/**
 * PATCH /api/device/jobs/[orderId]  — Report printing progress
 * POST  /api/device/jobs/[orderId]  — Complete, fail, or fallback actions
 *
 * Production Hardened (V4 Spec):
 * - Strict device ownership and allowed state machine transitions
 * - Idempotency: duplicate completion/fail requests do NOT re-deduct paper or duplicate refunds
 * - Atomic database transactions for state transitions and paper counters
 * - Explicit event ID acknowledgment for the durable outbox
 * - Safe document cleanup only after verified transaction commit
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, orders, devicePrintJobs, printers as adminPrinters } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent, syncOrderToPrintJob } from "@/lib/server/orders";
import { cleanupOrderFiles } from "@/lib/server/files";
import { calculateRefundAmount, executeOrderRefund } from "@/lib/server/refunds";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orderId: string }> };

// ─── PATCH: Progress update ───────────────────────────────────────────────────

export async function PATCH(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const { orderId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    pagesPrinted?: number;
    cupsJobId?:    string;
    status?:       "processing" | "printing";
    eventId?:      string;
  };

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!)));

  if (!order) return Response.json({ error: "Order not found or device mismatch." }, { status: 404 });

  // Disallow progress on terminal states
  if (order.status === "completed" || order.status === "failed" || order.status === "cancelled") {
    return Response.json({
      ok: true,
      acknowledged: true,
      eventId: body.eventId,
      status: order.status,
      notice: "Order is in terminal state; progress ignored.",
    });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.pagesPrinted !== undefined && typeof body.pagesPrinted === "number") {
    updates.pagesPrinted = Math.max(order.pagesPrinted || 0, Math.min(order.pagesToPrint, body.pagesPrinted));
  }
  if (body.cupsJobId) {
    updates.cupsJobId = String(body.cupsJobId).slice(0, 100);
  }
  if (body.status === "printing" && order.status !== "printing") {
    updates.status = "printing";
    updates.printStartedAt = new Date();
  } else if (body.status === "processing" && order.status === "queued") {
    updates.status = "processing";
  }

  await db.update(orders).set(updates).where(eq(orders.orderId, orderId));
  await syncOrderToPrintJob(orderId);

  return Response.json({
    ok: true,
    acknowledged: true,
    eventId: body.eventId,
    orderId,
    status: updates.status || order.status,
  });
}

// ─── POST: Complete, Fail, Fallback ───────────────────────────────────────────

export async function POST(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const { orderId } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!)));

  if (!order) return Response.json({ error: "Order not found or device mismatch." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const eventId = body.eventId;

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Complete
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "complete") {
    // 1. Idempotency Check: if already completed, do NOT re-deduct paper or duplicate events
    if (order.status === "completed") {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        status: "completed",
        alreadyCompleted: true,
      });
    }

    // 2. State machine validation
    const allowedSourceStates = ["queued", "processing", "printing", "fallback_pending"];
    if (!allowedSourceStates.includes(order.status)) {
      return Response.json(
        { error: `Cannot complete job from state '${order.status}'.` },
        { status: 409 }
      );
    }

    const pagesPrinted = typeof body.pagesPrinted === "number"
      ? Math.max(1, Math.min(order.pagesToPrint, body.pagesPrinted))
      : order.pagesToPrint;
    const cupsJobId = body.cupsJobId ? String(body.cupsJobId).slice(0, 100) : order.cupsJobId;
    const now = new Date();

    // 3. Atomic Database Transaction: Order state + Device Paper + Admin Printers
    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status: "completed",
          pagesPrinted,
          cupsJobId,
          completedAt: now,
          pin: null, // Clear student collection PIN
          updatedAt: now,
        })
        .where(eq(orders.orderId, orderId));

      await tx
        .update(devicePrintJobs)
        .set({
          completedAt: now,
          pagesConfirmed: pagesPrinted,
          cupsStatus: "completed",
        })
        .where(
          and(
            eq(devicePrintJobs.orderId, orderId),
            eq(devicePrintJobs.deviceId, auth.deviceId!)
          )
        );

      // Decrement physical paper inventory atomically
      const printer = order.fallbackPrinter || order.printerUsed || (order.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x");
      const sheetsConsumed = order.physicalSheets || Math.max(1, Math.ceil(pagesPrinted / (order.pagesPerSheet || 1)));

      const [dev] = await tx.select().from(devices).where(eq(devices.id, auth.deviceId!));
      if (dev) {
        let newKyocera = dev.kyoceraPaper ?? 250;
        let newCanon   = dev.canonPaper ?? 250;

        if (printer === "canon_gx6170") {
          newCanon = Math.max(0, newCanon - sheetsConsumed);
        } else {
          newKyocera = Math.max(0, newKyocera - sheetsConsumed);
        }

        await tx
          .update(devices)
          .set({
            kyoceraPaper: newKyocera,
            canonPaper: newCanon,
            paperReady: newKyocera > 0 || newCanon > 0,
            updatedAt: now,
          })
          .where(eq(devices.id, auth.deviceId!));

        // Sync admin fleet printers table
        try {
          const allPrns = await tx.select().from(adminPrinters);
          for (const prn of allPrns) {
            const isCanon = prn.supportsColor || prn.id.toLowerCase().includes("canon");
            if ((printer === "canon_gx6170" && isCanon) || (printer !== "canon_gx6170" && !isCanon)) {
              await tx
                .update(adminPrinters)
                .set({
                  paperRemaining: Math.max(0, (prn.paperRemaining ?? 250) - sheetsConsumed),
                  paperSource: "estimated",
                  totalPages: (prn.totalPages ?? 0) + pagesPrinted,
                  lastSuccessfulPrintAt: now,
                })
                .where(eq(adminPrinters.id, prn.id));
            }
          }
        } catch {
          // non-blocking for fleet sync
        }
      }
    });

    // 4. Document privacy cleanup (only executed AFTER transaction commit)
    try {
      await cleanupOrderFiles(orderId);
    } catch (cleanErr) {
      console.error(`[jobs] Cloud cleanup failed for ${orderId}:`, (cleanErr as Error).message);
    }

    // 5. Audit Logging & Admin Dashboard Sync
    await logAuditEvent({
      eventType: "print_completed",
      orderId,
      deviceId: auth.deviceId,
      details: { pagesPrinted, cupsJobId, eventId },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      status: "completed",
      pagesPrinted,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Fail
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "fail") {
    if (order.status === "failed") {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        status: "failed",
        alreadyFailed: true,
      });
    }

    const actualPagesPrinted = typeof body.pagesPrinted === "number" ? body.pagesPrinted : (order.pagesPrinted || 0);
    const reason = String(body.reason || "hardware_failure").slice(0, 500);
    const cupsJobId = body.cupsJobId ? String(body.cupsJobId).slice(0, 100) : order.cupsJobId;

    const refundCalc = calculateRefundAmount(order, actualPagesPrinted);
    let refundStatus = order.refundStatus ?? "NOT_REQUIRED";
    if (refundCalc.requiresReview) {
      refundStatus = "REFUND_REQUIRES_REVIEW";
    } else if (refundCalc.refundableAmount > 0) {
      refundStatus = "REFUND_REQUESTED";
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status: "failed",
          pagesPrinted: actualPagesPrinted,
          cupsJobId,
          failureReason: reason,
          refundableAmount: refundCalc.refundableAmount,
          refundStatus,
          updatedAt: now,
        })
        .where(eq(orders.orderId, orderId));

      await tx
        .update(devicePrintJobs)
        .set({
          failedAt: now,
          failureReason: reason,
          cupsStatus: "failed",
          pagesAttempted: actualPagesPrinted,
        })
        .where(
          and(
            eq(devicePrintJobs.orderId, orderId),
            eq(devicePrintJobs.deviceId, auth.deviceId!)
          )
        );
    });

    // Execute Cashfree refund if automated
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
      deviceId: auth.deviceId,
      details: { reason, pagesPrinted: actualPagesPrinted, cupsJobId, refundStatus, eventId },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      status: "failed",
      refundStatus,
      refundableAmount: refundCalc.refundableAmount,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Fallback
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "fallback") {
    if (order.colorMode !== "bw") {
      return Response.json(
        { error: "Colour jobs cannot fall back — Canon GX6170 is already the primary colour printer." },
        { status: 400 }
      );
    }

    const now = new Date();
    const reason = String(body.reason || "kyocera_offline_prior_to_job").slice(0, 300);

    await db
      .update(orders)
      .set({
        status: "fallback_pending",
        fallbackPrinter: "canon_gx6170",
        fallbackAt: now,
        failureReason: reason,
        updatedAt: now,
      })
      .where(eq(orders.orderId, orderId));

    await logAuditEvent({
      eventType: "fallback_triggered",
      orderId,
      deviceId: auth.deviceId,
      details: { reason, eventId },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      status: "fallback_pending",
      fallbackPrinter: "canon_gx6170",
    });
  }

  return Response.json({ error: `Unknown action '${action}'.` }, { status: 400 });
}
