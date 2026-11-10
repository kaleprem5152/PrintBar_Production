/**
 * GET  /api/device/jobs   — List jobs available for this device to claim
 * POST /api/device/jobs   — Atomically claim a specific job
 */
import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { orders, devicePrintJobs } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent, syncOrderToPrintJob } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

// ─── GET: List claimable jobs ──────────────────────────────────────────────────

export async function GET(req: Request) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  // Return paid orders that haven't been claimed yet
  const availableOrders = await db
    .select({
      orderId:      orders.orderId,
      colorMode:    orders.colorMode,
      pagesToPrint: orders.pagesToPrint,
      copies:       orders.copies,
      paperSize:    orders.paperSize,
      sides:        orders.sides,
      orientation:  orders.orientation,
      docs:         orders.docs,
      createdAt:    orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "paid"),
        lte(orders.createdAt, new Date()) // Ensure order is properly committed
      )
    )
    .limit(5); // Don't expose the full queue to the agent

  return Response.json({ jobs: availableOrders });
}

// ─── POST: Atomically claim a job ─────────────────────────────────────────────

export async function POST(req: Request) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  const deviceId = auth.deviceId!;
  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };

  if (!orderId) {
    return Response.json({ error: "orderId is required." }, { status: 400 });
  }

  const jobRef = `JOB-${randomBytes(6).toString("hex").toUpperCase()}`;
  const now = new Date();

  let claimResult: {
    claimed: typeof orders.$inferSelect;
    attempts: Array<typeof devicePrintJobs.$inferSelect>;
  } | null = null;

  try {
    claimResult = await db.transaction(async (tx) => {
      // Atomically transition from 'paid' → 'queued' for this specific order
      const [claimed] = await tx
        .update(orders)
        .set({
          status:         "queued",
          deviceId,
          printClaimedAt: now,
          updatedAt:      now,
        })
        .where(
          and(
            eq(orders.orderId, orderId),
            eq(orders.status, "paid"),
          )
        )
        .returning();

      if (!claimed) return null;

      const defaultPrinter = claimed.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x";
      const docs = Array.isArray(claimed.docs) && claimed.docs.length > 0 ? claimed.docs : [];
      const copies = Math.max(1, claimed.copies || 1);
      const pagesPerSheet = Math.max(1, claimed.pagesPerSheet || 1);

      const attemptRowsToInsert =
        docs.length > 0
          ? docs.map((doc, idx) => {
              const docPages = Math.max(1, Number(doc.selected ?? doc.pages ?? 1)) * copies;
              return {
                attemptId:       `ATT-${randomBytes(8).toString("hex").toUpperCase()}`,
                orderId,
                attemptNo:       idx + 1,
                docId:           doc.id || `doc_${idx + 1}`,
                jobRef,
                deviceId,
                printerName:     defaultPrinter,
                cupsJobId:       null,
                status:          "queued",
                isFallback:      false,
                pagesAttempted:  docPages,
                sheetsAttempted: Math.max(1, Math.ceil(docPages / pagesPerSheet)),
              };
            })
          : [
              {
                attemptId:       `ATT-${randomBytes(8).toString("hex").toUpperCase()}`,
                orderId,
                attemptNo:       1,
                docId:           null,
                jobRef,
                deviceId,
                printerName:     defaultPrinter,
                cupsJobId:       null,
                status:          "queued",
                isFallback:      false,
                pagesAttempted:  Math.max(1, claimed.pagesToPrint || 1),
                sheetsAttempted: Math.max(1, claimed.physicalSheets || 1),
              },
            ];

      const insertedAttempts = await tx
        .insert(devicePrintJobs)
        .values(attemptRowsToInsert)
        .returning();

      return { claimed, attempts: insertedAttempts };
    });
  } catch (dbErr) {
    console.error(`[jobs] Atomic claim transaction failed for ${orderId}:`, (dbErr as Error).message);
    return Response.json(
      { error: "Database unavailable during job claim." },
      { status: 503 }
    );
  }

  if (!claimResult) {
    return Response.json(
      { error: "Order is not available for claiming (already claimed or not found)." },
      { status: 409 }
    );
  }

  const { claimed, attempts } = claimResult;

  await logAuditEvent({
    eventType: "print_started",
    orderId,
    deviceId,
    details: {
      jobRef,
      printerName: claimed.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x",
      attempts: attempts.map((a) => ({ attemptId: a.attemptId, attemptNo: a.attemptNo, docId: a.docId })),
    },
  });

  await syncOrderToPrintJob(claimed);

  return Response.json({
    ok:        true,
    orderId:   claimed.orderId,
    jobRef,
    attemptId: attempts[0]?.attemptId ?? null,
    attempts:  attempts.map((a) => ({
      attemptId:      a.attemptId,
      attemptNo:      a.attemptNo,
      docId:          a.docId,
      printerName:    a.printerName,
      pagesAttempted: a.pagesAttempted,
      status:         a.status,
    })),
    docs:      claimed.docs,
    settings: {
      colorMode:     claimed.colorMode,
      copies:        claimed.copies,
      paperSize:     claimed.paperSize,
      sides:         claimed.sides,
      orientation:   claimed.orientation,
      pagesPerSheet: claimed.pagesPerSheet,
    },
    pagesToPrint: claimed.pagesToPrint,
  });
}
