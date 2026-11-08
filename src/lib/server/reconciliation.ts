import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentTransactions } from "@/db/schema";
import { getCashfreeOrder, verifyCashfreePayment } from "@/lib/server/cashfree";
import { generatePin, hashPin, logAuditEvent, markOrderPaid } from "@/lib/server/orders";

export type ReconciliationResult = {
  orderId: string;
  cashfreeOrderId: string;
  status: "reconciled" | "already_paid" | "not_paid" | "failed" | "amount_mismatch";
  message: string;
  paymentId?: string;
};

/**
 * Reconciles pending/failed orders with Cashfree's authoritative order & payment records.
 * Solves:
 * - Customer paid but closed browser before redirect.
 * - Cashfree webhook delayed or lost due to temporary network error.
 * - Server restarted mid-transaction.
 */
export async function reconcilePendingOrders(maxAgeHours = 48): Promise<{
  totalChecked: number;
  totalReconciled: number;
  results: ReconciliationResult[];
}> {
  const minDate = new Date(Date.now() - maxAgeHours * 3600 * 1000);

  // Find candidate orders in uncertain states that have a cashfreeOrderId
  const candidateOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["pending_payment", "payment_failed", "created"]),
        lt(orders.createdAt, new Date(Date.now() - 60 * 1000)), // At least 1 minute old
      )
    )
    .limit(50);

  const results: ReconciliationResult[] = [];
  let totalReconciled = 0;

  for (const order of candidateOrders) {
    if (!order.cashfreeOrderId || order.cashfreeOrderId.startsWith("sim_")) {
      continue;
    }

    try {
      // 1. Check Cashfree order & payments
      const cfPayment = await verifyCashfreePayment(order.cashfreeOrderId);

      if (cfPayment.paid && cfPayment.paymentId) {
        // Validate amount
        if (Math.round(cfPayment.amount) !== order.amount) {
          results.push({
            orderId: order.orderId,
            cashfreeOrderId: order.cashfreeOrderId,
            status: "amount_mismatch",
            message: `Amount mismatch: expected ₹${order.amount}, Cashfree reported ₹${cfPayment.amount}`,
          });
          continue;
        }

        // Generate PIN and mark paid
        const pin = await generatePin();
        const updated = await markOrderPaid({
          orderId: order.orderId,
          paymentId: cfPayment.paymentId,
          pin,
          paymentMethod: cfPayment.paymentMethod,
        });

        // Insert or update transaction record
        await db
          .insert(paymentTransactions)
          .values({
            orderId: order.orderId,
            cashfreeOrderId: order.cashfreeOrderId,
            cashfreePaymentId: cfPayment.paymentId,
            status: "success",
            amount: order.amount,
            currency: "INR",
            paymentMethod: cfPayment.paymentMethod,
            processedAt: new Date(),
          })
          .onConflictDoNothing();

        await logAuditEvent({
          eventType: "payment_success",
          orderId: order.orderId,
          details: {
            cfPaymentId: cfPayment.paymentId,
            amount: order.amount,
            source: "reconciliation_worker",
          },
        });

        totalReconciled++;
        results.push({
          orderId: order.orderId,
          cashfreeOrderId: order.cashfreeOrderId,
          status: "reconciled",
          message: `Successfully reconciled. Issued PIN ${pin}.`,
          paymentId: cfPayment.paymentId,
        });
      } else {
        results.push({
          orderId: order.orderId,
          cashfreeOrderId: order.cashfreeOrderId,
          status: "not_paid",
          message: "Cashfree reports order not yet completed or unpaid.",
        });
      }
    } catch (err) {
      results.push({
        orderId: order.orderId,
        cashfreeOrderId: order.cashfreeOrderId,
        status: "failed",
        message: (err as Error).message,
      });
    }
  }

  return {
    totalChecked: candidateOrders.length,
    totalReconciled,
    results,
  };
}

