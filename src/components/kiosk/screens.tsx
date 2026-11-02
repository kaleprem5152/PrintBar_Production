"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon, type IconName } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";
import { MachineSVG } from "./Machine";
import type { ErrorKind, KOrder, PrinterState } from "./types";

const INK = "#0f1217";

/* ---------- Shell ---------- */

const PRINTER_CHIP: Record<PrinterState | "printing", { text: string; dot: string; bg: string }> = {
  ready: { text: "Printer ready", dot: "#14925f", bg: "#e8f6ef" },
  printing: { text: "Printing", dot: "#f2542d", bg: "#fff0ea" },
  paper_out: { text: "Out of paper", dot: "#d98a00", bg: "#fff4dc" },
  paper_jam: { text: "Paper jam", dot: "#d6342c", bg: "#fdecea" },
  offline: { text: "Printer offline", dot: "#d6342c", bg: "#fdecea" },
  error: { text: "Printer error", dot: "#d6342c", bg: "#fdecea" },
};

export function Shell({ printer = "ready", printing, children }: { printer?: PrinterState; printing?: boolean; children: React.ReactNode }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const on = () => setTime(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }));
    on();
    const id = setInterval(on, 15000);
    return () => clearInterval(id);
  }, []);
  const chip = PRINTER_CHIP[printing && printer === "ready" ? "printing" : printer];
  return (
    <div className="flex h-[800px] w-[1280px] flex-col bg-white text-[#0f1217]" style={{ fontFamily: "var(--font-sans)", touchAction: "manipulation" }}>
      <header className="flex h-[84px] shrink-0 items-center justify-between border-b border-[#e3e5e9] px-12">
        <div className="flex items-center gap-4">
          <svg width="42" height="42" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="#101216" />
            <rect x="8" y="9" width="11" height="3" rx="1.5" fill="#fff" />
            <rect x="8" y="15" width="16" height="3" rx="1.5" fill="#fff" />
            <rect x="8" y="21" width="8" height="3" rx="1.5" fill="#fff" />
            <circle cx="24" cy="10.5" r="2.6" fill="#f2542d" />
          </svg>
          <span className="text-[30px] font-semibold tracking-tight">PrintBar</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-3 rounded-full px-5 py-2.5 text-[20px] font-semibold" style={{ background: chip.bg }}>
            <span className="h-3 w-3 rounded-full" style={{ background: chip.dot, animation: chip.text === "Printing" ? "blink 1s infinite" : undefined }} />
            {chip.text}
          </span>
          <span className="w-[72px] text-right text-[22px] font-medium tabular-nums text-[#6b717c]">{time}</span>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "accent";
  disabled?: boolean;
  className?: string;
  icon?: IconName;
}) {
  const v =
    variant === "primary"
      ? "bg-[#0f1217] text-white active:bg-[#2a2e36]"
      : variant === "accent"
        ? "bg-[#f2542d] text-white active:bg-[#d84420]"
        : "border-2 border-[#d4d7dc] bg-white text-[#0f1217] active:bg-[#f1f2f4]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-4 rounded-[24px] px-10 font-semibold transition-transform active:scale-[0.98] disabled:opacity-30 ${/\bh-\[/.test(className) ? "" : "h-[96px]"} ${/\btext-\[/.test(className) ? "" : "text-[32px]"} ${v} ${className}`}
    >
      {children}
      {icon && <Icon name={icon} size={32} strokeWidth={2.2} />}
    </button>
  );
}

/* ---------- 01 Idle ---------- */

export function IdleScreen({ printer = "ready", onStart, url }: { printer?: PrinterState; onStart?: () => void; url: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 0, color: { dark: INK, light: "#0000" } })
      .then(setSvg)
      .catch(() => {});
  }, [url]);
  return (
    <Shell printer={printer}>
      <div className="grid h-full grid-cols-[1.15fr_0.85fr] gap-14 px-12 py-10">
        <div className="flex flex-col justify-center">
          <p className="text-[22px] font-semibold uppercase tracking-[0.18em] text-[#f2542d]">Self-service printing</p>
          <h1 className="mt-5 text-[96px] font-semibold leading-[0.98] tracking-tight">Welcome to PrintBar</h1>
          <p className="mt-7 max-w-[600px] text-[32px] leading-snug text-[#5b616b]">Already paid online? Enter your collection PIN.</p>
          <div className="mt-12 flex items-center gap-6">
            <Btn onClick={onStart} variant="primary" className="animate-breathe h-[112px] min-w-[420px] text-[38px]" icon="arrow">
              Start Printing
            </Btn>
          </div>
          <p className="mt-8 flex items-center gap-3 text-[22px] text-[#6b717c]">
            <span className="font-semibold text-[#0f1217]">₹2</span> black &amp; white <span className="mx-1 text-[#c7cad0]">|</span>
            <span className="font-semibold text-[#0f1217]">₹8</span> colour <span className="text-[#9aa0a9]">per page</span>
          </p>
        </div>
        <div className="flex flex-col items-center justify-center">
          <div className="w-full rounded-[36px] border-2 border-[#e3e5e9] bg-[#f6f7f9] p-9 text-center">
            <p className="text-[22px] font-semibold uppercase tracking-[0.14em] text-[#6b717c]">No file yet?</p>
            <div className="mx-auto mt-6 h-[250px] w-[250px] rounded-[24px] bg-white p-5 shadow-sm">
              <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code to the PrintBar website" role="img" />
            </div>
            <p className="mt-7 text-[30px] font-semibold leading-tight">Scan to upload &amp; pay</p>
            <p className="mt-2 text-[21px] text-[#6b717c]">Then come back with your 4-digit PIN</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ---------- 02 PIN entry ---------- */

export type PinUiState = "entering" | "checking" | "invalid" | "ok" | "locked";

export function PinScreen({
  digits,
  state = "entering",
  attemptsLeft,
  printer = "ready",
  onKey,
  onBackspace,
  onClear,
  onConfirm,
  onCancel,
}: {
  digits: string;
  state?: PinUiState;
  attemptsLeft?: number;
  printer?: PrinterState;
  onKey?: (d: string) => void;
  onBackspace?: () => void;
  onClear?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const locked = state === "checking" || state === "ok" || state === "locked";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const keyCls =
    "flex h-[104px] items-center justify-center rounded-[24px] bg-[#f1f2f5] text-[48px] font-semibold transition active:scale-[0.96] active:bg-[#dfe2e7] disabled:opacity-40";
  const bad = state === "invalid";
  return (
    <Shell printer={printer}>
      <div className="grid h-full grid-cols-[1fr_540px] gap-14 px-12 py-8">
        <div className="flex flex-col justify-center">
          <button type="button" onClick={onCancel} className="mb-8 flex w-fit items-center gap-3 rounded-full border-2 border-[#d4d7dc] px-7 py-3.5 text-[24px] font-semibold active:bg-[#f1f2f4]">
            <Icon name="chevL" size={26} strokeWidth={2.4} /> Back
          </button>
          <h1 className="text-[64px] font-semibold leading-[1.02] tracking-tight">Enter Your Collection PIN</h1>
          <p className="mt-4 text-[26px] text-[#5b616b]">Use the 4-digit PIN shown on your phone after payment.</p>
          <div className={`mt-10 flex gap-5 ${bad ? "animate-shake" : ""}`} key={bad ? "bad" : "ok"} aria-label="PIN">
            {[0, 1, 2, 3].map((i) => {
              const filled = i < digits.length;
              const current = i === digits.length && state === "entering";
              return (
                <div
                  key={i}
                  className="relative flex h-[148px] w-[118px] items-center justify-center rounded-[26px] border-[3px] bg-[#f6f7f9] transition-colors"
                  style={{ borderColor: bad ? "#d6342c" : state === "ok" ? "#14925f" : current ? "#f2542d" : filled ? "#0f1217" : "#dfe2e7", background: bad ? "#fdf1f0" : state === "ok" ? "#eaf7f1" : undefined }}
                >
                  {filled && <span className="animate-pop block h-[30px] w-[30px] rounded-full" style={{ background: bad ? "#d6342c" : state === "ok" ? "#14925f" : INK }} />}
                  {current && <span className="absolute bottom-7 h-[4px] w-9 rounded bg-[#f2542d]" style={{ animation: "blink 1s infinite" }} />}
                </div>
              );
            })}
          </div>
          <div className="mt-8 h-[64px] text-[28px] font-medium" role="status" aria-live="polite">
            {state === "invalid" && (
              <p className="flex items-center gap-3 text-[#d6342c]">
                <Icon name="alert" size={32} /> PIN not recognised.{attemptsLeft != null && attemptsLeft > 0 ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` : ""}
              </p>
            )}
            {state === "checking" && (
              <p className="flex items-center gap-3 text-[#5b616b]">
                <span className="h-7 w-7 animate-spin-slow rounded-full border-[3px] border-[#d4d7dc] border-t-[#0f1217]" /> Checking your PIN…
              </p>
            )}
            {state === "ok" && (
              <p className="flex items-center gap-3 text-[#14925f]">
                <Icon name="check" size={34} strokeWidth={3} /> PIN verified
              </p>
            )}
            {state === "locked" && (
              <p className="flex items-center gap-3 text-[#d6342c]">
                <Icon name="lock" size={30} /> Too many attempts. Please wait a minute.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col justify-center">
          <div className="grid grid-cols-3 gap-4">
            {keys.map((k) => (
              <button key={k} type="button" disabled={locked} onClick={() => onKey?.(k)} className={keyCls}>
                {k}
              </button>
            ))}
            <button type="button" disabled={locked || !digits} onClick={onClear} className={`${keyCls} text-[28px]`}>
              Clear
            </button>
            <button type="button" disabled={locked} onClick={() => onKey?.("0")} className={keyCls}>
              0
            </button>
            <button type="button" disabled={locked || !digits} onClick={onBackspace} className={keyCls} aria-label="Backspace">
              <Icon name="backspace" size={44} strokeWidth={2} />
            </button>
          </div>
          <Btn variant="accent" disabled={locked || digits.length !== 4} onClick={onConfirm} className="mt-5 h-[104px] w-full text-[36px]" icon="check">
            Confirm
          </Btn>
        </div>
      </div>
    </Shell>
  );
}

/* ---------- 03 Retrieved job ---------- */

export function RetrievedScreen({ order, printer = "ready", onStart, onCancel }: { order: KOrder; printer?: PrinterState; onStart?: () => void; onCancel?: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ["Order ID", <span key="o" className="tabular-nums">{order.orderId}</span>],
    ["Total pages", `${order.pagesPerCopy}`],
    ["Copies", `${order.copies}`],
    [
      "Print mode",
      <span key="m" className="inline-flex items-center gap-3">
        <span className={`h-6 w-6 rounded-full ${order.colorMode === "color" ? "cmy-gradient" : "bg-gradient-to-r from-black to-white ring-2 ring-[#0f1217]/20"}`} />
        {order.colorMode === "bw" ? "Black & White" : "Colour"}
      </span>,
    ],
    ["Paper size", order.paperSize],
    ["Printing sides", order.sides === "single" ? "Single-sided" : "Double-sided"],
  ];
  return (
    <Shell printer={printer}>
      <div className="grid h-full grid-cols-[1fr_440px] gap-12 px-12 py-8">
        <div className="flex flex-col justify-center">
          <p className="mb-3 flex w-fit items-center gap-2.5 rounded-full bg-[#e8f6ef] px-5 py-2 text-[22px] font-semibold text-[#14925f]">
            <Icon name="check" size={24} strokeWidth={3} /> PIN verified
          </p>
          <h1 className="text-[60px] font-semibold leading-none tracking-tight">We found your print job</h1>
          <div className="mt-7 rounded-[28px] border-2 border-[#e3e5e9] bg-[#f8f9fa]">
            <div className="border-b-2 border-[#e3e5e9] px-8 py-5">
              <p className="text-[18px] font-semibold uppercase tracking-[0.12em] text-[#6b717c]">{order.docs.length === 1 ? "Document" : `Documents · ${order.docs.length}`}</p>
              {order.docs.map((d) => (
                <div key={d.name} className="mt-1.5 flex items-center justify-between gap-6 text-[28px] font-semibold">
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon name="file" size={28} className="shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="shrink-0 text-[24px] font-medium text-[#6b717c]">{d.selected} pages</span>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-3 gap-x-8 gap-y-5 px-8 py-6">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[20px] text-[#6b717c]">{k}</dt>
                  <dd className="mt-0.5 whitespace-nowrap text-[27px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-5">
          <div className="rounded-[28px] bg-[#0f1217] p-9 text-white">
            <p className="text-[20px] font-semibold uppercase tracking-[0.14em] text-white/60">Price paid</p>
            <p className="mt-2 text-[88px] font-semibold leading-none tabular-nums tracking-tight">{rupees(order.amount)}</p>
            <p className="mt-3 text-[20px] text-white/60">Paid online · nothing more to pay</p>
          </div>
          <Btn variant="accent" onClick={onStart} className="h-[116px] w-full text-[38px]" icon="arrow">
            Start Printing
          </Btn>
          <Btn variant="ghost" onClick={onCancel} className="h-[80px] w-full text-[26px]">
            Cancel
          </Btn>
        </div>
      </div>
    </Shell>
  );
}

/* ---------- 04 Printing ---------- */

export function PrintingScreen({ order, printer = "ready" }: { order: KOrder; printer?: PrinterState }) {
  const segs = 25;
  const on = Math.round((order.progress / 100) * segs);
  return (
    <Shell printer={printer} printing>
      <div className="grid h-full grid-cols-[1fr_380px] gap-8 px-12 py-8">
        <div className="flex flex-col justify-center">
          <p className="text-[22px] font-semibold uppercase tracking-[0.14em] text-[#6b717c]">
            Order <span className="tabular-nums text-[#0f1217]">{order.orderId}</span>
          </p>
          <h1 className="mt-3 flex items-center gap-4 text-[44px] font-semibold tracking-tight">
            <Icon name="file" size={42} />
            <span className="truncate">{order.currentDocument ?? order.docs[0]?.name}</span>
          </h1>
          <div className="mt-6 flex items-end gap-3">
            <span className="text-[190px] font-semibold leading-[0.85] tabular-nums tracking-tighter">{order.progress}</span>
            <span className="pb-3 text-[72px] font-semibold text-[#9aa0a9]">%</span>
            <span className="mb-4 ml-4 text-[28px] font-medium text-[#6b717c]">completed</span>
          </div>
          <div className="mt-8 flex gap-[5px]" role="progressbar" aria-valuenow={order.progress} aria-valuemin={0} aria-valuemax={100}>
            {Array.from({ length: segs }).map((_, i) => (
              <span key={i} className="h-[34px] flex-1 rounded-[5px] transition-colors duration-500" style={{ background: i < on ? "#f2542d" : "#e8eaee" }} />
            ))}
          </div>
          <div className="mt-8 flex items-baseline gap-10">
            <p className="text-[40px] font-semibold tabular-nums">
              {order.pagesPrinted} / {order.totalPages} <span className="text-[30px] font-medium text-[#5b616b]">pages printed</span>
            </p>
          </div>
          <p className="mt-1 text-[32px] text-[#6b717c] tabular-nums">{order.pagesRemaining} pages remaining</p>
          <p className="mt-6 flex items-center gap-3 text-[24px] text-[#5b616b]">
            <span className="h-3.5 w-3.5 rounded-full bg-[#f2542d]" style={{ animation: "blink 1s infinite" }} /> Please wait. Do not touch the paper while printing.
          </p>
        </div>
        <div className="flex items-center justify-center rounded-[36px] bg-gradient-to-b from-[#f6f7f9] to-[#e9ebee]">
          <MachineSVG progress={order.progress / 100} printing state={printer} height={560} />
        </div>
      </div>
    </Shell>
  );
}

/* ---------- 05 Completed ---------- */

export function CompletedScreen({ order, onDone, secondsLeft }: { order: KOrder; onDone?: () => void; secondsLeft?: number }) {
  return (
    <Shell printer="ready">
      <div className="flex h-full flex-col items-center justify-center px-12 text-center">
        <div className="animate-pop flex h-[116px] w-[116px] items-center justify-center rounded-full bg-[#14925f] text-white" style={{ animation: "pop .5s cubic-bezier(.2,1.4,.4,1) both, pulse-ring 1.6s ease-out 2" }}>
          <Icon name="check" size={66} strokeWidth={2.8} />
        </div>
        <h1 className="mt-7 text-[76px] font-semibold leading-none tracking-tight">Your documents are ready!</h1>
        <p className="mt-4 text-[32px] text-[#5b616b]">Please collect your prints from the output tray.</p>
        <div className="mt-7 flex gap-5">
          {[
            ["Total pages", String(order.totalPages)],
            ["Copies", String(order.copies)],
            ["Order", order.orderId],
          ].map(([k, v]) => (
            <div key={k} className="min-w-[200px] rounded-[22px] border-2 border-[#e3e5e9] bg-[#f8f9fa] px-8 py-4 text-left">
              <p className="text-[18px] font-semibold uppercase tracking-[0.1em] text-[#6b717c]">{k}</p>
              <p className="mt-1 text-[34px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <Btn onClick={onDone} className="mt-8 h-[100px] min-w-[360px] text-[38px]">
          Done
        </Btn>
        {secondsLeft != null && <p className="mt-4 text-[20px] text-[#9aa0a9]">Returning to start in {secondsLeft}s</p>}
      </div>
    </Shell>
  );
}

/* ---------- 06 Errors ---------- */

const ERR: Record<
  ErrorKind,
  { icon: IconName; title: string; msg: string; tone: string; soft: string; primary?: string; secondary?: string; printer?: PrinterState }
> = {
  invalid_pin: { icon: "x", title: "PIN not recognised", msg: "Please check the PIN on your phone, then try again.", tone: "#d6342c", soft: "#fdecea", primary: "Try again", secondary: "Back to start" },
  expired_pin: { icon: "clock", title: "This PIN has expired", msg: "Collection PINs are valid for 24 hours. Please create a new print job on the PrintBar website.", tone: "#d98a00", soft: "#fff4dc", primary: "Back to start" },
  printer_offline: { icon: "ban", title: "Printer is offline", msg: "This kiosk can't print right now. Please try another PrintBar kiosk, or ask a member of staff.", tone: "#d6342c", soft: "#fdecea", primary: "Check again", printer: "offline" },
  paper_out: { icon: "file", title: "Out of paper", msg: "This kiosk has run out of paper. Staff will refill it soon. Your job is saved and will not be lost.", tone: "#d98a00", soft: "#fff4dc", primary: "Check again", printer: "paper_out" },
  paper_jam: { icon: "alert", title: "Paper jam", msg: "Please don't pull the paper. Staff have been alerted. Your job is saved and will continue once it's cleared.", tone: "#d6342c", soft: "#fdecea", primary: "Check again", printer: "paper_jam" },
  network: { icon: "wifi", title: "No connection", msg: "We can't reach PrintBar right now. Reconnecting automatically…", tone: "#6b717c", soft: "#eef0f3", primary: "Try now" },
  print_failed: { icon: "alert", title: "Printing failed", msg: "Something went wrong while printing. Your payment is safe and your job is saved.", tone: "#d6342c", soft: "#fdecea", primary: "Try again", secondary: "Back to start", printer: "error" },
};

export function ErrorScreen({
  kind,
  order,
  message,
  onPrimary,
  onSecondary,
  busy,
}: {
  kind: ErrorKind;
  order?: KOrder | null;
  message?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  busy?: boolean;
}) {
  const e = ERR[kind];
  return (
    <Shell printer={e.printer ?? "ready"}>
      <div className="flex h-full flex-col items-center justify-center px-24 text-center">
        <div className="flex h-[150px] w-[150px] items-center justify-center rounded-full" style={{ background: e.soft, color: e.tone }}>
          {kind === "network" ? <span className="h-[70px] w-[70px] animate-spin-slow rounded-full border-[7px] border-[#d4d7dc] border-t-[#6b717c]" /> : <Icon name={e.icon} size={76} strokeWidth={2.2} />}
        </div>
        <h1 className="mt-9 text-[76px] font-semibold leading-none tracking-tight">{e.title}</h1>
        <p className="mt-6 max-w-[900px] text-[32px] leading-snug text-[#5b616b]">{message ?? e.msg}</p>
        {order && (kind === "paper_out" || kind === "paper_jam" || kind === "printer_offline" || kind === "print_failed") && (
          <p className="mt-6 rounded-full bg-[#f1f2f5] px-7 py-3 text-[24px] font-medium tabular-nums text-[#3b4048]">
            Job {order.orderId} saved · {order.pagesPrinted} of {order.totalPages} pages printed
          </p>
        )}
        <div className="mt-11 flex gap-5">
          {e.primary && (
            <Btn variant="primary" onClick={onPrimary} disabled={busy} className="h-[104px] min-w-[320px] text-[34px]" icon={kind === "network" || e.printer ? "refresh" : undefined}>
              {busy ? "Checking…" : e.primary}
            </Btn>
          )}
          {e.secondary && (
            <Btn variant="ghost" onClick={onSecondary} className="h-[104px] min-w-[280px] text-[30px]">
              {e.secondary}
            </Btn>
          )}
        </div>
        <p className="mt-8 text-[22px] text-[#9aa0a9]">Need help? Please ask a member of staff.</p>
      </div>
    </Shell>
  );
}
