import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { signPayment } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

/**
 * PROTOTYPE payment gateway. Stands in for Razorpay/Easebuzz checkout so the full flow
 * can be demonstrated without real money. It returns a payment id + HMAC signature,
 * exactly like a real gateway callback, which /api/payments/verify must then validate.
 */
export async function POST(req: Request) {
  const { orderId, token, method, simulate } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    token?: string;
    method?: string;
    simulate?: "success" | "failure";
  };
  const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId ?? ""));
  if (!o || o.token !== token || o.status !== "pending_payment") {
    return Response.json({ error: "Order is not awaiting payment." }, { status: 404 });
  }
  await new Promise((r) => setTimeout(r, 1600));
  if (simulate === "failure") {
    return Response.json({ error: "The bank declined this payment. You have not been charged." }, { status: 402 });
  }
  const paymentId = `pay_proto_${randomBytes(6).toString("hex")}`;
  return Response.json({ paymentId, method, signature: signPayment(o.orderId, paymentId) });
}
