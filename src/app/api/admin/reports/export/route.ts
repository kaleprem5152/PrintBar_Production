import { and, gte, lt, desc } from "drizzle-orm";
import { db } from "@/db";
import { payments, printJobs, refunds } from "@/db/schema";
import { audit, dateRange, oneOf, route } from "@/lib/api";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  let s = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // CSV formula-injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head: string[], data: unknown[][]) => [head.join(","), ...data.map((r) => r.map(esc).join(","))].join("\n");

export const GET = route("reports.export", async ({ req, user, ip }) => {
  const sp = req.nextUrl.searchParams;
  const type = oneOf(sp.get("type"), "type", ["jobs", "payments", "refunds"] as const);
  const { from, to } = dateRange(sp, 30);
  let body = "";
  if (type === "jobs") {
    const r = await db.select().from(printJobs).where(and(gte(printJobs.createdAt, from), lt(printJobs.createdAt, to))).orderBy(desc(printJobs.createdAt)).limit(20000);
    body = csv(
      ["job_id", "customer_ref", "file_name", "pages", "colour", "sided", "pages_per_sheet", "copies", "amount_inr", "payment_status", "status", "printer", "kiosk", "pages_printed", "created_at"],
      r.map((j) => [j.id, j.customerRef, j.fileName, j.pages, j.colorMode, j.sided, j.pagesPerSheet, j.copies, (j.amountPaise / 100).toFixed(2), j.paymentStatus, j.status, j.printerId, j.kioskId, j.pagesPrinted, j.createdAt]),
    );
  } else if (type === "payments") {
    const r = await db.select().from(payments).where(and(gte(payments.createdAt, from), lt(payments.createdAt, to))).orderBy(desc(payments.createdAt)).limit(20000);
    body = csv(
      ["order_id", "transaction_id", "job_id", "amount_inr", "gateway_fee_inr", "refunded_inr", "method", "status", "created_at"],
      r.map((p) => [p.orderId, p.transactionId, p.jobId, (p.amountPaise / 100).toFixed(2), (p.feePaise / 100).toFixed(2), (p.refundedPaise / 100).toFixed(2), p.method, p.status, p.createdAt]),
    );
  } else {
    const r = await db.select().from(refunds).where(and(gte(refunds.createdAt, from), lt(refunds.createdAt, to))).orderBy(desc(refunds.createdAt)).limit(20000);
    body = csv(
      ["refund_ref", "job_id", "amount_inr", "type", "status", "gateway_refund_id", "reason", "initiated_by", "created_at", "completed_at"],
      r.map((x) => [x.refundRef, x.jobId, (x.amountPaise / 100).toFixed(2), x.type, x.status, x.gatewayRefundId, x.reason, x.initiatedBy, x.createdAt, x.completedAt]),
    );
  }
  await audit({ user, ip }, "report.export", "report", type, { from: from.toISOString(), to: to.toISOString() });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="printbar-${type}-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
