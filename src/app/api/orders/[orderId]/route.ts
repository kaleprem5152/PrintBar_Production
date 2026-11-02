import { findByOrderId, toPublic } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k");
  const o = await findByOrderId(orderId);
  if (!o || !k || o.token !== k || o.status === "pending_payment") {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }
  return Response.json(toPublic(o, true));
}
