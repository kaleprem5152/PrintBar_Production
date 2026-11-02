"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";

type Phase = "idle" | "creating" | "redirecting" | "verifying" | "failed";

/**
 * PaymentSheet — Cashfree payment integration.
 *
 * Flow:
 * 1. User clicks "Pay" → POST /api/payments/create-order (server-side CF order)
 * 2. Received sessionId is used to redirect to Cashfree hosted checkout
 * 3. After checkout, Cashfree redirects to /track/:orderId?new=1
 * 4. The webhook independently updates the order status
 * 5. The track page polls /api/orders/:id for PIN and status
 *
 * The hosted checkout URL approach is used here because:
 * - It works on all browsers without JS SDK compatibility issues
 * - It is fully supported on mobile and kiosk browsers
 * - The Cashfree JS SDK can be added later for embedded checkout if desired
 *
 * UI design preserved from original prototype — only the payment logic changed.
 */
export function PaymentSheet({
  order,
  onClose,
  onPaid,
}: {
  order:   { orderId: string; token: string; amount: number };
  onClose: () => void;
  onPaid:  () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function pay() {
    setError("");
    setPhase("creating");

    try {
      // Step 1: Create a Cashfree order server-side
      const r = await fetch("/api/payments/create-order", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.orderId, token: order.token }),
      });

      const j = await r.json();

      if (!r.ok) {
        throw new Error(j.error ?? "Could not initiate payment. Please try again.");
      }

      const { sessionId, cfOrderId } = j as { sessionId: string; cfOrderId: string };

      if (!sessionId) {
        throw new Error("Payment session could not be created.");
      }

      // Step 2: Redirect to Cashfree hosted checkout
      // This is the safest approach for kiosk + mobile compatibility.
      // Cashfree will redirect back to APP_BASE_URL/track/:orderId?new=1 after payment.
      setPhase("redirecting");

      const env = process.env.NEXT_PUBLIC_CASHFREE_ENV ?? "sandbox";
      const checkoutUrl =
        env === "production"
          ? `https://payments.cashfree.com/order/#${sessionId}`
          : `https://payments-test.cashfree.com/order/#${sessionId}`;

      // Small delay so the user sees the "Redirecting..." message
      await new Promise((resolve) => setTimeout(resolve, 600));
      window.location.href = checkoutUrl;

    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
      setPhase("failed");
    }
  }

  const busy = phase === "creating" || phase === "redirecting" || phase === "verifying";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/55 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Payment"
    >
      <div className="flex max-h-[94svh] w-full max-w-lg animate-fade-up flex-col overflow-hidden rounded-t-[28px] bg-paper shadow-2xl md:rounded-[28px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-mute">
              Pay securely · {order.orderId}
            </p>
            <p className="text-2xl font-semibold tracking-tight">{rupees(order.amount)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close payment"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-40"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        {busy ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <span className="h-12 w-12 animate-spin-slow rounded-full border-[3px] border-ink/15 border-t-signal" />
            <p className="text-lg font-semibold">
              {phase === "creating"
                ? "Setting up your payment…"
                : phase === "redirecting"
                  ? "Redirecting to secure checkout…"
                  : "Verifying your payment…"}
            </p>
            <p className="max-w-xs text-sm text-mute">
              {phase === "redirecting"
                ? "You will be taken to Cashfree's secure checkout page."
                : "Please don't close this window."}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-6">
            {phase === "failed" && error && (
              <div className="mb-5 flex gap-3 rounded-2xl border border-bad/25 bg-red-50 p-4 text-sm" role="alert">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-bad" />
                <div>
                  <p className="font-semibold text-bad">Payment unsuccessful</p>
                  <p className="mt-0.5 text-ink/70">{error} You can try again.</p>
                </div>
              </div>
            )}

            {/* Payment summary */}
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-mute">
                Order summary
              </p>
              <div className="mt-3 flex items-end justify-between">
                <span className="text-[15px] text-ink/80">Total payable</span>
                <span className="text-3xl font-semibold tabular-nums tracking-tight">
                  {rupees(order.amount)}
                </span>
              </div>
            </div>

            {/* Payment methods supported */}
            <div className="mt-4 rounded-2xl border border-line bg-white/60 p-4">
              <p className="text-[13px] font-semibold text-mute">Accepted payment methods</p>
              <p className="mt-1 text-[14px] text-ink/80">
                UPI · Debit &amp; credit cards · Net banking · Wallets
              </p>
            </div>

            {/* Security note */}
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-ok-soft p-4">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-ok" />
              <p className="text-[13px] leading-relaxed text-ink/80">
                You will be redirected to <strong>Cashfree&apos;s</strong> secure checkout.
                Your payment details are handled directly by Cashfree and never stored by PrintBar.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        {!busy && (
          <div className="border-t border-line bg-paper px-5 pb-5 pt-4">
            <button
              type="button"
              onClick={pay}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-paper transition hover:bg-ink-2 active:scale-[0.99]"
            >
              <Icon name="lock" size={17} />
              {phase === "failed" ? "Try again" : "Pay"} {rupees(order.amount)}
            </button>
            <p className="mt-3 text-center text-[12px] text-mute">
              Powered by Cashfree Payments · SSL secured
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
