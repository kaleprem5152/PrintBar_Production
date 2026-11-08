"use client";

import { useState } from "react";
import { Chart, Donut, HBar, Legend, PALETTE } from "@/components/charts";
import { shortDate, type Row } from "@/components/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, KpiCard, LiveBadge, Notice, PageHeader, presetRange, RangePicker, Segmented, Skeleton, type Range } from "@/components/ui";
import { qs, useApi, useCan } from "@/lib/client";
import { dateOnly, inr, num, pct } from "@/lib/format";

const money = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const axisMoney = (n: number) => (n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(Math.round(n)));

export default function Analytics() {
  const can = useCan();
  const [range, setRange] = useState<Range>(presetRange("30d"));
  const [g, setG] = useState<"auto" | "day" | "week" | "month">("auto");
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>(`/api/admin/analytics${qs({ from: range.from, to: range.to, g: g === "auto" ? "" : g })}`, { interval: 60000 });
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  const s = data?.summary;
  const series: Row[] = data?.series ?? [];
  const lbl = (b: string) => (data?.range.granularity === "month" ? new Date(b).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : data?.range.granularity === "week" ? "Wk " + shortDate(b) : shortDate(b));
  const labels = series.map((r) => lbl(r.bucket));
  const exportQ = qs({ from: range.from, to: range.to });

  const pl: { label: string; value: number; kind: "plus" | "minus" | "total"; hint: string }[] = s ? [
    { label: "Gross revenue", value: s.grossRevenuePaise, kind: "plus", hint: "Successful customer payments" },
    { label: "Refunds", value: -s.refundsPaise, kind: "minus", hint: "Requested/processing/confirmed refunds" },
    { label: "Net revenue", value: s.netRevenuePaise, kind: "total", hint: "Revenue after refunds" },
    { label: "Payment gateway charges", value: -s.gatewayFeesPaise, kind: "minus", hint: "Cashfree fees on successful payments" },
    { label: "Consumables (procurement)", value: -s.consumablesPaise, kind: "minus", hint: "Paper, toner, ink, drums, parts bought in period" },
    { label: "Operating contribution", value: s.contributionPaise, kind: "total", hint: "Net revenue − gateway − consumables" },
    { label: `Fixed costs${s.fixedCostsConfigured ? "" : " (not configured)"}`, value: -s.fixedCostsPaise, kind: "minus", hint: "Rent, power, connectivity — prorated from Settings" },
    { label: "Net profit", value: s.netProfitPaise, kind: "total", hint: "Contribution − fixed costs" },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="hidden print:block"><h1 className="text-xl font-bold">PrintBar — Financial & Operations Report</h1><p className="text-sm text-slate-600">{dateOnly(range.from)} to {dateOnly(range.to)} · generated {new Date().toLocaleString("en-IN")}</p></div>
      <div className="no-print">
        <PageHeader title="Analytics & Reports" subtitle="Revenue, costs, contribution and utilisation" actions={<LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} />} />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <RangePicker value={range} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={g} onChange={setG} options={[{ value: "auto", label: "Auto" }, { value: "day", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} />
          </div>
        </div>
        {can("reports.export") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["jobs", "payments", "refunds"] as const).map((t) => <a key={t} href={`/api/admin/reports/export${qs({ type: t, from: range.from, to: range.to })}`} download className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 md:min-h-9"><Icon name="download" className="h-4 w-4" />CSV · {t}</a>)}
            <Button icon="file" onClick={() => window.print()}>Export PDF</Button>
          </div>
        )}
        <span className="hidden">{exportQ}</span>
      </div>

      {loading && !data ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div> : s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Gross revenue" icon="rupee" tone="green" value={inr(s.grossRevenuePaise)} sub={`${s.completed} completed jobs`} />
            <KpiCard label="Net revenue" icon="trending" tone="blue" value={inr(s.netRevenuePaise)} sub={`after ${inr(s.refundsPaise)} refunds`} />
            <KpiCard label="Operating contribution" icon="analytics" tone="violet" value={inr(s.contributionPaise)} sub={pct(s.contributionPaise, s.netRevenuePaise) + " of net revenue"} />
            <KpiCard label="Net profit" icon="rupee" tone={s.netProfitPaise >= 0 ? "green" : "red"} value={inr(s.netProfitPaise)} sub={s.fixedCostsConfigured ? "after fixed costs" : "fixed costs not set"} />
            <KpiCard label="Pages printed" icon="file" tone="blue" value={num(s.pages)} sub={`${num(s.bwPages)} B&W · ${num(s.colorPages)} colour`} />
            <KpiCard label="Cost per page" icon="rupee" tone="amber" value={s.costPerPagePaise == null ? "—" : "₹" + (s.costPerPagePaise / 100).toFixed(2)} sub="consumables + gateway ÷ pages" />
            <KpiCard label="Gateway charges" icon="payments" tone="slate" value={inr(s.gatewayFeesPaise)} sub={pct(s.gatewayFeesPaise, s.grossRevenuePaise, 1) + " of gross"} />
            <KpiCard label="Machine uptime" icon="activity" tone="green" value={s.uptimePct == null ? "—" : s.uptimePct.toFixed(2) + "%"} sub="all kiosks" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card title="Profit & loss" subtitle="Revenue, costs, contribution and net profit are distinct measures">
              <ul className="divide-y divide-slate-100">
                {pl.map((r) => (
                  <li key={r.label} className={`flex items-center justify-between gap-3 py-2.5 ${r.kind === "total" ? "bg-slate-50/80 px-2 -mx-2 rounded-lg" : ""}`}>
                    <div className="min-w-0"><p className={`text-sm ${r.kind === "total" ? "font-semibold text-slate-900" : "text-slate-700"}`}>{r.kind === "minus" ? "− " : ""}{r.label}</p><p className="text-xs text-slate-400">{r.hint}</p></div>
                    <p className={`shrink-0 tabular ${r.kind === "total" ? "text-base font-semibold" : "text-sm"} ${r.value < 0 && r.kind === "total" ? "text-red-600" : "text-slate-900"}`}>{inr(Math.abs(r.value))}{r.value < 0 && r.kind === "total" ? " loss" : ""}</p>
                  </li>
                ))}
              </ul>
              {!s.fixedCostsConfigured && <div className="mt-3"><Notice tone="amber" title="Net profit is overstated">No fixed costs are configured, so net profit equals contribution. Add monthly fixed costs in Settings → Operations → Finance.</Notice></div>}
            </Card>
            <Card title="Revenue by print type" subtitle="Share of successful payments">
              {s.bwRevenuePaise + s.colorRevenuePaise === 0 ? <EmptyState icon="rupee" title="No revenue in range" /> : (
                <div className="flex flex-col items-center gap-5 sm:flex-row">
                  <Donut label="B&W vs colour revenue" segments={[{ name: "B&W", value: s.bwRevenuePaise, color: PALETTE.navy }, { name: "Colour", value: s.colorRevenuePaise, color: PALETTE.violet }]} center={<div><p className="text-sm font-semibold tabular">{pct(s.colorRevenuePaise, s.bwRevenuePaise + s.colorRevenuePaise)}</p><p className="text-[11px] text-slate-500">colour</p></div>} />
                  <div className="w-full flex-1"><HBar items={[{ label: "B&W revenue", value: s.bwRevenuePaise / 100 }, { label: "Colour revenue", value: s.colorRevenuePaise / 100 }]} fmt={money} /></div>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`${data.range.granularity === "day" ? "Daily" : data.range.granularity === "week" ? "Weekly" : "Monthly"} revenue`} subtitle="Gross successful payments">
              <Chart title="Revenue" labels={labels} series={[{ name: "Revenue", color: PALETTE.green, values: series.map((r) => r.revenuePaise / 100) }]} fmt={money} axisFmt={axisMoney} />
            </Card>
            <Card title="Revenue vs refunds & costs" subtitle="Gateway charges, refunds and consumables">
              <Chart type="line" area={false} title="Revenue vs costs" labels={labels} series={[{ name: "Revenue", color: PALETTE.green, values: series.map((r) => r.revenuePaise / 100) }, { name: "Refunds", color: PALETTE.red, values: series.map((r) => r.refundsPaise / 100) }, { name: "Gateway", color: PALETTE.amber, values: series.map((r) => r.feesPaise / 100) }, { name: "Consumables", color: PALETTE.violet, values: series.map((r) => r.consumablesPaise / 100) }]} fmt={money} axisFmt={axisMoney} />
              <div className="mt-2"><Legend items={[{ name: "Revenue", color: PALETTE.green }, { name: "Refunds", color: PALETTE.red }, { name: "Gateway", color: PALETTE.amber }, { name: "Consumables", color: PALETTE.violet }]} /></div>
            </Card>
            <Card title="Printing volume" subtitle="Pages printed: B&W vs colour">
              <Chart title="Pages" labels={labels} series={[{ name: "B&W", color: PALETTE.navy, values: series.map((r) => r.bwPages) }, { name: "Colour", color: PALETTE.violet, values: series.map((r) => r.colorPages) }]} />
              <div className="mt-2"><Legend items={[{ name: "B&W", color: PALETTE.navy }, { name: "Colour", color: PALETTE.violet }]} /></div>
            </Card>
            <Card title="Payment success trend" subtitle="Paid vs failed payments">
              <Chart title="Payments" labels={labels} series={[{ name: "Paid", color: PALETTE.green, values: series.map((r) => r.paymentsOk) }, { name: "Failed", color: PALETTE.red, values: series.map((r) => r.paymentsFailed) }]} />
              <div className="mt-2"><Legend items={[{ name: "Paid", color: PALETTE.green }, { name: "Failed", color: PALETTE.red }]} /></div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Printer utilisation" subtitle="Share of pages printed in range">
              {data.printers.length === 0 ? <EmptyState icon="printer" title="No printing in range" /> : (
                <ul className="space-y-4">
                  {data.printers.map((p: Row) => (
                    <li key={p.printerId}>
                      <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-slate-700">{p.printerId}</span><span className="text-slate-500 tabular">{num(p.pages)} pages · {p.jobs} jobs · {pct(p.failed, p.jobs)} failed</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${p.sharePct}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Machine uptime by kiosk" subtitle="From recorded heartbeat gaps">
              <ul className="space-y-4">
                {Object.entries(data.uptime as Record<string, number | null>).map(([id, v]) => (
                  <li key={id}>
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-slate-700">{id}</span>{v == null ? <Badge tone="slate">no data</Badge> : <span className="tabular text-slate-600">{v.toFixed(2)}%</span>}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${v != null && v < 95 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${v ?? 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
