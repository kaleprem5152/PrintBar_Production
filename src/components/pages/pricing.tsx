"use client";

import { useEffect, useState } from "react";
import type { Row } from "@/components/domain";
import { Badge, Button, Card, ErrorState, Field, Icon, Input, Modal, Notice, PageHeader, Segmented, Select, Skeleton, Toggle, useUi } from "@/components/ui";
import { api, useApi, useCan } from "@/lib/client";
import { dateTime, inr } from "@/lib/format";
import { calcQuote, type PricingConfig } from "@/lib/quote";

type Form = { bw: string; color: string; duplex: string; min: string; pps: number[]; single: boolean; double: boolean; maxCopies: string; maxPages: string; note: string };
const toForm = (p: Row): Form => ({ bw: String(p.bwPaise / 100), color: String(p.colorPaise / 100), duplex: String(p.duplexDiscountPct), min: String(p.minTxnPaise / 100), pps: p.config.pagesPerSheet, single: p.config.singleSided, double: p.config.doubleSided, maxCopies: String(p.config.maxCopies), maxPages: String(p.config.maxPages), note: "" });
const toCfg = (f: Form): PricingConfig => ({ bwPaise: Math.round(Number(f.bw) * 100) || 0, colorPaise: Math.round(Number(f.color) * 100) || 0, duplexDiscountPct: Number(f.duplex) || 0, minTxnPaise: Math.round(Number(f.min) * 100) || 0, config: { pagesPerSheet: f.pps, maxCopies: Number(f.maxCopies) || 1, maxPages: Number(f.maxPages) || 1, singleSided: f.single, doubleSided: f.double } });

export default function Pricing() {
  const { data, error, loading, reload } = useApi<Row>("/api/admin/pricing");
  const can = useCan();
  const { toast } = useUi();
  const [form, setForm] = useState<Form | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState({ pages: "10", color: "bw" as "bw" | "color", sided: "single" as "single" | "double", pps: 1, copies: "1" });

  useEffect(() => { if (data && !form) setForm(toForm(data.active)); }, [data, form]);
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (loading || !data || !form) return <div className="space-y-3"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-96" /></div>;

  const active: Row = data.active;
  const next = toCfg(form);
  const dirty = JSON.stringify(toCfg(toForm(active))) !== JSON.stringify(next);
  const set = (k: keyof Form, v: Form[typeof k]) => setForm({ ...form, [k]: v });
  const togglePps = (n: number) => set("pps", form.pps.includes(n) ? form.pps.filter((x) => x !== n) : [...form.pps, n].sort((a, b) => a - b));
  const readonly = !can("pricing.manage");

  const quoteOf = (cfg: PricingConfig) => calcQuote(cfg, { pages: Number(pv.pages) || 0, color: pv.color === "color", sided: pv.sided, pagesPerSheet: pv.pps, copies: Number(pv.copies) || 0 });
  const qNew = quoteOf(next);
  const qOld = quoteOf({ bwPaise: active.bwPaise, colorPaise: active.colorPaise, duplexDiscountPct: active.duplexDiscountPct, minTxnPaise: active.minTxnPaise, config: active.config });

  const publish = async () => {
    setBusy(true);
    try {
      const r = await api<Row>("/api/admin/pricing", { method: "POST", body: { bwPaise: next.bwPaise, colorPaise: next.colorPaise, duplexDiscountPct: next.duplexDiscountPct, minTxnPaise: next.minTxnPaise, config: next.config, note: form.note, confirm: true } });
      toast("success", r.message);
      setConfirmOpen(false);
      setForm(null);
      reload();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };

  const diffRows: [string, string, string][] = [
    ["B&W per page", inr(active.bwPaise), inr(next.bwPaise)],
    ["Colour per page", inr(active.colorPaise), inr(next.colorPaise)],
    ["Double-sided discount", `${active.duplexDiscountPct}%`, `${next.duplexDiscountPct}%`],
    ["Minimum transaction", inr(active.minTxnPaise), inr(next.minTxnPaise)],
    ["Pages per sheet", active.config.pagesPerSheet.join(", "), next.config.pagesPerSheet.join(", ")],
    ["Sides", [active.config.singleSided && "single", active.config.doubleSided && "double"].filter(Boolean).join(" + "), [next.config.singleSided && "single", next.config.doubleSided && "double"].filter(Boolean).join(" + ")],
    ["Max copies / pages", `${active.config.maxCopies} / ${active.config.maxPages}`, `${next.config.maxCopies} / ${next.config.maxPages}`],
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Pricing & print configuration" subtitle={<>Live version <b>v{active.id}</b> · published {dateTime(active.createdAt)} by {active.publishedBy}</>} actions={<Badge tone="green" dot>Active in customer app</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card title="Per-page pricing" padded>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="B&W price per page (₹)"><Input type="number" inputMode="decimal" step="0.25" min="0.25" value={form.bw} disabled={readonly} onChange={(e) => set("bw", e.target.value)} /></Field>
              <Field label="Colour price per page (₹)"><Input type="number" inputMode="decimal" step="0.25" min="0.25" value={form.color} disabled={readonly} onChange={(e) => set("color", e.target.value)} /></Field>
              <Field label="Double-sided discount (%)" hint="Applied per page when double-sided is chosen"><Input type="number" inputMode="numeric" min="0" max="90" value={form.duplex} disabled={readonly} onChange={(e) => set("duplex", e.target.value)} /></Field>
              <Field label="Minimum transaction (₹)" hint="0 = no minimum"><Input type="number" inputMode="decimal" min="0" step="0.5" value={form.min} disabled={readonly} onChange={(e) => set("min", e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Print options offered to customers" padded>
            <div className="divide-y divide-slate-100">
              <Toggle checked={form.single} disabled={readonly} onChange={(v) => set("single", v)} label="Single-sided printing" />
              <Toggle checked={form.double} disabled={readonly} onChange={(v) => set("double", v)} label="Double-sided printing" />
            </div>
            <p className="mb-2 mt-3 text-[13px] font-medium text-slate-700">Pages per sheet</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 4, 6].map((n) => (
                <button key={n} disabled={readonly} onClick={() => togglePps(n)} aria-pressed={form.pps.includes(n)} className={`min-h-11 min-w-16 rounded-lg px-4 text-sm font-medium ring-1 ring-inset transition ${form.pps.includes(n) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-300"}`}>{n}-up</button>
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Maximum copies"><Input type="number" inputMode="numeric" min="1" value={form.maxCopies} disabled={readonly} onChange={(e) => set("maxCopies", e.target.value)} /></Field>
              <Field label="Maximum pages per job"><Input type="number" inputMode="numeric" min="1" value={form.maxPages} disabled={readonly} onChange={(e) => set("maxPages", e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Publish" padded>
            <Field label="Change note (kept in history & audit log)"><Input value={form.note} disabled={readonly} onChange={(e) => set("note", e.target.value)} maxLength={200} placeholder="e.g. Colour ink cost increase" /></Field>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" icon="check" disabled={readonly || !dirty || form.note.trim().length < 3 || !form.pps.length || (!form.single && !form.double)} onClick={() => setConfirmOpen(true)}>Review & publish</Button>
              <Button disabled={!dirty} onClick={() => setForm(toForm(active))}>Discard changes</Button>
            </div>
            {readonly && <p className="mt-2 text-xs text-slate-500">Your role can view pricing but not publish changes.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Live pricing preview" subtitle="Uses the same calculator as the backend quote API" padded>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pages"><Input type="number" inputMode="numeric" min="1" value={pv.pages} onChange={(e) => setPv({ ...pv, pages: e.target.value })} /></Field>
              <Field label="Copies"><Input type="number" inputMode="numeric" min="1" value={pv.copies} onChange={(e) => setPv({ ...pv, copies: e.target.value })} /></Field>
              <Field label="Colour"><Select value={pv.color} onChange={(e) => setPv({ ...pv, color: e.target.value as "bw" | "color" })}><option value="bw">B&W</option><option value="color">Colour</option></Select></Field>
              <Field label="Pages per sheet"><Select value={pv.pps} onChange={(e) => setPv({ ...pv, pps: Number(e.target.value) })}>{[1, 2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            </div>
            <div className="mt-3"><Segmented value={pv.sided} onChange={(v) => setPv({ ...pv, sided: v })} options={[{ value: "single", label: "Single-sided" }, { value: "double", label: "Double-sided" }]} /></div>
            <div className="mt-4 rounded-xl bg-navy-900 p-4 text-white">
              {qNew.valid ? (
                <>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Customer pays</p>
                  <p className="mt-1 text-3xl font-semibold tabular">{inr(qNew.totalPaise)}</p>
                  <p className="mt-1 text-xs text-slate-400">{qNew.printedPages} pages × {inr(qNew.perPagePaise)} · {qNew.sheets} sheets of paper{qNew.minApplied ? " · minimum applied" : ""}</p>
                  {dirty && qOld.valid && <p className={`mt-2 text-xs ${qNew.totalPaise > qOld.totalPaise ? "text-amber-300" : qNew.totalPaise < qOld.totalPaise ? "text-emerald-300" : "text-slate-400"}`}>Currently {inr(qOld.totalPaise)} → {qNew.totalPaise >= qOld.totalPaise ? "+" : ""}{inr(qNew.totalPaise - qOld.totalPaise)}</p>}
                </>
              ) : <ul className="space-y-1 text-sm text-amber-300">{qNew.errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
            </div>
            <p className="mt-3 text-xs text-slate-500">Last 30 days: avg completed job is {Math.round(data.last30d.avgPages)} pages / {inr(Math.round(data.last30d.avgAmountPaise))} across {data.last30d.jobs} jobs.</p>
          </Card>
          <Notice tone="blue" title="How the customer app receives prices">Publishing activates a new version instantly. The customer app and backend read <code className="break-all">GET /api/public/pricing</code> (and can request a server quote with <code>?pages=12&amp;color=1&amp;sided=double&amp;pps=2&amp;copies=2</code>). Wire the app's price display and payment amount to this endpoint so both always match.</Notice>
        </div>
      </div>

      <Card title="Pricing change history" padded={false}>
        <ul className="divide-y divide-slate-100">
          {data.history.map((h: Row) => (
            <li key={h.id} className="flex flex-col gap-1 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="font-medium text-slate-900">v{h.id} {h.active && <Badge tone="green" className="ml-1">Active</Badge>}</p><p className="text-slate-600">B&W {inr(h.bwPaise)} · Colour {inr(h.colorPaise)} · duplex −{h.duplexDiscountPct}% · min {inr(h.minTxnPaise)}</p><p className="text-xs text-slate-500">{h.note}</p></div>
              <p className="shrink-0 text-xs text-slate-500">{h.publishedBy} · {dateTime(h.createdAt)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Publish pricing changes?" size="md" footer={<><Button onClick={() => setConfirmOpen(false)}>Back</Button><Button variant="primary" loading={busy} onClick={publish}>Publish now</Button></>}>
        <Notice tone="amber" title="This affects all customers immediately">New jobs and payment amounts use this pricing as soon as it is published. Jobs already paid are unaffected.</Notice>
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13px]">
          {diffRows.map(([k, a, b]) => <li key={k} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${a !== b ? "bg-amber-50/60" : ""}`}><span className="text-slate-500">{k}</span><span className="text-right">{a === b ? <b>{b}</b> : <><span className="text-slate-400 line-through">{a}</span> <Icon name="chevronRight" className="inline h-3 w-3" /> <b>{b}</b></>}</span></li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Note: “{form.note}”</p>
      </Modal>
    </div>
  );
}
