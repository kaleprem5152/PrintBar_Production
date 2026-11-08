/**
 * Cashfree Payments integration.
 *
 * Uses the Cashfree Payments API v2023-08-01 directly via HTTP.
 * No dependency on the Cashfree Node SDK (allows exact version control
 * and avoids SDK churn). All requests are server-side only.
 *
 * Documentation: https://docs.cashfree.com/reference/pg-new-apis-endpoint
 *
 * Environment variables required:
 *   CASHFREE_CLIENT_ID
 *   CASHFREE_CLIENT_SECRET
 *   CASHFREE_ENV           = "sandbox" | "production"
 *   CASHFREE_API_VERSION   = "2023-08-01"
 *   APP_BASE_URL           = "https://your-app.railway.app"
 */
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export function getCashfreeConfig() {
  const clientId = (process.env.CASHFREE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CASHFREE_CLIENT_SECRET ?? "").trim();
  const rawEnv = (process.env.CASHFREE_ENV ?? "").trim().toLowerCase();

  // Auto-detect production vs sandbox if key format indicates it, or honor CASHFREE_ENV
  let env: "sandbox" | "production" = "sandbox";
  if (clientSecret.includes("_prod_")) {
    env = "production";
  } else if (clientSecret.includes("_test_")) {
    env = "sandbox";
  } else if (rawEnv === "production" || rawEnv === "prod") {
    env = "production";
  }

  const baseUrl =
    env === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";

  const apiVersion = process.env.CASHFREE_API_VERSION?.trim() || "2023-08-01";
  const appBaseUrl = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

  return { clientId, clientSecret, env, baseUrl, apiVersion, appBaseUrl };
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CashfreeOrderStatus =
  | "ACTIVE"
  | "PAID"
  | "EXPIRED";

export type CashfreeCreateOrderResult = {
  cfOrderId:    string;   // Cashfree's order ID (for checkout)
  orderId:      string;   // Our internal order ID
  checkoutUrl:  string;   // Hosted checkout URL
  sessionId:    string;   // For Cashfree.js embedded checkout
  expiresAt:    string;   // ISO8601
};

export type CashfreePaymentResult = {
  orderId:       string;
  cfOrderId:     string;
  paymentId:     string;
  paymentStatus: "SUCCESS" | "FAILED" | "PENDING" | "USER_DROPPED" | "VOID" | "CANCELLED" | "FLAGGED";
  amount:        number;
  currency:      string;
  paymentMethod: string;
  paymentTime:   string;
};

export type CashfreeWebhookPayload = {
  data: {
    order: {
      order_id:     string;
      order_amount: number;
      order_currency: string;
    };
    payment: {
      cf_payment_id: string;
      payment_status: string;
      payment_amount: number;
      payment_currency: string;
      payment_method: Record<string, unknown>;
      payment_time: string;
    };
    customer_details?: {
      customer_id?: string;
      customer_phone?: string;
    };
  };
  event_time: string;
  type: string;
};

// ─── API client ────────────────────────────────────────────────────────────────

async function cfRequest<T>(
  path: string,
  options: { method: "GET" | "POST"; body?: unknown }
): Promise<{ ok: boolean; data: T; status: number; error?: string }> {
  const { clientId, clientSecret, baseUrl, apiVersion } = getCashfreeConfig();

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials not configured. Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method:  options.method,
    headers: {
      "x-client-id":     clientId,
      "x-client-secret": clientSecret,
      "x-api-version":   apiVersion,
      "Content-Type":    "application/json",
      "Accept":          "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json() as T;

  if (!res.ok) {
    const errData = data as { message?: string; code?: string };
    return {
      ok:     false,
      data,
      status: res.status,
      error:  errData.message ?? `Cashfree API error ${res.status}`,
    };
  }
  return { ok: true, data, status: res.status };
}

// ─── Create a Cashfree order ────────────────────────────────────────────────────

/**
 * Creates a Cashfree payment order.
 * Called server-side immediately before showing the payment UI.
 * The cfOrderId is stored in our DB; never sent to the browser as authoritative.
 */
export async function createCashfreeOrder(params: {
  internalOrderId: string;  // Our PB-YYYY-NNNNN reference
  amount:          number;  // Rupees (integer)
  token?:          string;  // Session token for return URL
  customerPhone?:  string;  // Optional — Cashfree can pre-fill
}) {
  const { env, appBaseUrl } = getCashfreeConfig();
  const isHttps = appBaseUrl.startsWith("https://");

  const orderMeta: Record<string, string> = {};

  // In production mode, Cashfree strictly enforces that return_url & notify_url MUST be https.
  // In dev (http://localhost:3000), omit them so Cashfree doesn't reject with 400 invalid_url.
  if (isHttps) {
    const returnUrl = params.token
      ? `${appBaseUrl}/track/${params.internalOrderId}?k=${encodeURIComponent(params.token)}&new=1`
      : `${appBaseUrl}/track/${params.internalOrderId}?new=1`;
    orderMeta.return_url = returnUrl;
    orderMeta.notify_url = `${appBaseUrl}/api/payments/webhook`;
  } else if (env === "sandbox") {
    // Sandbox allows http URLs for local dev testing
    const returnUrl = params.token
      ? `${appBaseUrl}/track/${params.internalOrderId}?k=${encodeURIComponent(params.token)}&new=1`
      : `${appBaseUrl}/track/${params.internalOrderId}?new=1`;
    orderMeta.return_url = returnUrl;
  }

  const payload: Record<string, unknown> = {
    order_id:       params.internalOrderId,
    order_amount:   params.amount,
    order_currency: "INR",
    customer_details: {
      customer_id:    params.internalOrderId,
      customer_phone: params.customerPhone ?? "9999999999",
    },
  };

  if (Object.keys(orderMeta).length > 0) {
    payload.order_meta = orderMeta;
  }

  const result = await cfRequest<{
    cf_order_id?: string;
    order_id?: string;
    payment_session_id?: string;
    order_expiry_time?: string;
    order_status?: string;
    message?: string;
    code?: string;
  }>("/orders", {
    method: "POST",
    body:   payload,
  });

  if (!result.ok || !result.data.cf_order_id || !result.data.payment_session_id) {
    throw new Error(result.error ?? "Failed to create Cashfree payment order");
  }

  const checkoutUrl =
    env === "production"
      ? `https://payments.cashfree.com/order/#${result.data.payment_session_id}`
      : `https://payments-test.cashfree.com/order/#${result.data.payment_session_id}`;

  return {
    cfOrderId:   result.data.cf_order_id,
    sessionId:   result.data.payment_session_id,
    checkoutUrl,
    expiresAt:   result.data.order_expiry_time ?? "",
    orderId:     params.internalOrderId,
  };
}

// ─── Verify payment status ─────────────────────────────────────────────────────

/**
 * Verify a payment by fetching the order status from Cashfree.
 * NEVER trust the browser for this — always verify server-side.
 */
export async function verifyCashfreePayment(cfOrderId: string): Promise<{
  paid:          boolean;
  paymentId:     string;
  paymentStatus: string;
  amount:        number;
  paymentMethod: string;
  paymentTime:   string;
}> {
  const result = await cfRequest<{
    order_status?: string;
    cf_order_id?:  string;
    order_amount?: number;
    payments?: Array<{
      cf_payment_id:   string;
      payment_status:  string;
      payment_amount:  number;
      payment_method:  Record<string, unknown>;
      payment_time:    string;
    }>;
    message?: string;
  }>(`/orders/${cfOrderId}/payments`, {
    method: "GET",
  });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to verify Cashfree payment");
  }

  const payments = result.data.payments ?? [];
  const successPayment = payments.find((p) => p.payment_status === "SUCCESS");

  if (!successPayment) {
    const latestPayment = payments[0];
    return {
      paid:          false,
      paymentId:     latestPayment?.cf_payment_id ?? "",
      paymentStatus: latestPayment?.payment_status ?? "PENDING",
      amount:        latestPayment?.payment_amount ?? 0,
      paymentMethod: extractPaymentMethod(latestPayment?.payment_method ?? {}),
      paymentTime:   latestPayment?.payment_time ?? "",
    };
  }

  return {
    paid:          true,
    paymentId:     successPayment.cf_payment_id,
    paymentStatus: "SUCCESS",
    amount:        successPayment.payment_amount,
    paymentMethod: extractPaymentMethod(successPayment.payment_method),
    paymentTime:   successPayment.payment_time,
  };
}

function extractPaymentMethod(method: Record<string, unknown>): string {
  if (method.upi)         return "upi";
  if (method.card)        return "card";
  if (method.netbanking)  return "netbanking";
  if (method.wallet)      return "wallet";
  if (method.emi)         return "emi";
  return "unknown";
}

// ─── Webhook signature verification ────────────────────────────────────────────

/**
 * Verify the Cashfree webhook signature.
 *
 * Cashfree signs webhooks using the following procedure:
 *   1. Concatenate: timestamp + raw request body (as string)
 *   2. Compute HMAC-SHA256 using CASHFREE_CLIENT_SECRET as the key
 *   3. Base64-encode the result
 *   4. Compare with the x-webhook-signature header
 *
 * Source: https://docs.cashfree.com/docs/webhook-security
 *
 * @returns true if the signature is valid
 */
export function verifyCashfreeWebhookSignature(
  rawBody:   string,
  timestamp: string,
  signature: string
): boolean {
  const { clientSecret } = getCashfreeConfig();
  const secretKey = process.env.CASHFREE_WEBHOOK_SECRET?.trim() || clientSecret;

  if (!secretKey) {
    console.error("[cashfree] Webhook secret / client secret not set — cannot verify webhook");
    return false;
  }
  if (!timestamp || !signature) return false;

  try {
    const message  = timestamp + rawBody;
    const expected = createHmac("sha256", secretKey)
      .update(message)
      .digest("base64");

    const expectedBuf = Buffer.from(expected, "utf8");
    const givenBuf    = Buffer.from(signature, "utf8");

    if (expectedBuf.length !== givenBuf.length) return false;
    return timingSafeEqual(expectedBuf, givenBuf);
  } catch {
    return false;
  }
}

// ─── Environment check ─────────────────────────────────────────────────────────

export function cashfreeEnv(): "sandbox" | "production" {
  return getCashfreeConfig().env;
}

export function isCashfreeConfigured(): boolean {
  const { clientId, clientSecret } = getCashfreeConfig();
  return Boolean(clientId && clientSecret);
}
