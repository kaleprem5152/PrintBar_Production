import { and, asc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { deviceCommands } from "@/db/schema";
import { agentAuth } from "@/lib/agent";

export const dynamic = "force-dynamic";

/** Agent polls for queued commands (GET ?kioskId=KSK-001). Delivered commands are marked and must be acknowledged via POST /api/agent/commands/{id}. */
export async function GET(req: NextRequest) {
  const denied = agentAuth(req);
  if (denied) return denied;
  const kioskId = req.nextUrl.searchParams.get("kioskId");
  if (!kioskId) return Response.json({ error: "kioskId required" }, { status: 400 });
  const rows = await db.select().from(deviceCommands).where(and(eq(deviceCommands.kioskId, kioskId), eq(deviceCommands.status, "queued"))).orderBy(asc(deviceCommands.createdAt)).limit(20);
  if (rows.length) {
    await db.update(deviceCommands).set({ status: "delivered", deliveredAt: new Date() }).where(inArray(deviceCommands.id, rows.map((r) => r.id)));
  }
  return Response.json({
    commands: rows.map((r) => ({ id: r.id, command: r.command, printerId: r.printerId, payload: r.payload, idempotencyKey: r.idempotencyKey })),
  });
}
