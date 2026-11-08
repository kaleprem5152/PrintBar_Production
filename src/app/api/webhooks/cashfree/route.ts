import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { refunds } from "@/db/schema";
import { audit } from "@/lib/api";
import { mapRefundStatus } from "@/lib/cashfree";
import { applyRefundStatus } from "@/lib/refunds";

export const dynamic = "force-dynamic";

/**
 * Cashfree webhook receiver (REFUND_STATUS_WEBHOOK). Signature = base64(HMAC-SHA256(timestamp + rawBody, secret)).
 * This is the gateway-confirmation path that can mark a refund as successful.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
  if (!secret) return Response.json({ error: "Webhook secret not configured" }, { status: 503 });
  const raw = await req.text();
  const ts = req.headers.get("x-webhook-timestamp") ?? "";
  const sig = req.headers.get("x-webhook-signature") ?? "";
  const expected = createHmac("sha256", secret).update(ts + raw).digest("base64");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Bad signature" }, { status: 401 });

  const evt = JSON.parse(raw || "{}") as { type?: string; data?: { refund?: { refund_id?: string; refund_status?: string; cf_refund_id?: string | number; status_description?: string } } };
  if (evt.type === "REFUND_STATUS_WEBHOOK" && evt.data?.refund?.refund_id) {
    const r = evt.data.refund;
    const [row] = await db.select().from(refunds).where(eq(refunds.refundRef, r.refund_id!));
    if (row) {
      await applyRefundStatus(row.id, mapRefundStatus(r.refund_status), {
        gatewayRefundId: r.cf_refund_id != null ? String(r.cf_refund_id) : undefined,
        gatewayStatus: r.refund_status,
        message: r.status_description,
      });
      await audit({ user: null }, "refund.webhook", "refund", row.refundRef, { gatewayStatus: r.refund_status });
    }
  }
  return Response.json({ ok: true });
}
