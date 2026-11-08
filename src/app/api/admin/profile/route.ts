import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { ApiError, audit, route, str } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = route(null, async ({ user, ip, body }) => {
  const b = await body();
  const name = str(b.name, "Name", { min: 2, max: 80 });
  await db.update(adminUsers).set({ name }).where(eq(adminUsers.id, user.id));
  await audit({ user, ip }, "profile.update", "user", user.id, { name });
  return { ok: true, message: "Profile updated" };
});

export const POST = route(null, async ({ user, ip, body }) => {
  const b = await body();
  const current = String(b.current ?? "");
  const next = String(b.next ?? "");
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
  if (!verifyPassword(current, u.passwordHash)) throw new ApiError(400, "Current password is incorrect");
  if (next.length < 10 || !/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/\d/.test(next)) throw new ApiError(400, "New password must be 10+ characters with upper-case, lower-case and a number");
  if (next === current) throw new ApiError(400, "New password must be different");
  await db.update(adminUsers).set({ passwordHash: hashPassword(next), mustChangePassword: false }).where(eq(adminUsers.id, user.id));
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.userId, user.id), ne(adminSessions.id, user.sessionId), isNull(adminSessions.revokedAt)));
  await audit({ user, ip }, "auth.password_change", "user", user.id);
  return { ok: true, message: "Password changed. Other devices were signed out." };
});
