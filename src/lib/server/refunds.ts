import "server-only";
import { randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, refundTransactions, type OrderRow } from "@/db/schema";
import { createCashfreeRefund, getCashfreeRefundStatus } from "./cashfree";
import { logAuditEvent } from "./orders";

export type RefundScenario =
  | "kiosk_unreachable"
  | "printer_offline"
  | "hardware_failure_before_print"
  | "hardware_failure_partial_print"
  | "unverified_physical_output"
  | "job_cancelled"
  | "admin_manual_refund"
  | "payment_reconciliation_anomaly";

export type RefundCalculation = {
  orderId:          string;
  totalPaid:        number; // in Rupees
  sheetsExpected:   number;
  sheetsPrinted:    number;
  ratePerSheet:     number;
  earnedAmount:     number; // in Rupees
  refundableAmount: number; // in Rupees
  isPartial:        boolean;
  requiresReview:   boolean;
  reason:           string;
};

/**
 * Calculates the exact refundable amount based on verified physical output.
 * If physical output cannot be reliably verified, flags as requiresReview: true.
 */
export function calculateRefundAmount(order: OrderRow, verifiedSheetsPrinted?: number): RefundCalculation {
  const totalPaid = order.amount;
  const sheetsExpected = order.physicalSheets || Math.max(1, Math.ceil(order.pagesToPrint / (order.pagesPerSheet || 1)));
  const ratePerSheet = order.rateApplied || Math.max(1, Math.round(totalPaid / sheetsExpected));

  // If verified output is passed explicitly, use it; otherwise use order.sheetsPrinted
  const sheetsPrinted = verifiedSheetsPrinted !== undefined ? verifiedSheetsPrinted : (order.sheetsPrinted || 0);

  // If printer reported partial progress but output verification is uncertain
  if (sheetsPrinted > 0 && order.status === "requires_manual_review") {
    return {
      orderId: order.orderId,
      totalPaid,
      sheetsExpected,
      sheetsPrinted,
      ratePerSheet,
      earnedAmount: 0,
      refundableAmount: 0,
      isPartial: true,
      requiresReview: true,
      reason: "Physical output page count is unverified. Manual operator review required before refund.",
    };
  }

  // If zero sheets were printed (printer failed before starting, offline, or cancelled)
  if (sheetsPrinted <= 0) {
    return {
      orderId: order.orderId,
      totalPaid,
      sheetsExpected,
      sheetsPrinted: 0,
      ratePerSheet,
      earnedAmount: 0,
      refundableAmount: totalPaid,
      isPartial: false,
      requiresReview: false,
      reason: "Full refund: printing did not start or hardware failed before producing physical output.",
    };
  }

  // If all sheets were already printed
  if (sheetsPrinted >= sheetsExpected) {
    return {
      orderId: order.orderId,
      totalPaid,
      sheetsExpected,
      sheetsPrinted,
      ratePerSheet,
      earnedAmount: totalPaid,
      refundableAmount: 0,
      isPartial: false,
      requiresReview: false,
      reason: "No refund: all requested physical sheets were successfully printed.",
    };
  }

  // Partial printing output verified
  const earnedAmount = Math.min(totalPaid, sheetsPrinted * ratePerSheet);
  const refundableAmount = Math.max(0, totalPaid - earnedAmount);

  return {
    orderId: order.orderId,
    totalPaid,
    sheetsExpected,
    sheetsPrinted,
    ratePerSheet,
    earnedAmount,
    refundableAmount,
    isPartial: true,
    requiresReview: false,
    reason: `Partial refund: ${sheetsPrinted} of ${sheetsExpected} sheets printed. Refunding unprinted portion (₹${refundableAmount}).`,
  };
}

/**
 * Initiates a refund through Cashfree and logs it in the database.
 */
export async function executeOrderRefund(params: {
  orderId:                 string;
  amount?:                 number; // in Rupees, defaults to available refundable balance
  reason:                  string;
  scenario?:               RefundScenario;
  initiatedBy?:            string; // "system" | "admin" | "kiosk_auto"
  forceManualReview?:      boolean;
}): Promise<{
  success:        boolean;
  status:         string;
  refundId:       string;
  cashfreeRefundId?: string;
  error?:         string;
}> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderId, params.orderId));

  if (!order) {
    throw new Error(`Order ${params.orderId} not found.`);
  }

  if (order.status !== "paid" && order.status !== "failed" &&
      order.status !== "requires_manual_review" && order.status !== "cancelled" &&
      order.status !== "refund_pending") {
    throw new Error(`Order ${params.orderId} is in status '${order.status}' and cannot be refunded.`);
  }

  if (!order.cashfreePaymentId && !order.cashfreeOrderId) {
    throw new Error(`Order ${params.orderId} has no Cashfree payment reference.`);
  }

  // Prevent refunding more than was paid
  const alreadyRefunded = order.refundedAmount || 0;
  const maxAvailable = order.amount - alreadyRefunded;
  const refundAmount = params.amount !== undefined ? params.amount : maxAvailable;

  if (refundAmount <= 0 || refundAmount > maxAvailable) {
    throw new Error(`Requested refund ₹${refundAmount} exceeds available refundable balance ₹${maxAvailable}.`);
  }

  const uniqueSuffix = randomBytes(4).toString("hex");
  const refundId = `ref_${order.orderId}_${uniqueSuffix}`;
  const idempotencyKey = `idemp_${order.orderId}_${refundAmount}_${uniqueSuffix}`;
  const now = new Date();

  // If flagged for manual review, record as REFUND_REQUIRES_REVIEW without calling Cashfree
  if (params.forceManualReview) {
    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status:        "requires_manual_review",
          refundStatus:  "REFUND_REQUIRES_REVIEW",
          failureReason: params.reason,
          updatedAt:     now,
        })
        .where(eq(orders.id, order.id));

      await tx.insert(refundTransactions).values({
        orderId:              order.orderId,
        cashfreePaymentId:    order.cashfreePaymentId ?? "",
        cashfreeRefundId:     refundId,
        requestedAmount:      refundAmount,
        completedAmount:      0,
        currency:             "INR",
        reason:               params.reason,
        status:               "REFUND_REQUIRES_REVIEW",
        initiatedBy:          params.initiatedBy ?? "system",
        idempotencyKey,
        failureReason:        "Flagged for manual review",
        createdAt:            now,
        updatedAt:            now,
      });
    });

    await logAuditEvent({
      eventType: "admin_action",
      orderId:   order.orderId,
      actorId:   params.initiatedBy ?? "system",
      details:   { reason: params.reason, amount: refundAmount, status: "REFUND_REQUIRES_REVIEW" },
    });

    return {
      success:  false,
      status:   "REFUND_REQUIRES_REVIEW",
      refundId,
      error:    "Refund flagged for manual review. Physical verification required.",
    };
  }

  // Call Cashfree Refund API
  try {
    const cfRefund = await createCashfreeRefund({
      orderId:      order.orderId,
      refundAmount: refundAmount,
      refundId,
      refundNote:   params.reason,
    });

    const isSuccess = cfRefund.refundStatus === "SUCCESS";
    const dbStatus = isSuccess
      ? "REFUNDED"
      : cfRefund.refundStatus === "FAILED"
        ? "REFUND_FAILED"
        : "REFUND_PROCESSING";

    await db.transaction(async (tx) => {
      // Insert into refund_transactions
      await tx.insert(refundTransactions).values({
        orderId:              order.orderId,
        cashfreePaymentId:    order.cashfreePaymentId ?? "",
        cashfreeRefundId:     cfRefund.cfRefundId,
        requestedAmount:      refundAmount,
        completedAmount:      isSuccess ? refundAmount : 0,
        currency:             cfRefund.refundCurrency || "INR",
        reason:               params.reason,
        status:               dbStatus,
        initiatedBy:          params.initiatedBy ?? "system",
        idempotencyKey,
        failureReason:        cfRefund.statusDescription,
        cfResponse:           cfRefund,
        createdAt:            now,
        updatedAt:            now,
        completedAt:          isSuccess ? now : null,
      });

      // Update orders row
      await tx
        .update(orders)
        .set({
          status:         isSuccess ? "refunded" : "refund_pending",
          refundStatus:   dbStatus,
          refundedAmount: alreadyRefunded + (isSuccess ? refundAmount : 0),
          updatedAt:      now,
        })
        .where(eq(orders.id, order.id));
    });

    await logAuditEvent({
      eventType: isSuccess ? "refund_completed" : "refund_initiated",
      orderId:   order.orderId,
      actorId:   params.initiatedBy ?? "system",
      details:   {
        cfRefundId: cfRefund.cfRefundId,
        amount:     params.amount,
        status:     dbStatus,
        scenario:   params.scenario,
      },
    });

    return {
      success:          isSuccess || dbStatus === "REFUND_PROCESSING",
      status:           dbStatus,
      refundId:         cfRefund.refundId,
      cashfreeRefundId: cfRefund.cfRefundId,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown Cashfree refund error";
    console.error(`[refund] Cashfree refund failed for ${order.orderId}:`, err);

    await db.transaction(async (tx) => {
      await tx.insert(refundTransactions).values({
        orderId:           order.orderId,
        cashfreePaymentId: order.cashfreePaymentId ?? "",
        cashfreeRefundId:  refundId,
        requestedAmount:   refundAmount,
        completedAmount:   0,
        currency:          "INR",
        reason:            params.reason,
        status:            "REFUND_FAILED",
        initiatedBy:       params.initiatedBy ?? "system",
        idempotencyKey,
        failureReason:     errMsg,
        createdAt:         now,
        updatedAt:         now,
      });

      await tx
        .update(orders)
        .set({
          refundStatus: "REFUND_FAILED",
          updatedAt:    now,
        })
        .where(eq(orders.id, order.id));
    });

    await logAuditEvent({
      eventType: "refund_failed",
      orderId:   order.orderId,
      actorId:   params.initiatedBy ?? "system",
      details:   { error: errMsg, amount: params.amount },
    });

    return {
      success:  false,
      status:   "REFUND_FAILED",
      refundId,
      error:    errMsg,
    };
  }
}

/**
 * Synchronize the status of pending refunds by querying Cashfree API.
 */
export async function syncPendingRefunds(): Promise<{ synced: number; completed: number; failed: number }> {
  const pendingRefunds = await db
    .select()
    .from(refundTransactions)
    .where(eq(refundTransactions.status, "REFUND_PROCESSING"));

  let completed = 0;
  let failed = 0;

  for (const ref of pendingRefunds) {
    try {
      const statusRes = await getCashfreeRefundStatus(ref.orderId, ref.cashfreeRefundId);
      const now = new Date();

      if (statusRes.refundStatus === "SUCCESS") {
        await db.transaction(async (tx) => {
          await tx
            .update(refundTransactions)
            .set({
              status:          "REFUNDED",
              completedAmount: statusRes.refundAmount,
              completedAt:     now,
              updatedAt:       now,
            })
            .where(eq(refundTransactions.id, ref.id));

          await tx
            .update(orders)
            .set({
              status:         "refunded",
              refundStatus:   "REFUNDED",
              refundedAmount: statusRes.refundAmount,
              updatedAt:      now,
            })
            .where(eq(orders.orderId, ref.orderId));
        });
        completed++;
      } else if (statusRes.refundStatus === "FAILED") {
        await db
          .update(refundTransactions)
          .set({
            status:        "REFUND_FAILED",
            failureReason: statusRes.statusDescription || "Cashfree reported refund failure",
            updatedAt:     now,
          })
          .where(eq(refundTransactions.id, ref.id));
        failed++;
      }
    } catch (e) {
      console.warn(`[syncPendingRefunds] Failed to sync ${ref.cashfreeRefundId}:`, e);
    }
  }

  return { synced: pendingRefunds.length, completed, failed };
}

