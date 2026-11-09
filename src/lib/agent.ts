import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/server/device-auth";

/**
 * Unified Kiosk-Agent Authentication:
 * Supports:
 * 1. Simple secret via header `x-agent-key` (matched against KIOSK_AGENT_SECRET or DEVICE_AUTH_SECRET)
 * 2. HMAC authentication headers (`x-device-id`, `x-device-token`, `x-device-ts`, `x-device-nonce`)
 */
export function agentAuth(req: NextRequest): Response | null {
  // Method 1: Check x-agent-key header
  const givenKey = req.headers.get("x-agent-key") ?? "";
  const validSecrets = [
    process.env.KIOSK_AGENT_SECRET,
    process.env.DEVICE_AUTH_SECRET,
  ].filter(Boolean) as string[];

  if (givenKey && validSecrets.length > 0) {
    const givenHash = createHash("sha256").update(givenKey).digest();
    for (const secret of validSecrets) {
      const secretHash = createHash("sha256").update(secret).digest();
      if (givenHash.length === secretHash.length && timingSafeEqual(givenHash, secretHash)) {
        return null; // Authorized
      }
    }
  }

  // Method 2: Check HMAC device signature headers
  const deviceId = req.headers.get("x-device-id");
  const deviceToken = req.headers.get("x-device-token");
  const deviceTs = req.headers.get("x-device-ts");

  if (deviceId && deviceToken && deviceTs) {
    // If HMAC headers are present, authenticate using device auth rules
    // We can do sync HMAC verification here
    const secret = process.env.DEVICE_AUTH_SECRET || process.env.KIOSK_AGENT_SECRET || "";
    if (secret) {
      const ts = parseInt(deviceTs, 10);
      const now = Math.floor(Date.now() / 1000);
      if (!isNaN(ts) && Math.abs(now - ts) <= 120) {
        const nonce = req.headers.get("x-device-nonce") ?? "";
        const crypto = require("crypto");
        const msgWithNonce = nonce ? `${deviceId}:${deviceTs}:${nonce}` : `${deviceId}:${deviceTs}`;
        const msgLegacy = `${deviceId}:${deviceTs}`;
        const exp1 = crypto.createHmac("sha256", secret).update(msgWithNonce).digest("hex");
        const exp2 = crypto.createHmac("sha256", secret).update(msgLegacy).digest("hex");

        const givenBuf = Buffer.from(deviceToken, "utf8");
        const exp1Buf = Buffer.from(exp1, "utf8");
        const exp2Buf = Buffer.from(exp2, "utf8");

        const m1 = exp1Buf.length === givenBuf.length && timingSafeEqual(exp1Buf, givenBuf);
        const m2 = exp2Buf.length === givenBuf.length && timingSafeEqual(exp2Buf, givenBuf);

        if (m1 || m2) {
          return null; // Authorized
        }
      }
    }
  }

  if (!process.env.KIOSK_AGENT_SECRET && !process.env.DEVICE_AUTH_SECRET) {
    return Response.json(
      { error: "Agent API disabled: KIOSK_AGENT_SECRET / DEVICE_AUTH_SECRET is not configured" },
      { status: 503 }
    );
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
