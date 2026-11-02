import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { advance, ensureSeed, toPublic } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

// Basic brute-force protection for the 4-digit PIN (per kiosk process).
const attempts: number[] = [];
const MAX = 10;
const WINDOW = 60_000;

export async function POST(req: Request) {
  await ensureSeed();
  const now = Date.now();
  while (attempts.length && now - attempts[0] > WINDOW) attempts.shift();
  if (attempts.length >= MAX) {
    return Response.json({ error: "locked" }, { status: 429 });
  }
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (!pin || !/^\d{4}$/.test(pin)) return Response.json({ error: "invalid" }, { status: 400 });

  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.pin, pin), inArray(orders.status, ["paid", "pin_accepted", "printing", "failed"])))
    .orderBy(desc(orders.id));
  if (!o) {
    attempts.push(now);
    return Response.json({ error: "invalid" }, { status: 404 });
  }
  if (o.expiresAt && o.expiresAt.getTime() < now) {
    return Response.json({ error: "expired" }, { status: 410 });
  }
  let row = o;
  if (o.status === "paid") {
    [row] = await db.update(orders).set({ status: "pin_accepted" }).where(eq(orders.id, o.id)).returning();
  }
  row = await advance(row);
  return Response.json(toPublic(row, false));
}
