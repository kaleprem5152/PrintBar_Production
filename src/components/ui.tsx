"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import type { Tone } from "@/lib/constants";
import { relTime, istDateKey } from "@/lib/format";
import type { ApiErr } from "@/lib/client";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ───────────── icons ───────────── */
const P: Record<string, string[]> = {
  overview: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  jobs: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"],
  printer: ["M6 9V2h12v7", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 14h12v8H6z"],
  kiosk: ["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4"],
  payments: ["M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M1 10h22"],
  pricing: ["M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z", "M7 7h.01"],
  inventory: ["M16.5 9.4 7.5 4.21", "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.27 6.96 12 12.01l8.73-5.05", "M12 22.08V12"],
  analytics: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  bell: ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  users: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  audit: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  settings: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  menu: ["M3 12h18", "M3 6h18", "M3 18h18"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.35-4.35"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
  alert: ["M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  check: ["M20 6 9 17l-5-5"],
  checkCircle: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "M22 4 12 14.01l-3-3"],
  xCircle: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m15 9-6 6", "m9 9 6 6"],
  zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  pause: ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  play: ["M5 3l14 9-14 9V3z"],
  wrench: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"],
  power: ["M18.36 6.64a9 9 0 1 1-12.73 0", "M12 2v10"],
  wifi: ["M5 12.55a11 11 0 0 1 14.08 0", "M1.42 9a16 16 0 0 1 21.16 0", "M8.53 16.11a6 6 0 0 1 6.95 0", "M12 20h.01"],
  wifiOff: ["M1 1l22 22", "M16.72 11.06A10.94 10.94 0 0 1 19 12.55", "M5 12.55a10.94 10.94 0 0 1 5.17-2.39", "M10.71 5.05A16 16 0 0 1 22.58 9", "M1.42 9a15.91 15.91 0 0 1 4.7-2.88", "M8.53 16.11a6 6 0 0 1 6.95 0", "M12 20h.01"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  plus: ["M12 5v14", "M5 12h14"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  cpu: ["M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M9 9h6v6H9z", "M9 1v3", "M15 1v3", "M9 20v3", "M15 20v3", "M20 9h3", "M20 14h3", "M1 9h3", "M1 14h3"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  retry: ["M1 4v6h6", "M3.51 15a9 9 0 1 0 2.13-9.36L1 10"],
  ban: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m4.93 4.93 14.14 14.14"],
  undo: ["M3 7v6h6", "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"],
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  trending: ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  rupee: ["M6 3h12", "M6 8h12", "M9 13H6", "M6 13h3c6.667 0 6.667-10 0-10", "M6 13l8.5 8"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
  activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  sort: ["m7 15 5 5 5-5", "m7 9 5-5 5 5"],
};
export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.9 }: { name: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={cx("shrink-0", className)} aria-hidden="true">
      {(P[name] ?? P.info).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/* ───────────── tones ───────────── */
export const TONE: Record<Tone, { badge: string; dot: string; text: string; soft: string; bar: string }> = {
  neutral: { badge: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400", text: "text-slate-600", soft: "bg-slate-50", bar: "bg-slate-400" },
  slate: { badge: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400", text: "text-slate-600", soft: "bg-slate-50", bar: "bg-slate-400" },
  blue: { badge: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500", text: "text-blue-600", soft: "bg-blue-50", bar: "bg-blue-500" },
  green: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", text: "text-emerald-600", soft: "bg-emerald-50", bar: "bg-emerald-500" },
  amber: { badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", text: "text-amber-600", soft: "bg-amber-50", bar: "bg-amber-500" },
  red: { badge: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", text: "text-red-600", soft: "bg-red-50", bar: "bg-red-500" },
  violet: { badge: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", text: "text-violet-600", soft: "bg-violet-50", bar: "bg-violet-500" },
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone].badge, className)}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", TONE[tone].dot, pulse && "live-dot", TONE[tone].text)} />;
}

/* ───────────── buttons ───────────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "dark" | "warn";
  size?: "md" | "sm";
  loading?: boolean;
  icon?: string;
};
const VARIANT = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-blue-600/20",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  warn: "bg-amber-500 text-white hover:bg-amber-600 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
  dark: "bg-navy-800 text-white hover:bg-navy-700",
};
export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        size === "md" ? "min-h-11 px-4 text-sm" : "min-h-11 px-3 text-sm md:min-h-9 md:text-[13px]",
        VARIANT[variant],
        className,
      )}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon ? <Icon name={icon} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cx("inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 active:scale-95 md:h-9 md:w-9", className)}>
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

/* ───────────── layout bits ───────────── */
export function Card({ title, subtitle, action, children, className, padded = true, id }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 md:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cx(padded && "p-4 md:p-5", !!title && padded && "pt-3")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx("mt-0.5 break-words text-sm text-slate-900", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

export function Notice({ tone = "blue", title, children, icon }: { tone?: Tone; title?: string; children?: ReactNode; icon?: string }) {
  return (
    <div className={cx("flex gap-3 rounded-lg border p-3 text-sm", TONE[tone].soft, tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : tone === "green" ? "border-emerald-200" : "border-blue-200")}>
      <Icon name={icon ?? (tone === "red" || tone === "amber" ? "alert" : "info")} className={cx("mt-0.5 h-4 w-4", TONE[tone].text)} />
      <div className="min-w-0 text-slate-700">
        {title && <p className="font-medium text-slate-900">{title}</p>}
        {children && <div className={cx(title && "mt-0.5", "text-[13px] leading-relaxed")}>{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

export function EmptyState({ icon = "search", title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name={icon} className="h-6 w-6" /></div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: ApiErr | Error | null; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-500"><Icon name="alert" className="h-6 w-6" /></div>
      <p className="text-sm font-medium text-slate-900">{(error as ApiErr)?.status === 403 ? "You don't have access to this" : "Couldn't load data"}</p>
      <p className="mt-1 max-w-sm text-[13px] text-slate-500">{error?.message}</p>
      {retry && <Button className="mt-4" size="sm" icon="refresh" onClick={retry}>Try again</Button>}
    </div>
  );
}

/* ───────────── form controls ───────────── */
const fieldCls = "block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 md:min-h-10";
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(fieldCls, className)} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(fieldCls, "pr-8", className)}>{children}</select>;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(fieldCls, "min-h-24 py-2", className)} />;
}
export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand-600" : "bg-slate-300")}
      >
        <span className={cx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-lg bg-slate-100 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-9 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition md:min-h-8", value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div role="tablist" className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cx("-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition", value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {t.label}
            {!!t.badge && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{t.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative min-w-0 flex-1 md:max-w-xs">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input type="search" inputMode="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

/* ───────────── modal / bottom-sheet ───────────── */
export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "md:max-w-md", md: "md:max-w-lg", lg: "md:max-w-2xl", xl: "md:max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx("relative flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-2xl bg-white shadow-2xl md:max-h-[88vh] md:rounded-2xl", w)}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 md:hidden" />
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 md:px-6">
          <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">{children}</div>
        {footer && <footer className="pb-safe flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end md:px-6">{footer}</footer>}
      </div>
    </div>
  );
}

/* ───────────── toast + confirm ───────────── */
type ToastItem = { id: number; tone: "success" | "error" | "info"; text: string };
type ConfirmOpts = { title: string; message?: ReactNode; confirmLabel?: string; tone?: "danger" | "primary" | "warn"; requireText?: string };
const UiCtx = createContext<{ toast: (tone: ToastItem["tone"], text: string) => void; confirm: (o: ConfirmOpts) => Promise<boolean> } | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const idRef = useRef(0);
  const toast = useCallback((tone: ToastItem["tone"], text: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4500);
  }, []);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => { setTyped(""); setDlg({ ...o, resolve }); }), []);
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto flex w-full max-w-md animate-toast items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1", t.tone === "success" ? "bg-emerald-600 text-white ring-emerald-700" : t.tone === "error" ? "bg-red-600 text-white ring-red-700" : "bg-navy-800 text-white ring-navy-600")}>
            <Icon name={t.tone === "success" ? "checkCircle" : t.tone === "error" ? "alert" : "info"} className="mt-0.5 h-4 w-4" />
            <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
            <button onClick={() => setToasts((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss" className="-m-2 p-2 opacity-80"><Icon name="x" className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <Modal
        open={!!dlg}
        onClose={() => close(false)}
        title={dlg?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={dlg?.tone === "danger" ? "danger" : dlg?.tone === "warn" ? "warn" : "primary"} disabled={!!dlg?.requireText && typed.trim().toLowerCase() !== dlg.requireText.toLowerCase()} onClick={() => close(true)}>
              {dlg?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          {dlg?.message}
          {dlg?.requireText && (
            <Field label={`Type "${dlg.requireText}" to confirm`}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="off" autoComplete="off" />
            </Field>
          )}
        </div>
      </Modal>
    </UiCtx.Provider>
  );
}
export const useUi = () => {
  const c = useContext(UiCtx);
  if (!c) throw new Error("UiProvider missing");
  return c;
};

/* ───────────── data list: table on desktop → cards on mobile ───────────── */
export type Col<T> = {
  key: string;
  header: string;
  render: (r: T) => ReactNode;
  sort?: string;
  align?: "right";
  primary?: boolean; // card title row
  secondary?: boolean; // shown at top-right of card
  hideOnCard?: boolean;
  hideBelow?: "lg" | "xl";
  className?: string;
};
export type SortState = { key: string; dir: "asc" | "desc" };

export function DataList<T>({ rows, cols, rowKey, onRowClick, sort, onSort, loading, empty, error, retry }: {
  rows: T[] | undefined; cols: Col<T>[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void;
  sort?: SortState; onSort?: (s: SortState) => void; loading?: boolean; empty?: ReactNode; error?: ApiErr | null; retry?: () => void;
}) {
  if (error && !rows) return <ErrorState error={error} retry={retry} />;
  if (loading && !rows) return <SkeletonRows />;
  if (!rows?.length) return <>{empty ?? <EmptyState title="Nothing to show" hint="Try adjusting your filters." />}</>;
  const primary = cols.filter((c) => c.primary);
  const secondary = cols.filter((c) => c.secondary);
  const rest = cols.filter((c) => !c.primary && !c.secondary && !c.hideOnCard);
  return (
    <>
      {/* mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={() => onRowClick?.(r)}
              onKeyDown={(e) => onRowClick && (e.key === "Enter" || e.key === " ") && onRowClick(r)}
              className={cx("p-4 transition", onRowClick && "cursor-pointer active:bg-slate-50")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">{primary.map((c) => <div key={c.key}>{c.render(r)}</div>)}</div>
                <div className="shrink-0 text-right">{secondary.map((c) => <div key={c.key}>{c.render(r)}</div>)}</div>
              </div>
              {rest.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {rest.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{c.header}</dt>
                      <dd className="mt-0.5 min-w-0 text-[13px] text-slate-800">{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ul>
      {/* desktop table */}
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              {cols.map((c) => (
                <th key={c.key} className={cx("whitespace-nowrap px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.hideBelow === "lg" && "hidden lg:table-cell", c.hideBelow === "xl" && "hidden xl:table-cell")}>
                  {c.sort && onSort ? (
                    <button className={cx("inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900", sort?.key === c.sort && "text-slate-900")} onClick={() => onSort({ key: c.sort!, dir: sort?.key === c.sort && sort?.dir === "desc" ? "asc" : "desc" })}>
                      {c.header}
                      <Icon name={sort?.key === c.sort ? (sort?.dir === "asc" ? "chevronUp" : "chevronDown") : "sort"} className="h-3 w-3" />
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={() => onRowClick?.(r)} className={cx("transition", onRowClick && "cursor-pointer hover:bg-slate-50")}>
                {cols.map((c) => (
                  <td key={c.key} className={cx("px-4 py-3 align-middle", c.align === "right" && "text-right tabular", c.hideBelow === "lg" && "hidden lg:table-cell", c.hideBelow === "xl" && "hidden xl:table-cell", c.className)}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{total} result{total === 1 ? "" : "s"}</p> : null;
  const from = (page - 1) * size + 1;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
      <p className="text-xs text-slate-500 tabular">{from}–{Math.min(total, page * size)} of {total}</p>
      <div className="flex items-center gap-1">
        <IconButton icon="chevronLeft" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="disabled:opacity-30" />
        <span className="min-w-14 text-center text-xs text-slate-600 tabular">{page} / {pages}</span>
        <IconButton icon="chevronRight" label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="disabled:opacity-30" />
      </div>
    </div>
  );
}

/* ───────────── telemetry helpers ───────────── */
export const SOURCE_META: Record<string, { label: string; tone: Tone; hint: string }> = {
  telemetry: { label: "Reported", tone: "green", hint: "Reported by the printer through the kiosk agent" },
  estimated: { label: "Estimated", tone: "amber", hint: "Estimated from page counts — no sensor" },
  manual: { label: "Manual", tone: "violet", hint: "Entered manually by an admin" },
  unsupported: { label: "Not supported", tone: "slate", hint: "This printer does not expose this value" },
};
export function SourceTag({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? SOURCE_META.unsupported;
  return <span title={m.hint} className={cx("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", TONE[m.tone].badge)}>{m.label}</span>;
}

export function Meter({ label, value, source, suffix = "%", max = 100, low = 15, detail }: { label: string; value: number | null | undefined; source: string; suffix?: string; max?: number; low?: number; detail?: string }) {
  const unsupported = source === "unsupported" || value == null;
  const pct = unsupported ? 0 : Math.max(0, Math.min(100, (value! / max) * 100));
  const lowPct = (low / 100) * 100;
  const tone: Tone = unsupported ? "slate" : pct <= lowPct / 2 ? "red" : pct <= lowPct ? "amber" : "green";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">{label} <SourceTag source={unsupported ? "unsupported" : source} /></span>
        <span className="tabular text-slate-600">{unsupported ? "—" : `${value}${suffix === "%" ? "%" : ""}${detail ? ` ${detail}` : ""}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={unsupported ? undefined : value!} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className={cx("h-full rounded-full transition-all duration-500", TONE[tone].bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ───────────── freshness + range picker ───────────── */
export function LiveBadge({ updatedAt, refreshing, onRefresh }: { updatedAt: number | null; refreshing: boolean; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <button onClick={onRefresh} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100 md:min-h-9" aria-label="Refresh data">
      <span className={cx("h-2 w-2 rounded-full bg-emerald-500", !refreshing && "live-dot text-emerald-500")} />
      <span className="tabular">{refreshing ? "Updating…" : updatedAt ? `Live · ${relTime(new Date(updatedAt))}` : "Loading…"}</span>
      <Icon name="refresh" className={cx("h-3.5 w-3.5", refreshing && "animate-spin")} />
    </button>
  );
}

export type Range = { preset: "today" | "7d" | "30d" | "custom"; from: string; to: string };
export function presetRange(preset: Range["preset"]): Range {
  const now = new Date();
  const to = istDateKey(now);
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  return { preset, from: istDateKey(new Date(now.getTime() - days * 86400_000)), to };
}
export function RangePicker({ value, onChange, presets = ["today", "7d", "30d"] }: { value: Range; onChange: (r: Range) => void; presets?: Range["preset"][] }) {
  const labels = { today: "Today", "7d": "7 days", "30d": "30 days", custom: "Custom" };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={value.preset} onChange={(p) => onChange(p === "custom" ? { ...value, preset: "custom" } : presetRange(p))} options={[...presets, "custom" as const].map((p) => ({ value: p, label: labels[p] }))} />
      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="w-auto min-w-0 flex-1 sm:flex-none" />
          <span className="text-slate-400">→</span>
          <Input type="date" aria-label="To date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="w-auto min-w-0 flex-1 sm:flex-none" />
        </div>
      )}
    </div>
  );
}

export function KpiCard({ label, value, sub, icon, tone = "blue", delta, onClick, alert }: { label: string; value: ReactNode; sub?: ReactNode; icon: string; tone?: Tone; delta?: number | null; onClick?: () => void; alert?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cx("min-w-0 rounded-xl border bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition md:p-4", alert ? "border-red-200 ring-1 ring-red-100" : "border-slate-200/80", onClick && "active:scale-[0.99] hover:border-slate-300")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-lg", TONE[tone].soft, TONE[tone].text)}><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <p className="mt-1.5 truncate text-xl font-semibold tracking-tight text-slate-900 tabular md:text-2xl">{value}</p>
      <div className="mt-0.5 flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-slate-500">
        {delta != null && Number.isFinite(delta) && (
          <span className={cx("font-medium", delta >= 0 ? "text-emerald-600" : "text-red-600")}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%</span>
        )}
        {sub && <span className="truncate">{sub}</span>}
      </div>
    </Tag>
  );
}
