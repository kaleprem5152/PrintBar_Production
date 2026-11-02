import { resetDemo } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST() {
  await resetDemo();
  return Response.json({ ok: true });
}
