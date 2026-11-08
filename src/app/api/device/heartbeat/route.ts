/**
 * POST /api/device/heartbeat
 *
 * Raspberry Pi agent sends a heartbeat every 30 seconds.
 * Reports printer availability and requests any configuration updates.
 * Updates the device's last_heartbeat timestamp and printer status.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, printerStatusHistory } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

type HeartbeatBody = {
  kyoceraReady:  boolean;
  canonReady:    boolean;
  kyoceraStatus: string;
  canonStatus:   string;
  paperReady?:   boolean;
  cupsReachable: boolean;
  agentVersion:  string;
};

export async function POST(req: Request) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  const deviceId = auth.deviceId!;
  const body     = (await req.json().catch(() => ({}))) as HeartbeatBody;
  const now      = new Date();

  const updates: Record<string, unknown> = {
    lastHeartbeat: now,
    kyoceraReady:  body.kyoceraReady ?? false,
    canonReady:    body.canonReady ?? false,
    updatedAt:     now,
  };

  if (body.paperReady !== undefined) {
    updates.paperReady = body.paperReady;
  }

  // Update device heartbeat and printer status
  const [device] = await db
    .update(devices)
    .set(updates)
    .where(eq(devices.id, deviceId))
    .returning();

  // Record printer status history for monitoring
  if (body.kyoceraStatus) {
    await db.insert(printerStatusHistory).values({
      deviceId,
      printerName: "kyocera_pa3500x",
      status:      body.kyoceraStatus,
      paperReady:  body.kyoceraReady,
      rawPayload:  { agentVersion: body.agentVersion, cupsReachable: body.cupsReachable },
    });
  }
  if (body.canonStatus) {
    await db.insert(printerStatusHistory).values({
      deviceId,
      printerName: "canon_gx6170",
      status:      body.canonStatus,
      paperReady:  body.canonReady,
      rawPayload:  { agentVersion: body.agentVersion },
    });
  }

  return Response.json({
    ok:              true,
    serverTime:      now.toISOString(),
    maintenanceMode: device?.maintenanceMode ?? false,
    kyoceraPaper:    device?.kyoceraPaper ?? 250,
    canonPaper:      device?.canonPaper ?? 250,
    paperReady:      device?.paperReady ?? true,
  });
}
