import { and, count, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, kiosks, printAttempts, printers } from "@/db/schema";
import { route } from "@/lib/api";
import { getStaleMs, kioskView, printerView, sweepOffline } from "@/lib/live";

export const dynamic = "force-dynamic";

export const GET = route("printers.view", async () => {
  await sweepOffline();
  const staleMs = await getStaleMs();
  const ks = (await db.select().from(kiosks)).map((k) => kioskView(k, staleMs));
  const ps = await db.select().from(printers).orderBy(printers.kioskId, printers.priority);
  const monthStart = new Date(Date.now() - 30 * 86400_000);
  const vol = await db
    .select({ printerId: printAttempts.printerId, pages: sql<number>`coalesce(sum(${printAttempts.pagesPrinted}),0)` })
    .from(printAttempts)
    .where(gte(printAttempts.startedAt, monthStart))
    .groupBy(printAttempts.printerId);
  const al = await db
    .select({ printerId: alerts.printerId, n: count() })
    .from(alerts)
    .where(and(ne(alerts.status, "resolved"), inArray(alerts.printerId, ps.map((p) => p.id).concat("_"))))
    .groupBy(alerts.printerId);
  return {
    kiosks: ks.map((k) => ({ id: k.id, name: k.name, status: k.status, online: k.online })),
    printers: ps.map((p) => {
      const k = ks.find((x) => x.id === p.kioskId);
      return {
        ...printerView(p, k?.online ?? false),
        kioskName: k?.name,
        monthPages: Number(vol.find((v) => v.printerId === p.id)?.pages ?? 0),
        openAlerts: al.find((a) => a.printerId === p.id)?.n ?? 0,
      };
    }),
  };
});
void eq;
