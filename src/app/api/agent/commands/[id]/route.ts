import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { deviceCommands } from "@/db/schema";
import { agentAuth } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await agentAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { status?: string; result?: string };
  if (!["succeeded", "failed"].includes(b.status ?? "")) return Response.json({ error: "status must be succeeded|failed" }, { status: 400 });
  const [row] = await db.update(deviceCommands).set({ status: b.status!, result: String(b.result ?? "").slice(0, 500), completedAt: new Date() }).where(eq(deviceCommands.id, Number(id))).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
