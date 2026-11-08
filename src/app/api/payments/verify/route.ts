/**
 * POST /api/payments/verify
 *
 * Verifies payment for an order and issues collection PIN.
 * Supports both real Cashfree API verification and sandbox test simulation.
 */
import "server-only";
import { randomBytes } from "crypto";
import { findByToken, generatePin, logAuditEvent, markOrderPaid, toPublic } from "@/lib/server/orders";
import { verifyCashfreePayment, isCashfreeConfigured } from "@/lib/server/cashfree";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId, token, isSimulation, method } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?:   string;
    isSimulation?: boolean;
    method?: string;
  };

  if (!orderId || !token) {
    return Response.json({ error: "orderId and token are required." }, { status: 400 });
  }

  const order = await findByToken(orderId, token);
  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // Already paid — return current state (idempotent)
  if (order.status === "paid") {
    return Response.json(toPublic(order, true));
  }

  // Handle Simulation / Test Mode Payment
  const isSim = isSimulation || order.cashfreeOrderId?.startsWith("sim_") || !isCashfreeConfigured();

  if (isSim) {
    const pin = await generatePin();
    const paymentId = `sim_pay_${randomBytes(6).toString("hex")}`;
    const updated = await markOrderPaid({
      orderId: order.orderId,
      paymentId,
      pin,
      paymentMethod: method ?? "test_gateway",
    });

    await logAuditEvent({
      eventType: "payment_success",
      orderId:   order.orderId,
      details:   { paymentId, amount: order.amount, mode: "test_simulation" },
    });

    return Response.json(toPublic(updated, true));
  }

  if (!order.cashfreeOrderId) {
    return Response.json({ error: "No payment has been initiated for this order." }, { status: 409 });
  }

  try {
    const result = await verifyCashfreePayment(order.cashfreeOrderId);

    if (!result.paid) {
      return Response.json(
        { error: "Payment has not been confirmed yet. Please wait a moment and try again." },
        { status: 402 }
      );
    }

    const pin = await generatePin();
    const updated = await markOrderPaid({
      orderId: order.orderId,
      paymentId: result.paymentId,
      pin,
      paymentMethod: result.paymentMethod,
    });

    await logAuditEvent({
      eventType: "payment_success",
      orderId:   order.orderId,
      details:   { cfPaymentId: result.paymentId, amount: result.amount, source: "verify_endpoint" },
    });

    return Response.json(toPublic(updated, true));
  } catch (err) {
    console.error("[verify] Cashfree verification failed:", err);
    return Response.json(
      { error: "Could not verify payment. Please wait a moment and try again." },
      { status: 502 }
    );
  }
}
