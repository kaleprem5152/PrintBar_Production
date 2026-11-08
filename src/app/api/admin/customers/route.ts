import { and, desc, eq, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { payments, printJobs, refunds } from "@/db/schema";
import { ApiError, pageParams, route } from "@/lib/api";

export const dynamic = "force-dynamic";
const n = (v: unknown) => Number(v ?? 0);

/** Customers are represented only by an opaque reference. No documents, names or phone numbers are exposed. */
export const GET = route("customers.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const ref = sp.get("ref");
  if (ref) {
    const jobs = await db.select().from(printJobs).where(eq(printJobs.customerRef, ref)).orderBy(desc(printJobs.createdAt)).limit(100);
    if (!jobs.length) throw new ApiError(404, "Customer not found");
    const txns = await db
      .select({ p: payments })
      .from(payments)
      .innerJoin(printJobs, eq(printJobs.id, payments.jobId))
      .where(eq(printJobs.customerRef, ref))
      .orderBy(desc(payments.createdAt))
      .limit(100);
    const rs = await db
      .select({ r: refunds })
      .from(refunds)
      .innerJoin(printJobs, eq(printJobs.id, refunds.jobId))
      .where(eq(printJobs.customerRef, ref))
      .orderBy(desc(refunds.createdAt));
    return { ref, jobs, transactions: txns.map((t) => t.p), refunds: rs.map((r) => r.r) };
  }
  const { page, size, offset } = pageParams(sp);
  const q = sp.get("q")?.trim();
  const sort = { recent: "last", pages: "pages", spend: "spend", jobs: "jobs", failed: "failed" }[sp.get("sort") ?? "recent"] ?? "last";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const where = q ? sql`where j.customer_ref ilike ${"%" + q.replace(/[%_]/g, "") + "%"}` : sql``;
  const rows = (
    await db.execute(sql`select j.customer_ref ref, count(*) jobs, coalesce(sum(j.pages_printed),0) pages,
      count(*) filter (where j.status in ('failed','partially_completed','refund_pending','refunded')) failed,
      coalesce(sum(p.amount_paise) filter (where p.status='success'),0) spend,
      coalesce(sum(p.refunded_paise),0) refunded, max(j.created_at) last
      from print_jobs j left join payments p on p.job_id=j.id ${where}
      group by 1 order by ${sql.raw(sort)} ${sql.raw(dir)} nulls last, 1 limit ${size} offset ${offset}`)
  ).rows as Record<string, unknown>[];
  const [tot] = (await db.execute(sql`select count(distinct customer_ref) c from print_jobs ${q ? sql`where customer_ref ilike ${"%" + q.replace(/[%_]/g, "") + "%"}` : sql``}`)).rows as Record<string, unknown>[];
  void and; void ilike;
  return {
    rows: rows.map((r) => ({ ref: String(r.ref), jobs: n(r.jobs), pages: n(r.pages), failed: n(r.failed), spendPaise: n(r.spend), refundedPaise: n(r.refunded), last: r.last })),
    total: n(tot.c),
    page,
    size,
  };
});
