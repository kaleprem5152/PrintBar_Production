import { findByOrderId, toPublic, markOrderPaid, generatePin } from "@/lib/server/orders";
import { verifyCashfreePayment, isCashfreeConfigured } from "@/lib/server/cashfree";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k");
  const o = await findByOrderId(orderId);
  if (!o) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // Allow matching token or demo orders
  if (k && o.token !== k && !o.isDemo) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // If returning from Cashfree redirect in pending_payment state, check if payment succeeded
  if (o.status === "pending_payment" && o.cashfreeOrderId && !o.cashfreeOrderId.startsWith("sim_") && isCashfreeConfigured()) {
    try {
      const result = await verifyCashfreePayment(o.cashfreeOrderId);
      if (result.paid) {
        const pin = await generatePin();
        const updated = await markOrderPaid({
          orderId: o.orderId,
          paymentId: result.paymentId,
          pin,
          paymentMethod: result.paymentMethod,
        });
        return Response.json(toPublic(updated, true));
      }
    } catch {
      // Continue and return public order with current pending_payment status
    }
  }

  return Response.json(toPublic(o, true));
}
