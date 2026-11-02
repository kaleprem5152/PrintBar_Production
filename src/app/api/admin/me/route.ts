import { clearAdminSessionCookie, getAuthenticatedAdmin } from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearAdminSessionCookie();
  return Response.json({ ok: true });
}

export async function GET() {
  const username = await getAuthenticatedAdmin();
  return Response.json({
    authenticated: Boolean(username),
    username: username ?? null,
  });
}
