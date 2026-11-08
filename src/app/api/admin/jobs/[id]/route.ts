import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobLogs, payments, printAttempts, printJobs, refunds } from "@/db/schema";
import { ApiError, audit, int, oneOf, route, str } from "@/lib/api";
import { cashfreeStatus } from "@/lib/cashfree";
import { cancelEligibility, cancelJob, reconcileJob, retryEligibility, retryJob } from "@/lib/jobs";
import { computeEligibility, initiateRefund } from "@/lib/refunds";
import { getGroup } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>("jobs.view", async ({ params, user }) => {
  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, params.id));
  if (!job) throw new ApiError(404, "Job not found");
  const pays = await db.select().from(payments).where(eq(payments.jobId, job.id)).orderBy(desc(payments.id));
  const payment = pays[0];
  const rs = payment ? await db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).orderBy(desc(refunds.id)) : [];
  const attempts = await db.select().from(printAttempts).where(eq(printAttempts.jobId, job.id)).orderBy(asc(printAttempts.attemptNo));
  const logs = await db.select().from(jobLogs).where(eq(jobLogs.jobId, job.id)).orderBy(asc(jobLogs.createdAt)).limit(200);
  const proc = await getGroup("processing");
  const cleanup = await getGroup("cleanup");
  const canPay = user.permissions.includes("payments.view");
  return {
    job,
    payment: canPay ? payment ?? null : null,
    refunds: canPay ? rs : [],
    attempts,
    logs,
    retry: retryEligibility(job, payment, rs, attempts, proc.maxRetries),
    cancel: cancelEligibility(job),
    refund: computeEligibility(job, payment, rs),
    gateway: cashfreeStatus().configured,
    documentPolicy: { deleteAfterMin: cleanup.deleteDocumentsAfterMin, deleted: !!job.documentDeletedAt },
  };
});

export const POST = route<{ id: string }>(["jobs.manage", "refunds.manage"], async ({ params, user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["retry", "cancel", "reconcile", "refund"] as const);
  const need = action === "refund" ? "refunds.manage" : "jobs.manage";
  if (!user.permissions.includes(need)) throw new ApiError(403, "You don't have permission to do this");
  const id = params.id;
  if (action === "retry") {
    const r = await retryJob(id, user);
    await audit({ user, ip }, "job.retry", "job", id, r);
    return { ok: true, message: `Retry queued on ${r.printerId}${r.failover ? " (failover printer)" : ""}. Waiting for the kiosk agent to pick it up — no new payment was created.` };
  }
  if (action === "cancel") {
    const r = await cancelJob(id, user);
    await audit({ user, ip }, "job.cancel", "job", id, r);
    return { ok: true, message: r.paid ? "Job cancelled. Payment was captured — a refund is now eligible." : "Job cancelled." };
  }
  if (action === "reconcile") {
    const r = await reconcileJob(id, user);
    await audit({ user, ip }, "job.reconcile", "job", id, { findings: r.findings.length });
    return { ok: true, message: "Reconciliation complete", ...r };
  }
  const reason = str(b.reason, "Reason", { min: 5, max: 200 });
  const amountPaise = b.amountPaise != null && b.amountPaise !== "" ? int(b.amountPaise, "Amount", { min: 100 }) : undefined;
  const refund = await initiateRefund(user, { jobId: id, amountPaise, reason });
  await audit({ user, ip }, "refund.initiate", "job", id, { refundRef: refund.refundRef, amountPaise: refund.amountPaise, reason, status: refund.status });
  return {
    ok: true,
    refund,
    message:
      refund.status === "success"
        ? "Refund confirmed by the gateway."
        : refund.status === "failed"
          ? `Gateway rejected the refund: ${refund.gatewayMessage ?? "unknown"}`
          : refund.status === "processing"
            ? "Refund accepted by Cashfree and is processing. It will show as refunded only after gateway confirmation."
            : "Refund recorded. It is NOT complete — " + (refund.gatewayMessage ?? "awaiting gateway submission"),
  };
});
