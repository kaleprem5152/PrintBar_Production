import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { expiryFromNow, generatePin, signPayment, toPublic } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId, token, paymentId, signature } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?: string;
    paymentId?: string;
    signature?: string;
  };
  const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId ?? ""));
  if (!o || o.token !== token) return Response.json({ error: "Order not found." }, { status: 404 });
  if (o.status !== "pending_payment") return Response.json(toPublic(o, true));

  const expected = signPayment(o.orderId, paymentId ?? "");
  const given = Buffer.from(signature ?? "");
  const exp = Buffer.from(expected);
  if (!paymentId || given.length !== exp.length || !timingSafeEqual(given, exp)) {
    return Response.json({ error: "Payment could not be verified." }, { status: 402 });
  }

  const pin = await generatePin();
  const [u] = await db
    .update(orders)
    .set({ status: "paid", pin, paymentRef: paymentId, paidAt: new Date(), expiresAt: expiryFromNow() })
    .where(eq(orders.id, o.id))
    .returning();
  return Response.json(toPublic(u, true));
}
