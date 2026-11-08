import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, refundTransactions } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { executeOrderRefund, syncPendingRefunds } from "@/lib/server/refunds";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/refunds — List all refund transactions
 * POST /api/admin/refunds — Initiate a refund
 */
export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const refunds = await db
      .select({
        id: refundTransactions.id,
        orderId: refundTransactions.orderId,
        cashfreePaymentId: refundTransactions.cashfreePaymentId,
        cashfreeRefundId: refundTransactions.cashfreeRefundId,
        requestedAmount: refundTransactions.requestedAmount,
        completedAmount: refundTransactions.completedAmount,
        currency: refundTransactions.currency,
        reason: refundTransactions.reason,
        status: refundTransactions.status,
        initiatedBy: refundTransactions.initiatedBy,
        createdAt: refundTransactions.createdAt,
        completedAt: refundTransactions.completedAt,
        failureReason: refundTransactions.failureReason,
        orderStatus: orders.status,
        orderAmount: orders.amount,
      })
      .from(refundTransactions)
      .leftJoin(orders, eq(refundTransactions.orderId, orders.orderId))
      .orderBy(desc(refundTransactions.id))
      .limit(100);

    return Response.json({ refunds });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId, amount, reason } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    amount?: number;
    reason?: string;
  };

  if (!orderId) {
    return Response.json({ error: "orderId is required" }, { status: 400 });
  }

  try {
    const outcome = await executeOrderRefund({
      orderId,
      amount,
      reason: reason || "Manual admin refund issued",
      initiatedBy: `admin:${admin}`,
    });

    return Response.json(outcome);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

