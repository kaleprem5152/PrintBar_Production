import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, kiosks, printers } from "@/db/schema";
import { route } from "@/lib/api";
import { getStaleMs, kioskView, printerView, sweepOffline } from "@/lib/live";
import { computeUptime } from "@/lib/uptime";

export const dynamic = "force-dynamic";

export const GET = route("kiosks.view", async () => {
  await sweepOffline();
  const stale = await getStaleMs();
  const ks = (await db.select().from(kiosks).orderBy(kiosks.id)).map((k) => kioskView(k, stale));
  const ps = await db.select().from(printers);
  const up = await computeUptime(new Date(Date.now() - 30 * 86400_000), new Date());
  const cmds = await db.select().from(deviceCommands).where(inArray(deviceCommands.status, ["queued", "delivered"])).orderBy(desc(deviceCommands.createdAt));
  void eq;
  return {
    kiosks: ks.map((k) => ({
      ...k,
      uptime30d: up.perKiosk[k.id] ?? null,
      pendingCommands: cmds.filter((c) => c.kioskId === k.id).length,
      printers: ps.filter((p) => p.kioskId === k.id).map((p) => printerView(p, k.online)),
    })),
  };
});
