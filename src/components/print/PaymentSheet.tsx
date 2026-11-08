"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";

type Phase = "idle" | "creating" | "opening_gateway" | "simulating" | "verifying" | "failed";
type PaymentMode = "cashfree" | "instant";

function loadCashfreeSdk(): Promise<any> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if ((window as any).Cashfree) return resolve((window as any).Cashfree);
    const existing = document.querySelector('script[src*="cashfree.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).Cashfree ?? null));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve((window as any).Cashfree ?? null);
    script.onerror = () => resolve(null);
    document.body.appendChild(script);
  });
}

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
  const [mode, setMode] = useState<PaymentMode>("cashfree");
  const [simulateFail, setSimulateFail] = useState(false);
  const [simulationAllowed, setSimulationAllowed] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Preload Cashfree JS SDK in background
    loadCashfreeSdk().catch(() => {});
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handlePay() {
    setError("");

    // ─────────────────────────────────────────────────────────────
    // Flow A: Instant Test / Simulation (Dev / Explicit test only)
    // ─────────────────────────────────────────────────────────────
    if (mode === "instant") {
      if (!simulationAllowed) {
        setError("Test simulation is disabled in production. Please use Cashfree.");
        return;
      }

      setPhase("simulating");
      await new Promise((resolve) => setTimeout(resolve, 800));

      if (simulateFail) {
        setError("Test transaction declined. Uncheck the failure toggle and try again.");
        setPhase("failed");
        return;
      }

      setPhase("verifying");
      try {
        const v = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.orderId,
            token: order.token,
            isSimulation: true,
            method: "test_simulation",
          }),
        });

        const vj = await v.json();
        if (!v.ok) {
          throw new Error(vj.error ?? "Payment verification failed.");
        }

        onPaid();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test transaction failed.");
        setPhase("failed");
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // Flow B: Real Cashfree Gateway (UPI QR, GPay, Cards, NetBanking)
    // ─────────────────────────────────────────────────────────────
    setPhase("creating");

    try {
      const res = await fetch("/api/payments/create-order", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.orderId, token: order.token }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to initialize payment gateway.");
      }

      if (data.isSimulationAllowed) {
        setSimulationAllowed(true);
      }

      // If order is already paid:
      if (data.paid) {
        onPaid();
        return;
      }

      // If Cashfree is not configured in .env:
      if (!data.isConfigured || data.isSimulation) {
        if (!data.isSimulationAllowed) {
          throw new Error("Cashfree payment gateway is unavailable. Please notify the kiosk operator.");
        }
        setMode("instant");
        setPhase("simulating");
        await new Promise((resolve) => setTimeout(resolve, 700));
        const v = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.orderId,
            token: order.token,
            isSimulation: true,
            method: "test_simulation",
          }),
        });
        if (v.ok) {
          onPaid();
          return;
        }
      }

      // Open Cashfree Modal or Redirect
      setPhase("opening_gateway");
      const CashfreeSdk = await loadCashfreeSdk();

      if (CashfreeSdk && data.sessionId) {
        try {
          const cf = CashfreeSdk({ mode: data.env === "production" ? "production" : "sandbox" });
          const checkoutRes = await cf.checkout({
            paymentSessionId: data.sessionId,
            redirectTarget: "_modal",
          });

          if (checkoutRes?.error) {
            // Dismissed or error inside modal
            const msg = checkoutRes.error.message || "Payment modal closed.";
            if (msg.toLowerCase().includes("closed") || msg.toLowerCase().includes("cancel")) {
              setPhase("idle");
              return;
            }
            throw new Error(msg);
          }

          // Payment completed in modal — verify server-side
          setPhase("verifying");
          const v = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: order.orderId, token: order.token }),
          });

          if (v.ok) {
            onPaid();
            return;
          }
        } catch (modalErr) {
          console.warn("[payment] Cashfree modal dismissed or errored:", modalErr);
          // If modal failed, offer direct hosted checkout URL
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
            return;
          }
          throw modalErr;
        }
      } else if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      } else {
        throw new Error("Unable to load Cashfree checkout. Please try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
      setPhase("failed");
    }
  }

  const busy = phase === "creating" || phase === "opening_gateway" || phase === "simulating" || phase === "verifying";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Payment checkout"
    >
      <div className="flex max-h-[92svh] w-full max-w-lg animate-fade-up flex-col overflow-hidden rounded-t-[28px] bg-paper shadow-2xl sm:rounded-[28px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mute">
              Secure Checkout · {order.orderId}
            </p>
            <p className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {rupees(order.amount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close payment"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white/70 text-ink/80 transition hover:bg-white active:scale-95 disabled:opacity-40"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        {busy ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
            <span className="h-12 w-12 animate-spin-slow rounded-full border-[3px] border-ink/15 border-t-signal" />
            <p className="text-lg font-semibold">
              {phase === "creating"
                ? "Connecting to Cashfree Payments…"
                : phase === "opening_gateway"
                  ? "Opening secure payment window…"
                  : phase === "simulating"
                    ? "Processing test transaction…"
                    : "Confirming and generating your PIN…"}
            </p>
            <p className="max-w-xs text-sm text-mute">
              {phase === "opening_gateway"
                ? "Complete payment in the Cashfree dialog."
                : "Please do not refresh or close this window."}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {phase === "failed" && error && (
              <div className="flex gap-3 rounded-2xl border border-bad/25 bg-red-50 p-4 text-sm" role="alert">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-bad" />
                <div>
                  <p className="font-semibold text-bad">Payment could not be completed</p>
                  <p className="mt-0.5 text-ink/75 leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            {/* Total Payable Card */}
            <div className="rounded-2xl border border-line bg-white p-4 sm:p-5 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[12px] font-semibold uppercase tracking-wider text-mute">Total payable</span>
                <p className="text-xs text-mute mt-0.5">Includes taxes &amp; self-service printing</p>
              </div>
              <span className="text-3xl font-bold tabular-nums tracking-tight text-ink">
                {rupees(order.amount)}
              </span>
            </div>

            {/* Mode Selector */}
            <div>
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-mute">
                Payment method
              </p>
              <div className={`grid ${simulationAllowed ? "grid-cols-2" : "grid-cols-1"} gap-2.5`}>
                {/* Cashfree PG */}
                <button
                  type="button"
                  onClick={() => setMode("cashfree")}
                  className={`flex flex-col items-start rounded-2xl border p-4 text-left transition ${
                    mode === "cashfree"
                      ? "border-ink bg-ink text-white shadow-md"
                      : "border-line bg-white hover:border-ink/30 text-ink"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      mode === "cashfree" ? "bg-amber-400 text-black" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      Live Official Gateway
                    </span>
                    <Icon name="zap" size={17} className={mode === "cashfree" ? "text-amber-400" : "text-signal"} />
                  </div>
                  <span className="mt-2.5 text-[14.5px] font-bold leading-tight">Cashfree Payments</span>
                  <span className={`mt-1 text-[11.5px] leading-tight ${mode === "cashfree" ? "text-white/70" : "text-mute"}`}>
                    Instant UPI QR · Google Pay · PhonePe · Paytm · Cards · NetBanking
                  </span>
                </button>

                {/* Instant Sandbox Simulation (Dev only) */}
                {simulationAllowed && (
                  <button
                    type="button"
                    onClick={() => setMode("instant")}
                    className={`flex flex-col items-start rounded-2xl border p-4 text-left transition ${
                      mode === "instant"
                        ? "border-ink bg-ink text-white shadow-md"
                        : "border-line bg-white hover:border-ink/30 text-ink"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                        mode === "instant" ? "bg-amber-400 text-black" : "bg-blue-50 text-blue-700"
                      }`}>
                        Free Test
                      </span>
                      <Icon name="check" size={17} className={mode === "instant" ? "text-amber-400" : "text-ok"} />
                    </div>
                    <span className="mt-2.5 text-[14.5px] font-bold leading-tight">Dev Sandbox</span>
                    <span className={`mt-1 text-[11.5px] leading-tight ${mode === "instant" ? "text-white/70" : "text-mute"}`}>
                      Simulate payment without real money
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Mode Details Box */}
            {mode === "cashfree" ? (
              <div className="rounded-2xl border border-line bg-white p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-signal/10 text-signal">
                    <Icon name="phone" size={16} />
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-ink">Cashfree PG Production</p>
                    <p className="text-[11.5px] text-mute">Instant QR code scan with Google Pay, PhonePe, Paytm, or Cards</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1 border-t border-line/60 text-[11px] text-mute">
                  <span className="rounded-md bg-paper-2 px-2 py-1 font-medium">⚡ Instant UPI</span>
                  <span className="rounded-md bg-paper-2 px-2 py-1 font-medium">💳 RuPay / Visa / Master</span>
                  <span className="rounded-md bg-paper-2 px-2 py-1 font-medium">🏦 NetBanking</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-line/80 bg-paper-2/60 p-4 text-[13px]">
                  <p className="font-semibold text-ink">Instant Sandbox Simulation</p>
                  <p className="mt-0.5 text-mute leading-relaxed">
                    Instantly marks the order as paid, generates your unique 4-digit collection PIN, and routes you to the live print tracking screen.
                  </p>
                </div>

                <div className="rounded-2xl border border-dashed border-line bg-white/50 p-3.5 text-[12px] text-mute">
                  <label className="flex cursor-pointer items-center gap-2 text-ink/80 select-none">
                    <input
                      type="checkbox"
                      checked={simulateFail}
                      onChange={(e) => setSimulateFail(e.target.checked)}
                      className="h-4 w-4 rounded accent-ink"
                    />
                    Simulate a payment failure (to verify error recovery)
                  </label>
                </div>
              </div>
            )}

            {/* Security note */}
            <div className="flex items-start gap-2.5 rounded-2xl bg-ok-soft p-3.5">
              <Icon name="shield" size={17} className="mt-0.5 shrink-0 text-ok" />
              <p className="text-[12px] leading-relaxed text-ink/80">
                256-bit encrypted. Official Cashfree Payment Gateway integration verified with live Supabase database.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        {!busy && (
          <div className="border-t border-line bg-paper px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            <button
              type="button"
              onClick={handlePay}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-paper shadow-md transition hover:bg-ink-2 active:scale-[0.98]"
            >
              <Icon name="lock" size={17} />
              {phase === "failed" ? "Try Again" : mode === "cashfree" ? `Pay ${rupees(order.amount)} via Cashfree` : `Instant Test Pay · ${rupees(order.amount)}`}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-mute">
              {mode === "cashfree"
                ? "Official Cashfree checkout window will open securely"
                : "Free developer testing mode · No money deducted"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
