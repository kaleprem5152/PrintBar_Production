"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Scaled } from "@/components/kiosk/FitStage";
import { Icon, Logo } from "@/components/ui/Icon";

const ORDER = "PB-2026-00142";
const FAULTS: { v: string; label: string }[] = [
  { v: "ready", label: "Ready" },
  { v: "paper_out", label: "Paper out" },
  { v: "paper_jam", label: "Paper jam" },
  { v: "offline", label: "Offline" },
  { v: "error", label: "Printer error" },
];

const FLOW = ["Payment", "PIN generated", "PIN entered", "Job retrieved", "Printing started", "Completed"];

type Live = { status: string; progress: number; pagesPrinted: number; totalPages: number };

export function DemoClient() {
  const [live, setLive] = useState<Live | null>(null);
  const [printer, setPrinter] = useState("ready");
  const [gen, setGen] = useState(0);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [o, s] = await Promise.all([
          fetch(`/api/orders/${ORDER}?k=demo`, { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/kiosk/status", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setLive(o);
        setPrinter(s.state);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const setFault = useCallback(async (state: string) => {
    setPrinter(state);
    await fetch("/api/kiosk/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
  }, []);

  async function reset() {
    setResetting(true);
    await fetch("/api/demo/reset", { method: "POST" });
    setGen((g) => g + 1);
    setResetting(false);
  }

  const reached =
    !live ? 0 : { paid: 2, pin_accepted: 4, printing: 5, failed: 5, completed: 6 }[live.status as "paid"] ?? 2;

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link href="/"><Logo /></Link>
          <Link href="/print" className="text-sm font-semibold hover:underline">Try the real workflow →</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">Prototype demo</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">One job, two screens.</h1>
        <p className="mt-3 max-w-2xl text-[16px] text-mute">
          The customer&apos;s phone and the kiosk below are two separate apps talking to the same backend. Enter the PIN on the kiosk and watch both update. The printer is a simulator in this prototype.
        </p>

        <div className="mt-8 grid gap-4 rounded-[24px] border border-line bg-white p-5 md:grid-cols-[1fr_auto] md:items-center">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-5">
            {[
              ["Order ID", ORDER],
              ["PIN", "4827"],
              ["Document", "Semester_Notes.pdf"],
              ["Pages · Copies", "30 · 1"],
              ["Mode · Price", "B&W · ₹60"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] font-semibold uppercase tracking-wider text-mute">{k}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={reset} disabled={resetting} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[15px] font-semibold text-paper hover:bg-ink-2 disabled:opacity-50">
            <Icon name="refresh" size={17} /> Reset demo job
          </button>
        </div>

        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Job status">
          {FLOW.map((f, i) => {
            const done = i < reached;
            const cur = i === reached;
            return (
              <li key={f} className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-[13.5px] font-semibold transition ${done ? "border-ok/30 bg-ok-soft text-ok" : cur ? "border-signal/40 bg-signal-soft text-signal" : "border-line bg-white text-mute"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${done ? "bg-ok text-white" : "border border-current"}`}>
                  {done ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}
                </span>
                {f}
              </li>
            );
          })}
        </ol>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[360px_1fr]">
          <div>
            <p className="mb-3 text-sm font-semibold">Customer website</p>
            <div className="mx-auto w-[340px] rounded-[44px] border-[10px] border-[#14161a] bg-[#14161a] shadow-2xl">
              <iframe key={`m${gen}`} title="Customer tracking page" src={`/track/${ORDER}?k=demo&embed=1`} className="h-[680px] w-full rounded-[34px] bg-paper" />
            </div>
          </div>
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">Kiosk touchscreen · 10″ landscape</p>
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="mr-1 text-mute">Printer state:</span>
                {FAULTS.map((f) => (
                  <button
                    key={f.v}
                    type="button"
                    onClick={() => setFault(f.v)}
                    className={`rounded-full border px-3 py-1.5 font-semibold transition ${printer === f.v ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink/40"}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[26px] bg-[#14161a] p-4 shadow-2xl md:p-6">
              <div className="overflow-hidden rounded-[10px]">
                <Scaled>
                  <iframe key={`k${gen}`} title="PrintBar kiosk" src="/kiosk" style={{ width: 1280, height: 800, border: 0 }} />
                </Scaled>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-mute">
              Try PIN <b className="text-ink">4827</b> for the sample job, <b className="text-ink">0000</b> for an expired PIN, or any other PIN for an invalid one. Set the printer to a fault state mid-print to see the error and resume flow.{" "}
              <Link href="/kiosk/gallery" className="font-semibold text-ink underline">See all kiosk screens</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
