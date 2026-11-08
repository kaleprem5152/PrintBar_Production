"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export const PALETTE = { blue: "#2563eb", sky: "#38bdf8", green: "#10b981", amber: "#f59e0b", red: "#ef4444", violet: "#8b5cf6", slate: "#94a3b8", navy: "#1e293b" };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export type Series = { name: string; color: string; values: number[] };

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.name}</span>
      ))}
    </div>
  );
}

/** Responsive bar (stacked/grouped) and line/area chart with touch-friendly tooltip. */
export function Chart({ type = "bar", labels, series, stacked = true, height = 200, fmt = (n: number) => String(n), axisFmt, title, area = true }: {
  type?: "bar" | "line"; labels: string[]; series: Series[]; stacked?: boolean; height?: number; fmt?: (n: number) => string; axisFmt?: (n: number) => string; title: string; area?: boolean;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const padL = 40, padR = 8, padT = 10, padB = 24;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const totals = labels.map((_, i) => (type === "bar" && stacked ? series.reduce((a, s) => a + (s.values[i] ?? 0), 0) : Math.max(0, ...series.map((s) => s.values[i] ?? 0))));
  const max = niceMax(Math.max(...totals, 0));
  const y = (v: number) => padT + ih - (v / max) * ih;
  const step = iw / Math.max(1, n);
  const x = (i: number) => padL + (type === "bar" ? step * i + step / 2 : n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 52))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const barW = Math.max(2, Math.min(28, (step * 0.7) / (stacked ? 1 : series.length)));

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left - padL;
    const i = type === "bar" ? Math.floor(px / step) : Math.round((px / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} role="img" aria-label={title}>
      {w > 0 && (
        <svg width={w} height={height} className="touch-pan-y overflow-visible" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : "3 4"} />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#64748b">{(axisFmt ?? fmt)(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={i} x={x(i)} y={height - 7} textAnchor="middle" fontSize="10" fill="#64748b">{l}</text> : null))}
          {hover != null && <rect x={type === "bar" ? padL + step * hover : x(hover) - 0.5} y={padT} width={type === "bar" ? step : 1} height={ih} fill={type === "bar" ? "#f1f5f9" : "#cbd5e1"} />}
          {type === "bar" &&
            labels.map((_, i) => {
              let acc = 0;
              return series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const bh = (v / max) * ih;
                const bx = stacked ? x(i) - barW / 2 : x(i) - (barW * series.length) / 2 + si * barW;
                const by = stacked ? y(acc + v) : y(v);
                acc += v;
                return v > 0 ? <rect key={`${i}-${si}`} x={bx} y={by} width={barW} height={bh} rx={2} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} /> : null;
              });
            })}
          {type === "line" &&
            series.map((s) => {
              const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
              const line = "M" + pts.join("L");
              return (
                <g key={s.name}>
                  {area && n > 1 && <path d={`${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} opacity={0.1} />}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {hover != null && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill="#fff" stroke={s.color} strokeWidth={2} />}
                  {n === 1 && <circle cx={x(0)} cy={y(s.values[0] ?? 0)} r={4} fill={s.color} />}
                </g>
              );
            })}
        </svg>
      )}
      {hover != null && w > 0 && (
        <div className="pointer-events-none absolute z-10 min-w-28 rounded-lg bg-navy-900 px-2.5 py-2 text-xs text-white shadow-lg" style={{ top: 0, left: Math.min(Math.max(0, x(hover) - 56), Math.max(0, w - 130)) }}>
          <div className="mb-1 font-medium text-slate-300">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
              <span className="font-medium tabular">{fmt(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Donut({ segments, size = 140, center, label }: { segments: { name: string; value: number; color: string }[]; size?: number; center?: React.ReactNode; label: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={14} />
        {total > 0 &&
          segments.map((s) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={14} strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} className="transition-all duration-500" />;
            off += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  );
}

export function HBar({ items, fmt = (n: number) => String(n), color = PALETTE.blue }: { items: { label: string; value: number; sub?: string }[]; fmt?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-slate-700">{i.label}</span>
            <span className="shrink-0 text-slate-500 tabular">{fmt(i.value)}{i.sub && <span className="ml-1.5 text-slate-400">{i.sub}</span>}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={cx("h-full rounded-full transition-all duration-500")} style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}
