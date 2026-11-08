import { and, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, jobLogs, kiosks, payments, printAttempts, printJobs, printers, refunds } from "@/db/schema";
import { ApiError } from "./api";
import { cashfreeStatus, cfGetOrderPayments, GatewayError } from "./cashfree";
import { getGroup } from "./settings";

type Job = typeof printJobs.$inferSelect;
type Payment = typeof payments.$inferSelect;
type Refund = typeof refunds.$inferSelect;
type Attempt = typeof printAttempts.$inferSelect;

export function retryEligibility(job: Job, payment: Payment | undefined, rs: Refund[], attempts: Attempt[], maxRetries: number) {
  const no = (reason: string) => ({ ok: false, reason });
  if (!["failed", "partially_completed"].includes(job.status)) return no("Only failed or partially completed jobs can be retried");
  if (!payment || payment.status !== "success") return no("Payment is not confirmed — an unpaid job is never printed");
  if (rs.some((r) => r.status !== "failed")) return no("A refund exists or is in progress — retrying could print AND refund the same job");
  if (attempts.some((a) => ["queued", "printing"].includes(a.status))) return no("A print attempt is already in progress");
  if (job.documentDeletedAt) return no("Customer document was already deleted under the retention policy — it cannot be reprinted. Offer a refund instead.");
  if (job.retryCount >= maxRetries) return no(`Retry limit (${maxRetries}) reached`);
  return { ok: true as const, reason: undefined };
}

export function cancelEligibility(job: Job) {
  if (["uploaded", "awaiting_payment", "payment_successful", "queued"].includes(job.status)) return { ok: true as const, reason: undefined };
  return { ok: false, reason: "Only jobs that have not started printing can be cancelled" };
}

export async function retryJob(jobId: string, user: { name: string }) {
  const g = await getGroup("processing");
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId)).for("update");
    if (!job) throw new ApiError(404, "Job not found");
    const [payment] = await tx.select().from(payments).where(eq(payments.jobId, jobId)).orderBy(desc(payments.id)).limit(1).for("update");
    const rs = payment ? await tx.select().from(refunds).where(eq(refunds.paymentId, payment.id)) : [];
    const attempts = await tx.select().from(printAttempts).where(eq(printAttempts.jobId, jobId));
    const el = retryEligibility(job, payment, rs, attempts, g.maxRetries);
    if (!el.ok) throw new ApiError(409, el.reason!);

    // Choose printer: assigned one if healthy, otherwise failover (if enabled)
    const all = await tx.select().from(printers).where(job.kioskId ? eq(printers.kioskId, job.kioskId) : undefined);
    const usable = all.filter((p) => p.enabled && !p.paused && p.connected && p.state !== "error" && (job.colorMode === "bw" || p.supportsColor));
    const assigned = usable.find((p) => p.id === job.printerId);
    const failover = g.autoFailover ? usable.filter((p) => p.autoFailover).sort((a, b) => a.priority - b.priority)[0] : undefined;
    const target = assigned ?? failover;
    if (!target) throw new ApiError(409, "No enabled, connected printer is available for this job. Resolve the printer issue first.");
    const kiosk = target.kioskId ? (await tx.select().from(kiosks).where(eq(kiosks.id, target.kioskId)))[0] : undefined;
    if (kiosk && (!kiosk.enabled || kiosk.printingPaused || kiosk.maintenance)) {
      throw new ApiError(409, "Kiosk is disabled, paused or in maintenance mode — resume printing first");
    }

    const [{ n }] = await tx.select({ n: max(printAttempts.attemptNo) }).from(printAttempts).where(eq(printAttempts.jobId, jobId));
    const attemptNo = (n ?? 0) + 1;
    await tx.insert(printAttempts).values({ jobId, attemptNo, printerId: target.id, status: "queued" }); // unique "one live attempt" index guards races
    await tx
      .update(printJobs)
      .set({ status: "queued", printerId: target.id, kioskId: target.kioskId, retryCount: job.retryCount + 1, errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(printJobs.id, jobId));
    await tx.insert(deviceCommands).values({
      kioskId: target.kioskId,
      printerId: target.id,
      command: "print_job",
      payload: { jobId, attemptNo, alreadyPrintedPages: job.pagesPrinted, paymentId: payment!.id },
      idempotencyKey: `retry:${jobId}:${attemptNo}`,
      requestedBy: user.name,
    });
    await tx.insert(jobLogs).values({
      jobId,
      message: `Retry #${attemptNo} queued on ${target.id} by ${user.name}${target.id !== job.printerId ? " (failover printer)" : ""}. No new payment created.`,
    });
    return { attemptNo, printerId: target.id, failover: target.id !== job.printerId };
  });
}

export async function cancelJob(jobId: string, user: { name: string }) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId)).for("update");
    if (!job) throw new ApiError(404, "Job not found");
    const el = cancelEligibility(job);
    if (!el.ok) throw new ApiError(409, el.reason!);
    const now = new Date();
    await tx.update(printAttempts).set({ status: "cancelled", endedAt: now }).where(and(eq(printAttempts.jobId, jobId), inArray(printAttempts.status, ["queued"])));
    // Withdraw queued device commands so the kiosk can never print a cancelled job
    const cmds = await tx.select().from(deviceCommands).where(and(eq(deviceCommands.command, "print_job"), eq(deviceCommands.status, "queued")));
    for (const c of cmds) {
      if ((c.payload as { jobId?: string })?.jobId === jobId) {
        await tx.update(deviceCommands).set({ status: "cancelled", completedAt: now, result: "Job cancelled by admin" }).where(eq(deviceCommands.id, c.id));
      }
    }
    await tx.update(printJobs).set({ status: "cancelled", errorCode: "cancelled", updatedAt: now }).where(eq(printJobs.id, jobId));
    await tx.insert(jobLogs).values({ jobId, message: `Cancelled by ${user.name}` });
    const [pay] = await tx.select().from(payments).where(eq(payments.jobId, jobId)).orderBy(desc(payments.id)).limit(1);
    if (pay) {
      await tx
        .update(payments)
        .set({ customerStatus: pay.status === "success" ? "Cancelled – refund eligible" : "Cancelled" })
        .where(eq(payments.id, pay.id));
    }
    return { paid: pay?.status === "success" };
  });
}

/** Reconcile print ↔ payment state. Optionally pulls truth from Cashfree. Safe fixes only; never creates charges or prints. */
export async function reconcileJob(jobId: string, user: { name: string }) {
  const findings: { level: "ok" | "info" | "warn" | "fixed"; text: string }[] = [];
  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (!job) throw new ApiError(404, "Job not found");
  let [payment] = await db.select().from(payments).where(eq(payments.jobId, jobId)).orderBy(desc(payments.id)).limit(1);
  if (!payment) {
    findings.push({ level: "info", text: "No payment record exists for this job" });
    return { findings };
  }

  if (cashfreeStatus().configured) {
    try {
      const list = await cfGetOrderPayments(payment.orderId);
      const ok = list.find((p) => p.payment_status === "SUCCESS");
      const gw = ok ? "success" : list.some((p) => p.payment_status === "PENDING") ? "pending" : list.length ? "failed" : "pending";
      if (gw !== payment.status && payment.status !== "success") {
        await db.update(payments).set({ status: gw, transactionId: ok ? String(ok.cf_payment_id) : payment.transactionId, paidAt: ok ? new Date() : payment.paidAt }).where(eq(payments.id, payment.id));
        findings.push({ level: "fixed", text: `Payment status updated from gateway: ${payment.status} → ${gw}` });
        payment = { ...payment, status: gw };
      } else if (payment.status === "success" && gw !== "success") {
        findings.push({ level: "warn", text: `Gateway reports "${gw}" but local record says success — investigate in the Cashfree dashboard (not auto-changed)` });
      } else findings.push({ level: "ok", text: "Payment status matches Cashfree" });
      await db.update(payments).set({ reconciledAt: new Date() }).where(eq(payments.id, payment.id));
    } catch (e) {
      findings.push({ level: "warn", text: `Gateway check failed: ${e instanceof GatewayError ? e.message : "unknown error"}` });
    }
  } else {
    findings.push({ level: "info", text: "Cashfree not configured — reconciled against internal records only" });
  }

  const total = job.pages * job.copies;
  const rs = await db.select().from(refunds).where(eq(refunds.paymentId, payment.id));
  const set = async (status: string, why: string, extra: Partial<Job> = {}) => {
    await db.update(printJobs).set({ status, updatedAt: new Date(), ...extra }).where(eq(printJobs.id, jobId));
    findings.push({ level: "fixed", text: `Job status ${job.status} → ${status}: ${why}` });
  };

  if (payment.status === "success" && ["uploaded", "awaiting_payment"].includes(job.status)) {
    await set("payment_successful", "payment confirmed", { paymentStatus: "success" });
  } else if (payment.status === "failed" && ["payment_successful", "queued", "processing", "printing"].includes(job.status)) {
    findings.push({ level: "warn", text: "Payment failed but job is active — cancel it so it cannot print unpaid" });
  } else if (job.status === "completed" && job.pagesPrinted < total) {
    await set("partially_completed", `only ${job.pagesPrinted}/${total} pages printed`);
  } else if (job.status === "failed" && payment.status === "success" && !rs.some((r) => r.status !== "failed")) {
    findings.push({ level: "warn", text: "Paid job failed and no refund exists — retry the job or issue a refund" });
  } else if (job.status === "refund_pending" && rs.some((r) => r.status === "success")) {
    await set("refunded", "refund confirmed by gateway", { paymentStatus: "refunded" });
  } else if (job.status === "completed" && rs.some((r) => r.status !== "failed")) {
    findings.push({ level: "warn", text: "Job completed AND a refund exists — manual review required" });
  } else {
    findings.push({ level: "ok", text: "Print state and payment state are consistent" });
  }
  await db.insert(jobLogs).values({ jobId, message: `Reconciliation run by ${user.name}: ${findings.map((f) => f.text).join("; ")}`.slice(0, 900) });
  return { findings };
}
