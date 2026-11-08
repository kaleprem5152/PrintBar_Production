/**
 * Cashfree Payments (PG v2023-08-01) server-side client.
 * Credentials come ONLY from environment variables and are never returned to the browser.
 *   CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=sandbox|production, CASHFREE_WEBHOOK_SECRET (optional; defaults to secret key)
 */
export class GatewayError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

export function cashfreeStatus() {
  const configured = !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
  return {
    configured,
    environment: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
    appIdHint: process.env.CASHFREE_APP_ID ? `${process.env.CASHFREE_APP_ID.slice(0, 3)}••••••••` : null,
    secretSet: !!process.env.CASHFREE_SECRET_KEY,
    webhookSecretSet: !!(process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY),
  };
}

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const st = cashfreeStatus();
  if (!st.configured) throw new GatewayError(503, "Cashfree credentials are not configured on this backend");
  const base = st.environment === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
  let res: Response;
  try {
    res = await fetch(base + path, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": process.env.CASHFREE_APP_ID!,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GatewayError(0, "Cashfree is unreachable", true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GatewayError(res.status, String(data.message ?? `Gateway error ${res.status}`), res.status >= 500);
  return data as T;
}

export type CfRefund = { cf_refund_id?: string | number; refund_id: string; refund_status?: string; status_description?: string };

export const cfCreateRefund = (p: { orderId: string; refundId: string; amountPaise: number; note: string }) =>
  cf<CfRefund>(`/orders/${encodeURIComponent(p.orderId)}/refunds`, {
    method: "POST",
    headers: { "x-idempotency-key": p.refundId },
    body: JSON.stringify({
      refund_amount: p.amountPaise / 100,
      refund_id: p.refundId,
      refund_note: p.note.slice(0, 100),
      refund_speed: "STANDARD",
    }),
  });

export const cfGetRefund = (orderId: string, refundId: string) =>
  cf<CfRefund>(`/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`);

export type CfPayment = { cf_payment_id: string | number; payment_status: string; payment_amount: number; payment_method?: Record<string, unknown> };
export const cfGetOrderPayments = (orderId: string) => cf<CfPayment[]>(`/orders/${encodeURIComponent(orderId)}/payments`);

/** Map Cashfree refund status → internal status. Success only on explicit SUCCESS. */
export function mapRefundStatus(s: string | undefined): "processing" | "success" | "failed" {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "CANCELLED":
    case "FAILED":
      return "failed";
    default:
      return "processing"; // PENDING, ONHOLD, unknown
  }
}
