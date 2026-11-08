import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dateRange, route } from "@/lib/api";
import { TZ } from "@/lib/constants";
import { getGroup } from "@/lib/settings";
import { computeUptime } from "@/lib/uptime";

export const dynamic = "force-dynamic";
const n = (v: unknown) => Number(v ?? 0);

export const GET = route("analytics.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const { from, to, days } = dateRange(sp, 30);
  const g = ["day", "week", "month"].includes(sp.get("g") ?? "") ? sp.get("g")! : days > 90 ? "month" : days > 31 ? "week" : "day";
  const F = from.toISOString();
  const T = to.toISOString();
  const rng = (c: string) => sql.raw(`${c} >= '${F}'::timestamptz and ${c} < '${T}'::timestamptz`);
  const bucket = (c: string) => sql.raw(`to_char(date_trunc('${g}', ${c} at time zone '${TZ}'),'YYYY-MM-DD')`);
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];
  const FAILED = sql`status in ('failed','partially_completed','refund_pending','refunded')`;

  const pay = await rows(sql`select ${bucket("created_at")} b, coalesce(sum(amount_paise) filter (where status='success'),0) revenue,
      coalesce(sum(fee_paise) filter (where status='success'),0) fees, count(*) filter (where status='success') ok, count(*) filter (where status='failed') failed,
      count(*) filter (where status='pending') pending from payments where ${rng("created_at")} group by 1`);
  const ref = await rows(sql`select ${bucket("created_at")} b, coalesce(sum(amount_paise) filter (where status<>'failed'),0) refunds from refunds where ${rng("created_at")} group by 1`);
  const jobs = await rows(sql`select ${bucket("created_at")} b, coalesce(sum(pages_printed),0) pages,
      coalesce(sum(pages_printed) filter (where color_mode='bw'),0) bw, coalesce(sum(pages_printed) filter (where color_mode='color'),0) color,
      count(*) filter (where status='completed') completed, count(*) filter (where ${FAILED}) failed from print_jobs where ${rng("created_at")} group by 1`);
  const cons = await rows(sql`select ${bucket("created_at")} b, coalesce(sum(qty*unit_cost_paise),0) spend from inventory_movements where kind='purchase' and ${rng("created_at")} group by 1`);
  const byColor = await rows(sql`select j.color_mode m, coalesce(sum(p.amount_paise),0) revenue from payments p join print_jobs j on j.id=p.job_id where p.status='success' and ${rng("p.created_at")} group by 1`);
  const util = await rows(sql`select printer_id, count(*) jobs, coalesce(sum(pages_printed),0) pages, count(*) filter (where ${FAILED}) failed from print_jobs where printer_id is not null and ${rng("created_at")} group by 1 order by 3 desc`);

  const keys = new Set<string>();
  [pay, ref, jobs, cons].forEach((a) => a.forEach((r) => keys.add(String(r.b))));
  const m = (a: Record<string, unknown>[]) => new Map(a.map((r) => [String(r.b), r]));
  const mp = m(pay), mr = m(ref), mj = m(jobs), mc = m(cons);
  const series = [...keys].sort().map((b) => ({
    bucket: b,
    revenuePaise: n(mp.get(b)?.revenue),
    feesPaise: n(mp.get(b)?.fees),
    refundsPaise: n(mr.get(b)?.refunds),
    consumablesPaise: n(mc.get(b)?.spend),
    paymentsOk: n(mp.get(b)?.ok),
    paymentsFailed: n(mp.get(b)?.failed),
    paymentsPending: n(mp.get(b)?.pending),
    pages: n(mj.get(b)?.pages),
    bwPages: n(mj.get(b)?.bw),
    colorPages: n(mj.get(b)?.color),
    completed: n(mj.get(b)?.completed),
    failed: n(mj.get(b)?.failed),
  }));
  const sum = (k: keyof (typeof series)[number]) => series.reduce((a, r) => a + (r[k] as number), 0);
  const gross = sum("revenuePaise");
  const refunds = sum("refundsPaise");
  const fees = sum("feesPaise");
  const consumables = sum("consumablesPaise");
  const pages = sum("pages");
  const finance = await getGroup("finance");
  const fixed = Math.round((finance.monthlyFixedCostsPaise * days) / 30);
  const netRevenue = gross - refunds;
  const contribution = netRevenue - fees - consumables;
  const uptime = await computeUptime(from, to);
  const colorRev = n(byColor.find((r) => r.m === "color")?.revenue);
  const bwRev = n(byColor.find((r) => r.m === "bw")?.revenue);
  const totalPagesAll = util.reduce((a, r) => a + n(r.pages), 0);

  return {
    range: { from: F, to: T, days, granularity: g },
    summary: {
      grossRevenuePaise: gross,
      refundsPaise: refunds,
      netRevenuePaise: netRevenue,
      gatewayFeesPaise: fees,
      consumablesPaise: consumables,
      contributionPaise: contribution,
      fixedCostsPaise: fixed,
      fixedCostsConfigured: finance.monthlyFixedCostsPaise > 0,
      netProfitPaise: contribution - fixed,
      pages,
      bwPages: sum("bwPages"),
      colorPages: sum("colorPages"),
      bwRevenuePaise: bwRev,
      colorRevenuePaise: colorRev,
      costPerPagePaise: pages ? (consumables + fees) / pages : null,
      consumableCostPerPagePaise: pages ? consumables / pages : null,
      completed: sum("completed"),
      failed: sum("failed"),
      uptimePct: uptime.overall,
    },
    series,
    printers: util.map((r) => ({ printerId: String(r.printer_id), jobs: n(r.jobs), pages: n(r.pages), failed: n(r.failed), sharePct: totalPagesAll ? (100 * n(r.pages)) / totalPagesAll : 0 })),
    uptime: uptime.perKiosk,
  };
});
