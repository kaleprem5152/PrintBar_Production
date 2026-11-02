/**
 * POST /api/payments/create-order
 *
 * Creates a Cashfree payment order for the given PrintBar order.
 * Called by the frontend after the user clicks "Continue to Payment".
 *
 * Returns the Cashfree payment session ID needed for the JS SDK checkout.
 * The cfOrderId is stored in our database; never rely on client-supplied values.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentTransactions } from "@/db/schema";
import { createCashfreeOrder, isCashfreeConfigured } from "@/lib/server/cashfree";
import { logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId, token } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?:   string;
  };

  if (!orderId || !token) {
    return Response.json({ error: "orderId and token are required." }, { status: 400 });
  }

  // Verify the order exists and the token matches
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderId, orderId));

  if (!order || order.token !== token) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // If already has an existing Cashfree order in pending_payment state, return it
  if (order.cashfreeOrderId && order.status === "pending_payment") {
    return Response.json({
      cfOrderId: order.cashfreeOrderId,
      orderId:   order.orderId,
      amount:    order.amount,
    });
  }

  // Only allow payment creation for orders awaiting payment
  if (order.status !== "created" && order.status !== "pending_payment") {
    return Response.json({ error: "This order is not awaiting payment." }, { status: 409 });
  }

  if (!isCashfreeConfigured()) {
    return Response.json(
      { error: "Payment gateway not configured. Contact support." },
      { status: 503 }
    );
  }

  try {
    // Create Cashfree order
    const cfOrder = await createCashfreeOrder({
      internalOrderId: order.orderId,
      amount:          order.amount,
    });

    // Store Cashfree order ID and transition status
    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          cashfreeOrderId: cfOrder.cfOrderId,
          status:          "pending_payment",
          updatedAt:       new Date(),
        })
        .where(eq(orders.id, order.id));

      // Create a pending payment transaction record
      await tx.insert(paymentTransactions).values({
        orderId:         order.orderId,
        cashfreeOrderId: cfOrder.cfOrderId,
        status:          "pending",
        amount:          order.amount,
        currency:        "INR",
      });
    });

    await logAuditEvent({
      eventType: "payment_initiated",
      orderId:   order.orderId,
      details:   { cfOrderId: cfOrder.cfOrderId, amount: order.amount },
    });

    return Response.json({
      cfOrderId:  cfOrder.cfOrderId,
      sessionId:  cfOrder.sessionId,
      orderId:    order.orderId,
      amount:     order.amount,
    });
  } catch (err) {
    console.error("[create-order] Cashfree order creation failed:", err);
    return Response.json(
      { error: "Payment gateway temporarily unavailable. Please try again." },
      { status: 502 }
    );
  }
}
