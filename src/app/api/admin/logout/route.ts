import { clearAdminSessionCookie } from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearAdminSessionCookie();
  return Response.json({ ok: true });
}
