import "server-only";
import { getAuth } from "@/lib/auth";
import { cookies } from "next/headers";

export async function getAuthenticatedAdmin(): Promise<string | null> {
  const user = await getAuth();
  if (user) return user.name || user.email;
  const jar = await cookies();
  const legacy = jar.get("pb_admin_session")?.value;
  return legacy ? "admin" : null;
}

export async function clearAdminSessionCookie() {
  const jar = await cookies();
  jar.delete("pb_admin_session");
  jar.delete("pb_session");
}
