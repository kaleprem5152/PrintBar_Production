/**
 * PATCH /api/device/jobs/[orderId]/progress  — Report printing progress
 * POST  /api/device/jobs/[orderId]/complete  — Report job complete
 * POST  /api/device/jobs/[orderId]/fail      — Report job failure
 * POST  /api/device/jobs/[orderId]/fallback  — Request fallback to Canon
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, printJobs } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent } from "@/lib/server/orders";
import { deleteStoredFiles } from "@/lib/server/files";

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

    // Delete stored files from cloud temp storage
    const docs = order.docs as { id: string }[];
    await deleteStoredFiles(docs.map((d) => d.id));

    const now = new Date();
    await db.update(orders).set({
      status:          "completed",
      pagesPrinted:    pagesPrinted ?? order.pagesToPrint,
      cupsJobId:       cupsJobId ?? order.cupsJobId,
      filesDeleted:    true,
      filesDeletedAt:  now,
      completedAt:     now,
      pin:             null,  // Clear PIN on completion
      updatedAt:       now,
    }).where(eq(orders.orderId, orderId));

    // Update print job record
    await db.update(printJobs).set({
      completedAt:     now,
      pagesConfirmed:  pagesPrinted ?? order.pagesToPrint,
      cupsStatus:      "completed",
    }).where(
      and(
        eq(printJobs.orderId, orderId),
        eq(printJobs.deviceId, auth.deviceId!)
      )
    );

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
      details:   { docCount: docs.length },
    });

    return Response.json({ ok: true, status: "completed" });
  }

  // ── Fail ─────────────────────────────────────────────────────────────────
  if (action === "fail") {
    const { pagesPrinted, reason, cupsJobId } = (await req.json().catch(() => ({}))) as {
      pagesPrinted?: number;
      reason?:       string;
      cupsJobId?:    string;
    };

    await db.update(orders).set({
      status:        "failed",
      pagesPrinted:  pagesPrinted ?? order.pagesPrinted,
      cupsJobId:     cupsJobId ?? order.cupsJobId,
      failureReason: reason ?? "unknown",
      updatedAt:     new Date(),
    }).where(eq(orders.orderId, orderId));

    await db.update(printJobs).set({
      failedAt:      new Date(),
      failureReason: reason ?? "unknown",
      cupsStatus:    "failed",
      pagesAttempted: pagesPrinted ?? order.pagesPrinted,
    }).where(
      and(
        eq(printJobs.orderId, orderId),
        eq(printJobs.deviceId, auth.deviceId!)
      )
    );

    await logAuditEvent({
      eventType: "print_failed",
      orderId,
      deviceId:  auth.deviceId,
      details:   { reason, pagesPrinted, cupsJobId },
    });

    return Response.json({ ok: true, status: "failed" });
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

    return Response.json({
      ok:           true,
      status:       "fallback_pending",
      resumeFromPage: (pagesPrinted ?? order.pagesPrinted) + 1,
      fallbackPrinter: "canon_gx6170",
    });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
