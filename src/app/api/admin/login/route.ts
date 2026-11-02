import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  ensureDefaultAdmin,
  setAdminSessionCookie,
  verifyPassword,
} from "@/lib/server/admin-auth";
import { logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDefaultAdmin();

  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return Response.json({ error: "Username and password are required." }, { status: 400 });
  }

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
  if (!user || !user.isActive) {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setAdminSessionCookie(user.username);
  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, user.id));

  await logAuditEvent({
    eventType: "admin_login",
    actorId:   user.username,
  });

  return Response.json({ ok: true, username: user.username });
}
