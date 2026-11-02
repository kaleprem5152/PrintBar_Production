import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { findByOrderId, getKioskState, toPublic } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const o = await findByOrderId(orderId);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(toPublic(o, false));
}

export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const o = await findByOrderId(orderId);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });

  if (action === "start" || action === "resume") {
    const state = await getKioskState();
    if (state !== "ready") return Response.json({ error: state }, { status: 409 });
    const okFrom = action === "start" ? ["pin_accepted"] : ["failed"];
    if (!okFrom.includes(o.status)) return Response.json(toPublic(o, false));
    const [u] = await db
      .update(orders)
      .set({
        status: "printing",
        printStartedAt: new Date(),
        printBaseline: action === "start" ? 0 : o.pagesPrinted,
        failureReason: null,
      })
      .where(eq(orders.id, o.id))
      .returning();
    return Response.json(toPublic(u, false));
  }
  return Response.json({ error: "unknown_action" }, { status: 400 });
}
