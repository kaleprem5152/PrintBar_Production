/**
 * PATCH /api/device/jobs/[orderId]/progress  — Report printing progress
 * POST  /api/device/jobs/[orderId]/complete  — Report job complete
 * POST  /api/device/jobs/[orderId]/fail      — Report job failure
 * POST  /api/device/jobs/[orderId]/fallback  — Request fallback to Canon
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, orders, devicePrintJobs } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent, syncOrderToPrintJob } from "@/lib/server/orders";
import { cleanupOrderFiles } from "@/lib/server/files";
import { calculateRefundAmount, executeOrderRefund } from "@/lib/server/refunds";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orderId: string }> };

// ─── PATCH — progress update ──────────────────────────────────────────────────

export async function PATCH(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const { orderId } = await ctx.params;
  const { pagesPrinted, cupsJobId, status } = (await req.json().catch(() => ({}))) as {
    pagesPrinted?: number;
    cupsJobId?:    string;
    status?:       "processing" | "printing";
  };

  const [order] = await db.select().from(orders).where(
    and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!))
  );
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (pagesPrinted !== undefined) updates.pagesPrinted = pagesPrinted;
  if (cupsJobId)                  updates.cupsJobId    = cupsJobId;
  if (status === "printing" && order.status !== "printing") {
    updates.status        = "printing";
    updates.printStartedAt = new Date();
  } else if (status === "processing" && order.status === "queued") {
    updates.status = "processing";
  }

  await db.update(orders).set(updates).where(eq(orders.orderId, orderId));
  await syncOrderToPrintJob(orderId);

  return Response.json({ ok: true });
}

// ─── POST /complete ────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const { orderId } = await ctx.params;
  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  const [order] = await db.select().from(orders).where(
    and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!))
  );
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });

  // ── Complete ─────────────────────────────────────────────────────────────
  if (action === "complete") {
    const { pagesPrinted, cupsJobId } = (await req.json().catch(() => ({}))) as {
      pagesPrinted?: number;
      cupsJobId?:    string;
    };

    // Delete stored files from cloud temp storage with verified cleanup
    await cleanupOrderFiles(orderId);

    const now = new Date();
    await db.update(orders).set({
      status:          "completed",
      pagesPrinted:    pagesPrinted ?? order.pagesToPrint,
      cupsJobId:       cupsJobId ?? order.cupsJobId,
      completedAt:     now,
      pin:             null,  // Clear PIN on completion
      updatedAt:       now,
    }).where(eq(orders.orderId, orderId));

    // Update print job record
    await db.update(devicePrintJobs).set({
      completedAt:     now,
      pagesConfirmed:  pagesPrinted ?? order.pagesToPrint,
      cupsStatus:      "completed",
    }).where(
      and(
        eq(devicePrintJobs.orderId, orderId),
        eq(devicePrintJobs.deviceId, auth.deviceId!)
      )
    );

    // Deduct physical paper sheets from device inventory
    try {
      const printer = order.fallbackPrinter || order.printerUsed || (order.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x");
      const sheetsConsumed = order.physicalSheets || Math.max(1, Math.ceil((pagesPrinted ?? order.pagesToPrint) / (order.pagesPerSheet || 1)));

      const [dev] = await db.select().from(devices).where(eq(devices.id, auth.deviceId!));
      if (dev) {
        let newKyocera = dev.kyoceraPaper ?? 0;
        let newCanon = dev.canonPaper ?? 0;

        if (printer === "canon_gx6170") {
          newCanon = Math.max(0, newCanon - sheetsConsumed);
        } else {
          newKyocera = Math.max(0, newKyocera - sheetsConsumed);
        }

        const paperReady = newKyocera > 0 || newCanon > 0;
        await db.update(devices).set({
          kyoceraPaper: newKyocera,
          canonPaper:   newCanon,
          paperReady,
          updatedAt:    new Date(),
        }).where(eq(devices.id, auth.deviceId!));

        // Synchronize admin printers table
        try {
          const { printers: adminPrinters } = await import("@/db/schema");
          const allPrns = await db.select().from(adminPrinters);
          for (const prn of allPrns) {
            const isCanon = prn.supportsColor || prn.id.toLowerCase().includes("canon") || prn.name.toLowerCase().includes("colour");
            if ((printer === "canon_gx6170" && isCanon) || (printer !== "canon_gx6170" && !isCanon)) {
              const remaining = Math.max(0, (prn.paperRemaining ?? 0) - sheetsConsumed);
              await db.update(adminPrinters).set({
                paperRemaining: remaining,
                paperSource: "estimated",
                totalPages: (prn.totalPages ?? 0) + (pagesPrinted ?? order.pagesToPrint),
                lastSuccessfulPrintAt: new Date(),
              }).where(eq(adminPrinters.id, prn.id));
            }
          }
        } catch {
          // non-blocking
        }
      }
    } catch (paperErr) {
      console.warn("[jobs] Could not update device paper count:", (paperErr as Error).message);
    }

    await logAuditEvent({
      eventType: "print_completed",
      orderId,
      deviceId:  auth.deviceId,
      details:   { pagesPrinted, cupsJobId },
    });
    await logAuditEvent({
      eventType: "document_deleted",
      orderId,
      deviceId:  auth.deviceId,
      details:   { docCount: (order.docs as any[])?.length || 0 },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({ ok: true, status: "completed" });
  }

  // ── Fail ─────────────────────────────────────────────────────────────────
  if (action === "fail") {
    const { pagesPrinted, reason, cupsJobId } = (await req.json().catch(() => ({}))) as {
      pagesPrinted?: number;
      reason?:       string;
      cupsJobId?:    string;
    };

    const actualPagesPrinted = pagesPrinted ?? order.pagesPrinted;
    const refundCalc = calculateRefundAmount(order, actualPagesPrinted);

    let refundStatus = order.refundStatus ?? "NOT_REQUIRED";
    if (refundCalc.requiresReview) {
      refundStatus = "REFUND_REQUIRES_REVIEW";
    } else if (refundCalc.refundableAmount > 0) {
      refundStatus = "REFUND_REQUESTED";
    }

    await db.update(orders).set({
      status:           "failed",
      pagesPrinted:     actualPagesPrinted,
      cupsJobId:        cupsJobId ?? order.cupsJobId,
      failureReason:    reason ?? "unknown",
      refundableAmount: refundCalc.refundableAmount,
      refundStatus,
      updatedAt:        new Date(),
    }).where(eq(orders.orderId, orderId));

    await db.update(devicePrintJobs).set({
      failedAt:       new Date(),
      failureReason:  reason ?? "unknown",
      cupsStatus:     "failed",
      pagesAttempted: actualPagesPrinted,
    }).where(
      and(
        eq(devicePrintJobs.orderId, orderId),
        eq(devicePrintJobs.deviceId, auth.deviceId!)
      )
    );

    // If automatic refund is applicable and payment exists, trigger Cashfree refund
    if (refundStatus === "REFUND_REQUESTED" && order.cashfreePaymentId) {
      try {
        await executeOrderRefund({
          orderId,
          amount: refundCalc.refundableAmount,
          reason: refundCalc.reason,
          scenario: "hardware_failure_partial_print",
          initiatedBy: "system_printer_failure",
        });
      } catch (refundErr) {
        console.error(`[jobs] Automatic refund trigger failed for ${orderId}:`, (refundErr as Error).message);
      }
    }

    await logAuditEvent({
      eventType: "print_failed",
      orderId,
      deviceId:  auth.deviceId,
      details:   { reason, pagesPrinted: actualPagesPrinted, cupsJobId, refundStatus, refundableAmount: refundCalc.refundableAmount },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({ ok: true, status: "failed", refundStatus, refundableAmount: refundCalc.refundableAmount });
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  if (action === "fallback") {
    const { pagesPrinted, reason, previousCupsJobId } = (await req.json().catch(() => ({}))) as {
      pagesPrinted?:      number;
      reason?:            string;
      previousCupsJobId?: string;
    };

    // Only allow fallback if primary printer was Kyocera and job was B&W
    if (order.colorMode !== "bw") {
      return Response.json(
        { error: "Colour jobs cannot fall back — Canon is already the primary colour printer." },
        { status: 400 }
      );
    }

    if (order.status !== "printing" && order.status !== "processing") {
      return Response.json(
        { error: "Fallback is only allowed during active printing." },
        { status: 409 }
      );
    }

    const now = new Date();
    await db.update(orders).set({
      status:              "fallback_pending",
      pagesPrinted:        pagesPrinted ?? order.pagesPrinted,
      printBaseline:       pagesPrinted ?? order.pagesPrinted, // Resume from here
      fallbackPrinter:     "canon_gx6170",
      fallbackAt:          now,
      failureReason:       reason ?? "primary_printer_failed",
      cupsJobId:           previousCupsJobId ?? order.cupsJobId,
      updatedAt:           now,
    }).where(eq(orders.orderId, orderId));

    await logAuditEvent({
      eventType: "fallback_triggered",
      orderId,
      deviceId:  auth.deviceId,
      details:   { reason, pagesPrinted, previousCupsJobId },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok:           true,
      status:       "fallback_pending",
      resumeFromPage: (pagesPrinted ?? order.pagesPrinted) + 1,
      fallbackPrinter: "canon_gx6170",
    });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
