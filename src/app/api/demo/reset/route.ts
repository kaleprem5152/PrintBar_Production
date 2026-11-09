import { resetDemo } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Demo reset is disabled in production." }, { status: 403 });
  }
  await resetDemo();
  return Response.json({ ok: true });
}
