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
import { logAuditEvent } from "@/lib/server/orders";

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

  // Atomically transition from 'paid' → 'queued' for this specific order
  // Only one device can claim it (CAS-style update)
  const [claimed] = await db
    .update(orders)
    .set({
      status:         "queued",
      deviceId,
      printClaimedAt: new Date(),
      updatedAt:      new Date(),
    })
    .where(
      and(
        eq(orders.orderId, orderId),
        eq(orders.status, "paid"),        // Only claim from 'paid' state
      )
    )
    .returning();

  if (!claimed) {
    return Response.json(
      { error: "Order is not available for claiming (already claimed or not found)." },
      { status: 409 }
    );
  }

  // Create a print job record
  const jobRef = `JOB-${randomBytes(6).toString("hex").toUpperCase()}`;
  await db.insert(devicePrintJobs).values({
    orderId,
    jobRef,
    deviceId,
    printerName:    claimed.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x",
    isFallback:     false,
  });

  await logAuditEvent({
    eventType: "print_started",
    orderId,
    deviceId,
    details:   { jobRef, printerName: claimed.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x" },
  });

  return Response.json({
    ok:      true,
    orderId: claimed.orderId,
    jobRef,
    docs:    claimed.docs,
    settings: {
      colorMode:   claimed.colorMode,
      copies:      claimed.copies,
      paperSize:   claimed.paperSize,
      sides:       claimed.sides,
      orientation: claimed.orientation,
    },
    pagesToPrint: claimed.pagesToPrint,
  });
}
