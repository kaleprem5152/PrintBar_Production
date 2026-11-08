import { cookies } from "next/headers";
import { audit } from "@/lib/api";
import { getAuth, revokeSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getAuth();
  if (user) {
    await revokeSession(user.sessionId);
    await audit({ user }, "auth.logout", "session");
  }
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
