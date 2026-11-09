import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { deviceCommands } from "@/db/schema";
import { agentAuth } from "@/lib/agent";

export const dynamic = "force-dynamic";

const LEASE_DURATION_MS = 60_000; // 60-second lease

/**
 * Agent polls for queued or lease-expired commands.
 * Delivered commands have an active lease window. If unacknowledged within 60s,
 * they are re-delivered so crashes do not permanently drop commands.
 */
export async function GET(req: NextRequest) {
  const denied = await agentAuth(req);
  if (denied) return denied;

  const kioskId = req.nextUrl.searchParams.get("kioskId");
  if (!kioskId) return Response.json({ error: "kioskId required" }, { status: 400 });

  const leaseCutoff = new Date(Date.now() - LEASE_DURATION_MS);

  // Fetch commands that are queued OR delivered but whose lease expired
  const rows = await db
    .select()
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.kioskId, kioskId),
        or(
          eq(deviceCommands.status, "queued"),
          and(
            eq(deviceCommands.status, "delivered"),
            lt(deviceCommands.deliveredAt, leaseCutoff)
          )
        )
      )
    )
    .orderBy(asc(deviceCommands.createdAt))
    .limit(10);

  if (rows.length) {
    const now = new Date();
    await db
      .update(deviceCommands)
      .set({ status: "delivered", deliveredAt: now })
      .where(inArray(deviceCommands.id, rows.map((r) => r.id)));
  }

  return Response.json({
    commands: rows.map((r) => ({
      id: r.id,
      command: r.command,
      printerId: r.printerId,
      payload: r.payload,
      idempotencyKey: r.idempotencyKey,
    })),
  });
}
