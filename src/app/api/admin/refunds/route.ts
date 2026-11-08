import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { printJobs, refunds } from "@/db/schema";
import { ApiError, audit, int, oneOf, pageParams, route } from "@/lib/api";
import { reconcileRefund } from "@/lib/refunds";

export const dynamic = "force-dynamic";

export const GET = route("payments.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp);
  const conds = [];
  const status = sp.get("status");
  if (status) conds.push(eq(refunds.status, status));
  const q = sp.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(refunds.refundRef, like), ilike(refunds.jobId, like), ilike(refunds.gatewayRefundId, like)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({ r: refunds, customerRef: printJobs.customerRef })
    .from(refunds)
    .innerJoin(printJobs, eq(printJobs.id, refunds.jobId))
    .where(where)
    .orderBy(desc(refunds.createdAt))
    .limit(size)
    .offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(refunds).where(where);
  return { rows: rows.map((x) => ({ ...x.r, customerRef: x.customerRef })), total, page, size };
});

/** Reconcile a refund against Cashfree. This is the only manual path that can move a refund forward. */
export const POST = route("refunds.manage", async ({ user, ip, body }) => {
  const b = await body();
  oneOf(b.action, "action", ["reconcile"] as const);
  const id = int(b.id, "Refund id", { min: 1 });
  const r = await reconcileRefund(id);
  if (!r) throw new ApiError(404, "Refund not found");
  await audit({ user, ip }, "refund.reconcile", "refund", r.refundRef, { status: r.status, gatewayStatus: r.gatewayStatus });
  return {
    ok: true,
    refund: r,
    message: r.status === "success" ? "Refund is complete (gateway-confirmed)." : r.status === "failed" ? "Gateway reports the refund failed." : `Still ${r.status} at the gateway.`,
  };
});
