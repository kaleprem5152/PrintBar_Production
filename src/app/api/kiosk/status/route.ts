import { DEVICE_ID } from "@/lib/config";
import { ensureSeed, getKioskState, setDemoStateOverride } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

const VALID = ["ready", "offline", "paper_out", "paper_jam", "error"];

export async function GET() {
  await ensureSeed();
  const state = await getKioskState(DEVICE_ID);
  return Response.json({ state });
}

/** Demo / prototype control: allows testing printer states on the kiosk UI */
export async function POST(req: Request) {
  await ensureSeed();
  const { state } = (await req.json().catch(() => ({}))) as { state?: string };
  if (!state || !VALID.includes(state)) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
  setDemoStateOverride(state);
  return Response.json({ state });
}
