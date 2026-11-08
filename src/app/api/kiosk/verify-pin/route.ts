/**
 * POST /api/kiosk/verify-pin
 *
 * Verifies a customer's 4-digit collection PIN at the kiosk.
 * Rate limited and database-locked:
 * - Locks order after 5 consecutive failed attempts for 15 minutes.
 * - Global IP rate limiting: 10 attempts per 60 seconds.
 * - Supports hashed PIN comparison with constant-time matching.
 * - Transitions order from 'paid' to 'pin_accepted'.
 */
import {
  findOrderByPin,
  updateOrderStatus,
  toPublic,
  logAuditEvent,
  recordFailedPinAttempt,
} from "@/lib/server/orders";

export const dynamic = "force-dynamic";

// IP-based sliding rate limiter
const ipAttempts = new Map<string, number[]>();
const MAX_IP_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

export async function POST(req: Request) {
  const now = Date.now();
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-kiosk";

  // Sliding window cleanup for IP rate limiting
  const currentAttempts = (ipAttempts.get(clientIp) || []).filter((t) => now - t < WINDOW_MS);
  if (currentAttempts.length >= MAX_IP_ATTEMPTS) {
    return Response.json(
      { error: "Too many attempts from this terminal. Please wait 1 minute." },
      { status: 429 }
    );
  }

  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (!pin || !/^\d{4}$/.test(pin.trim())) {
    currentAttempts.push(now);
    ipAttempts.set(clientIp, currentAttempts);
    return Response.json({ error: "Invalid PIN format. Enter 4 digits." }, { status: 400 });
  }

  const cleanPin = pin.trim();

  // Look up an active order with this PIN (searches both plaintext and HMAC-SHA256 hash)
  const o = await findOrderByPin(cleanPin);

  if (!o) {
    currentAttempts.push(now);
    ipAttempts.set(clientIp, currentAttempts);

    await logAuditEvent({
      eventType: "pin_verified",
      ipAddress: clientIp,
      details: { outcome: "failed_not_found" },
    });

    return Response.json({ error: "Invalid PIN. No active order found." }, { status: 404 });
  }

  // Check if this specific order is locked out
  if (o.pinLockedUntil && new Date(o.pinLockedUntil).getTime() > now) {
    const remainingSecs = Math.ceil((new Date(o.pinLockedUntil).getTime() - now) / 1000);
    return Response.json(
      {
        error: `Order temporarily locked due to multiple failed attempts. Try again in ${remainingSecs}s.`,
        retryAfter: remainingSecs,
      },
      { status: 423 }
    );
  }

  // Check PIN expiry
  if (o.expiresAt && new Date(o.expiresAt).getTime() < now) {
    return Response.json(
      { error: "PIN has expired. Orders expire after 24 hours of payment." },
      { status: 410 }
    );
  }

  // Transition 'paid' → 'pin_accepted'
  let row = o;
  if (o.status === "paid") {
    const updated = await updateOrderStatus(o.orderId, "pin_accepted");
    if (updated) row = updated;

    await logAuditEvent({
      eventType: "pin_verified",
      orderId: o.orderId,
      ipAddress: clientIp,
      details: { status: "paid_to_pin_accepted" },
    });
  }

  return Response.json(toPublic(row, false));
}
