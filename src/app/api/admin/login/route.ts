import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  ensureDefaultAdmin,
  setAdminSessionCookie,
  validateAdminCredentials,
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

  const valid = await validateAdminCredentials(username, password);
  if (!valid) {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setAdminSessionCookie(username);

  try {
    await db
      .update(adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(adminUsers.username, username));
  } catch {
    // Ignore in fallback mode
  }

  await logAuditEvent({
    eventType: "admin_login",
    actorId:   username,
  });

  return Response.json({ ok: true, username });
}
