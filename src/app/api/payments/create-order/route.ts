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

  // Check paper availability before accepting payment
  try {
    const { db } = await import("@/db");
    const { devices } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { DEVICE_ID } = await import("@/lib/config");

    const [dev] = await db.select().from(devices).where(eq(devices.id, DEVICE_ID)).limit(1);
    if (dev) {
      if (dev.maintenanceMode) {
        return Response.json(
          { error: "The kiosk is currently in maintenance mode. Payment cannot be accepted at this time." },
          { status: 503 }
        );
      }

      const sheetsNeeded = order.physicalSheets || Math.max(1, Math.ceil(order.pagesToPrint / (order.pagesPerSheet || 1)));
      const kyoceraPaper = dev.kyoceraPaper ?? 0;
      const canonPaper = dev.canonPaper ?? 0;

      if (!dev.paperReady || (kyoceraPaper <= 0 && canonPaper <= 0)) {
        return Response.json(
          { error: "The kiosk is completely out of paper. Please ask the kiosk operator to refill paper." },
          { status: 503 }
        );
      }

      if (order.colorMode === "color" && canonPaper < sheetsNeeded) {
        return Response.json(
          { error: `The colour printer does not have enough paper for this job (available: ${canonPaper} sheets, required: ${sheetsNeeded} sheets). Please contact the operator.` },
          { status: 503 }
        );
      }

      if (order.colorMode === "bw" && kyoceraPaper < sheetsNeeded && canonPaper < sheetsNeeded) {
        return Response.json(
          { error: `The kiosk does not have enough paper for this job (required: ${sheetsNeeded} sheets). Please contact the operator.` },
          { status: 503 }
        );
      }
    }
  } catch (err) {
    // If DB check encounters transient error, proceed safely
  }

  // Check if Cashfree credentials are configured in environment
  const configured = isCashfreeConfigured();
  const allowSimulation = process.env.NODE_ENV !== "production" && process.env.ALLOW_PAYMENT_SIMULATION === "true";

  if (!configured) {
    if (!allowSimulation) {
      console.error("[create-order] Cashfree credentials are not configured in production");
      return Response.json(
        { error: "Cashfree payment gateway is not configured or unavailable. Please contact the kiosk administrator." },
        { status: 503 }
      );
    }

    // Explicit Development / Sandbox simulation mode (ONLY when ALLOW_PAYMENT_SIMULATION === "true")
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
      cfOrderId:           simCfOrderId,
      sessionId:           `sim_sess_${order.token}`,
      orderId:             order.orderId,
      amount:              order.amount,
      isConfigured:        false,
      isSimulation:        true,
      isSimulationAllowed: true,
      env:                 "sandbox",
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
      cfOrderId:           cfOrder.cfOrderId,
      sessionId:           cfOrder.sessionId,
      checkoutUrl:         cfOrder.checkoutUrl,
      orderId:             order.orderId,
      amount:              order.amount,
      isConfigured:        true,
      isSimulation:        false,
      isSimulationAllowed: allowSimulation,
      env:                 cashfreeEnv(),
    });
  } catch (err) {
    console.error("[create-order] Cashfree order creation failed:", err);
    return Response.json(
      { error: (err as Error).message || "Payment gateway temporarily unavailable. Please try again." },
      { status: 502 }
    );
  }
}
