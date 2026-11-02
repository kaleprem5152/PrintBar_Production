import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kiosks } from "@/db/schema";
import { KIOSK_ID } from "@/lib/config";
import { ensureSeed, getKioskState } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

const VALID = ["ready", "offline", "paper_out", "paper_jam", "error"];

export async function GET() {
  return Response.json({ state: await getKioskState() });
}

/** Prototype control: stands in for the kiosk's hardware agent reporting printer state. */
export async function POST(req: Request) {
  await ensureSeed();
  const { state } = (await req.json().catch(() => ({}))) as { state?: string };
  if (!state || !VALID.includes(state)) return Response.json({ error: "Invalid state" }, { status: 400 });
  await db.update(kiosks).set({ state, updatedAt: new Date() }).where(eq(kiosks.id, KIOSK_ID));
  return Response.json({ state });
}
