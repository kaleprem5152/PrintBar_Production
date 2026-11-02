/**
 * POST /api/payments/verify
 *
 * Called by the frontend after the Cashfree JS SDK redirect/callback.
 * Performs server-side verification of the payment — the frontend is NEVER
 * trusted as proof of payment.
 *
 * Flow:
 * 1. Frontend calls this endpoint with the orderId and token after checkout
 * 2. We look up the order's Cashfree order ID from the database
 * 3. We call the Cashfree API to verify the actual payment status
 * 4. If paid and amount matches, we issue a PIN and transition the order
 * 5. This is a FALLBACK to the webhook — the webhook is the primary mechanism
 *
 * Security:
 * - Always verifies server-side with Cashfree (never trusts browser claims)
 * - The orderId/token pair is required (prevents enumeration)
 * - Idempotent: already-paid orders return their current state
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentTransactions } from "@/db/schema";
import { verifyCashfreePayment } from "@/lib/server/cashfree";
import { generatePin, logAuditEvent, toPublic } from "@/lib/server/orders";
import { PIN_TTL_HOURS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId, token } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?:   string;
  };

  if (!orderId || !token) {
    return Response.json({ error: "orderId and token are required." }, { status: 400 });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.token, token)));

  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  // Already paid — return current state (idempotent)
  if (order.status !== "pending_payment" && order.status !== "payment_pending") {
    return Response.json(toPublic(order, true));
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

    // Verify amount matches
    if (Math.round(result.amount) !== order.amount) {
      console.error(
        `[verify] Amount mismatch: expected ${order.amount}, CF returned ${result.amount}`
      );
      await logAuditEvent({
        eventType: "payment_failed",
        orderId,
        details:   { reason: "amount_mismatch", expected: order.amount, received: result.amount },
      });
      return Response.json({ error: "Payment amount mismatch. Contact support." }, { status: 422 });
    }

    // Check for duplicate — webhook may have already processed this
    const [existing] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.cashfreePaymentId, result.paymentId),
          eq(paymentTransactions.status, "success")
        )
      );

    if (existing) {
      // Already processed by webhook — just reload the order
      const [refreshed] = await db.select().from(orders).where(eq(orders.orderId, orderId));
      return Response.json(toPublic(refreshed ?? order, true));
    }

    // Process payment (webhook hasn't arrived yet)
    const pin = await generatePin();
    const expiresAt = new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
    const now = new Date();

    let updatedOrder = order;
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(orders)
        .set({
          status:            "paid",
          pin,
          expiresAt,
          paidAt:            now,
          cashfreePaymentId: result.paymentId,
          updatedAt:         now,
        })
        .where(eq(orders.id, order.id))
        .returning();
      updatedOrder = u ?? order;

      await tx
        .insert(paymentTransactions)
        .values({
          orderId,
          cashfreeOrderId:   order.cashfreeOrderId!,
          cashfreePaymentId: result.paymentId,
          status:            "success",
          amount:            order.amount,
          currency:          "INR",
          paymentMethod:     result.paymentMethod,
          processedAt:       now,
        })
        .onConflictDoNothing();
    });

    await logAuditEvent({
      eventType: "payment_success",
      orderId,
      details:   { cfPaymentId: result.paymentId, amount: result.amount, source: "verify_fallback" },
    });

    return Response.json(toPublic(updatedOrder, true));
  } catch (err) {
    console.error("[verify] Cashfree verification failed:", err);
    return Response.json(
      { error: "Could not verify payment. Please wait a moment and try again." },
      { status: 502 }
    );
  }
}
