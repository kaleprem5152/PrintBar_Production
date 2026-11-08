import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, kiosks, printers } from "@/db/schema";
import { ApiError, audit, oneOf, route } from "@/lib/api";
import { cashfreeStatus } from "@/lib/cashfree";
import { DEFAULT_SETTINGS, type SettingsGroup } from "@/lib/constants";
import { getGroup, getSetting, setSetting } from "@/lib/settings";
import { getActivePricing } from "@/lib/server/active-pricing";

export const dynamic = "force-dynamic";

const RANGES: Record<string, [number, number]> = {
  maxFileMB: [1, 200], maxPagesPerJob: [1, 2000], jobTimeoutSec: [30, 3600], maxRetries: [0, 5], defaultPaperCapacity: [50, 1000],
  deleteDocumentsAfterMin: [1, 1440], purgeLogsAfterDays: [7, 730], heartbeatIntervalSec: [10, 300], staleAfterSec: [30, 900],
  monthlyFixedCostsPaise: [0, 100000000],
};

export const GET = route("settings.view", async () => {
  const groups = {} as Record<string, unknown>;
  for (const g of Object.keys(DEFAULT_SETTINGS) as SettingsGroup[]) groups[g] = await getGroup(g);
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbOk = false;
  }
  const dbMs = Date.now() - t0;
  const [k] = await db.select({ n: count() }).from(kiosks);
  const [p] = await db.select({ n: count() }).from(printers);
  const [q] = (await db.select({ n: count() }).from(deviceCommands).where(sql`${deviceCommands.status} = 'queued'`));
  const pricing = await getActivePricing();
  return {
    groups,
    health: {
      database: { ok: dbOk, latencyMs: dbMs },
      cashfree: cashfreeStatus(),
      agentAuthConfigured: !!process.env.KIOSK_AGENT_SECRET,
      push: { vapidPublic: !!process.env.VAPID_PUBLIC_KEY, vapidPrivate: !!process.env.VAPID_PRIVATE_KEY },
      kiosks: k.n,
      printers: p.n,
      queuedCommands: q.n,
      pricingVersion: pricing.id,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      demo: await getSetting("demo_mode", false),
    },
  };
});

export const PATCH = route("settings.manage", async ({ user, ip, body }) => {
  const b = await body();
  const group = oneOf(b.group, "group", Object.keys(DEFAULT_SETTINGS) as SettingsGroup[]);
  const current = await getGroup(group);
  const defaults = DEFAULT_SETTINGS[group] as Record<string, unknown>;
  const incoming = (b.values ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  for (const [key, def] of Object.entries(defaults)) {
    if (!(key in incoming)) continue;
    const v = incoming[key];
    if (typeof def === "number") {
      const n = Number(v);
      const [lo, hi] = RANGES[key] ?? [0, Number.MAX_SAFE_INTEGER];
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) throw new ApiError(400, `${key} must be a whole number between ${lo} and ${hi}`);
      next[key] = n;
    } else if (typeof def === "boolean") next[key] = !!v;
    else if (Array.isArray(def)) {
      next[key] = (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim().toLowerCase().replace(/^\./, "")).filter(Boolean).slice(0, 20);
      if (!(next[key] as string[]).length) throw new ApiError(400, "At least one value is required");
    } else next[key] = String(v ?? "").slice(0, 200);
  }
  if (group === "network" && (next.staleAfterSec as number) <= (next.heartbeatIntervalSec as number)) {
    throw new ApiError(400, "Offline threshold must be longer than the heartbeat interval");
  }
  await setSetting(group, next, user.name);
  await audit({ user, ip }, "settings.update", "settings", group, { from: current, to: next });
  return { ok: true, message: "Settings saved. Kiosk agents receive updated values with their next heartbeat." };
});
