import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import LoginForm from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getAuth();
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/admin") ? sp.next : "/admin";
  if (user) redirect(next);
  return <LoginForm next={next} />;
}
