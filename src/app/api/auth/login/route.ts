import { eq, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { adminUsers, auditLogs } from "@/db/schema";
import { clientIp } from "@/lib/api";
import { createSession, hashPassword, SESSION_COOKIE, SESSION_HOURS, verifyPassword } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const emailInput = String(body.email ?? "").trim().toLowerCase();
  const email = emailInput.includes("@") ? emailInput : `${emailInput}@printbar.in`;
  const password = String(body.password ?? "");
  const ip = clientIp(req);
  const fail = (msg: string, status = 401) => Response.json({ error: msg }, { status });
  if (!emailInput || !password) return fail("Enter your email and password", 400);

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(
      or(
        eq(adminUsers.email, emailInput),
        eq(adminUsers.email, email),
        eq(adminUsers.username, emailInput)
      )
    )
    .limit(1);
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return fail(`Account temporarily locked. Try again in ${Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)} min.`, 429);
  }
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    if (user) {
      const n = user.failedLogins + 1;
      await db
        .update(adminUsers)
        .set({ failedLogins: n, lockedUntil: n >= 5 ? new Date(Date.now() + 15 * 60_000) : null })
        .where(eq(adminUsers.id, user.id));
    }
    await db.insert(auditLogs).values({ userId: user?.id ?? null, userName: user?.name ?? email, action: "auth.login_failed", entity: "session", ip, details: {} });
    return fail("Invalid email or password");
  }

  // Update last login and upgrade legacy password hash if needed
  const updates: Record<string, unknown> = {
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };
  if (!user.passwordHash.startsWith("scrypt$")) {
    updates.passwordHash = hashPassword(password);
  }
  await db.update(adminUsers).set(updates).where(eq(adminUsers.id, user.id));
  const { token, expiresAt } = await createSession(user.id, ip, req.headers.get("user-agent"));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
    expires: expiresAt,
  });
  await db.insert(auditLogs).values({ userId: user.id, userName: user.name, role: user.role, action: "auth.login", entity: "session", ip, details: {} });
  void sql;
  return Response.json({ ok: true });
}
