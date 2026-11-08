import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobLogs, payments, printJobs, refunds } from "@/db/schema";
import { ApiError } from "./api";
import { notify } from "./alerts";
import { PENDING_JOB_STATUSES } from "./constants";
import { cashfreeStatus, cfCreateRefund, cfGetRefund, GatewayError, mapRefundStatus } from "./cashfree";
import { inr } from "./format";

type Job = typeof printJobs.$inferSelect;
type Payment = typeof payments.$inferSelect;
type Refund = typeof refunds.$inferSelect;

export function computeEligibility(job: Job, payment: Payment | undefined, rs: Refund[]) {
  const blockers: string[] = [];
  const total = job.pages * job.copies;
  const printed = Math.min(job.pagesPrinted, total);
  if (!payment || payment.status !== "success") blockers.push("No confirmed payment exists for this job");
  const active = rs.find((r) => r.status === "requested" || r.status === "processing");
  if (active) blockers.push(`Refund ${active.refundRef} is already ${active.status} — duplicate refunds are blocked`);
  if (PENDING_JOB_STATUSES.includes(job.status)) blockers.push("Job is still pending/queued/printing — cancel it first");
  if (printed >= total && job.status === "completed") blockers.push("All pages were printed — not eligible for a refund");
  const committed = rs.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amountPaise, 0);
  const amount = payment?.amountPaise ?? 0;
  const proportional = total > 0 ? Math.round((amount * (total - printed)) / total) : 0;
  const eligible = Math.max(0, Math.min(proportional - committed, amount - committed));
  if (!blockers.length && eligible < 100) blockers.push("Nothing left to refund for the unprinted pages");
  return {
    ok: blockers.length === 0,
    blockers,
    eligiblePaise: blockers.length ? 0 : eligible,
    printedPages: printed,
    totalPages: total,
    unprintedPages: total - printed,
    paidPaise: amount,
    committedPaise: committed,
  };
}

const CUSTOMER_STATUS = {
  requested: "Refund requested",
  processing: "Refund processing",
  success: "Refunded",
  failed: "Refund failed – support reviewing",
} as const;

export async function initiateRefund(
  user: { name: string },
  p: { jobId: string; amountPaise?: number; reason: string },
) {
  const created = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, p.jobId)).for("update");
    if (!job) throw new ApiError(404, "Job not found");
    const [payment] = await tx.select().from(payments).where(eq(payments.jobId, job.id)).orderBy(desc(payments.id)).limit(1).for("update");
    const rs = payment ? await tx.select().from(refunds).where(eq(refunds.paymentId, payment.id)) : [];
    const el = computeEligibility(job, payment, rs);
    if (!el.ok) throw new ApiError(409, el.blockers[0], { blockers: el.blockers });
    const amount = p.amountPaise ?? el.eligiblePaise;
    if (amount < 100) throw new ApiError(400, "Minimum refund is ₹1");
    if (amount > el.eligiblePaise) throw new ApiError(400, `Amount exceeds the eligible refund of ${inr(el.eligiblePaise)}`);
    const refundRef = `RF-${job.id}-${rs.length + 1}`;
    const type = amount >= payment!.amountPaise - el.committedPaise && el.committedPaise === 0 && amount === payment!.amountPaise ? "full" : "partial";
    const [refund] = await tx
      .insert(refunds)
      .values({ refundRef, paymentId: payment!.id, jobId: job.id, amountPaise: amount, type, reason: p.reason, initiatedBy: user.name })
      .returning();
    await tx.update(printJobs).set({ status: "refund_pending", updatedAt: new Date() }).where(eq(printJobs.id, job.id));
    await tx.update(payments).set({ customerStatus: CUSTOMER_STATUS.requested }).where(eq(payments.id, payment!.id));
    await tx.insert(jobLogs).values({
      jobId: job.id,
      level: "info",
      message: `Refund ${refundRef} of ${inr(amount)} requested by ${user.name}: ${p.reason} (printed ${el.printedPages}/${el.totalPages} pages)`,
    });
    return { refund, payment: payment! };
  });
  await submitToGateway(created.refund, created.payment);
  const [fresh] = await db.select().from(refunds).where(eq(refunds.id, created.refund.id));
  return fresh;
}

async function submitToGateway(refund: Refund, payment: Payment) {
  if (!cashfreeStatus().configured) {
    await db
      .update(refunds)
      .set({
        gatewayMessage: "Cashfree credentials are not configured on this backend. Refund is recorded and awaiting gateway submission — use Reconcile once configured.",
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refund.id));
    return;
  }
  try {
    const r = await cfCreateRefund({ orderId: payment.orderId, refundId: refund.refundRef, amountPaise: refund.amountPaise, note: refund.reason });
    await applyRefundStatus(refund.id, mapRefundStatus(r.refund_status), {
      gatewayRefundId: r.cf_refund_id != null ? String(r.cf_refund_id) : undefined,
      gatewayStatus: r.refund_status,
      message: r.status_description,
    });
  } catch (e) {
    const ge = e instanceof GatewayError ? e : new GatewayError(0, "Gateway call failed", true);
    if (ge.retryable) {
      await db.update(refunds).set({ gatewayMessage: `${ge.message}. Refund remains requested — reconcile to retry safely (idempotent).`, updatedAt: new Date() }).where(eq(refunds.id, refund.id));
    } else {
      await applyRefundStatus(refund.id, "failed", { gatewayStatus: `HTTP ${ge.status}`, message: ge.message });
    }
  }
}

/** The ONLY place a refund can become successful — driven by gateway confirmation (create response, GET reconcile or signed webhook). */
export async function applyRefundStatus(
  refundId: number,
  status: "processing" | "success" | "failed",
  info: { gatewayRefundId?: string; gatewayStatus?: string; message?: string },
) {
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!r || r.status === "success") return null; // terminal
    if (r.status === "failed" && status !== "success") return null;
    const [pay] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for("update");
    const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, r.jobId)).for("update");
    const now = new Date();
    await tx
      .update(refunds)
      .set({
        status,
        gatewayRefundId: info.gatewayRefundId ?? r.gatewayRefundId,
        gatewayStatus: info.gatewayStatus ?? r.gatewayStatus,
        gatewayMessage: info.message ?? r.gatewayMessage,
        updatedAt: now,
        completedAt: status === "processing" ? null : now,
      })
      .where(eq(refunds.id, r.id));
    if (status === "success") {
      const refunded = pay.refundedPaise + r.amountPaise;
      const full = refunded >= pay.amountPaise;
      await tx.update(payments).set({ refundedPaise: refunded, customerStatus: full ? "Refunded" : "Partially refunded" }).where(eq(payments.id, pay.id));
      await tx
        .update(printJobs)
        .set({
          status: full ? "refunded" : job.pagesPrinted > 0 ? "partially_completed" : "failed",
          paymentStatus: full ? "refunded" : "partially_refunded",
          updatedAt: now,
        })
        .where(eq(printJobs.id, job.id));
    } else if (status === "failed") {
      await tx.update(payments).set({ customerStatus: CUSTOMER_STATUS.failed }).where(eq(payments.id, pay.id));
      if (job.status === "refund_pending") {
        await tx
          .update(printJobs)
          .set({ status: job.errorCode === "cancelled" ? "cancelled" : job.pagesPrinted > 0 ? "partially_completed" : "failed", updatedAt: now })
          .where(eq(printJobs.id, job.id));
      }
    } else {
      await tx.update(payments).set({ customerStatus: CUSTOMER_STATUS.processing }).where(eq(payments.id, pay.id));
    }
    await tx.insert(jobLogs).values({
      jobId: job.id,
      level: status === "failed" ? "error" : "info",
      message: `Refund ${r.refundRef} → ${status}${info.message ? `: ${info.message}` : ""}`,
    });
    return { r, status };
  });
  if (out && out.status !== "processing") {
    await notify({
      type: "refund_update",
      severity: out.status === "failed" ? "warning" : "info",
      title: `Refund ${out.r.refundRef} ${out.status === "success" ? "completed" : "failed"}`,
      body: `${inr(out.r.amountPaise)} for job ${out.r.jobId}`,
      link: "/admin/payments?tab=refunds",
    });
  }
  return out;
}

export async function reconcileRefund(refundId: number) {
  const [r] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r) throw new ApiError(404, "Refund not found");
  if (r.status === "success") return r;
  if (!cashfreeStatus().configured) throw new ApiError(503, "Cashfree is not configured — cannot reconcile with the gateway");
  const [pay] = await db.select().from(payments).where(eq(payments.id, r.paymentId));
  try {
    const g = await cfGetRefund(pay.orderId, r.refundRef);
    await applyRefundStatus(r.id, mapRefundStatus(g.refund_status), {
      gatewayRefundId: g.cf_refund_id != null ? String(g.cf_refund_id) : undefined,
      gatewayStatus: g.refund_status,
      message: g.status_description,
    });
  } catch (e) {
    if (e instanceof GatewayError && e.status === 404 && r.status === "requested") {
      await submitToGateway(r, pay); // never reached gateway → safe idempotent create
    } else if (e instanceof GatewayError) {
      throw new ApiError(502, `Gateway: ${e.message}`);
    } else throw e;
  }
  const [fresh] = await db.select().from(refunds).where(and(eq(refunds.id, r.id)));
  return fresh;
}
