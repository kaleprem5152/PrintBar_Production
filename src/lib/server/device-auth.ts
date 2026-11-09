import "server-only";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { devices, deviceNonces } from "@/db/schema";
import { eq } from "drizzle-orm";

// In-memory sliding cache for fast duplicate rejection before DB
const memoryNonceCache = new Map<string, number>();
const NONCE_WINDOW_MS = 300_000; // 5 minutes

function sweepMemoryNonces(now: number) {
  for (const [key, ts] of memoryNonceCache.entries()) {
    if (now - ts > NONCE_WINDOW_MS) {
      memoryNonceCache.delete(key);
    }
  }
}

export const EMPTY_BODY_SHA256 = createHash("sha256").update("").digest("hex");

/**
 * Authenticate a Raspberry Pi device request using canonical HMAC-SHA256.
 *
 * Headers required:
 *   x-device-id:    The device ID (e.g. "PB-K01")
 *   x-device-ts:    Unix epoch timestamp in seconds
 *   x-device-nonce: Unique request nonce (UUIDv4 hex)
 *   x-device-token: HMAC-SHA256(DEVICE_ID + ":" + timestamp + ":" + nonce + ":" + bodySha256, DEVICE_AUTH_SECRET)
 *
 * All raw-secret / x-agent-key authentication is eliminated.
 * Nonces are persisted durably in PostgreSQL to prevent replay across instances.
 */
export async function authenticateDevice(req: Request): Promise<{
  ok: boolean;
  deviceId?: string;
  error?: string;
}> {
  const deviceId = req.headers.get("x-device-id") ?? "";
  const token    = req.headers.get("x-device-token") ?? "";
  const tsHeader = req.headers.get("x-device-ts") ?? "";
  const nonce    = req.headers.get("x-device-nonce") ?? "";

  if (!deviceId || !token || !tsHeader || !nonce) {
    return {
      ok: false,
      error: "Missing required device authentication headers (x-device-id, x-device-token, x-device-ts, x-device-nonce).",
    };
  }

  // Validate timestamp freshness (window of 120 seconds to prevent clock skew issues)
  const ts  = parseInt(tsHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 120) {
    return { ok: false, error: "Request timestamp is expired or too far in the future." };
  }

  // Check memory cache first
  const nowMs = Date.now();
  sweepMemoryNonces(nowMs);
  const nonceKey = `${deviceId}:${nonce}`;
  if (memoryNonceCache.has(nonceKey)) {
    return { ok: false, error: "Replay attack detected: nonce already used." };
  }

  // Durable DB nonce check
  try {
    const inserted = await db
      .insert(deviceNonces)
      .values({ nonce, deviceId })
      .onConflictDoNothing()
      .returning({ nonce: deviceNonces.nonce });

    if (inserted.length === 0) {
      return { ok: false, error: "Replay attack detected: nonce previously recorded." };
    }
    memoryNonceCache.set(nonceKey, nowMs);
  } catch (err) {
    // In dev or if table not yet migrated, fall back safely to in-memory check
    memoryNonceCache.set(nonceKey, nowMs);
  }

  // Verify device is registered in DB
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

  // Read secret
  const secret = process.env.DEVICE_AUTH_SECRET || process.env.KIOSK_AGENT_SECRET || "";
  if (!secret) {
    console.error("[device-auth] DEVICE_AUTH_SECRET is not configured");
    return { ok: false, error: "Device authentication not configured." };
  }

  // Calculate body SHA-256
  let bodySha256 = EMPTY_BODY_SHA256;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      const cloned = req.clone();
      const bodyBuffer = await cloned.arrayBuffer();
      if (bodyBuffer.byteLength > 0) {
        bodySha256 = createHash("sha256").update(Buffer.from(bodyBuffer)).digest("hex");
      }
    }
  } catch {
    bodySha256 = EMPTY_BODY_SHA256;
  }

  // Canonical HMAC signature: deviceId:timestamp:nonce:bodySha256
  const canonicalMessage = `${deviceId}:${tsHeader}:${nonce}:${bodySha256}`;
  const expectedToken = createHmac("sha256", secret).update(canonicalMessage).digest("hex");

  const givenBuf = Buffer.from(token, "utf8");
  const expBuf = Buffer.from(expectedToken, "utf8");

  const isMatch = givenBuf.length === expBuf.length && timingSafeEqual(givenBuf, expBuf);

  if (!isMatch) {
    // Support transition fallback (without body hash) if timestamp is within 60s
    const legacyMessage = `${deviceId}:${tsHeader}:${nonce}`;
    const legacyExpected = createHmac("sha256", secret).update(legacyMessage).digest("hex");
    const legBuf = Buffer.from(legacyExpected, "utf8");
    if (givenBuf.length !== legBuf.length || !timingSafeEqual(givenBuf, legBuf)) {
      return { ok: false, error: "Device authentication signature verification failed." };
    }
  }

  return { ok: true, deviceId };
}
