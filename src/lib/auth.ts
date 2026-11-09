import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { getRolePermissions } from "./settings";
import type { Permission } from "./rbac";

export const SESSION_COOKIE = "pb_session";
export const SESSION_HOURS = 12;

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  permissions: Permission[];
  sessionId: string;
  mustChangePassword: boolean;
};

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const h = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${h}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  if (!pw || !stored) return false;

  // Format 1: scrypt$salt$hash (Modern standard format)
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    const salt = parts[1];
    const hash = parts[2];
    if (!salt || !hash) return false;
    try {
      const a = Buffer.from(hash, "hex");
      const b = scryptSync(pw, salt, 64);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Format 2: salt:hash (Legacy colon-separated format)
  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    try {
      const a = Buffer.from(hash, "hex");
      const b = scryptSync(pw, salt, 64);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Format 3: salt$hash (Without scrypt prefix)
  if (stored.includes("$")) {
    const parts = stored.split("$");
    const salt = parts[0];
    const hash = parts[1];
    if (!salt || !hash) return false;
    try {
      const a = Buffer.from(hash, "hex");
      const b = scryptSync(pw, salt, 64);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Format 4: Fallback direct equality
  return stored === pw;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: number, ip: string | null, ua: string | null) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.insert(adminSessions).values({ id: sha(token), userId, ip, userAgent: ua?.slice(0, 300) ?? null, expiresAt });
  return { token, expiresAt };
}

export async function revokeSession(id: string) {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, id));
}

export const getAuth = cache(async (): Promise<AuthUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha(token);
  const [row] = await db
    .select({ s: adminSessions, u: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(and(eq(adminSessions.id, id), isNull(adminSessions.revokedAt)))
    .limit(1);
  if (!row || row.s.expiresAt.getTime() < Date.now() || !row.u.active) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(adminSessions).set({ lastSeenAt: new Date() }).where(eq(adminSessions.id, id));
  }
  return {
    id: row.u.id,
    email: row.u.email,
    name: row.u.name,
    role: row.u.role,
    permissions: await getRolePermissions(row.u.role),
    sessionId: id,
    mustChangePassword: row.u.mustChangePassword,
  };
});
