import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";

// Sliding cache of recently seen nonces: Map<nonce, seenTimestampMs>
const seenNonces = new Map<string, number>();
const NONCE_WINDOW_MS = 120_000;

function sweepNonces(now: number) {
  for (const [nonce, ts] of seenNonces.entries()) {
    if (now - ts > NONCE_WINDOW_MS) {
      seenNonces.delete(nonce);
    }
  }
}

/**
 * Authenticate a Raspberry Pi device request.
 *
 * The device includes headers:
 *   x-device-id:    The device ID (e.g. "PB-K01")
 *   x-device-token: HMAC-SHA256(DEVICE_ID + ":" + timestamp (+ ":" + nonce), DEVICE_AUTH_SECRET)
 *   x-device-ts:    Unix timestamp (seconds) — prevents replay attacks
 *   x-device-nonce: Optional/Recommended unique request nonce
 *
 * Token must be within 60 seconds of server time and nonces cannot be replayed.
 */
export async function authenticateDevice(req: Request): Promise<{
  ok: boolean;
  deviceId?: string;
  error?: string;
}> {
  const deviceId  = req.headers.get("x-device-id") ?? "";
  const token     = req.headers.get("x-device-token") ?? "";
  const tsHeader  = req.headers.get("x-device-ts") ?? "";
  const nonce     = req.headers.get("x-device-nonce") ?? "";

  if (!deviceId || !token || !tsHeader) {
    return { ok: false, error: "Missing device authentication headers." };
  }

  // Validate timestamp to prevent replay attacks (60-second window)
  const ts  = parseInt(tsHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 60) {
    return { ok: false, error: "Request timestamp is too old or too far in the future." };
  }

  // Nonce replay check
  if (nonce) {
    const nowMs = Date.now();
    sweepNonces(nowMs);
    const nonceKey = `${deviceId}:${nonce}`;
    if (seenNonces.has(nonceKey)) {
      return { ok: false, error: "Replay attack detected: nonce already used." };
    }
    seenNonces.set(nonceKey, nowMs);
  }

  // Load device from database
  let device: typeof devices.$inferSelect | undefined;
  try {
    const [d] = await db.select().from(devices).where(eq(devices.id, deviceId));
    device = d;
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Database unavailable for device verification." };
    }
  }

  if (process.env.NODE_ENV === "production" && (!device || !device.isActive)) {
    return { ok: false, error: "Device not registered or inactive." };
  }

  // Verify HMAC token
  const secret = process.env.DEVICE_AUTH_SECRET ?? "";
  if (!secret) {
    console.error("[device-auth] DEVICE_AUTH_SECRET is not set");
    return { ok: false, error: "Device authentication not configured." };
  }

  // Support both nonce-signed message and legacy message
  const messageWithNonce = nonce ? `${deviceId}:${tsHeader}:${nonce}` : `${deviceId}:${tsHeader}`;
  const messageLegacy = `${deviceId}:${tsHeader}`;

  const expected1 = createHmac("sha256", secret).update(messageWithNonce).digest("hex");
  const expected2 = createHmac("sha256", secret).update(messageLegacy).digest("hex");

  const givenBuf = Buffer.from(token, "utf8");
  const exp1Buf = Buffer.from(expected1, "utf8");
  const exp2Buf = Buffer.from(expected2, "utf8");

  const match1 = exp1Buf.length === givenBuf.length && timingSafeEqual(exp1Buf, givenBuf);
  const match2 = exp2Buf.length === givenBuf.length && timingSafeEqual(exp2Buf, givenBuf);

  if (!match1 && !match2) {
    return { ok: false, error: "Device authentication signature failed." };
  }

  return { ok: true, deviceId };
}
