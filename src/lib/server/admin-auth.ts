import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";

const SESSION_COOKIE = "pb_admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SECRET = process.env.ADMIN_SESSION_SECRET || "printbar-admin-secret-at-least-32-chars-long";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, originalHash] = storedHash.split(":");
    if (!salt || !originalHash) return false;
    const computed = scryptSync(password, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(computed), Buffer.from(originalHash));
  } catch {
    return false;
  }
}

export function createSessionToken(username: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const data = `${username}:${exp}`;
  const sig = createHmac("sha256", SECRET).update(data).digest("hex");
  return `${Buffer.from(data).toString("base64url")}.${sig}`;
}

export function verifySessionToken(token: string): string | null {
  try {
    const [dataB64, sig] = token.split(".");
    if (!dataB64 || !sig) return null;
    const data = Buffer.from(dataB64, "base64url").toString("utf8");
    const expectedSig = createHmac("sha256", SECRET).update(data).digest("hex");
    if (sig !== expectedSig) return null;

    const [username, expStr] = data.split(":");
    const exp = parseInt(expStr, 10);
    if (isNaN(exp) || Date.now() > exp) return null;

    return username;
  } catch {
    return null;
  }
}

export async function getAuthenticatedAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setAdminSessionCookie(username: string) {
  const token = createSessionToken(username);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Ensure at least one default admin account exists for first login */
export async function ensureDefaultAdmin() {
  try {
    const [existing] = await db.select().from(adminUsers).limit(1);
    if (!existing) {
      const defaultUser = process.env.ADMIN_DEFAULT_USER || "admin";
      const defaultPass = process.env.ADMIN_DEFAULT_PASS || "printbar2026";
      const passwordHash = hashPassword(defaultPass);
      await db.insert(adminUsers).values({
        username: defaultUser,
        passwordHash,
        isActive: true,
      });
      console.log(`[admin] Default admin account seeded: ${defaultUser}`);
    }
  } catch {
    /* ignore if DB not ready */
  }
}
