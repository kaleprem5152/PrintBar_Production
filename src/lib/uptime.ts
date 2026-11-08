import { asc } from "drizzle-orm";
import { db } from "@/db";
import { connectivityEvents, kiosks } from "@/db/schema";

/** Uptime derived from recorded connectivity events (heartbeat timeouts/resumes). Returns 0–100. */
export async function computeUptime(from: Date, to: Date) {
  const end = Math.min(to.getTime(), Date.now());
  const ks = await db.select().from(kiosks);
  const evs = await db.select().from(connectivityEvents).orderBy(asc(connectivityEvents.createdAt));
  const perKiosk: Record<string, number | null> = {};
  let up = 0;
  let total = 0;
  for (const k of ks) {
    const start = Math.max(from.getTime(), k.createdAt.getTime());
    if (end <= start || !k.lastHeartbeat) {
      perKiosk[k.id] = null;
      continue;
    }
    let state = "online";
    let cursor = start;
    let down = 0;
    for (const e of evs.filter((x) => x.kioskId === k.id)) {
      const t = e.createdAt.getTime();
      if (t <= start) {
        state = e.kind;
        continue;
      }
      if (t >= end) break;
      if (state === "offline") down += t - cursor;
      cursor = t;
      state = e.kind;
    }
    if (state === "offline") down += end - cursor;
    const span = end - start;
    perKiosk[k.id] = Math.max(0, 100 * (1 - down / span));
    up += span - down;
    total += span;
  }
  return { overall: total ? (100 * up) / total : null, perKiosk };
}
