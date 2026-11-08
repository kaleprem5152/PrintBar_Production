/**
 * POST /api/kiosk/verify-pin
 *
 * Verifies a customer's 4-digit collection PIN at the kiosk.
 * Rate limited in-process (10 attempts per 60 seconds).
 *
 * Returns the order details if PIN is valid and not expired.
 * Transitions the order from 'paid' to 'pin_accepted'.
 */
import { findOrderByPin, updateOrderStatus, toPublic, logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

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
  const o = await findOrderByPin(pin);

  if (!o) {
    attempts.push(now);
    return Response.json({ error: "invalid" }, { status: 404 });
  }

  // Check PIN expiry
  if (o.expiresAt && new Date(o.expiresAt).getTime() < now) {
    return Response.json({ error: "expired" }, { status: 410 });
  }

  // Transition 'paid' → 'pin_accepted'
  let row = o;
  if (o.status === "paid") {
    const updated = await updateOrderStatus(o.orderId, "pin_accepted");
    if (updated) row = updated;

    await logAuditEvent({
      eventType: "pin_verified",
      orderId:   o.orderId,
      details:   { status: "paid_to_pin_accepted" },
    });
  }

  return Response.json(toPublic(row, false));
}
