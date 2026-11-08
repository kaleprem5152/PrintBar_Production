import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers, alerts, kiosks, notifications } from "@/db/schema";
import { route } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { getStaleMs, kioskView, sweepOffline } from "@/lib/live";
import { cashfreeStatus } from "@/lib/cashfree";

export const dynamic = "force-dynamic";

export const GET = route(null, async ({ user }) => {
  await sweepOffline();
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
  const prefs = u?.notifyPrefs ?? {};
  const disabled = Object.entries(prefs.types ?? {}).filter(([, v]) => v === false).map(([k]) => k);
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(sql`not (${user.id} = any(${notifications.readBy}))`, disabled.length ? sql`${notifications.type} not in ${disabled}` : undefined));
  const openAlerts = await db.select({ severity: alerts.severity, n: count() }).from(alerts).where(ne(alerts.status, "resolved")).groupBy(alerts.severity);
  const ks = (await db.select().from(kiosks)).map((k) => kioskView(k, 90_000));
  void getStaleMs; void inArray;
  const demo = await getSetting("demo_mode", false);
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
    demo,
    unread,
    alerts: {
      critical: openAlerts.find((a) => a.severity === "critical")?.n ?? 0,
      total: openAlerts.reduce((a, b) => a + b.n, 0),
    },
    fleet: {
      total: ks.length,
      online: ks.filter((k) => k.status === "online").length,
      paused: ks.filter((k) => k.printingPaused).length,
      maintenance: ks.filter((k) => k.maintenance).length,
    },
    gatewayConfigured: cashfreeStatus().configured,
  };
});
