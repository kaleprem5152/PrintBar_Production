import { TZ } from "./constants";

export function inr(paise: number | null | undefined, opts: { compact?: boolean } = {}): string {
  const v = (paise ?? 0) / 100;
  if (opts.compact && Math.abs(v) >= 100000) {
    return "₹" + (v / 100000).toFixed(2).replace(/\.?0+$/, "") + "L";
  }
  if (opts.compact && Math.abs(v) >= 10000) {
    return "₹" + (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  const whole = Number.isInteger(v);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export const num = (n: number | null | undefined) => new Intl.NumberFormat("en-IN").format(n ?? 0);

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d));
}

export function dateOnly(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function relTime(d: string | Date | null | undefined, now = Date.now()): string {
  if (!d) return "never";
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function pct(n: number, d: number, digits = 0): string {
  if (!d) return "—";
  return ((n / d) * 100).toFixed(digits) + "%";
}

export function istDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
