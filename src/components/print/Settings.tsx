"use client";

import { Icon } from "@/components/ui/Icon";
import { parsePageRange, type PagesPerSheet } from "@/lib/pricing";
import { rupees, type ColorMode, type Orientation, type Sides } from "@/lib/config";
import type { Cfg, Settings, UDoc } from "./types";

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-mute">{title}</h3>
        {hint && <span className="text-[12.5px] text-mute">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; sub?: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-[14.5px] font-medium transition active:scale-[0.98] ${
              on ? "border-ink bg-ink text-paper shadow-xs" : "border-line bg-white hover:border-ink/40"
            }`}
          >
            {o.icon}
            <span className="text-left leading-tight">
              {o.label}
              {o.sub && <span className={`block text-[12px] font-normal ${on ? "text-paper/60" : "text-mute"}`}>{o.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Sheet({ landscape }: { landscape?: boolean }) {
  return <span className={`block rounded-[3px] border-[1.5px] border-current ${landscape ? "h-3.5 w-5" : "h-5 w-3.5"}`} />;
}

function NUpLayoutIcon({ count }: { count: PagesPerSheet }) {
  if (count === 1) {
    return (
      <span className="flex h-5 w-4 items-center justify-center rounded-[2px] border border-current p-0.5">
        <span className="h-full w-full rounded-[1px] bg-current opacity-40" />
      </span>
    );
  }
  if (count === 2) {
    return (
      <span className="flex h-4 w-5 flex-col gap-0.5 rounded-[2px] border border-current p-0.5">
        <span className="h-full w-full rounded-[1px] bg-current opacity-40" />
        <span className="h-full w-full rounded-[1px] bg-current opacity-40" />
      </span>
    );
  }
  if (count === 4) {
    return (
      <span className="grid h-5 w-4 grid-cols-2 gap-0.5 rounded-[2px] border border-current p-0.5">
        <span className="rounded-[1px] bg-current opacity-40" />
        <span className="rounded-[1px] bg-current opacity-40" />
        <span className="rounded-[1px] bg-current opacity-40" />
        <span className="rounded-[1px] bg-current opacity-40" />
      </span>
    );
  }
  return (
    <span className="grid h-5 w-4 grid-cols-2 grid-rows-3 gap-0.5 rounded-[2px] border border-current p-0.5">
      <span className="rounded-[1px] bg-current opacity-40" />
      <span className="rounded-[1px] bg-current opacity-40" />
      <span className="rounded-[1px] bg-current opacity-40" />
      <span className="rounded-[1px] bg-current opacity-40" />
      <span className="rounded-[1px] bg-current opacity-40" />
      <span className="rounded-[1px] bg-current opacity-40" />
    </span>
  );
}

export function SettingsPanel({
  cfg,
  settings,
  setSettings,
  doc,
  updateDoc,
  multi,
}: {
  cfg: Cfg;
  settings: Settings;
  setSettings: (s: Settings) => void;
  doc: UDoc;
  updateDoc: (patch: Partial<UDoc>) => void;
  multi: boolean;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });
  const rangeErr = doc.useRange ? parsePageRange(doc.range, doc.pages).error : undefined;
  const showErr = doc.useRange && doc.range.trim() && rangeErr;

  return (
    <section className="rounded-[24px] border border-line bg-white p-4 md:p-6" aria-label="Print settings">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Print settings</h2>
        <span className="text-[12.5px] text-mute">Applies to all files</span>
      </div>

      <div className="divide-y divide-line">
        <Group title="Colour mode">
          <div role="radiogroup" aria-label="Colour mode" className="grid grid-cols-2 gap-3">
            {(
              [
                { v: "bw", label: "Black & White", price: cfg.pricing.bw },
                { v: "color", label: "Colour", price: cfg.pricing.color },
              ] as { v: ColorMode; label: string; price: number }[]
            ).map((o) => {
              const on = settings.colorMode === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("colorMode", o.v)}
                  className={`relative overflow-hidden rounded-2xl border-2 p-4 text-left transition active:scale-[0.98] ${
                    on ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink/40"
                  }`}
                >
                  <span className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${o.v === "color" ? "cmy-gradient" : on ? "bg-paper/15" : "bg-paper-2"}`}>
                    {o.v === "bw" && <span className="h-3.5 w-3.5 rounded-full bg-gradient-to-r from-ink to-white ring-1 ring-ink/30" />}
                  </span>
                  <span className="block text-[15px] font-semibold leading-tight">{o.label}</span>
                  <span className={`mt-1 block text-[13px] ${on ? "text-paper/70" : "text-mute"}`}>
                    <b className="text-[17px] font-semibold">{rupees(o.price)}</b>/sheet
                  </span>
                  {on && (
                    <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-signal text-white">
                      <Icon name="check" size={14} strokeWidth={2.6} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="Pages per sheet" hint="Save paper with N-up layout">
          <div role="radiogroup" aria-label="Pages per sheet" className="grid grid-cols-4 gap-2">
            {(
              [
                { v: 1, label: "1-up", sub: "Standard" },
                { v: 2, label: "2-up", sub: "2 on 1" },
                { v: 4, label: "4-up", sub: "4 on 1" },
                { v: 6, label: "6-up", sub: "6 on 1" },
              ] as const
            ).map((o) => {
              const on = (settings.pagesPerSheet || 1) === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("pagesPerSheet", o.v)}
                  className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center transition active:scale-[0.98] ${
                    on ? "border-ink bg-ink text-paper shadow-xs" : "border-line bg-white hover:border-ink/40"
                  }`}
                >
                  <NUpLayoutIcon count={o.v} />
                  <span className="text-[13px] font-semibold leading-tight">{o.label}</span>
                  <span className={`text-[11px] ${on ? "text-paper/70" : "text-mute"}`}>{o.sub}</span>
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="Copies">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-line bg-white p-1">
              <button
                type="button"
                aria-label="Decrease copies"
                disabled={settings.copies <= 1}
                onClick={() => set("copies", settings.copies - 1)}
                className="flex h-11 w-11 items-center justify-center rounded-full transition enabled:hover:bg-paper-2 enabled:active:scale-95 disabled:opacity-30"
              >
                <Icon name="minus" size={18} />
              </button>
              <input
                aria-label="Number of copies"
                inputMode="numeric"
                value={settings.copies}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/\D/g, "") || "1", 10);
                  set("copies", Math.min(99, Math.max(1, n)));
                }}
                className="w-14 bg-transparent text-center text-lg font-semibold tabular-nums outline-none"
              />
              <button
                type="button"
                aria-label="Increase copies"
                disabled={settings.copies >= 99}
                onClick={() => set("copies", settings.copies + 1)}
                className="flex h-11 w-11 items-center justify-center rounded-full transition enabled:hover:bg-paper-2 enabled:active:scale-95 disabled:opacity-30"
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
            <span className="text-[13px] text-mute">{settings.copies === 1 ? "1 copy" : `${settings.copies} copies`}</span>
          </div>
        </Group>

        <Group title="Paper size" hint={cfg.hardware.paperSizes.length === 1 ? "Installed in kiosks" : undefined}>
          <Seg
            label="Paper size"
            value={settings.paperSize}
            onChange={(v) => set("paperSize", String(v))}
            options={cfg.hardware.paperSizes.map((p) => ({ value: p, label: p, sub: p === "A4" ? "210 × 297 mm" : undefined }))}
          />
        </Group>

        {cfg.hardware.sides.length > 1 && (
          <Group title="Printing sides">
            <Seg<Sides>
              label="Printing sides"
              value={settings.sides}
              onChange={(v) => set("sides", v)}
              options={[
                { value: "single", label: "Single-sided" },
                { value: "double", label: "Double-sided" },
              ]}
            />
          </Group>
        )}

        <Group title="Orientation">
          <Seg<Orientation>
            label="Orientation"
            value={settings.orientation}
            onChange={(v) => set("orientation", v)}
            options={[
              { value: "portrait", label: "Portrait", icon: <Sheet /> },
              { value: "landscape", label: "Landscape", icon: <Sheet landscape /> },
            ]}
          />
        </Group>

        <Group title="Pages" hint={multi ? `For ${doc.name}` : `${doc.pages} page${doc.pages === 1 ? "" : "s"} in file`}>
          <Seg<"all" | "range">
            label="Page selection"
            value={doc.useRange ? "range" : "all"}
            onChange={(v) => updateDoc({ useRange: v === "range" })}
            options={[
              { value: "all", label: "All pages" },
              { value: "range", label: "Custom range" },
            ]}
          />
          {doc.useRange && (
            <div className="mt-3">
              <input
                aria-label="Custom page range"
                aria-invalid={!!showErr}
                value={doc.range}
                onChange={(e) => updateDoc({ range: e.target.value.replace(/[^\d,\-\s]/g, "") })}
                placeholder={`e.g. 1-5, 8, 11-${Math.max(12, Math.min(doc.pages, 20))}`}
                inputMode="text"
                className={`h-12 w-full rounded-2xl border bg-white px-4 text-[15px] outline-none transition focus:ring-2 ${
                  showErr ? "border-bad focus:ring-bad/20" : "border-line focus:border-ink focus:ring-ink/10"
                }`}
              />
              <p className={`mt-2 text-[13px] ${showErr ? "text-bad" : "text-mute"}`}>
                {showErr ? rangeErr : !doc.range.trim() ? "Enter pages or ranges separated by commas." : `${parsePageRange(doc.range, doc.pages).count} pages selected`}
              </p>
            </div>
          )}
        </Group>
      </div>
    </section>
  );
}
