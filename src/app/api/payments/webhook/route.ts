/**
 * POST /api/payments/webhook
 *
 * Receives and processes Cashfree payment webhooks.
 *
 * Security:
 * - Verifies the x-webhook-signature header using HMAC-SHA256
 * - Uses raw request body for signature verification (before any JSON parsing)
 * - Idempotent: duplicate webhooks for the same payment are safely ignored
 * - Never starts printing based solely on the webhook; updates DB status only
 *
 * After a successful webhook, the Raspberry Pi agent polls for PAID orders
 * and claims them for printing.
 *
 * Documentation: https://docs.cashfree.com/docs/webhook-security
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentTransactions, refundTransactions } from "@/db/schema";
import { verifyCashfreeWebhookSignature } from "@/lib/server/cashfree";
import { generatePin, hashPin, logAuditEvent } from "@/lib/server/orders";
import { PIN_TTL_HOURS } from "@/lib/config";

export const dynamic = "force-dynamic";

// Prevent edge runtime — we need Node.js crypto
export const runtime = "nodejs";

export async function POST(req: Request) {
  // ── 1. Read the raw body for signature verification ──────────────────────
  const rawBody = await req.text();

  // ── 2. Extract Cashfree signature headers ─────────────────────────────────
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const signature = req.headers.get("x-webhook-signature") ?? "";

  // ── 3. Verify webhook signature ───────────────────────────────────────────
  if (!verifyCashfreeWebhookSignature(rawBody, timestamp, signature)) {
    console.error("[webhook] Signature verification failed");
    // Return 200 to prevent Cashfree from retrying — this is intentionally
    // a silent failure (don't reveal signature mismatch to callers)
    return new Response("ok", { status: 200 });
  }

  // ── 4. Parse the payload ──────────────────────────────────────────────────
  let payload: {
    type?: string;
    data?: {
      order?: {
        order_id?: string;
        order_amount?: number;
      };
      payment?: {
        cf_payment_id?: string;
        payment_status?: string;
        payment_amount?: number;
        payment_method?: Record<string, unknown>;
        payment_time?: string;
      };
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[webhook] Invalid JSON payload");
    return new Response("ok", { status: 200 });
  }

  const eventType    = payload.type ?? "";
  const internalOrderId = payload.data?.order?.order_id ?? "";
  const cfPaymentId  = payload.data?.payment?.cf_payment_id ?? "";
  const paymentStatus = payload.data?.payment?.payment_status ?? "";
  const paymentAmount = payload.data?.payment?.payment_amount ?? 0;
  const paymentMethod = payload.data?.payment?.payment_method ?? {};
  const paymentTime   = payload.data?.payment?.payment_time ?? "";

  console.log(`[webhook] Event: ${eventType} | Order: ${internalOrderId} | Payment: ${cfPaymentId} | Status: ${paymentStatus}`);

  // ── 5. Process refund events ──────────────────────────────────────────────
  if (eventType.startsWith("REFUND_")) {
    const refundData = (payload.data as any)?.refund;
    const cfRefundId = refundData?.cf_refund_id;
    const refOrderId = refundData?.order_id || internalOrderId;
    const rfStatus = (refundData?.refund_status || "").toUpperCase();
    const rfAmount = Number(refundData?.refund_amount || 0);

    console.log(`[webhook] Refund event: ${eventType} | Order: ${refOrderId} | CF Refund ID: ${cfRefundId} | Status: ${rfStatus}`);

    if (refOrderId) {
      const now = new Date();
      if (rfStatus === "SUCCESS") {
        await db
          .update(orders)
          .set({ refundStatus: "REFUNDED", refundedAmount: Math.round(rfAmount), updatedAt: now })
          .where(eq(orders.orderId, refOrderId));

        if (cfRefundId) {
          await db
            .update(refundTransactions)
            .set({ status: "SUCCESS", completedAmount: rfAmount, completedAt: now, updatedAt: now })
            .where(eq(refundTransactions.cashfreeRefundId, cfRefundId));
        }

        await logAuditEvent({
          eventType: "refund_completed",
          orderId: refOrderId,
          details: { cfRefundId, amount: rfAmount, source: "webhook" },
        });
      } else if (rfStatus === "FAILED") {
        await db
          .update(orders)
          .set({ refundStatus: "REFUND_FAILED", updatedAt: now })
          .where(eq(orders.orderId, refOrderId));

        if (cfRefundId) {
          await db
            .update(refundTransactions)
            .set({ status: "FAILED", failureReason: refundData?.status_description || "Cashfree reported failed", updatedAt: now })
            .where(eq(refundTransactions.cashfreeRefundId, cfRefundId));
        }
      }
    }

    return new Response("ok", { status: 200 });
  }

  // ── 6. Only process payment events from here ──────────────────────────────
  if (!eventType.startsWith("PAYMENT_")) {
    return new Response("ok", { status: 200 });
  }

  if (!internalOrderId) {
    console.error("[webhook] Missing order_id in webhook payload");
    return new Response("ok", { status: 200 });
  }

  // ── 7. Load the order ─────────────────────────────────────────────────────
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderId, internalOrderId));

  if (!order) {
    console.error(`[webhook] Order ${internalOrderId} not found`);
    return new Response("ok", { status: 200 });
  }

  // ── 8. Idempotency: skip if already processed ─────────────────────────────
  if (order.status === "paid" || order.status === "queued" ||
      order.status === "claimed" || order.status === "printing" ||
      order.status === "completed" || order.status === "refunded") {
    console.log(`[webhook] Order ${internalOrderId} already processed (status: ${order.status}), skipping`);
    return new Response("ok", { status: 200 });
  }

  // ── 9. Check for duplicate CF payment ID in transaction log ───────────────
  if (cfPaymentId) {
    const [existing] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.cashfreePaymentId, cfPaymentId),
          eq(paymentTransactions.status, "success")
        )
      );
    if (existing) {
      console.log(`[webhook] Payment ${cfPaymentId} already recorded, skipping`);
      return new Response("ok", { status: 200 });
    }
  }

  // ── 9. Process SUCCESS payment ────────────────────────────────────────────
  if (paymentStatus === "SUCCESS") {
    // Verify the amount matches what we expect
    if (Math.round(paymentAmount) !== order.amount) {
      console.error(
        `[webhook] Amount mismatch for ${internalOrderId}: expected ${order.amount}, got ${paymentAmount}`
      );
      await logAuditEvent({
        eventType: "payment_failed",
        orderId:   internalOrderId,
        details:   { reason: "amount_mismatch", expected: order.amount, received: paymentAmount },
      });
      return new Response("ok", { status: 200 });
    }

    try {
      const pin = await generatePin();
      const expiresAt = new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
      const now = new Date();

      await db.transaction(async (tx) => {
        // Update order to PAID and issue PIN
        await tx
          .update(orders)
          .set({
            status:            "paid",
            pin,
            pinHash:           hashPin(pin),
            pinAttempts:       0,
            pinLockedUntil:    null,
            expiresAt,
            paidAt:            now,
            cashfreePaymentId: cfPaymentId,
            updatedAt:         now,
          })
          .where(eq(orders.id, order.id));

        // Record the successful payment transaction
        await tx
          .insert(paymentTransactions)
          .values({
            orderId:           internalOrderId,
            cashfreeOrderId:   order.cashfreeOrderId ?? "",
            cashfreePaymentId: cfPaymentId,
            status:            "success",
            amount:            order.amount,
            currency:          "INR",
            paymentMethod:     extractMethodName(paymentMethod),
            webhookReceivedAt: now,
            webhookPayload:    { type: eventType, payment_time: paymentTime }, // No PII stored
            processedAt:       now,
          })
          .onConflictDoNothing();
      });

      await logAuditEvent({
        eventType: "payment_success",
        orderId:   internalOrderId,
        details:   { cfPaymentId, amount: paymentAmount, method: extractMethodName(paymentMethod) },
      });

      console.log(`[webhook] Payment SUCCESS for ${internalOrderId} — PIN issued, order queued`);
    } catch (err) {
      console.error(`[webhook] Failed to process payment for ${internalOrderId}:`, err);
      // Do not return 500 — Cashfree will retry, which could cause issues
      // The reconciliation job will pick this up
    }
  }

  // ── 10. Process FAILED / other payment events ─────────────────────────────
  if (paymentStatus === "FAILED" || paymentStatus === "USER_DROPPED" || paymentStatus === "CANCELLED") {
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({ status: "payment_failed", updatedAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment")));

        if (cfPaymentId) {
          await tx
            .insert(paymentTransactions)
            .values({
              orderId:           internalOrderId,
              cashfreeOrderId:   order.cashfreeOrderId ?? "",
              cashfreePaymentId: cfPaymentId,
              status:            "failed",
              amount:            order.amount,
              currency:          "INR",
              webhookReceivedAt: new Date(),
            })
            .onConflictDoNothing();
        }
      });

      await logAuditEvent({
        eventType: "payment_failed",
        orderId:   internalOrderId,
        details:   { cfPaymentId, paymentStatus },
      });
    } catch (err) {
      console.error(`[webhook] Failed to record payment failure for ${internalOrderId}:`, err);
    }
  }

  // Always return 200 to acknowledge receipt
  return new Response("ok", { status: 200 });
}

function extractMethodName(method: Record<string, unknown>): string {
  if (method.upi)        return "upi";
  if (method.card)       return "card";
  if (method.netbanking) return "netbanking";
  if (method.wallet)     return "wallet";
  if (method.emi)        return "emi";
  return "unknown";
}
