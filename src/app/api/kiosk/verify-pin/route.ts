/**
 * POST /api/kiosk/verify-pin
 *
 * Verifies a customer's 4-digit collection PIN at the kiosk.
 * Rate limited in-process (10 attempts per 60 seconds).
 *
 * Returns the order details if PIN is valid and not expired.
 * Transitions the order from 'paid' to 'pin_accepted'.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { toPublic, logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

// In-process rate limiting (10 attempts per 60 seconds per server process)
// For production with multiple processes, use Redis or database-backed rate limiting
const attempts: number[] = [];
const MAX    = 10;
const WINDOW = 60_000;

export async function POST(req: Request) {
  const now = Date.now();

  // Sliding window cleanup
  while (attempts.length && now - attempts[0] > WINDOW) attempts.shift();
  if (attempts.length >= MAX) {
    return Response.json({ error: "locked" }, { status: 429 });
  }

  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (!pin || !/^\d{4}$/.test(pin)) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  // Look up an active order with this PIN
  const [o] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.pin, pin),
        inArray(orders.status, [
          "paid", "pin_accepted", "queued", "claimed",
          "processing", "printing", "fallback_pending",
          "fallback_printing", "failed",
        ]),
      )
    )
    .orderBy(desc(orders.id));

  if (!o) {
    attempts.push(now);
    return Response.json({ error: "invalid" }, { status: 404 });
  }

  // Check PIN expiry
  if (o.expiresAt && o.expiresAt.getTime() < now) {
    return Response.json({ error: "expired" }, { status: 410 });
  }

  // Transition 'paid' → 'pin_accepted'
  let row = o;
  if (o.status === "paid") {
    const [u] = await db
      .update(orders)
      .set({ status: "pin_accepted", updatedAt: new Date() })
      .where(and(eq(orders.id, o.id), eq(orders.status, "paid")))
      .returning();
    if (u) row = u;

    await logAuditEvent({
      eventType: "pin_verified",
      orderId:   o.orderId,
      details:   { status: "paid_to_pin_accepted" },
    });
  }

  return Response.json(toPublic(row, false));
}
