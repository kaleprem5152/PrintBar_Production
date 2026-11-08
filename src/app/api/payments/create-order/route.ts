/**
 * POST /api/payments/create-order
 *
 * Creates a Cashfree payment order for the given PrintBar order.
 * If Cashfree credentials are not yet configured (e.g. local dev / preview),
 * it returns a simulation session so the order can still be completed and tested.
 */
import "server-only";
import { findByToken, updateOrderPaymentState, logAuditEvent } from "@/lib/server/orders";
import { createCashfreeOrder, isCashfreeConfigured, cashfreeEnv } from "@/lib/server/cashfree";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId, token } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?:   string;
  };

  if (!orderId || !token) {
    return Response.json({ error: "orderId and token are required." }, { status: 400 });
  }

  const order = await findByToken(orderId, token);
  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // Already paid
  if (order.status === "paid") {
    return Response.json({
      orderId: order.orderId,
      paid: true,
      pin: order.pin,
      amount: order.amount,
    });
  }

  // Check if Cashfree credentials are configured in environment
  const configured = isCashfreeConfigured();

  if (!configured) {
    // Sandbox / Test simulation mode
    const simCfOrderId = `sim_${order.orderId}`;
    await updateOrderPaymentState({
      orderId: order.orderId,
      cashfreeOrderId: simCfOrderId,
      status: "pending_payment",
    });

    await logAuditEvent({
      eventType: "payment_initiated",
      orderId:   order.orderId,
      details:   { cfOrderId: simCfOrderId, amount: order.amount, mode: "simulation" },
    });

    return Response.json({
      cfOrderId:    simCfOrderId,
      sessionId:    `sim_sess_${order.token}`,
      orderId:      order.orderId,
      amount:       order.amount,
      isConfigured: false,
      isSimulation: true,
      env:          "sandbox",
    });
  }

  try {
    const cfOrder = await createCashfreeOrder({
      internalOrderId: order.orderId,
      amount:          order.amount,
      token:           order.token,
    });

    await updateOrderPaymentState({
      orderId:         order.orderId,
      cashfreeOrderId: cfOrder.cfOrderId,
      status:          "pending_payment",
    });

    await logAuditEvent({
      eventType: "payment_initiated",
      orderId:   order.orderId,
      details:   { cfOrderId: cfOrder.cfOrderId, amount: order.amount },
    });

    return Response.json({
      cfOrderId:    cfOrder.cfOrderId,
      sessionId:    cfOrder.sessionId,
      checkoutUrl:  cfOrder.checkoutUrl,
      orderId:      order.orderId,
      amount:       order.amount,
      isConfigured: true,
      isSimulation: false,
      env:          cashfreeEnv(),
    });
  } catch (err) {
    console.error("[create-order] Cashfree order creation failed:", err);
    return Response.json(
      { error: (err as Error).message || "Payment gateway temporarily unavailable. Please try again." },
      { status: 502 }
    );
  }
}
