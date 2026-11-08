import { and, asc, count, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { printJobs } from "@/db/schema";
import { dateRange, pageParams, route } from "@/lib/api";

export const dynamic = "force-dynamic";

const SORTS = {
  created: printJobs.createdAt,
  amount: printJobs.amountPaise,
  pages: printJobs.pages,
  status: printJobs.status,
  id: printJobs.id,
} as const;

export const GET = route("jobs.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = sp.get("q")?.trim();
  const conds = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(printJobs.id, like), ilike(printJobs.customerRef, like), ilike(printJobs.fileName, like)));
  }
  const status = sp.get("status");
  if (status) conds.push(eq(printJobs.status, status));
  const payment = sp.get("payment");
  if (payment) conds.push(eq(printJobs.paymentStatus, payment));
  const mode = sp.get("mode");
  if (mode === "bw" || mode === "color") conds.push(eq(printJobs.colorMode, mode));
  const printer = sp.get("printer");
  if (printer) conds.push(eq(printJobs.printerId, printer));
  if (sp.get("from") || sp.get("to")) {
    const { from, to } = dateRange(sp, 30);
    conds.push(gte(printJobs.createdAt, from), lt(printJobs.createdAt, to));
  }
  const where = conds.length ? and(...conds) : undefined;
  const sortKey = (sp.get("sort") ?? "created") as keyof typeof SORTS;
  const col = SORTS[sortKey] ?? SORTS.created;
  const order = sp.get("dir") === "asc" ? asc(col) : desc(col);

  const rows = await db.select().from(printJobs).where(where).orderBy(order, desc(printJobs.id)).limit(size).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(printJobs).where(where);
  const counts = await db.select({ status: printJobs.status, n: count() }).from(printJobs).groupBy(printJobs.status);
  void sql;
  return { rows, total, page, size, statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
});
