import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId, maintenanceMode } = (await req.json().catch(() => ({}))) as {
    deviceId?: string;
    maintenanceMode?: boolean;
  };

  if (!deviceId || maintenanceMode === undefined) {
    return Response.json({ error: "deviceId and maintenanceMode are required." }, { status: 400 });
  }

  await db
    .update(devices)
    .set({ maintenanceMode, updatedAt: new Date() })
    .where(eq(devices.id, deviceId));

  await logAuditEvent({
    eventType: "admin_action",
    deviceId,
    actorId: admin,
    details: { action: "toggle_maintenance", maintenanceMode },
  });

  return Response.json({ ok: true, deviceId, maintenanceMode });
}
