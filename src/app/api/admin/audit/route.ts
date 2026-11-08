import { and, count, desc, eq, gte, ilike, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { dateRange, pageParams, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route("audit.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp, 30);
  const conds = [];
  const q = sp.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(auditLogs.action, like), ilike(auditLogs.userName, like), ilike(auditLogs.entityId, like)));
  }
  const area = sp.get("area");
  if (area) conds.push(ilike(auditLogs.action, `${area.replace(/[%_]/g, "")}.%`));
  if (sp.get("from") || sp.get("to")) {
    const { from, to } = dateRange(sp, 30);
    conds.push(gte(auditLogs.createdAt, from), lt(auditLogs.createdAt, to));
  }
  const user = sp.get("user");
  if (user) conds.push(eq(auditLogs.userName, user));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(size).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  return { rows, total, page, size };
});
