import "server-only";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { devices, deviceNonces } from "@/db/schema";
import { eq } from "drizzle-orm";

export const EMPTY_BODY_SHA256 = createHash("sha256").update("").digest("hex");
const MAX_CLOCK_SKEW_SECONDS = 120; // 2 minutes

/**
 * Normalizes a URL path for canonical HMAC signing.
 * Strips query strings, hashes, duplicate slashes, and trailing slashes.
 * Example: "https://host/api/device/jobs/?foo=bar" -> "/api/device/jobs"
 */
export function normalizeCanonicalPath(urlOrPath: string): string {
  try {
    let pathname = urlOrPath;
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      pathname = new URL(urlOrPath).pathname;
    } else {
      pathname = urlOrPath.split("?")[0].split("#")[0];
    }
    pathname = pathname.replace(/\/+/g, "/").replace(/\/$/, "");
    return pathname.startsWith("/") ? pathname : "/" + pathname;
  } catch {
    return urlOrPath;
  }
}

/**
 * Builds the unambiguous canonical message string:
 * METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256
 */
export function buildCanonicalMessage(
  method: string,
  pathname: string,
  timestamp: string,
  nonce: string,
  bodySha256: string
): string {
  const normMethod = method.trim().toUpperCase();
  const normPath   = normalizeCanonicalPath(pathname);
  const normSha    = bodySha256.trim().toLowerCase();
  return `${normMethod}:${normPath}:${timestamp}:${nonce}:${normSha}`;
}

/**
 * Authenticate a Raspberry Pi device request.
 *
 * Strict Security Order (V4 Spec):
 * 1. Validate device identity & headers.
 * 2. Validate timestamp format and allowed clock tolerance.
 * 3. Validate nonce format.
 * 4. Calculate request body hash (SHA-256).
 * 5. Reconstruct the canonical signature.
 * 6. Verify HMAC using constant-time comparison.
 * 7. Atomically insert the nonce into durable PostgreSQL storage with unique constraint.
 * 8. Reject replayed nonce values.
 * 9. In production: if PostgreSQL replay protection fails, reject request.
 */
export async function authenticateDevice(req: Request): Promise<{
  ok: boolean;
  deviceId?: string;
  error?: string;
}> {
  // Disallow legacy authentication headers
  if (req.headers.has("x-agent-key")) {
    return {
      ok: false,
      error: "Legacy raw secret authentication (x-agent-key) is permanently discontinued.",
    };
  }

  // Strictly enforce canonical authentication headers
  const deviceId  = req.headers.get("x-device-id") ?? "";
  const signature = req.headers.get("x-signature") ?? "";
  const tsHeader  = req.headers.get("x-timestamp") ?? "";
  const nonce     = req.headers.get("x-nonce") ?? "";

  // 1. Validate required headers presence and device identity format
  if (!deviceId || !signature || !tsHeader || !nonce) {
    return {
      ok: false,
      error: "Missing required device authentication headers (X-Device-ID, X-Timestamp, X-Nonce, X-Signature).",
    };
  }

  if (!/^[A-Za-z0-9_-]{3,32}$/.test(deviceId)) {
    return { ok: false, error: "Invalid device ID format." };
  }

  // 2. Validate timestamp freshness (<=120s clock skew)
  const ts = parseInt(tsHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: "Request timestamp is outside the allowed clock tolerance window." };
  }

  // 3. Validate nonce format (alphanumeric 16-64 chars)
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    return { ok: false, error: "Invalid nonce format." };
  }

  // 4. Calculate request body hash
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

  // Authoritative secret resolution
  const secret = process.env.DEVICE_AUTH_SECRET || process.env.PRINTBAR_DEVICE_SECRET || "";
  if (!secret) {
    console.error("[device-auth] DEVICE_AUTH_SECRET is not configured on server");
    return { ok: false, error: "Server device authentication is not configured." };
  }

  // 5. Reconstruct canonical signature: METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256
  const normPath = normalizeCanonicalPath(new URL(req.url).pathname);
  const canonicalMessage = buildCanonicalMessage(req.method, normPath, tsHeader, nonce, bodySha256);
  const expectedSignature = createHmac("sha256", secret).update(canonicalMessage).digest("hex");

  // 6. Verify HMAC using constant-time comparison (NO fallback signature allowed)
  const givenBuf    = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");

  if (givenBuf.length !== expectedBuf.length || !timingSafeEqual(givenBuf, expectedBuf)) {
    return { ok: false, error: "HMAC signature verification failed." };
  }

  // 7 & 8. Atomically consume nonce in PostgreSQL (Only executed AFTER valid signature!)
  try {
    const inserted = await db
      .insert(deviceNonces)
      .values({ nonce, deviceId })
      .onConflictDoNothing()
      .returning({ nonce: deviceNonces.nonce });

    if (inserted.length === 0) {
      return { ok: false, error: "Replay attack detected: nonce has already been consumed." };
    }
  } catch (dbErr) {
    console.error("[device-auth] PostgreSQL replay protection error:", (dbErr as Error).message);
    return { ok: false, error: "Durable replay protection unavailable. Request rejected." };
  }

  // 9. Verify device registration in DB
  try {
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    if (process.env.NODE_ENV === "production" && (!device || !device.isActive)) {
      return { ok: false, error: "Device is not registered or is currently inactive." };
    }
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Database unavailable for device validation." };
    }
  }

  return { ok: true, deviceId };
}
