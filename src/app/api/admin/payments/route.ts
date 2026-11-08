import { and, asc, count, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { payments, printJobs, refunds } from "@/db/schema";
import { dateRange, pageParams, route } from "@/lib/api";
import { cashfreeStatus } from "@/lib/cashfree";

export const dynamic = "force-dynamic";

export const GET = route("payments.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp);
  const { from, to } = dateRange(sp, 30);
  const conds = [gte(payments.createdAt, from), lt(payments.createdAt, to)];
  const q = sp.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(payments.orderId, like), ilike(payments.transactionId, like), ilike(payments.jobId, like), ilike(printJobs.customerRef, like))!);
  }
  const status = sp.get("status");
  if (status === "refunded") conds.push(sql`${payments.refundedPaise} > 0`);
  else if (status) conds.push(eq(payments.status, status));
  const method = sp.get("method");
  if (method) conds.push(eq(payments.method, method));
  const where = and(...conds);
  const sortCol = { created: payments.createdAt, amount: payments.amountPaise, fee: payments.feePaise }[sp.get("sort") ?? "created"] ?? payments.createdAt;
  const order = sp.get("dir") === "asc" ? asc(sortCol) : desc(sortCol);

  const rows = await db
    .select({ p: payments, customerRef: printJobs.customerRef, jobStatus: printJobs.status, fileName: printJobs.fileName })
    .from(payments)
    .innerJoin(printJobs, eq(printJobs.id, payments.jobId))
    .where(where)
    .orderBy(order, desc(payments.id))
    .limit(size)
    .offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(payments).innerJoin(printJobs, eq(printJobs.id, payments.jobId)).where(where);
  const [sum] = await db
    .select({
      okCount: sql<number>`count(*) filter (where ${payments.status}='success')`,
      okPaise: sql<number>`coalesce(sum(${payments.amountPaise}) filter (where ${payments.status}='success'),0)`,
      pendingCount: sql<number>`count(*) filter (where ${payments.status}='pending')`,
      pendingPaise: sql<number>`coalesce(sum(${payments.amountPaise}) filter (where ${payments.status}='pending'),0)`,
      failedCount: sql<number>`count(*) filter (where ${payments.status}='failed')`,
      failedPaise: sql<number>`coalesce(sum(${payments.amountPaise}) filter (where ${payments.status}='failed'),0)`,
      feesPaise: sql<number>`coalesce(sum(${payments.feePaise}) filter (where ${payments.status}='success'),0)`,
    })
    .from(payments)
    .where(and(gte(payments.createdAt, from), lt(payments.createdAt, to)));
  const [rf] = await db
    .select({
      activeCount: sql<number>`count(*) filter (where ${refunds.status} in ('requested','processing'))`,
      activePaise: sql<number>`coalesce(sum(${refunds.amountPaise}) filter (where ${refunds.status} in ('requested','processing')),0)`,
      doneCount: sql<number>`count(*) filter (where ${refunds.status}='success')`,
      donePaise: sql<number>`coalesce(sum(${refunds.amountPaise}) filter (where ${refunds.status}='success'),0)`,
    })
    .from(refunds);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    rows: rows.map((r) => ({ ...r.p, customerRef: r.customerRef, jobStatus: r.jobStatus, fileName: r.fileName })),
    total,
    page,
    size,
    summary: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, n(v)])),
    refundSummary: Object.fromEntries(Object.entries(rf).map(([k, v]) => [k, n(v)])),
    gateway: cashfreeStatus(),
  };
});
