/**
 * PATCH /api/device/jobs/[orderId]  — Report printing progress for a specific attempt
 * POST  /api/device/jobs/[orderId]  — processing, attempt, bind, complete, fail, or fallback actions
 *
 * Production Hardened (Print-Attempt Identity & CUPS Ownership Spec):
 * - Every print attempt has a unique backend-generated attemptId
 * - Progress & completion resolve strictly by attemptId (never by orderId+deviceId alone or .limit(1))
 * - CUPS job ID must be bound to an attempt before progress or completion events are accepted
 * - Unique DB constraint enforces 1-to-1 ownership between (deviceId, cupsJobId) and attempt
 * - Late events from failed/superseded/completed attempts cannot modify newer attempts or order state
 * - Partial completion is routed to refund_pending / requires_manual_review (never marked completed)
 * - Paper inventory & fleet statistics deduct strictly from the attempt's validated actual printer
 * - Fail-closed durable event idempotency via device_events
 */
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { devices, orders, devicePrintJobs, deviceEvents, printers as adminPrinters } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent, syncOrderToPrintJob } from "@/lib/server/orders";
import { cleanupOrderFiles } from "@/lib/server/files";
import { calculateRefundAmount, executeOrderRefund } from "@/lib/server/refunds";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orderId: string }> };

function normalizePrinter(raw?: unknown): "kyocera_pa3500x" | "canon_gx6170" | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "kyocera_pa3500x" || v === "printbar-kyocera" || v === "kyocera") return "kyocera_pa3500x";
  if (v === "canon_gx6170" || v === "printbar-canon" || v === "canon") return "canon_gx6170";
  return null;
}

function isPgUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function checkEventIdempotency(eventId: string) {
  try {
    const [ev] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.eventId, eventId));
    return { ok: true as const, existing: ev ?? null };
  } catch (dbErr) {
    console.error(`[jobs] Durable event lookup failed for eventId ${eventId}:`, (dbErr as Error).message);
    return {
      ok: false as const,
      response: Response.json(
        { error: "Durable idempotency store unavailable. Request rejected to prevent duplicate operations.", eventId },
        { status: 503 }
      ),
    };
  }
}

// ─── PATCH: Attempt-scoped progress update ────────────────────────────────────

export async function PATCH(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const { orderId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    eventId?:      string;
    attemptId?:    string;
    printer?:      string;
    cupsJobId?:    string;
    pagesPrinted?: number;
    status?:       "processing" | "printing";
  };

  const eventId = body.eventId;
  if (!eventId || typeof eventId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(eventId)) {
    return Response.json({ error: "Missing or invalid progress eventId." }, { status: 400 });
  }

  const idem = await checkEventIdempotency(eventId);
  if (!idem.ok) return idem.response;
  if (idem.existing) {
    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      duplicateEvent: true,
      ...(idem.existing.payload ?? {}),
    });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!)));

  if (!order) return Response.json({ error: "Order not found or device mismatch." }, { status: 404 });

  // Require exact attempt identity, printer, and bound CUPS job ID
  const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
  if (!attemptId) {
    return Response.json({ error: "Explicit attemptId is required on progress events." }, { status: 400 });
  }

  const canonicalPrinter = normalizePrinter(body.printer);
  if (!canonicalPrinter) {
    return Response.json(
      { error: `Invalid or missing printer '${String(body.printer ?? "")}' for kiosk PB-K01.` },
      { status: 400 }
    );
  }

  const cupsJobId = typeof body.cupsJobId === "string" ? body.cupsJobId.trim().slice(0, 100) : "";
  if (!cupsJobId) {
    return Response.json({ error: "Explicit cupsJobId is required on progress events." }, { status: 400 });
  }

  // Resolve exact attempt strictly by unique attemptId
  const [attempt] = await db
    .select()
    .from(devicePrintJobs)
    .where(eq(devicePrintJobs.attemptId, attemptId));

  if (!attempt || attempt.orderId !== orderId || attempt.deviceId !== auth.deviceId!) {
    return Response.json(
      { error: `Attempt '${attemptId}' not found for order '${orderId}' on device '${auth.deviceId}'.` },
      { status: 404 }
    );
  }

  if (attempt.printerName !== canonicalPrinter) {
    return Response.json(
      { error: `Printer mismatch for attempt '${attemptId}': recorded '${attempt.printerName}', got '${canonicalPrinter}'.` },
      { status: 422 }
    );
  }

  if (!attempt.cupsJobId) {
    return Response.json(
      { error: `Attempt '${attemptId}' has no persisted CUPS job ID yet. Bind CUPS job ID before sending progress.` },
      { status: 422 }
    );
  }

  if (attempt.cupsJobId !== cupsJobId) {
    return Response.json(
      { error: `CUPS job ID mismatch for attempt '${attemptId}': expected '${attempt.cupsJobId}', got '${cupsJobId}'.` },
      { status: 422 }
    );
  }

  if (!["queued", "printing"].includes(attempt.status)) {
    return Response.json(
      { error: `Attempt '${attemptId}' is already in state '${attempt.status}'; late progress rejected.` },
      { status: 409 }
    );
  }

  const now = new Date();
  const attemptMaxPages = attempt.pagesAttempted > 0 ? attempt.pagesAttempted : order.pagesToPrint;
  const requestedPages = typeof body.pagesPrinted === "number" ? Math.max(0, body.pagesPrinted) : attempt.pagesConfirmed;
  const monotonicAttemptPages = Math.max(attempt.pagesConfirmed || 0, Math.min(attemptMaxPages, requestedPages));
  const pagesPerSheet = Math.max(1, order.pagesPerSheet || 1);
  const monotonicAttemptSheets = Math.max(attempt.sheetsConfirmed || 0, Math.ceil(monotonicAttemptPages / pagesPerSheet));

  try {
    await db.transaction(async (tx) => {
      await tx.insert(deviceEvents).values({
        eventId,
        orderId,
        deviceId: auth.deviceId!,
        action: "progress",
        payload: {
          attemptId,
          cupsJobId,
          printer: canonicalPrinter,
          pagesConfirmed: monotonicAttemptPages,
        },
      });

      await tx
        .update(devicePrintJobs)
        .set({
          pagesConfirmed: monotonicAttemptPages,
          sheetsConfirmed: monotonicAttemptSheets,
          status: "printing",
          cupsStatus: "printing",
        })
        .where(eq(devicePrintJobs.attemptId, attemptId));

      // Aggregate monotonic confirmed pages across active/completed attempts
      const allAttempts = await tx
        .select()
        .from(devicePrintJobs)
        .where(eq(devicePrintJobs.orderId, orderId));

      const aggregatePages = Math.min(
        order.pagesToPrint,
        allAttempts
          .filter((a) => ["printing", "completed", "partial"].includes(a.status))
          .reduce((acc, a) => acc + (a.attemptId === attemptId ? monotonicAttemptPages : (a.pagesConfirmed || 0)), 0)
      );

      const orderUpdates: Record<string, unknown> = {
        pagesPrinted: Math.max(order.pagesPrinted || 0, aggregatePages),
        updatedAt: now,
      };
      if (["queued", "processing", "fallback_pending"].includes(order.status)) {
        orderUpdates.status = order.fallbackPrinter ? "fallback_printing" : "printing";
        orderUpdates.printStartedAt = order.printStartedAt || now;
      }

      await tx.update(orders).set(orderUpdates).where(eq(orders.orderId, orderId));
    });
  } catch (dbErr) {
    console.error(`[jobs] Progress transaction failed for ${attemptId}:`, (dbErr as Error).message);
    return Response.json({ error: "Database unavailable while persisting progress." }, { status: 503 });
  }

  await syncOrderToPrintJob(orderId);

  return Response.json({
    ok: true,
    acknowledged: true,
    eventId,
    orderId,
    attemptId,
    cupsJobId,
    printer: canonicalPrinter,
    pagesPrinted: monotonicAttemptPages,
    status: "printing",
  });
}

// ─── POST: processing | attempt | bind | complete | fail | fallback ───────────

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

  if (!eventId || typeof eventId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(eventId)) {
    return Response.json({ error: "Missing or invalid eventId." }, { status: 400 });
  }

  if (body.orderId && body.orderId !== orderId) {
    return Response.json(
      { error: `Order ID mismatch: URL '${orderId}', payload '${String(body.orderId)}'.` },
      { status: 422 }
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Processing (pre-submission download state transition)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "processing") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({ ok: true, acknowledged: true, eventId, status: order.status, duplicateEvent: true });
    }

    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "processing",
          payload: {},
        });
        if (order.status === "queued") {
          await tx.update(orders).set({ status: "processing", updatedAt: now }).where(eq(orders.orderId, orderId));
        }
      });
    } catch (dbErr) {
      return Response.json({ error: `Database unavailable: ${(dbErr as Error).message}` }, { status: 503 });
    }

    await syncOrderToPrintJob(orderId);
    return Response.json({ ok: true, acknowledged: true, eventId, status: order.status === "queued" ? "processing" : order.status });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Attempt (Create a new unique print attempt for retry/fallback/reroute)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "attempt") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        duplicateEvent: true,
        ...(idem.existing.payload ?? {}),
      });
    }

    const canonicalPrinter = normalizePrinter(body.printer);
    if (!canonicalPrinter) {
      return Response.json(
        { error: `Printer '${String(body.printer ?? "")}' does not belong to kiosk PB-K01.` },
        { status: 400 }
      );
    }

    const isFallback = Boolean(body.isFallback);
    const docId = typeof body.docId === "string" && body.docId.trim() ? body.docId.trim().slice(0, 100) : null;
    const supersedeAttemptId = typeof body.supersedeAttemptId === "string" ? body.supersedeAttemptId.trim() : null;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;
    const pagesAttempted = Math.max(
      1,
      typeof body.pagesAttempted === "number" && body.pagesAttempted > 0 ? body.pagesAttempted : order.pagesToPrint
    );
    const pagesPerSheet = Math.max(1, order.pagesPerSheet || 1);
    const sheetsAttempted = Math.max(1, Math.ceil(pagesAttempted / pagesPerSheet));
    const now = new Date();

    let createdAttempt: typeof devicePrintJobs.$inferSelect;
    try {
      createdAttempt = await db.transaction(async (tx) => {
        if (supersedeAttemptId) {
          const [prior] = await tx
            .select()
            .from(devicePrintJobs)
            .where(eq(devicePrintJobs.attemptId, supersedeAttemptId));

          if (!prior || prior.orderId !== orderId || prior.deviceId !== auth.deviceId!) {
            throw new Error(`SUPERSEDE_NOT_FOUND:${supersedeAttemptId}`);
          }

          if (["queued", "printing"].includes(prior.status)) {
            await tx
              .update(devicePrintJobs)
              .set({
                status: "superseded",
                failedAt: now,
                failureReason: reason || "Superseded by retry or fallback attempt",
              })
              .where(eq(devicePrintJobs.attemptId, supersedeAttemptId));
          }
        }

        const existingAttempts = await tx
          .select({ attemptNo: devicePrintJobs.attemptNo, jobRef: devicePrintJobs.jobRef })
          .from(devicePrintJobs)
          .where(eq(devicePrintJobs.orderId, orderId));

        const maxNo = existingAttempts.reduce((m, r) => Math.max(m, r.attemptNo || 0), 0);
        const jobRef = existingAttempts[0]?.jobRef || `JOB-${randomBytes(6).toString("hex").toUpperCase()}`;
        const attemptId = `ATT-${randomBytes(8).toString("hex").toUpperCase()}`;

        const [inserted] = await tx
          .insert(devicePrintJobs)
          .values({
            attemptId,
            orderId,
            attemptNo: maxNo + 1,
            docId,
            jobRef,
            deviceId: auth.deviceId!,
            printerName: canonicalPrinter,
            cupsJobId: null,
            status: "queued",
            isFallback,
            pagesAttempted,
            sheetsAttempted,
          })
          .returning();

        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "attempt",
          payload: {
            attemptId: inserted.attemptId,
            attemptNo: inserted.attemptNo,
            printerName: canonicalPrinter,
            docId,
            isFallback,
          },
        });

        if (isFallback) {
          await tx
            .update(orders)
            .set({
              fallbackPrinter: canonicalPrinter,
              fallbackAt: now,
              updatedAt: now,
            })
            .where(eq(orders.orderId, orderId));
        }

        return inserted;
      });
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.startsWith("SUPERSEDE_NOT_FOUND:")) {
        return Response.json({ error: `Prior attempt '${supersedeAttemptId}' not found for order.` }, { status: 404 });
      }
      console.error(`[jobs] Attempt creation failed for ${orderId}:`, msg);
      return Response.json({ error: "Database unavailable while creating print attempt." }, { status: 503 });
    }

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      attemptId: createdAttempt.attemptId,
      attemptNo: createdAttempt.attemptNo,
      docId: createdAttempt.docId,
      printerName: createdAttempt.printerName,
      status: createdAttempt.status,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Bind (Persist 1-to-1 CUPS job ID ownership onto exact attempt)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "bind") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        duplicateEvent: true,
        ...(idem.existing.payload ?? {}),
      });
    }

    const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    const cupsJobId = typeof body.cupsJobId === "string" ? body.cupsJobId.trim().slice(0, 100) : "";
    const canonicalPrinter = normalizePrinter(body.printer);

    if (!attemptId || !cupsJobId || !canonicalPrinter) {
      return Response.json(
        { error: "attemptId, valid printer, and cupsJobId are required to bind a CUPS job." },
        { status: 400 }
      );
    }

    const now = new Date();
    try {
      const outcome = await db.transaction(async (tx) => {
        const [attempt] = await tx
          .select()
          .from(devicePrintJobs)
          .where(eq(devicePrintJobs.attemptId, attemptId));

        if (!attempt || attempt.orderId !== orderId || attempt.deviceId !== auth.deviceId!) {
          return { status: 404 as const, error: `Attempt '${attemptId}' not found for order '${orderId}'.` };
        }

        if (attempt.printerName !== canonicalPrinter) {
          return {
            status: 422 as const,
            error: `Printer mismatch binding attempt '${attemptId}': attempt belongs to '${attempt.printerName}', got '${canonicalPrinter}'.`,
          };
        }

        if (!["queued", "printing"].includes(attempt.status)) {
          return {
            status: 409 as const,
            error: `Cannot bind CUPS job ID to inactive attempt '${attemptId}' in state '${attempt.status}'.`,
          };
        }

        if (attempt.cupsJobId) {
          if (attempt.cupsJobId === cupsJobId) {
            await tx.insert(deviceEvents).values({
              eventId,
              orderId,
              deviceId: auth.deviceId!,
              action: "bind",
              payload: { attemptId, cupsJobId, printerName: canonicalPrinter, alreadyBound: true },
            });
            return { status: 200 as const, alreadyBound: true };
          }
          return {
            status: 409 as const,
            error: `Attempt '${attemptId}' is already bound to CUPS job '${attempt.cupsJobId}'. Overwriting with '${cupsJobId}' is forbidden.`,
          };
        }

        // Enforce 1-to-1 CUPS job ownership across all attempts on this device
        const [conflict] = await tx
          .select({ attemptId: devicePrintJobs.attemptId })
          .from(devicePrintJobs)
          .where(
            and(
              eq(devicePrintJobs.deviceId, auth.deviceId!),
              eq(devicePrintJobs.cupsJobId, cupsJobId)
            )
          );

        if (conflict && conflict.attemptId !== attemptId) {
          return {
            status: 409 as const,
            error: `CUPS job '${cupsJobId}' is already bound to attempt '${conflict.attemptId}'. Duplicate CUPS claims are forbidden.`,
          };
        }

        await tx
          .update(devicePrintJobs)
          .set({
            cupsJobId,
            status: "printing",
            cupsStatus: "pending",
          })
          .where(eq(devicePrintJobs.attemptId, attemptId));

        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "bind",
          payload: { attemptId, cupsJobId, printerName: canonicalPrinter },
        });

        const nextOrderStatus = attempt.isFallback ? "fallback_printing" : "printing";
        await tx
          .update(orders)
          .set({
            status: ["queued", "processing", "fallback_pending"].includes(order.status) ? nextOrderStatus : order.status,
            printStartedAt: order.printStartedAt || now,
            cupsJobId: order.cupsJobId || cupsJobId,
            printerUsed: order.printerUsed || canonicalPrinter,
            updatedAt: now,
          })
          .where(eq(orders.orderId, orderId));

        return { status: 200 as const, alreadyBound: false };
      });

      if (outcome.status !== 200) {
        return Response.json({ error: outcome.error }, { status: outcome.status });
      }
    } catch (dbErr) {
      if (isPgUniqueViolation(dbErr)) {
        return Response.json(
          { error: `CUPS job '${cupsJobId}' is already claimed by another attempt (unique constraint violation).` },
          { status: 409 }
        );
      }
      console.error(`[jobs] Bind transaction failed for ${attemptId}:`, (dbErr as Error).message);
      return Response.json({ error: "Database unavailable while binding CUPS job ID." }, { status: 503 });
    }

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      attemptId,
      cupsJobId,
      printerName: canonicalPrinter,
      status: "printing",
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Complete (Strict attempt-level verification & transactional accounting)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "complete") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        status: order.status,
        alreadyCompleted: order.status === "completed",
        duplicateEvent: true,
        ...(idem.existing.payload ?? {}),
      });
    }

    const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    if (!attemptId) {
      return Response.json({ error: "Explicit attemptId is required for completion." }, { status: 400 });
    }

    const cupsJobId = typeof body.cupsJobId === "string" ? body.cupsJobId.trim().slice(0, 100) : "";
    if (!cupsJobId) {
      return Response.json({ error: "Explicit CUPS job ID evidence is required for completion." }, { status: 400 });
    }

    const canonicalPrinter = normalizePrinter(body.printer);
    if (!canonicalPrinter) {
      return Response.json(
        { error: `Printer '${String(body.printer ?? "")}' does not belong to kiosk PB-K01.` },
        { status: 400 }
      );
    }

    if (typeof body.pagesPrinted !== "number" || body.pagesPrinted <= 0) {
      return Response.json(
        { error: "Explicit verified pagesPrinted counter (>0) is required for completion." },
        { status: 400 }
      );
    }

    // Resolve the exact recorded attempt by unique attemptId (NEVER .limit(1) by orderId)
    const [attempt] = await db
      .select()
      .from(devicePrintJobs)
      .where(eq(devicePrintJobs.attemptId, attemptId));

    if (!attempt || attempt.orderId !== orderId || attempt.deviceId !== auth.deviceId!) {
      return Response.json(
        { error: `Recorded print attempt '${attemptId}' not found for order '${orderId}' on device '${auth.deviceId}'.` },
        { status: 404 }
      );
    }

    // Validate printer ownership against recorded attempt
    if (attempt.printerName !== canonicalPrinter) {
      return Response.json(
        { error: `Printer mismatch with recorded attempt '${attemptId}': attempt is for '${attempt.printerName}', completion reported '${canonicalPrinter}'.` },
        { status: 422 }
      );
    }

    // Validate persisted CUPS job ownership
    if (!attempt.cupsJobId) {
      return Response.json(
        { error: `Attempt '${attemptId}' has no persisted CUPS job ID bound. Bind CUPS job ID before completing.` },
        { status: 422 }
      );
    }

    if (attempt.cupsJobId !== cupsJobId) {
      return Response.json(
        { error: `CUPS job ownership verification failed for attempt '${attemptId}': expected '${attempt.cupsJobId}', got '${cupsJobId}'.` },
        { status: 422 }
      );
    }

    // Attempt idempotency: already completed/partial attempt returns ack WITHOUT re-deducting paper
    if (attempt.status === "completed" || attempt.status === "partial") {
      await db
        .insert(deviceEvents)
        .values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "complete",
          payload: { attemptId, cupsJobId, printerUsed: canonicalPrinter, alreadyCompleted: true },
        })
        .onConflictDoNothing();

      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        attemptId,
        attemptStatus: attempt.status,
        status: order.status,
        alreadyCompleted: true,
      });
    }

    // Reject late completion from failed/superseded/manual_review attempts
    if (!["queued", "printing"].includes(attempt.status)) {
      return Response.json(
        { error: `Cannot complete attempt '${attemptId}' from inactive state '${attempt.status}'.` },
        { status: 409 }
      );
    }

    const allowedOrderStates = ["queued", "processing", "printing", "fallback_pending", "fallback_printing"];
    if (!allowedOrderStates.includes(order.status)) {
      return Response.json(
        { error: `Cannot complete order from state '${order.status}'. Allowed states: ${allowedOrderStates.join(", ")}.` },
        { status: 409 }
      );
    }

    const attemptExpectedPages = attempt.pagesAttempted > 0 ? attempt.pagesAttempted : order.pagesToPrint;
    const verifiedPages = Math.min(attemptExpectedPages, Math.max(0, body.pagesPrinted));
    const isAttemptPartial = verifiedPages < attemptExpectedPages;
    const attemptStatus = isAttemptPartial ? "partial" : "completed";
    const pagesPerSheet = Math.max(1, order.pagesPerSheet || 1);
    const sheetsConsumed = Math.max(1, Math.ceil(verifiedPages / pagesPerSheet));
    const isCanon = canonicalPrinter === "canon_gx6170";
    const now = new Date();

    let txOutcome: {
      orderStatus: "printing" | "completed" | "refund_pending" | "requires_manual_review";
      totalConfirmedPages: number;
      totalConfirmedSheets: number;
      refundCalc: ReturnType<typeof calculateRefundAmount> | null;
      refundStatus: string;
    };

    try {
      txOutcome = await db.transaction(async (tx) => {
        // Re-verify attempt inside transaction with atomic CAS update
        const [updatedAttempt] = await tx
          .update(devicePrintJobs)
          .set({
            status: attemptStatus,
            completedAt: isAttemptPartial ? null : now,
            failedAt: isAttemptPartial ? now : null,
            failureReason: isAttemptPartial
              ? `Partial output verified: ${verifiedPages}/${attemptExpectedPages} pages printed.`
              : null,
            pagesConfirmed: verifiedPages,
            sheetsConfirmed: sheetsConsumed,
            cupsStatus: attemptStatus,
          })
          .where(
            and(
              eq(devicePrintJobs.attemptId, attemptId),
              inArray(devicePrintJobs.status, ["queued", "printing"])
            )
          )
          .returning();

        if (!updatedAttempt) {
          throw new Error("ATTEMPT_STATE_RACE");
        }

        // Aggregate verified output across all completed/partial attempts for this order
        const orderAttempts = await tx
          .select()
          .from(devicePrintJobs)
          .where(eq(devicePrintJobs.orderId, orderId));

        const confirmedRows = orderAttempts.filter((a) => a.status === "completed" || a.status === "partial");
        const totalConfirmedPages = Math.min(
          order.pagesToPrint,
          confirmedRows.reduce((s, a) => s + (a.pagesConfirmed || 0), 0)
        );
        const totalConfirmedSheets = confirmedRows.reduce((s, a) => s + (a.sheetsConfirmed || 0), 0);

        let orderStatus: "printing" | "completed" | "refund_pending" | "requires_manual_review" = "printing";
        let refundStatus = order.refundStatus ?? "NOT_REQUIRED";
        let refundCalc: ReturnType<typeof calculateRefundAmount> | null = null;

        if (isAttemptPartial) {
          refundCalc = calculateRefundAmount(order, totalConfirmedSheets);
          if (refundCalc.requiresReview) {
            orderStatus = "requires_manual_review";
            refundStatus = "REFUND_REQUIRES_REVIEW";
          } else if (refundCalc.refundableAmount > 0) {
            orderStatus = "refund_pending";
            refundStatus = "REFUND_REQUESTED";
          } else {
            orderStatus = "requires_manual_review";
            refundStatus = "REFUND_REQUIRES_REVIEW";
          }
        } else if (totalConfirmedPages >= order.pagesToPrint) {
          orderStatus = "completed";
          refundStatus = "NOT_REQUIRED";
        } else {
          // Multi-document order: this document completed, more documents remain
          orderStatus = "printing";
        }

        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "complete",
          payload: {
            attemptId,
            cupsJobId,
            printerUsed: canonicalPrinter,
            pagesPrinted: verifiedPages,
            sheetsConsumed,
            partial: isAttemptPartial,
            orderStatus,
          },
        });

        const isTerminal = orderStatus === "completed" || orderStatus === "refund_pending" || orderStatus === "requires_manual_review";
        await tx
          .update(orders)
          .set({
            status: orderStatus,
            pagesPrinted: totalConfirmedPages,
            sheetsPrinted: totalConfirmedSheets,
            cupsJobId,
            printerUsed: canonicalPrinter,
            completedAt: orderStatus === "completed" ? now : null,
            failureReason: isAttemptPartial
              ? `Partial output verified: ${totalConfirmedPages}/${order.pagesToPrint} pages printed.`
              : null,
            refundableAmount: refundCalc?.refundableAmount ?? 0,
            refundStatus,
            pin: isTerminal ? null : order.pin,
            updatedAt: now,
          })
          .where(eq(orders.orderId, orderId));

        // Decrement physical paper strictly on the attempt's validated actual printer
        const [dev] = await tx.select().from(devices).where(eq(devices.id, auth.deviceId!));
        if (dev) {
          let newKyocera = dev.kyoceraPaper ?? 250;
          let newCanon = dev.canonPaper ?? 250;

          if (isCanon) {
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

          try {
            const allPrns = await tx.select().from(adminPrinters);
            for (const prn of allPrns) {
              const prnIsCanon = prn.supportsColor || prn.id.toLowerCase().includes("canon");
              if ((isCanon && prnIsCanon) || (!isCanon && !prnIsCanon)) {
                await tx
                  .update(adminPrinters)
                  .set({
                    paperRemaining: Math.max(0, (prn.paperRemaining ?? 250) - sheetsConsumed),
                    paperSource: "estimated",
                    totalPages: (prn.totalPages ?? 0) + verifiedPages,
                    lastSuccessfulPrintAt: now,
                  })
                  .where(eq(adminPrinters.id, prn.id));
              }
            }
          } catch {
            // non-blocking for fleet sync
          }
        }

        return { orderStatus, totalConfirmedPages, totalConfirmedSheets, refundCalc, refundStatus };
      });
    } catch (dbErr) {
      if ((dbErr as Error).message === "ATTEMPT_STATE_RACE") {
        return Response.json(
          { error: `Attempt '${attemptId}' state changed concurrently; completion rejected.` },
          { status: 409 }
        );
      }
      console.error(`[jobs] Completion transaction failed for ${attemptId}:`, (dbErr as Error).message);
      return Response.json({ error: "Database unavailable while completing print attempt." }, { status: 503 });
    }

    // Automatic partial refund only after commit
    if (isAttemptPartial && txOutcome.refundCalc && txOutcome.refundCalc.refundableAmount > 0 && !txOutcome.refundCalc.requiresReview) {
      try {
        await executeOrderRefund({
          orderId,
          amount: txOutcome.refundCalc.refundableAmount,
          reason: txOutcome.refundCalc.reason,
          scenario: "hardware_failure_partial_print",
          initiatedBy: "system_partial_print",
        });
      } catch (refundErr) {
        console.error(`[jobs] Automatic partial refund failed for ${orderId}:`, (refundErr as Error).message);
      }
    }

    // Document cleanup only when the entire order has reached terminal completion/refund/manual-review
    if (["completed", "refund_pending", "requires_manual_review"].includes(txOutcome.orderStatus)) {
      try {
        await cleanupOrderFiles(orderId);
      } catch (cleanErr) {
        console.error(`[jobs] Cloud cleanup failed for ${orderId}:`, (cleanErr as Error).message);
      }
    }

    await logAuditEvent({
      eventType: isAttemptPartial ? "print_failed" : "print_completed",
      orderId,
      deviceId: auth.deviceId,
      details: {
        attemptId,
        pagesPrinted: verifiedPages,
        totalOrderPagesConfirmed: txOutcome.totalConfirmedPages,
        pagesExpected: order.pagesToPrint,
        cupsJobId,
        printerUsed: canonicalPrinter,
        partial: isAttemptPartial,
        orderStatus: txOutcome.orderStatus,
        refundStatus: txOutcome.refundStatus,
        refundableAmount: txOutcome.refundCalc?.refundableAmount ?? 0,
        eventId,
      },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      attemptId,
      attemptStatus,
      status: txOutcome.orderStatus,
      partial: isAttemptPartial,
      pagesPrinted: verifiedPages,
      totalOrderPagesConfirmed: txOutcome.totalConfirmedPages,
      pagesExpected: order.pagesToPrint,
      sheetsConsumed,
      printerUsed: canonicalPrinter,
      refundStatus: txOutcome.refundStatus,
      refundableAmount: txOutcome.refundCalc?.refundableAmount ?? 0,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Fail (Attempt-aware failure & partial/full refund calculation)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "fail") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        status: order.status,
        alreadyFailed: order.status === "failed",
        duplicateEvent: true,
      });
    }

    if (order.status === "failed") {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        status: "failed",
        alreadyFailed: true,
      });
    }

    const attemptId = typeof body.attemptId === "string" && body.attemptId.trim() ? body.attemptId.trim() : null;
    const reason = String(body.reason || "hardware_failure").slice(0, 500);
    const isManualReview = Boolean(body.manualReview) || reason.toLowerCase().includes("manual_review") || reason.toLowerCase().includes("uncertain");
    const pagesPerSheet = Math.max(1, order.pagesPerSheet || 1);
    const reportedPages = typeof body.pagesPrinted === "number" ? Math.max(0, body.pagesPrinted) : 0;
    const now = new Date();

    let failOutcome: {
      finalOrderStatus: "failed" | "requires_manual_review" | "refund_pending";
      refundCalc: ReturnType<typeof calculateRefundAmount>;
      refundStatus: string;
      totalConfirmedPages: number;
    };

    try {
      failOutcome = await db.transaction(async (tx) => {
        if (attemptId) {
          const [att] = await tx
            .select()
            .from(devicePrintJobs)
            .where(eq(devicePrintJobs.attemptId, attemptId));

          if (!att || att.orderId !== orderId || att.deviceId !== auth.deviceId!) {
            throw new Error(`ATTEMPT_NOT_FOUND:${attemptId}`);
          }

          if (["queued", "printing"].includes(att.status)) {
            await tx
              .update(devicePrintJobs)
              .set({
                status: isManualReview ? "manual_review" : "failed",
                failedAt: now,
                failureReason: reason,
                pagesConfirmed: reportedPages,
                sheetsConfirmed: reportedPages > 0 ? Math.ceil(reportedPages / pagesPerSheet) : 0,
                cupsStatus: isManualReview ? "manual_review" : "failed",
              })
              .where(eq(devicePrintJobs.attemptId, attemptId));
          }
        }

        const allAttempts = await tx
          .select()
          .from(devicePrintJobs)
          .where(eq(devicePrintJobs.orderId, orderId));

        const confirmedRows = allAttempts.filter((a) => a.status === "completed" || a.status === "partial");
        const totalConfirmedPages = Math.min(
          order.pagesToPrint,
          confirmedRows.reduce((s, a) => s + (a.pagesConfirmed || 0), 0)
        );
        const totalConfirmedSheets = confirmedRows.reduce((s, a) => s + (a.sheetsConfirmed || 0), 0);

        const finalOrderStatus: "failed" | "requires_manual_review" | "refund_pending" = isManualReview
          ? "requires_manual_review"
          : totalConfirmedSheets > 0
            ? "refund_pending"
            : "failed";

        const refundCalc = calculateRefundAmount(
          { ...order, status: finalOrderStatus },
          isManualReview && reportedPages > 0 ? totalConfirmedSheets + Math.ceil(reportedPages / pagesPerSheet) : totalConfirmedSheets
        );

        let refundStatus = order.refundStatus ?? "NOT_REQUIRED";
        if (refundCalc.requiresReview || isManualReview) {
          refundStatus = "REFUND_REQUIRES_REVIEW";
        } else if (refundCalc.refundableAmount > 0) {
          refundStatus = "REFUND_REQUESTED";
        }

        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "fail",
          payload: { attemptId, pagesPrinted: totalConfirmedPages, reason, finalOrderStatus },
        });

        await tx
          .update(orders)
          .set({
            status: finalOrderStatus,
            pagesPrinted: totalConfirmedPages,
            sheetsPrinted: totalConfirmedSheets,
            failureReason: reason,
            refundableAmount: refundCalc.refundableAmount,
            refundStatus,
            pin: null,
            updatedAt: now,
          })
          .where(eq(orders.orderId, orderId));

        return { finalOrderStatus, refundCalc, refundStatus, totalConfirmedPages };
      });
    } catch (dbErr) {
      const msg = (dbErr as Error).message || "";
      if (msg.startsWith("ATTEMPT_NOT_FOUND:")) {
        return Response.json({ error: `Attempt '${attemptId}' not found for order '${orderId}'.` }, { status: 404 });
      }
      console.error(`[jobs] Fail transaction failed for ${orderId}:`, msg);
      return Response.json({ error: "Database unavailable while failing print job." }, { status: 503 });
    }

    if (failOutcome.refundCalc.refundableAmount > 0 && !failOutcome.refundCalc.requiresReview && !isManualReview) {
      try {
        await executeOrderRefund({
          orderId,
          amount: failOutcome.refundCalc.refundableAmount,
          reason: failOutcome.refundCalc.reason,
          scenario: failOutcome.totalConfirmedPages > 0 ? "hardware_failure_partial_print" : "hardware_failure_before_print",
          initiatedBy: "system_printer_failure",
        });
      } catch (refundErr) {
        console.error(`[jobs] Automatic refund trigger failed for ${orderId}:`, (refundErr as Error).message);
      }
    }

    try {
      await cleanupOrderFiles(orderId);
    } catch {}

    await logAuditEvent({
      eventType: "print_failed",
      orderId,
      deviceId: auth.deviceId,
      details: {
        attemptId,
        reason,
        pagesPrinted: failOutcome.totalConfirmedPages,
        refundStatus: failOutcome.refundStatus,
        eventId,
      },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      attemptId,
      status: failOutcome.finalOrderStatus,
      refundStatus: failOutcome.refundStatus,
      refundableAmount: failOutcome.refundCalc.refundableAmount,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Action: Fallback (Mark primary failed/superseded & create Canon fallback attempt)
  // ══════════════════════════════════════════════════════════════════════════
  if (action === "fallback") {
    const idem = await checkEventIdempotency(eventId);
    if (!idem.ok) return idem.response;
    if (idem.existing) {
      return Response.json({
        ok: true,
        acknowledged: true,
        eventId,
        duplicateEvent: true,
        ...(idem.existing.payload ?? {}),
      });
    }

    if (order.colorMode !== "bw") {
      return Response.json(
        { error: "Colour jobs cannot fall back — Canon GX6170 is already the primary colour printer." },
        { status: 400 }
      );
    }

    const now = new Date();
    const reason = String(body.reason || "kyocera_offline_prior_to_job").slice(0, 300);
    const priorAttemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : null;
    const docId = typeof body.docId === "string" ? body.docId.trim() : null;
    const pagesAttempted = Math.max(
      1,
      typeof body.pagesAttempted === "number" && body.pagesAttempted > 0 ? body.pagesAttempted : order.pagesToPrint
    );
    const pagesPerSheet = Math.max(1, order.pagesPerSheet || 1);

    let fallbackAttempt: typeof devicePrintJobs.$inferSelect;
    try {
      fallbackAttempt = await db.transaction(async (tx) => {
        if (priorAttemptId) {
          const [prior] = await tx
            .select()
            .from(devicePrintJobs)
            .where(eq(devicePrintJobs.attemptId, priorAttemptId));
          if (!prior || prior.orderId !== orderId || prior.deviceId !== auth.deviceId!) {
            throw new Error(`PRIOR_NOT_FOUND:${priorAttemptId}`);
          }
          if (["queued", "printing"].includes(prior.status)) {
            await tx
              .update(devicePrintJobs)
              .set({
                status: "failed",
                failedAt: now,
                failureReason: reason,
              })
              .where(eq(devicePrintJobs.attemptId, priorAttemptId));
          }
        }

        const existingAttempts = await tx
          .select({ attemptNo: devicePrintJobs.attemptNo, jobRef: devicePrintJobs.jobRef })
          .from(devicePrintJobs)
          .where(eq(devicePrintJobs.orderId, orderId));
        const maxNo = existingAttempts.reduce((m, r) => Math.max(m, r.attemptNo || 0), 0);
        const jobRef = existingAttempts[0]?.jobRef || `JOB-${randomBytes(6).toString("hex").toUpperCase()}`;

        const [created] = await tx
          .insert(devicePrintJobs)
          .values({
            attemptId: `ATT-${randomBytes(8).toString("hex").toUpperCase()}`,
            orderId,
            attemptNo: maxNo + 1,
            docId,
            jobRef,
            deviceId: auth.deviceId!,
            printerName: "canon_gx6170",
            cupsJobId: null,
            status: "queued",
            isFallback: true,
            pagesAttempted,
            sheetsAttempted: Math.max(1, Math.ceil(pagesAttempted / pagesPerSheet)),
          })
          .returning();

        await tx.insert(deviceEvents).values({
          eventId,
          orderId,
          deviceId: auth.deviceId!,
          action: "fallback",
          payload: {
            attemptId: created.attemptId,
            attemptNo: created.attemptNo,
            fallbackPrinter: "canon_gx6170",
            reason,
          },
        });

        await tx
          .update(orders)
          .set({
            status: "fallback_pending",
            fallbackPrinter: "canon_gx6170",
            fallbackAt: now,
            failureReason: reason,
            updatedAt: now,
          })
          .where(eq(orders.orderId, orderId));

        return created;
      });
    } catch (dbErr) {
      const msg = (dbErr as Error).message || "";
      if (msg.startsWith("PRIOR_NOT_FOUND:")) {
        return Response.json({ error: `Prior attempt '${priorAttemptId}' not found.` }, { status: 404 });
      }
      return Response.json({ error: "Database unavailable while creating fallback attempt." }, { status: 503 });
    }

    await logAuditEvent({
      eventType: "fallback_triggered",
      orderId,
      deviceId: auth.deviceId,
      details: { reason, eventId, attemptId: fallbackAttempt.attemptId },
    });

    await syncOrderToPrintJob(orderId);

    return Response.json({
      ok: true,
      acknowledged: true,
      eventId,
      attemptId: fallbackAttempt.attemptId,
      attemptNo: fallbackAttempt.attemptNo,
      status: "fallback_pending",
      fallbackPrinter: "canon_gx6170",
    });
  }

  return Response.json({ error: "Invalid action. Specify action=processing|attempt|bind|complete|fail|fallback" }, { status: 400 });
}

void sql;
