import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Authenticate a Raspberry Pi device request.
 *
 * The device includes two headers:
 *   x-device-id:    The device ID (e.g. "PB-K01")
 *   x-device-token: HMAC-SHA256(DEVICE_ID + ":" + timestamp, DEVICE_AUTH_SECRET)
 *   x-device-ts:    Unix timestamp (seconds) — prevents replay attacks
 *
 * Token must be within 60 seconds of server time.
 */
export async function authenticateDevice(req: Request): Promise<{
  ok: boolean;
  deviceId?: string;
  error?: string;
}> {
  const deviceId  = req.headers.get("x-device-id") ?? "";
  const token     = req.headers.get("x-device-token") ?? "";
  const tsHeader  = req.headers.get("x-device-ts") ?? "";

  if (!deviceId || !token || !tsHeader) {
    return { ok: false, error: "Missing device authentication headers." };
  }

  // Validate timestamp to prevent replay attacks (60-second window)
  const ts  = parseInt(tsHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 60) {
    return { ok: false, error: "Request timestamp is too old or too far in the future." };
  }

  // Load device from database
  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
  if (!device || !device.isActive) {
    return { ok: false, error: "Device not registered or inactive." };
  }

  // Verify HMAC token
  const secret   = process.env.DEVICE_AUTH_SECRET ?? "";
  if (!secret) {
    console.error("[device-auth] DEVICE_AUTH_SECRET is not set");
    return { ok: false, error: "Device authentication not configured." };
  }

  const message  = `${deviceId}:${tsHeader}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf    = Buffer.from(token, "utf8");

  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, error: "Device authentication failed." };
  }

  return { ok: true, deviceId };
}
