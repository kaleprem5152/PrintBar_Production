import type { NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/server/device-auth";

/**
 * Unified Kiosk-Agent Authentication Middleware.
 * Strictly enforces canonical HMAC-SHA256 signature verification.
 * Raw secret headers (x-agent-key) are completely eliminated.
 */
export async function agentAuth(req: NextRequest): Promise<Response | null> {
  const result = await authenticateDevice(req);
  if (!result.ok) {
    return Response.json(
      { error: result.error || "Unauthorized: invalid device signature" },
      { status: 401 }
    );
  }
  return null; // Authorized
}
