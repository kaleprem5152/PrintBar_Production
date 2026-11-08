import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { connectivityEvents, deviceCommands, kioskLogs, kiosks, printerEvents, printers } from "@/db/schema";
import { agentAuth } from "@/lib/agent";
import { evaluatePrinterAlerts, resolveAlerts } from "@/lib/alerts";
import { isFresh, getStaleMs } from "@/lib/live";
import { getGroup } from "@/lib/settings";
import { count, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

const int = (v: unknown, lo = 0, hi = 100000000) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);

/**
 * Kiosk agent heartbeat (Raspberry Pi → backend). Only values the agent actually reports are stored,
 * and each printer metric is tagged as `telemetry` — missing sensors stay NULL/"unsupported" instead of being invented.
 */
export async function POST(req: NextRequest) {
  const denied = agentAuth(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!b?.kioskId) return Response.json({ error: "kioskId required" }, { status: 400 });
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, String(b.kioskId)));
  if (!k) return Response.json({ error: "Unknown kiosk" }, { status: 404 });
  const stale = await getStaleMs();
  const wasOnline = isFresh(k.lastHeartbeat, stale);
  const now = new Date();
  await db
    .update(kiosks)
    .set({
      lastHeartbeat: now,
      softwareVersion: typeof b.softwareVersion === "string" ? b.softwareVersion.slice(0, 20) : k.softwareVersion,
      networkType: typeof b.networkType === "string" ? b.networkType.slice(0, 20) : k.networkType,
      ipAddress: typeof b.ip === "string" ? b.ip.slice(0, 45) : k.ipAddress,
      backendConnected: true,
      piTempC: int(b.pi?.tempC, 0, 150),
      piCpuPct: int(b.pi?.cpuPct, 0, 100),
      piMemPct: int(b.pi?.memPct, 0, 100),
      diskPct: int(b.pi?.diskPct, 0, 100),
      upsStatus: typeof b.upsStatus === "string" ? b.upsStatus.slice(0, 30) : null,
    })
    .where(eq(kiosks.id, k.id));
  if (!wasOnline) {
    const [last] = await db.select().from(connectivityEvents).where(eq(connectivityEvents.kioskId, k.id)).orderBy(desc(connectivityEvents.createdAt)).limit(1);
    if (!last || last.kind !== "online") await db.insert(connectivityEvents).values({ kioskId: k.id, kind: "online", detail: "Heartbeat resumed" });
    await resolveAlerts({ kioskId: k.id, types: ["kiosk_offline", "pi_offline"] });
  }
  if (b.upsStatus === "on_battery" || b.upsStatus === "low_battery") {
    const { raiseAlert } = await import("@/lib/alerts");
    await raiseAlert({ kioskId: k.id, type: "power_warning", details: `UPS reports: ${b.upsStatus}` });
  } else await resolveAlerts({ kioskId: k.id, types: ["power_warning"] });

  for (const rp of Array.isArray(b.printers) ? b.printers.slice(0, 10) : []) {
    const [p] = await db.select().from(printers).where(and(eq(printers.id, String(rp.id)), eq(printers.kioskId, k.id)));
    if (!p) continue;
    const upd: Partial<typeof printers.$inferInsert> = { lastHeartbeat: now };
    if (typeof rp.connected === "boolean") upd.connected = rp.connected;
    if (["idle", "printing", "error", "offline"].includes(rp.state)) upd.state = rp.state;
    upd.errorCode = typeof rp.errorCode === "string" ? rp.errorCode.slice(0, 40) : null;
    upd.errorMessage = typeof rp.errorMessage === "string" ? rp.errorMessage.slice(0, 200) : null;
    const pr = int(rp.paperRemaining, 0, p.paperCapacity);
    if (pr != null) { upd.paperRemaining = pr; upd.paperSource = "telemetry"; }
    const tb = int(rp.tonerBlack, 0, 100), tc = int(rp.tonerColor, 0, 100), dl = int(rp.drumLife, 0, 100);
    if (tb != null) { upd.tonerBlack = tb; upd.tonerSource = "telemetry"; }
    if (tc != null) { upd.tonerColor = tc; upd.tonerSource = "telemetry"; }
    if (dl != null) { upd.drumLife = dl; upd.drumSource = "telemetry"; }
    const tp = int(rp.totalPages);
    if (tp != null) upd.totalPages = tp;
    if (rp.state === "error" && rp.errorMessage && p.errorMessage !== rp.errorMessage) {
      await db.insert(printerEvents).values({ printerId: p.id, kind: "error", code: upd.errorCode, message: String(rp.errorMessage).slice(0, 200) });
    }
    await db.update(printers).set(upd).where(eq(printers.id, p.id));
    const [fresh] = await db.select().from(printers).where(eq(printers.id, p.id));
    await evaluatePrinterAlerts(fresh);
  }
  for (const l of Array.isArray(b.logs) ? b.logs.slice(0, 50) : []) {
    await db.insert(kioskLogs).values({ kioskId: k.id, level: ["info", "warn", "error"].includes(l.level) ? l.level : "info", message: String(l.message ?? "").slice(0, 400) });
  }

  const ps = await db.select().from(printers).where(eq(printers.kioskId, k.id));
  const [{ n }] = await db.select({ n: count() }).from(deviceCommands).where(and(eq(deviceCommands.kioskId, k.id), eq(deviceCommands.status, "queued")));
  const proc = await getGroup("processing");
  const net = await getGroup("network");
  return Response.json({
    serverTime: now.toISOString(),
    pendingCommands: n,
    config: {
      enabled: k.enabled, maintenance: k.maintenance, printingPaused: k.printingPaused,
      printers: Object.fromEntries(ps.map((p) => [p.id, { enabled: p.enabled, paused: p.paused, role: p.role, priority: p.priority, autoFailover: p.autoFailover }])),
      jobTimeoutSec: proc.jobTimeoutSec, heartbeatIntervalSec: net.heartbeatIntervalSec,
    },
  });
}
