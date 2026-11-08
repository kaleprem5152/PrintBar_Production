"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, Logo } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";
import type { PublicOrder } from "@/lib/server/orders";

type O = Omit<PublicOrder, "paidAt" | "expiresAt" | "completedAt"> & { paidAt: string | null; expiresAt: string | null; completedAt: string | null };

const FAIL_TEXT: Record<string, string> = {
  paper_out: "The kiosk is out of paper.",
  paper_jam: "The kiosk reported a paper jam.",
  offline: "The kiosk printer went offline.",
  error: "The printer reported an error.",
};

export function OrderView({ orderId, token, isNew, embed }: { orderId: string; token: string; isNew: boolean; embed: boolean }) {
  const [o, setO] = useState<O | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(isNew ? 0 : 4);
  const lastStatus = useRef("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/orders/${orderId}?k=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("Order not found");
        const j = (await r.json()) as O;
        if (!alive) return;
        setO(j);
        setErr("");
        lastStatus.current = j.status;
        if (j.status !== "completed") timer = setTimeout(tick, j.status === "printing" ? 900 : 1800);
      } catch {
        if (!alive) return;
        setErr("We couldn't load this order. Check your link or connection.");
        timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [orderId, token]);

  useEffect(() => {
    if (!isNew || !o?.pin) return;
    if (revealed >= 4) return;
    const id = setTimeout(() => setRevealed((r) => r + 1), revealed === 0 ? 500 : 320);
    return () => clearTimeout(id);
  }, [isNew, o?.pin, revealed]);

  async function copy() {
    if (!o?.pin) return;
    try {
      await navigator.clipboard.writeText(o.pin);
    } catch {
      const t = document.createElement("textarea");
      t.value = o.pin;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const expired = o?.status === "paid" && o.expiresAt && new Date(o.expiresAt).getTime() < Date.now();

  return (
    <div className="min-h-svh bg-paper">
      {!embed && (
        <header className="border-b border-line/70">
          <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
            <Link href="/" aria-label="PrintBar home">
              <Logo />
            </Link>
            <Link href="/print" className="text-[14px] font-semibold text-ink/70 hover:text-ink">
              New print job
            </Link>
          </div>
        </header>
      )}
      <main className={`mx-auto max-w-3xl px-4 ${embed ? "pb-8 pt-5" : "pb-16 pt-8"}`}>
        {err && !o && (
          <div className="rounded-2xl border border-line bg-white p-6 text-center">
            <Icon name="alert" size={28} className="mx-auto text-warn" />
            <p className="mt-3 font-semibold">{err}</p>
          </div>
        )}
        {!o && !err && <div className="h-64 animate-pulse rounded-[28px] bg-paper-2" />}

        {o && (
          <div className="space-y-5">
            <Heading o={o} expired={!!expired} />

            {o.pin && !expired && (
              <section className="relative overflow-hidden rounded-[28px] bg-ink p-6 text-paper md:p-8" aria-label="Collection PIN">
                <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-signal/25 blur-3xl" />
                <p className="relative text-[12.5px] font-semibold uppercase tracking-[0.16em] text-paper/60">Collection PIN</p>
                <div className="relative mt-4 flex gap-2 sm:gap-2.5 md:gap-3.5" aria-live="polite" aria-label={`Your collection PIN is ${o.pin.split("").join(" ")}`}>
                  {o.pin.split("").map((d, i) => (
                    <div
                      key={i}
                      className={`flex h-[72px] sm:h-[84px] md:h-[104px] flex-1 items-center justify-center rounded-2xl border text-[36px] sm:text-[52px] md:text-[64px] font-semibold tabular-nums transition-all duration-300 ${
                        i < revealed ? "border-paper/25 bg-paper text-ink" : "border-paper/15 bg-paper/10 text-paper/40"
                      }`}
                      style={{ transform: i < revealed ? "none" : "scale(0.94)" }}
                    >
                      {i < revealed ? <span className="animate-pop">{d}</span> : "•"}
                    </div>
                  ))}
                </div>
                <div className="relative mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-sm text-[13px] sm:text-[13.5px] leading-relaxed text-paper/65">
                    Enter this PIN on a PrintBar kiosk to collect your prints. Valid for 24 hours.
                  </p>
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex h-12 w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-full bg-paper px-6 text-[15px] font-semibold text-ink transition active:scale-[0.97]"
                  >
                    <Icon name={copied ? "check" : "copy"} size={17} />
                    {copied ? "Copied" : "Copy PIN"}
                  </button>
                </div>
              </section>
            )}

            {expired && (
              <div className="rounded-2xl border border-bad/25 bg-red-50 p-5 text-[14.5px]">
                <p className="font-semibold text-bad">This PIN has expired.</p>
                <p className="mt-1 text-ink/70">Collection PINs are valid for 24 hours. Please contact PrintBar support for help with this order.</p>
              </div>
            )}

            <section className="rounded-[24px] border border-line bg-white p-5 md:p-6" aria-label="Order details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3">
                <D k="Order ID" v={o.orderId} mono />
                <D k="Total pages" v={`${o.totalPages}`} />
                <D k="Copies" v={`${o.copies}`} />
                <D k="Colour mode" v={o.colorMode === "bw" ? "Black & White" : "Colour"} />
                <D k="Paper" v={`${o.paperSize} · ${o.sides === "single" ? "Single" : "Double"}-sided`} />
                <D k="Paid" v={rupees(o.amount)} />
              </dl>
              <div className="mt-5 border-t border-line pt-4 text-[14px]">
                <p className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-mute">Documents</p>
                {o.docs.map((d) => (
                  <p key={d.name} className="flex justify-between gap-3">
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="shrink-0 text-mute">{d.selected} pages</span>
                  </p>
                ))}
              </div>
            </section>

            {o.status === "paid" && !expired && (
              <section className="rounded-[24px] border border-line bg-white p-5 md:p-6" aria-label="How to collect">
                <h2 className="text-lg font-semibold">Collect at a kiosk</h2>
                <ol className="mt-4 space-y-3 text-[14.5px]">
                  {["Visit any PrintBar kiosk and tap Start Printing.", "Enter your 4-digit collection PIN.", "Confirm your job and collect your prints from the output tray."].map((t, i) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-2 text-[13px] font-semibold">{i + 1}</span>
                      <span className="pt-0.5 text-ink/80">{t}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <Tracker o={o} />

            {o.status === "completed" && (
              <p className="flex items-start gap-2.5 rounded-2xl bg-ok-soft p-4 text-[14px] text-ink/80">
                <Icon name="trash" size={18} className="mt-0.5 shrink-0 text-ok" />
                {o.filesDeleted ? "Printing complete. Your document files have been deleted from PrintBar storage." : "Printing complete."}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Heading({ o, expired }: { o: O; expired: boolean }) {
  const map: Record<string, { badge: string; title: React.ReactNode; tone: string }> = {
    paid: { badge: "Payment successful", title: <>Your print job is <span className="font-display italic font-normal">ready.</span></>, tone: "ok" },
    pin_accepted: { badge: "PIN accepted", title: <>Your job is at the <span className="font-display italic font-normal">kiosk.</span></>, tone: "ok" },
    printing: { badge: "Printing", title: <>Printing <span className="font-display italic font-normal">now.</span></>, tone: "signal" },
    failed: { badge: "Printing paused", title: <>Printing was <span className="font-display italic font-normal">interrupted.</span></>, tone: "warn" },
    completed: { badge: "Completed", title: <>Your prints are <span className="font-display italic font-normal">ready.</span></>, tone: "ok" },
  };
  const m = map[o.status] ?? map.paid;
  const cls = expired ? "bg-red-50 text-bad" : m.tone === "ok" ? "bg-ok-soft text-ok" : m.tone === "signal" ? "bg-signal-soft text-signal" : "bg-amber-100 text-warn";
  return (
    <div>
      <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${cls}`}>
        <Icon name={m.tone === "warn" || expired ? "alert" : "check"} size={15} strokeWidth={2.4} /> {expired ? "PIN expired" : m.badge}
      </span>
      <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">{m.title}</h1>
    </div>
  );
}

function D({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[12.5px] font-semibold uppercase tracking-wider text-mute">{k}</dt>
      <dd className={`mt-1 text-[15.5px] font-semibold ${mono ? "tabular-nums" : ""}`}>{v}</dd>
    </div>
  );
}

const STAGES = ["Payment completed", "Waiting for kiosk", "PIN accepted", "Printing started", "Printing completed"];

function Tracker({ o }: { o: O }) {
  // index of the first stage that is not done yet
  const doneCount = { paid: 1, pin_accepted: 3, printing: 3, failed: 3, completed: 5 }[o.status as "paid"] ?? 1;
  const showProgress = ["printing", "failed", "completed"].includes(o.status);
  const subs: Record<number, string> = {
    1: "Waiting at any PrintBar kiosk for your PIN",
    3: o.status === "pin_accepted" ? "Waiting for you to start printing on the kiosk" : "",
  };

  return (
    <section className="rounded-[24px] border border-line bg-white p-5 md:p-6" aria-label="Live print tracking">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live tracking</h2>
        {o.status !== "completed" && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-mute">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ok" /> Live
          </span>
        )}
      </div>
      <ol className="mt-5">
        {STAGES.map((s, i) => {
          const done = i < doneCount;
          const current = i === doneCount && o.status !== "completed";
          const failed = current && o.status === "failed";
          return (
            <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
              {i < STAGES.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${done ? "bg-ok" : "bg-line"}`} />}
              <span
                className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-white transition-colors ${
                  done ? "border-ok bg-ok" : failed ? "border-warn bg-warn" : current ? "border-signal bg-white" : "border-line bg-white"
                }`}
              >
                {done && <Icon name="check" size={14} strokeWidth={3} />}
                {failed && <Icon name="alert" size={14} />}
                {current && !failed && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal" />}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className={`text-[15px] font-semibold ${done || current ? "" : "text-mute/70"}`}>{s}</p>
                {current && subs[i] && <p className="mt-0.5 text-[13.5px] text-mute">{subs[i]}</p>}
                {i === 3 && showProgress && <Progress o={o} />}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Progress({ o }: { o: O }) {
  const done = o.status === "completed";
  return (
    <div className="mt-3 rounded-2xl bg-paper-2/70 p-4">
      <div className="flex items-center justify-between gap-3 text-[13px] text-mute">
        <span className="truncate">
          Order <b className="font-semibold text-ink">{o.orderId}</b>
        </span>
        <span className="truncate">{o.currentDocument ?? o.docs[0]?.name}</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-linear ${o.status === "failed" ? "bg-warn" : done ? "bg-ok" : "bg-signal"}`} style={{ width: `${o.progress}%` }} />
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <p className="text-[15px] font-semibold tabular-nums">
          {o.pagesPrinted} / {o.totalPages} pages printed
        </p>
        <p className="text-[15px] font-semibold tabular-nums">{o.progress}% completed</p>
      </div>
      <p className="mt-0.5 text-[13.5px] text-mute tabular-nums">{o.pagesRemaining} pages remaining</p>
      {o.status === "failed" && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[13.5px] text-ink/80" role="status">
          {FAIL_TEXT[o.failureReason ?? "error"] ?? FAIL_TEXT.error} Your job is saved and will resume from page {o.pagesPrinted + 1} when the kiosk is ready.
        </p>
      )}
    </div>
  );
}
