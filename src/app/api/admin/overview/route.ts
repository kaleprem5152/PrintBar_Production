import { count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, kiosks, printers, printJobs, refunds } from "@/db/schema";
import { dateRange, route } from "@/lib/api";
import { PENDING_JOB_STATUSES, SEVERITY, TZ, type Severity } from "@/lib/constants";
import { getSetting } from "@/lib/settings";
import { getStaleMs, kioskView, printerView, sweepOffline } from "@/lib/live";
import { computeUptime } from "@/lib/uptime";
import { istDateKey } from "@/lib/format";

export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);
const FAILED = sql`status in ('failed','partially_completed','refund_pending','refunded')`;

export const GET = route("overview.view", async ({ req }) => {
  await sweepOffline();
  const sp = req.nextUrl.searchParams;
  const { from, to, days } = dateRange(sp, 1);
  const F = from.toISOString();
  const T = to.toISOString();
  const DAY = 86400_000;
  const prevFrom = new Date(from.getTime() - days * DAY).toISOString();
  const inRange = (col: string) => sql.raw(`${col} >= '${F}'::timestamptz and ${col} < '${T}'::timestamptz`);
  const inPrev = (col: string) => sql.raw(`${col} >= '${prevFrom}'::timestamptz and ${col} < '${F}'::timestamptz`);
  const seriesDays = Math.max(days, 7);
  const sFrom = new Date(to.getTime() - seriesDays * DAY).toISOString();
  const inSeries = (col: string) => sql.raw(`${col} >= '${sFrom}'::timestamptz and ${col} < '${T}'::timestamptz`);
  const day = (col: string) => sql.raw(`to_char(${col} at time zone '${TZ}','YYYY-MM-DD')`);

  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];

  const [jobAgg] = await rows(sql`select
      count(*) filter (where status='completed') completed,
      count(*) filter (where ${FAILED}) failed,
      coalesce(sum(pages_printed),0) pages,
      coalesce(sum(pages_printed) filter (where color_mode='bw'),0) bw,
      coalesce(sum(pages_printed) filter (where color_mode='color'),0) color
    from print_jobs where ${inRange("created_at")}`);
  const [prevAgg] = await rows(sql`select count(*) filter (where status='completed') completed from print_jobs where ${inPrev("created_at")}`);
  const [payAgg] = await rows(sql`select
      coalesce(sum(amount_paise) filter (where status='success'),0) revenue,
      count(*) filter (where status='success') ok,
      count(*) filter (where status='failed') failed,
      count(*) filter (where status='pending') pending
    from payments where ${inRange("created_at")}`);
  const [prevPay] = await rows(sql`select coalesce(sum(amount_paise) filter (where status='success'),0) revenue from payments where ${inPrev("created_at")}`);
  const [refAgg] = await rows(sql`select count(*) filter (where status<>'failed') n, coalesce(sum(amount_paise) filter (where status<>'failed'),0) amt from refunds where ${inRange("created_at")}`);
  const [{ pending }] = await db.select({ pending: count() }).from(printJobs).where(inArray(printJobs.status, PENDING_JOB_STATUSES));
  const [refPend] = await db.select({ n: count(), amt: sql<number>`coalesce(sum(${refunds.amountPaise}),0)` }).from(refunds).where(inArray(refunds.status, ["requested", "processing"]));

  const daily = await rows(sql`select ${day("created_at")} d,
      count(*) filter (where status='completed') completed, count(*) filter (where ${FAILED}) failed,
      coalesce(sum(pages_printed) filter (where color_mode='bw'),0) bw, coalesce(sum(pages_printed) filter (where color_mode='color'),0) color
    from print_jobs where ${inSeries("created_at")} group by 1 order by 1`);
  const dailyPay = await rows(sql`select ${day("created_at")} d,
      coalesce(sum(amount_paise) filter (where status='success'),0) revenue,
      count(*) filter (where status='success') ok, count(*) filter (where status='failed') failed, count(*) filter (where status='pending') pending
    from payments where ${inSeries("created_at")} group by 1 order by 1`);
  const hourly = await rows(sql`select extract(hour from created_at at time zone '${sql.raw(TZ)}')::int h, count(*) jobs, coalesce(sum(pages_printed),0) pages, count(*) filter (where ${FAILED}) failed
    from print_jobs where ${inRange("created_at")} group by 1`);
  const peak = await rows(sql`select extract(hour from created_at at time zone '${sql.raw(TZ)}')::int h, count(*) jobs
    from print_jobs where created_at >= now() - interval '30 days' group by 1 order by 2 desc limit 3`);

  const keyList: string[] = [];
  for (let i = seriesDays - 1; i >= 0; i--) keyList.push(istDateKey(new Date(to.getTime() - (i + 1) * DAY + 3600_000)));
  const dMap = new Map(daily.map((r) => [String(r.d), r]));
  const pMap = new Map(dailyPay.map((r) => [String(r.d), r]));
  const series = keyList.map((k) => ({
    date: k,
    revenuePaise: num(pMap.get(k)?.revenue),
    paymentsOk: num(pMap.get(k)?.ok),
    paymentsFailed: num(pMap.get(k)?.failed),
    paymentsPending: num(pMap.get(k)?.pending),
    completed: num(dMap.get(k)?.completed),
    failed: num(dMap.get(k)?.failed),
    bwPages: num(dMap.get(k)?.bw),
    colorPages: num(dMap.get(k)?.color),
  }));
  const hMap = new Map(hourly.map((r) => [num(r.h), r]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, jobs: num(hMap.get(h)?.jobs), pages: num(hMap.get(h)?.pages), failed: num(hMap.get(h)?.failed) }));

  const staleMs = await getStaleMs();
  const ks = (await db.select().from(kiosks).orderBy(kiosks.id)).map((k) => kioskView(k, staleMs));
  const ps = await db.select().from(printers).orderBy(printers.id);
  const printerViews = ps.map((p) => printerView(p, ks.find((k) => k.id === p.kioskId)?.online ?? false));
  const openAlerts = await db.select().from(alerts).where(ne(alerts.status, "resolved")).orderBy(desc(alerts.createdAt)).limit(30);
  openAlerts.sort((a, b) => SEVERITY[b.severity as Severity].rank - SEVERITY[a.severity as Severity].rank || b.createdAt.getTime() - a.createdAt.getTime());
  const uptime = await computeUptime(from, to);
  const [{ failedJobsNeedingAction }] = await db
    .select({ failedJobsNeedingAction: count() })
    .from(printJobs)
    .where(eq(printJobs.status, "failed"));

  const revenue = num(payAgg.revenue);
  return {
    range: { from: F, to: T, days },
    kpis: {
      revenuePaise: revenue,
      revenuePrevPaise: num(prevPay.revenue),
      completed: num(jobAgg.completed),
      completedPrev: num(prevAgg.completed),
      pages: num(jobAgg.pages),
      bwPages: num(jobAgg.bw),
      colorPages: num(jobAgg.color),
      failed: num(jobAgg.failed),
      failedNeedingAction: failedJobsNeedingAction,
      pending,
      refundsCount: num(refAgg.n),
      refundsPaise: num(refAgg.amt),
      refundsPendingCount: refPend.n,
      refundsPendingPaise: num(refPend.amt),
      uptimePct: uptime.overall,
      activeKiosks: ks.filter((k) => k.status === "online").length,
      totalKiosks: ks.length,
      payments: { ok: num(payAgg.ok), failed: num(payAgg.failed), pending: num(payAgg.pending) },
    },
    series,
    hours,
    peakHours: peak.map((r) => ({ hour: num(r.h), jobs: num(r.jobs) })),
    kiosks: ks.map((k) => ({ ...k, uptimePct: uptime.perKiosk[k.id] ?? null, printers: printerViews.filter((p) => p.kioskId === k.id) })),
    alerts: openAlerts.slice(0, 6),
    demo: await getSetting("demo_mode", false),
    generatedAt: new Date().toISOString(),
  };
});
