import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { ApiError, audit, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(null, async ({ req, user }) => {
  const all = req.nextUrl.searchParams.get("all") === "1" && user.permissions.includes("users.manage");
  const rows = await db
    .select({ s: adminSessions, name: adminUsers.name, email: adminUsers.email })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(and(isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date()), all ? undefined : eq(adminSessions.userId, user.id)))
    .orderBy(desc(adminSessions.lastSeenAt))
    .limit(100);
  return {
    sessions: rows.map((r) => ({
      id: r.s.id, current: r.s.id === user.sessionId, userName: r.name, email: r.email, ip: r.s.ip, userAgent: r.s.userAgent,
      createdAt: r.s.createdAt, lastSeenAt: r.s.lastSeenAt, expiresAt: r.s.expiresAt,
    })),
  };
});

export const DELETE = route(null, async ({ user, ip, body }) => {
  const b = await body();
  if (b.scope === "others") {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.userId, user.id), ne(adminSessions.id, user.sessionId), isNull(adminSessions.revokedAt)));
    await audit({ user, ip }, "session.revoke_others", "session", user.id);
    return { ok: true, message: "Signed out of all other devices" };
  }
  const id = String(b.id ?? "");
  const [s] = await db.select().from(adminSessions).where(eq(adminSessions.id, id));
  if (!s) throw new ApiError(404, "Session not found");
  if (s.userId !== user.id && !user.permissions.includes("users.manage")) throw new ApiError(403, "Not allowed");
  if (s.id === user.sessionId) throw new ApiError(400, "Use Sign out to end your current session");
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, id));
  await audit({ user, ip }, "session.revoke", "session", s.userId);
  return { ok: true, message: "Session revoked" };
});
