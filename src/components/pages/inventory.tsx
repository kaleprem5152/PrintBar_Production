"use client";

import { useState } from "react";
import { Chart, Legend, PALETTE } from "@/components/charts";
import type { Row } from "@/components/domain";
import { Badge, Button, Card, Col, DataList, EmptyState, ErrorState, Field, Icon, Input, KpiCard, Modal, PageHeader, Select, Skeleton, Tabs, Textarea, useUi } from "@/components/ui";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { api, useApi, useCan } from "@/lib/client";
import { dateTime, inr, num } from "@/lib/format";

type Tab = "stock" | "spend" | "ledger";
type Mode = { kind: "purchase" | "adjust" | "consume" | "create" | "threshold"; item?: Row } | null;
const CAT_COLOR: Record<string, string> = { paper: PALETTE.blue, toner: PALETTE.navy, ink: PALETTE.violet, drum: PALETTE.amber, parts: PALETTE.green };

export default function Inventory() {
  const { data, error, loading, reload } = useApi<Row>("/api/admin/inventory", { interval: 30000 });
  const [tab, setTab] = useState<Tab>("stock");
  const [mode, setMode] = useState<Mode>(null);
  const can = useCan();
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  const items: Row[] = data?.items ?? [];
  const low = items.filter((i) => i.low);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthSpend = (data?.monthly ?? []).filter((m: Row) => m.month === thisMonth).reduce((a: number, m: Row) => a + m.spendPaise, 0);
  const months = [...new Set<string>((data?.monthly ?? []).map((m: Row) => m.month))].sort();
  const cats = Object.keys(INVENTORY_CATEGORIES);

  const ledgerCols: Col<Row>[] = [
    { key: "item", header: "Item", primary: true, render: (m) => <span className="text-[13px] font-medium">{m.itemName}</span> },
    { key: "qty", header: "Change", secondary: true, align: "right", render: (m) => <span className={`font-medium tabular ${m.qty > 0 ? "text-emerald-600" : "text-red-600"}`}>{m.qty > 0 ? "+" : ""}{num(m.qty)} {m.unit}</span> },
    { key: "kind", header: "Type", render: (m) => <Badge tone={m.kind === "purchase" ? "green" : m.kind === "adjustment" ? "violet" : "slate"}>{m.kind}</Badge> },
    { key: "note", header: "Note / reference", render: (m) => <span className="text-xs text-slate-600">{m.note}{m.supplier ? ` · ${m.supplier}` : ""}{m.reference ? ` · ${m.reference}` : ""}</span> },
    { key: "by", header: "By", render: (m) => <span className="text-[13px]">{m.byName}</span> },
    { key: "at", header: "When", render: (m) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(m.createdAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Inventory" subtitle="Paper, toner, ink, drums and parts — stock, usage and procurement" actions={can("inventory.manage") ? <Button variant="primary" icon="plus" onClick={() => setMode({ kind: "create" })}>New item</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Items tracked" icon="inventory" tone="blue" value={items.length} />
        <KpiCard label="Below reorder level" icon="alert" tone={low.length ? "red" : "green"} alert={low.length > 0} value={low.length} sub={low.map((l) => l.name.split(" ").slice(0, 2).join(" ")).join(", ") || "All stocked"} />
        <KpiCard label="Spend this month" icon="rupee" tone="amber" value={inr(monthSpend)} sub="procurement" />
        <KpiCard label="Paper stock" icon="file" tone="blue" value={`${num(items.find((i) => i.category === "paper")?.stock)}`} sub={items.find((i) => i.category === "paper")?.daysLeft != null ? `~${items.find((i) => i.category === "paper")?.daysLeft} days left` : "sheets"} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "stock", label: "Stock", badge: low.length || undefined }, { value: "spend", label: "Procurement & spend" }, { value: "ledger", label: "Audit ledger" }]} />

      {tab === "stock" && (loading && !data ? <Skeleton className="h-64" /> : items.length === 0 ? <Card><EmptyState icon="inventory" title="No inventory items" /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <Card key={i.id} className={i.low ? "border-red-200" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{i.name}</p><p className="text-xs text-slate-500">{i.sku} · {INVENTORY_CATEGORIES[i.category]}</p></div>
                {i.low ? <Badge tone="red" dot>Reorder</Badge> : <Badge tone="green" dot>OK</Badge>}
              </div>
              <p className="mt-3 text-2xl font-semibold tabular text-slate-900">{num(i.stock)} <span className="text-sm font-normal text-slate-500">{i.unit}</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${i.low ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (i.stock / Math.max(1, i.reorderThreshold * 3)) * 100)}%` }} /></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><dt className="text-slate-400">Reorder at</dt><dd className="font-medium">{num(i.reorderThreshold)}</dd></div>
                <div><dt className="text-slate-400">Used (30d)</dt><dd className="font-medium">{num(i.used30d)} · {i.perDay >= 1 ? Math.round(i.perDay) : i.perDay.toFixed(2)}/day</dd></div>
                <div><dt className="text-slate-400">Estimated remaining</dt><dd className="font-medium">{i.daysLeft == null ? "no recent usage" : `~${i.daysLeft} days`}</dd></div>
                <div><dt className="text-slate-400">Unit cost</dt><dd className="font-medium">{inr(i.unitCostPaise)}</dd></div>
                <div className="col-span-2"><dt className="text-slate-400">Last purchase</dt><dd className="font-medium">{i.lastPurchase ? `${dateTime(i.lastPurchase.at)} · ${i.lastPurchase.supplier ?? "—"}` : "—"}</dd></div>
              </dl>
              {can("inventory.manage") && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setMode({ kind: "purchase", item: i })}>Buy</Button>
                  <Button size="sm" onClick={() => setMode({ kind: "consume", item: i })}>Use</Button>
                  <Button size="sm" onClick={() => setMode({ kind: "adjust", item: i })}>Adjust</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      ))}

      {tab === "spend" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Monthly consumable expenditure" subtitle="Purchases by category (₹)">
            {months.length === 0 ? <EmptyState icon="rupee" title="No purchases recorded" /> : (
              <>
                <Chart title="Monthly consumable expenditure" labels={months.map((m) => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" }))} series={cats.map((c) => ({ name: INVENTORY_CATEGORIES[c], color: CAT_COLOR[c], values: months.map((m) => ((data?.monthly ?? []) as Row[]).filter((x) => x.month === m && x.category === c).reduce((a, x) => a + x.spendPaise / 100, 0)) }))} fmt={(n) => "₹" + Math.round(n).toLocaleString("en-IN")} axisFmt={(n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n)))} />
                <div className="mt-2"><Legend items={cats.map((c) => ({ name: INVENTORY_CATEGORIES[c], color: CAT_COLOR[c] }))} /></div>
              </>
            )}
          </Card>
          <Card title="Purchase history" padded={false}>
            <DataList rows={data?.movements?.filter((m: Row) => m.kind === "purchase")} cols={ledgerCols} rowKey={(m) => m.id} loading={loading} empty={<EmptyState icon="inventory" title="No purchases yet" />} />
          </Card>
        </div>
      )}
      {tab === "ledger" && <Card padded={false} title="Stock movements & manual adjustments"><div className="pt-3"><DataList rows={data?.movements} cols={ledgerCols} rowKey={(m) => m.id} loading={loading} /></div></Card>}

      <StockModal mode={mode} onClose={() => setMode(null)} onDone={() => { setMode(null); reload(); }} />
    </div>
  );
}

function StockModal({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const k = mode?.kind;
  const it = mode?.item;
  const submit = async () => {
    setBusy(true);
    try {
      const body: Row = k === "create" ? { action: "create", ...f } : { action: k, itemId: it?.id, ...f };
      const r = await api<Row>("/api/admin/inventory", { method: "POST", body });
      toast("success", r.message);
      setF({});
      onDone();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const title = k === "create" ? "New inventory item" : k === "purchase" ? `Record purchase · ${it?.name}` : k === "consume" ? `Record usage · ${it?.name}` : `Manual stock adjustment · ${it?.name}`;
  return (
    <Modal open={!!mode} onClose={() => { onClose(); setF({}); }} title={title} size="md" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-4">
        {k === "create" && (
          <>
            <Field label="Name"><Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU"><Input value={f.sku ?? ""} onChange={(e) => set("sku", e.target.value)} autoCapitalize="characters" /></Field>
              <Field label="Category"><Select value={f.category ?? "paper"} onChange={(e) => set("category", e.target.value)}>{Object.entries(INVENTORY_CATEGORIES).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</Select></Field>
              <Field label="Unit (e.g. sheets)"><Input value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} /></Field>
              <Field label="Reorder threshold"><Input type="number" inputMode="numeric" value={f.reorderThreshold ?? ""} onChange={(e) => set("reorderThreshold", e.target.value)} /></Field>
              <Field label="Unit cost (₹)"><Input type="number" inputMode="decimal" value={f.unitCostRupees ?? ""} onChange={(e) => set("unitCostRupees", e.target.value)} /></Field>
            </div>
          </>
        )}
        {(k === "purchase" || k === "consume" || k === "adjust") && (
          <>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Current stock: <b>{num(it?.stock)} {it?.unit}</b></p>
            <Field label={k === "adjust" ? "Change (use − to reduce)" : "Quantity"} hint={k === "adjust" ? "e.g. -120 for damaged stock, +50 for a recount" : undefined}><Input type="number" inputMode="numeric" value={f.qty ?? ""} onChange={(e) => set("qty", e.target.value)} /></Field>
            {k === "purchase" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit cost (₹)"><Input type="number" inputMode="decimal" step="0.01" value={f.unitCostRupees ?? String((it?.unitCostPaise ?? 0) / 100)} onChange={(e) => set("unitCostRupees", e.target.value)} /></Field>
                <Field label="Supplier"><Input value={f.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} /></Field>
                <Field label="Invoice / reference"><Input value={f.reference ?? ""} onChange={(e) => set("reference", e.target.value)} /></Field>
              </div>
            )}
            <Field label={k === "adjust" ? "Reason (required, audited)" : "Note"}><Textarea value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} rows={2} /></Field>
          </>
        )}
        <p className="flex items-center gap-2 text-xs text-slate-500"><Icon name="audit" className="h-4 w-4" />Every change is written to the audit ledger with your name.</p>
      </div>
    </Modal>
  );
}
