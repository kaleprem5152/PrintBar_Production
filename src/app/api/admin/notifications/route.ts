import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers, notifications, type NotifyPrefs } from "@/db/schema";
import { audit, int, oneOf, pageParams, route } from "@/lib/api";
import { NOTIFICATION_TYPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const GET = route(null, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(sp, 25);
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
  const prefs: NotifyPrefs = u?.notifyPrefs ?? {};
  const disabled = Object.entries(prefs.types ?? {}).filter(([, v]) => v === false).map(([k]) => k);
  const conds = [disabled.length ? sql`${notifications.type} not in ${disabled}` : undefined];
  if (sp.get("unread") === "1") conds.push(sql`not (${user.id} = any(${notifications.readBy}))`);
  const type = sp.get("type");
  if (type) conds.push(eq(notifications.type, type));
  const where = and(...conds);
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(size).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
  return {
    rows: rows.map(({ readBy, ...n }) => ({ ...n, read: readBy.includes(user.id) })),
    total,
    page,
    size,
    prefs: {
      inApp: prefs.inApp ?? true,
      push: prefs.push ?? false,
      minSeverity: prefs.minSeverity ?? "info",
      types: Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, prefs.types?.[k] ?? true])),
    },
  };
});

export const POST = route(null, async ({ user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["read", "read_all", "save_prefs"] as const);
  if (action === "read") {
    const id = int(b.id, "id", { min: 1 });
    await db.update(notifications).set({ readBy: sql`array_append(${notifications.readBy}, ${user.id})` }).where(and(eq(notifications.id, id), sql`not (${user.id} = any(${notifications.readBy}))`));
  } else if (action === "read_all") {
    await db.update(notifications).set({ readBy: sql`array_append(${notifications.readBy}, ${user.id})` }).where(sql`not (${user.id} = any(${notifications.readBy}))`);
  } else {
    const p = (b.prefs ?? {}) as NotifyPrefs;
    const types: Record<string, boolean> = {};
    for (const k of Object.keys(NOTIFICATION_TYPES)) types[k] = p.types?.[k] !== false;
    const prefs: NotifyPrefs = {
      inApp: p.inApp !== false,
      push: !!p.push,
      minSeverity: (["info", "warning", "critical"] as const).includes(p.minSeverity as "info") ? p.minSeverity : "info",
      types,
    };
    await db.update(adminUsers).set({ notifyPrefs: prefs }).where(eq(adminUsers.id, user.id));
    await audit({ user, ip }, "notifications.prefs", "user", user.id, { push: prefs.push });
    return { ok: true, message: "Notification preferences saved" };
  }
  return { ok: true };
});
