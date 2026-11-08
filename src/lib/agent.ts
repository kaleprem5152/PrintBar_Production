import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/** Kiosk-agent authentication: shared secret in KIOSK_AGENT_SECRET, sent as `x-agent-key`. */
export function agentAuth(req: NextRequest): Response | null {
  const secret = process.env.KIOSK_AGENT_SECRET;
  if (!secret) return Response.json({ error: "Agent API disabled: KIOSK_AGENT_SECRET is not configured" }, { status: 503 });
  const given = req.headers.get("x-agent-key") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
