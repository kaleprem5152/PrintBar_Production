"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ALERT_TYPES, JOB_STATUS, PAYMENT_STATUS, REFUND_STATUS, SEVERITY, type Severity, type Tone } from "@/lib/constants";
import { relTime } from "@/lib/format";
import { Badge, Icon, Meter, StatusDot } from "./ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const JobBadge = ({ s }: { s: string }) => <Badge tone={JOB_STATUS[s]?.tone ?? "neutral"} dot>{JOB_STATUS[s]?.label ?? s}</Badge>;
export const PayBadge = ({ s }: { s: string }) => <Badge tone={PAYMENT_STATUS[s]?.tone ?? "neutral"}>{PAYMENT_STATUS[s]?.label ?? s}</Badge>;
export const RefundBadge = ({ s }: { s: string }) => <Badge tone={REFUND_STATUS[s]?.tone ?? "neutral"} dot>{REFUND_STATUS[s]?.label ?? s}</Badge>;
export const SeverityBadge = ({ s }: { s: string }) => <Badge tone={SEVERITY[s as Severity]?.tone ?? "neutral"} dot>{SEVERITY[s as Severity]?.label ?? s}</Badge>;
export const ModeBadge = ({ mode }: { mode: string }) => (
  <span className="inline-flex items-center gap-1.5 text-[13px]"><span className={mode === "color" ? "h-2.5 w-2.5 rounded-full bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-yellow-400" : "h-2.5 w-2.5 rounded-full bg-slate-800"} />{mode === "color" ? "Colour" : "B&W"}</span>
);

const KIOSK: Record<string, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "green" },
  offline: { label: "Offline", tone: "red" },
  maintenance: { label: "Maintenance", tone: "amber" },
  paused: { label: "Printing paused", tone: "amber" },
  disabled: { label: "Disabled", tone: "slate" },
};
export const KioskBadge = ({ s }: { s: string }) => <Badge tone={KIOSK[s]?.tone ?? "neutral"} dot>{KIOSK[s]?.label ?? s}</Badge>;

const PRINTER: Record<string, { label: string; tone: Tone }> = {
  idle: { label: "Idle", tone: "green" },
  printing: { label: "Printing", tone: "blue" },
  error: { label: "Error", tone: "red" },
  paused: { label: "Paused", tone: "amber" },
  disabled: { label: "Disabled", tone: "slate" },
  disconnected: { label: "Disconnected", tone: "red" },
  unreachable: { label: "Unreachable", tone: "slate" },
};
export const PrinterBadge = ({ s }: { s: string }) => <Badge tone={PRINTER[s]?.tone ?? "neutral"} dot>{PRINTER[s]?.label ?? s}</Badge>;
export const RoleBadge = ({ role }: { role: string }) => <Badge tone={role === "primary" ? "blue" : "slate"}>{role === "primary" ? "Primary" : "Backup"}</Badge>;

export function Heartbeat({ at, online }: { at: string | null; online?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
      <StatusDot tone={online === undefined ? "slate" : online ? "green" : "red"} pulse={online} />
      {relTime(at)}
    </span>
  );
}

export function AlertRow({ a, children }: { a: Row; children?: ReactNode }) {
  const meta = ALERT_TYPES[a.type];
  const tone = SEVERITY[a.severity as Severity]?.tone ?? "neutral";
  return (
    <div className={`flex gap-3 rounded-lg border p-3 ${tone === "red" ? "border-red-200 bg-red-50/50" : tone === "amber" ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-slate-50/50"}`}>
      <Icon name={a.type?.startsWith("paper") ? "file" : a.type === "kiosk_offline" || a.type === "pi_offline" ? "wifiOff" : a.type === "network_issue" ? "wifi" : "alert"} className={`mt-0.5 h-5 w-5 ${tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-blue-500"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-slate-900">{a.title}</p>
          <SeverityBadge s={a.severity} />
          {a.status === "acknowledged" && <Badge tone="blue">Acknowledged</Badge>}
        </div>
        <p className="mt-0.5 text-[13px] text-slate-600">{a.details ?? meta?.label}</p>
        <p className="mt-1 text-xs text-slate-400">{relTime(a.createdAt)}</p>
        {children}
      </div>
    </div>
  );
}

export function PrinterMiniStatus({ p }: { p: Row }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-900">{p.name}</p>
          <p className="truncate text-xs text-slate-500">{p.model}</p>
        </div>
        <PrinterBadge s={p.live} />
      </div>
      {p.live === "error" && p.errorMessage && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{p.errorMessage}</p>}
      <div className="mt-3 grid gap-2.5">
        <Meter label="Paper" value={p.paperRemaining} source={p.paperRemaining == null ? "unsupported" : p.paperSource} max={p.paperCapacity} low={10} detail={`/ ${p.paperCapacity} sheets`} />
        <Meter label="Toner / ink" value={p.tonerColor != null ? Math.min(p.tonerBlack ?? 100, p.tonerColor) : p.tonerBlack} source={p.tonerSource} />
      </div>
    </div>
  );
}

export function LinkCard({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="block rounded-lg transition hover:bg-slate-50">{children}</Link>;
}

export const shortDate = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};
export const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
