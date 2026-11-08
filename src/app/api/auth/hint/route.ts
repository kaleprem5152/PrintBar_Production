import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { BOOTSTRAP_USERS, DEFAULT_PASSWORD, ensureBootstrap } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** First-run helper: only reveals the bootstrap credentials while those accounts have never been used / changed. */
export async function GET() {
  await ensureBootstrap();
  const fresh = await db
    .select({ email: adminUsers.email, role: adminUsers.role })
    .from(adminUsers)
    .where(and(eq(adminUsers.mustChangePassword, true), isNull(adminUsers.lastLoginAt)));
  const accounts = fresh.filter((u) => BOOTSTRAP_USERS.some((b) => b.email === u.email));
  if (!accounts.length || process.env.ADMIN_BOOTSTRAP_PASSWORD) return Response.json({ show: false });
  return Response.json({ show: true, password: DEFAULT_PASSWORD, accounts });
}
