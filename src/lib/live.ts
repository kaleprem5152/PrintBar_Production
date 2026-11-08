import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { connectivityEvents, kiosks, printers } from "@/db/schema";
import { getGroup, getSetting } from "./settings";
import { raiseAlert, resolveAlerts } from "./alerts";

export const HB_STALE_MS = 90_000;
export const isFresh = (d: Date | string | null | undefined, ms = HB_STALE_MS) =>
  !!d && Date.now() - new Date(d).getTime() < ms;

export type KioskRow = typeof kiosks.$inferSelect;
export type PrinterRow = typeof printers.$inferSelect;

export async function getStaleMs() {
  const n = await getGroup("network");
  return Math.max(15, n.staleAfterSec) * 1000;
}

export function kioskView(k: KioskRow, staleMs = HB_STALE_MS) {
  const online = isFresh(k.lastHeartbeat, staleMs);
  const status = !k.enabled ? "disabled" : !online ? "offline" : k.maintenance ? "maintenance" : k.printingPaused ? "paused" : "online";
  return { ...k, online, status };
}
export type KioskView = ReturnType<typeof kioskView>;

export function printerView(p: PrinterRow, kioskOnline: boolean) {
  const connection = !kioskOnline ? "unknown" : p.connected ? "connected" : "disconnected";
  const live = !p.enabled
    ? "disabled"
    : p.paused
      ? "paused"
      : !kioskOnline
        ? "unreachable"
        : !p.connected
          ? "disconnected"
          : p.state === "error"
            ? "error"
            : p.state === "printing"
              ? "printing"
              : "idle";
  return { ...p, connection, live };
}
export type PrinterView = ReturnType<typeof printerView>;

let lastDemoTouch = 0;
let lastSweep = 0;

/** Demo dataset only: keeps seeded telemetry fresh (except the deliberately offline kiosk). Clearly flagged in the UI. */
export async function touchDemo() {
  if (Date.now() - lastDemoTouch < 15_000) return;
  lastDemoTouch = Date.now();
  if (!(await getSetting("demo_mode", false))) return;
  const ks = await db.select().from(kiosks).where(eq(kiosks.isDemo, true));
  const now = new Date();
  for (const k of ks) {
    if (k.id === "KSK-003") continue; // designated offline demo kiosk
    await db.update(kiosks).set({ lastHeartbeat: now }).where(eq(kiosks.id, k.id));
    await db.update(printers).set({ lastHeartbeat: now }).where(eq(printers.kioskId, k.id));
  }
}

/**
 * Lazy offline detector: records an offline connectivity event + alert when a kiosk's heartbeat goes stale.
 * (A cron/worker should call this in production — see docs.)
 */
export async function sweepOffline() {
  if (Date.now() - lastSweep < 20_000) return;
  lastSweep = Date.now();
  await touchDemo();
  const staleMs = await getStaleMs();
  const ks = await db.select().from(kiosks).where(eq(kiosks.enabled, true));
  for (const k of ks) {
    if (!k.lastHeartbeat) continue;
    const online = isFresh(k.lastHeartbeat, staleMs);
    const [last] = await db.select().from(connectivityEvents).where(eq(connectivityEvents.kioskId, k.id)).orderBy(desc(connectivityEvents.createdAt)).limit(1);
    if (!online && (!last || last.kind === "online")) {
      await db.insert(connectivityEvents).values({
        kioskId: k.id,
        kind: "offline",
        detail: "Heartbeat timeout",
        createdAt: new Date(k.lastHeartbeat.getTime() + staleMs),
      });
      await raiseAlert({
        kioskId: k.id,
        type: "kiosk_offline",
        details: `No heartbeat since ${k.lastHeartbeat.toISOString()}. Raspberry Pi, network or power may be down (cannot be distinguished remotely).`,
        source: "system",
      });
    } else if (online && last?.kind === "offline") {
      await db.insert(connectivityEvents).values({ kioskId: k.id, kind: "online", detail: "Heartbeat resumed" });
      await resolveAlerts({ kioskId: k.id, types: ["kiosk_offline", "pi_offline"] });
    }
  }
}
