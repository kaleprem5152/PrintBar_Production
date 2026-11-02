"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";

type Method = "upi" | "card" | "netbanking";
type Phase = "idle" | "processing" | "verifying" | "failed";

const BANKS = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "Punjab National Bank"];

export function PaymentSheet({
  order,
  onClose,
  onPaid,
}: {
  order: { orderId: string; token: string; amount: number };
  onClose: () => void;
  onPaid: () => void;
}) {
  const [method, setMethod] = useState<Method>("upi");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [upi, setUpi] = useState("");
  const [card, setCard] = useState({ number: "", exp: "", cvv: "", name: "" });
  const [bank, setBank] = useState(BANKS[0]);
  const [fail, setFail] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const valid =
    method === "upi"
      ? /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi.trim())
      : method === "card"
        ? card.number.replace(/\s/g, "").length >= 15 && /^\d{2}\/\d{2}$/.test(card.exp) && card.cvv.length >= 3 && card.name.trim().length > 1
        : !!bank;

  async function pay() {
    setTouched(true);
    if (!valid) return;
    setError("");
    setPhase("processing");
    try {
      const r = await fetch("/api/payments/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, token: order.token, method, simulate: fail ? "failure" : "success" }),
      });
      const g = await r.json();
      if (!r.ok) throw new Error(g.error || "Payment failed.");
      setPhase("verifying");
      const v = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, token: order.token, paymentId: g.paymentId, signature: g.signature }),
      });
      const j = await v.json();
      if (!v.ok) throw new Error(j.error || "We couldn't verify this payment.");
      onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed.");
      setPhase("failed");
    }
  }

  const busy = phase === "processing" || phase === "verifying";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/55 backdrop-blur-sm md:items-center" role="dialog" aria-modal="true" aria-label="Payment">
      <div className="flex max-h-[94svh] w-full max-w-lg animate-fade-up flex-col overflow-hidden rounded-t-[28px] bg-paper shadow-2xl md:rounded-[28px]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-mute">Pay securely · {order.orderId}</p>
            <p className="text-2xl font-semibold tracking-tight">{rupees(order.amount)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close payment" className="flex h-10 w-10 items-center justify-center rounded-full border border-line disabled:opacity-40">
            <Icon name="x" size={18} />
          </button>
        </div>

        {busy ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <span className="h-12 w-12 animate-spin-slow rounded-full border-[3px] border-ink/15 border-t-signal" />
            <p className="text-lg font-semibold">{phase === "processing" ? "Processing payment…" : "Verifying your payment…"}</p>
            <p className="max-w-xs text-sm text-mute">
              {phase === "processing" ? "Please don't close this window or press back." : "Confirming with PrintBar before generating your PIN."}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {phase === "failed" && (
              <div className="mb-5 flex gap-3 rounded-2xl border border-bad/25 bg-red-50 p-4 text-sm" role="alert">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-bad" />
                <div>
                  <p className="font-semibold text-bad">Payment unsuccessful</p>
                  <p className="mt-0.5 text-ink/70">{error} You can try again or use another method.</p>
                </div>
              </div>
            )}

            <div role="tablist" aria-label="Payment method" className="grid grid-cols-3 gap-2 rounded-2xl bg-paper-2 p-1">
              {(
                [
                  ["upi", "UPI"],
                  ["card", "Cards"],
                  ["netbanking", "Net banking"],
                ] as [Method, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={method === m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`h-11 rounded-xl text-[14px] font-semibold transition ${method === m ? "bg-white shadow-sm" : "text-mute"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              {method === "upi" && (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center text-[13px] font-medium">
                    {["Google Pay", "PhonePe", "Paytm"].map((a) => (
                      <button key={a} type="button" onClick={() => setUpi((u) => u || "name@upi")} className="rounded-xl border border-line bg-white py-3 hover:border-ink/40">
                        {a}
                      </button>
                    ))}
                  </div>
                  <Field label="UPI ID" value={upi} onChange={setUpi} placeholder="yourname@bank" error={touched && !valid ? "Enter a valid UPI ID, e.g. name@okbank" : ""} />
                </>
              )}
              {method === "card" && (
                <>
                  <Field
                    label="Card number"
                    value={card.number}
                    onChange={(v) => setCard({ ...card, number: v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim() })}
                    placeholder="1234 5678 9012 3456"
                    inputMode="numeric"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Expiry"
                      value={card.exp}
                      onChange={(v) => {
                        const d = v.replace(/\D/g, "").slice(0, 4);
                        setCard({ ...card, exp: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d });
                      }}
                      placeholder="MM/YY"
                      inputMode="numeric"
                    />
                    <Field label="CVV" value={card.cvv} onChange={(v) => setCard({ ...card, cvv: v.replace(/\D/g, "").slice(0, 4) })} placeholder="•••" inputMode="numeric" />
                  </div>
                  <Field label="Name on card" value={card.name} onChange={(v) => setCard({ ...card, name: v })} placeholder="As printed on card" error={touched && !valid ? "Please complete all card details" : ""} />
                </>
              )}
              {method === "netbanking" && (
                <div role="radiogroup" aria-label="Bank" className="grid gap-2">
                  {BANKS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      aria-checked={bank === b}
                      onClick={() => setBank(b)}
                      className={`flex h-12 items-center justify-between rounded-xl border px-4 text-left text-[14.5px] font-medium ${bank === b ? "border-ink bg-white" : "border-line bg-white/60"}`}
                    >
                      {b}
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${bank === b ? "border-ink bg-ink text-white" : "border-line"}`}>
                        {bank === b && <Icon name="check" size={12} strokeWidth={3} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-line bg-white/60 p-3.5 text-[12.5px] leading-relaxed text-mute">
              <p>
                <b className="text-ink">Prototype gateway.</b> No real money is charged. In production this step is replaced by Razorpay or Easebuzz checkout, and the PIN is issued only after the server verifies the payment signature.
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-ink/80">
                <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} className="h-4 w-4 accent-ink" />
                Simulate a failed payment
              </label>
            </div>
          </div>
        )}

        {!busy && (
          <div className="border-t border-line bg-paper px-5 pb-5 pt-4">
            <button type="button" onClick={pay} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-paper transition hover:bg-ink-2 active:scale-[0.99]">
              <Icon name="lock" size={17} />
              {phase === "failed" ? "Try again" : "Pay"} {rupees(order.amount)}
            </button>
            <p className="mt-3 text-center text-[12px] text-mute">UPI · Debit &amp; credit cards · Net banking</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-mute">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={!!error}
        className={`h-12 w-full rounded-xl border bg-white px-4 text-[15px] outline-none focus:ring-2 ${error ? "border-bad focus:ring-bad/20" : "border-line focus:border-ink focus:ring-ink/10"}`}
      />
      {error && <span className="mt-1 block text-[12.5px] text-bad">{error}</span>}
    </label>
  );
}
