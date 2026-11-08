import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { pageParams, route } from "@/lib/api";
import { sweepOffline } from "@/lib/live";

export const dynamic = "force-dynamic";

export const GET = route(null, async ({ req }) => {
  await sweepOffline();
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp, 25);
  const conds = [];
  const st = sp.get("status") ?? "active";
  if (st === "active") conds.push(ne(alerts.status, "resolved"));
  else if (st !== "all") conds.push(eq(alerts.status, st));
  const sev = sp.get("severity");
  if (sev) conds.push(eq(alerts.severity, sev));
  const q = sp.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(alerts.title, like), ilike(alerts.details, like), ilike(alerts.printerId, like), ilike(alerts.kioskId, like)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(alerts)
    .where(where)
    .orderBy(sql`case ${alerts.severity} when 'critical' then 3 when 'warning' then 2 else 1 end desc`, desc(alerts.createdAt))
    .limit(size)
    .offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(alerts).where(where);
  const counts = await db.select({ status: alerts.status, severity: alerts.severity, n: count() }).from(alerts).groupBy(alerts.status, alerts.severity);
  return { rows, total, page, size, counts };
});
