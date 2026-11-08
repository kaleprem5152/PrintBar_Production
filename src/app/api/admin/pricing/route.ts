import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pricingVersions } from "@/db/schema";
import { ApiError, audit, int, route, str } from "@/lib/api";
import { notify } from "@/lib/alerts";
import { inr } from "@/lib/format";
import { getActivePricing } from "@/lib/server/active-pricing";

export const dynamic = "force-dynamic";

export const GET = route("pricing.view", async () => {
  const active = await getActivePricing();
  const history = await db.select().from(pricingVersions).orderBy(desc(pricingVersions.id)).limit(50);
  const [avg] = await db.execute(sql`select coalesce(avg(pages),0) pages, coalesce(avg(amount_paise),0) amount, count(*) n from print_jobs where created_at >= now() - interval '30 days' and status='completed'`).then((r) => r.rows as Record<string, unknown>[]);
  return { active, history, last30d: { avgPages: Number(avg.pages), avgAmountPaise: Number(avg.amount), jobs: Number(avg.n) } };
});

export const POST = route("pricing.manage", async ({ user, ip, body }) => {
  const b = await body();
  if (b.confirm !== true) throw new ApiError(400, "Publishing pricing requires confirmation");
  const bw = int(b.bwPaise, "B&W price", { min: 0, max: 100000 });
  const color = int(b.colorPaise, "Colour price", { min: 0, max: 100000 });
  const duplex = int(b.duplexDiscountPct, "Double-sided discount", { min: 0, max: 90 });
  const min = int(b.minTxnPaise, "Minimum transaction", { min: 0, max: 1000000 });
  const cfg = b.config ?? {};
  const pps = (Array.isArray(cfg.pagesPerSheet) ? cfg.pagesPerSheet : []).map(Number).filter((n: number) => [1, 2, 4, 6].includes(n));
  if (!pps.length) throw new ApiError(400, "Enable at least one pages-per-sheet option");
  if (!cfg.singleSided && !cfg.doubleSided) throw new ApiError(400, "Enable at least one sided option");
  if (bw < 1 || color < 1) throw new ApiError(400, "Prices must be at least ₹0.01 per page");
  const next = {
    bwPaise: bw, colorPaise: color, duplexDiscountPct: duplex, minTxnPaise: min,
    config: {
      pagesPerSheet: [...new Set<number>(pps)].sort((a, c) => a - c),
      maxCopies: int(cfg.maxCopies, "Max copies", { min: 1, max: 500 }),
      maxPages: int(cfg.maxPages, "Max pages per job", { min: 1, max: 2000 }),
      singleSided: !!cfg.singleSided,
      doubleSided: !!cfg.doubleSided,
    },
    note: str(b.note, "Change note", { min: 3, max: 200 }),
  };
  const prev = await db.select().from(pricingVersions).where(eq(pricingVersions.active, true)).limit(1);
  const [created] = await db.transaction(async (tx) => {
    await tx.update(pricingVersions).set({ active: false }).where(eq(pricingVersions.active, true));
    return tx.insert(pricingVersions).values({ ...next, active: true, publishedBy: user.name }).returning();
  });
  await audit({ user, ip }, "pricing.publish", "pricing", created.id, {
    from: prev[0] ? { bw: inr(prev[0].bwPaise), color: inr(prev[0].colorPaise), duplexDiscountPct: prev[0].duplexDiscountPct, min: inr(prev[0].minTxnPaise) } : null,
    to: { bw: inr(bw), color: inr(color), duplexDiscountPct: duplex, min: inr(min) },
    note: next.note,
  });
  await notify({ type: "refund_update", severity: "info", title: `Pricing published by ${user.name}`, body: `B&W ${inr(bw)} · Colour ${inr(color)} per page`, link: "/admin/pricing" });
  return { ok: true, version: created, message: "Pricing published. The customer app reads it from /api/public/pricing and new jobs are quoted with it immediately." };
});
