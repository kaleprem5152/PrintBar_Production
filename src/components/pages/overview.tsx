"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chart, Donut, HBar, Legend, PALETTE } from "@/components/charts";
import { AlertRow, Heartbeat, hourLabel, KioskBadge, PrinterMiniStatus, shortDate, type Row } from "@/components/domain";
import { Badge, Card, EmptyState, ErrorState, Icon, KpiCard, LiveBadge, PageHeader, presetRange, RangePicker, Skeleton, type Range } from "@/components/ui";
import { SEVERITY } from "@/lib/constants";
import { inr, num, pct } from "@/lib/format";
import { qs, useApi, useCan } from "@/lib/client";

export default function Overview() {
  const router = useRouter();
  const can = useCan();
  const [range, setRange] = useState<Range>(presetRange("today"));
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>(`/api/admin/overview${qs({ from: range.from, to: range.to })}`, { interval: 15000 });

  if (error && !data) return <ErrorState error={error} retry={reload} />;
  const k = data?.kpis;
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const successRate = k ? pct(k.completed, k.completed + k.failed) : "—";
  const periodLabel = range.preset === "today" ? "today" : range.preset === "custom" ? "selected range" : `last ${data?.range.days ?? ""} days`;

  const series: Row[] = data?.series ?? [];
  const labels = series.map((s) => shortDate(s.date));

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Live operational picture across all kiosks"
        actions={<><LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} /></>}
      />
      <RangePicker value={range} onChange={setRange} />

      {/* attention */}
      {data && (data.alerts.length > 0 || k.failedNeedingAction > 0 || k.refundsPendingCount > 0) && (
        <Card
          title="Needs attention"
          action={<Link href="/admin/notifications?tab=alerts" className="inline-flex min-h-11 items-center text-[13px] font-medium text-brand-600 md:min-h-0">All alerts →</Link>}
        >
          <div className="space-y-2">
            {data.alerts.slice(0, 3).map((a: Row) => <AlertRow key={a.id} a={a} />)}
            <div className="grid gap-2 sm:grid-cols-2">
              {k.failedNeedingAction > 0 && can("jobs.view") && (
                <Link href="/admin/jobs?status=failed" className="flex min-h-11 items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[13px] hover:bg-slate-100">
                  <span className="flex items-center gap-2"><Icon name="jobs" className="h-4 w-4 text-red-500" />{k.failedNeedingAction} failed job{k.failedNeedingAction > 1 ? "s" : ""} to review</span><Icon name="chevronRight" className="h-4 w-4 text-slate-400" />
                </Link>
              )}
              {k.refundsPendingCount > 0 && can("payments.view") && (
                <Link href="/admin/payments?tab=refunds" className="flex min-h-11 items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[13px] hover:bg-slate-100">
                  <span className="flex items-center gap-2"><Icon name="undo" className="h-4 w-4 text-amber-500" />{k.refundsPendingCount} refund{k.refundsPendingCount > 1 ? "s" : ""} in flight · {inr(k.refundsPendingPaise)}</span><Icon name="chevronRight" className="h-4 w-4 text-slate-400" />
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {!k
          ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
          : (
            <>
              <KpiCard label="Revenue" icon="rupee" tone="green" value={inr(k.revenuePaise)} delta={range.preset !== "custom" ? delta(k.revenuePaise, k.revenuePrevPaise) : null} sub={`${k.payments.ok} payments · ${periodLabel}`} />
              <KpiCard label="Successful jobs" icon="checkCircle" tone="green" value={num(k.completed)} delta={delta(k.completed, k.completedPrev)} sub={`${successRate} success`} onClick={() => router.push("/admin/jobs?status=completed")} />
              <KpiCard label="Pages printed" icon="file" tone="blue" value={num(k.pages)} sub={periodLabel} />
              <KpiCard label="B&W pages" icon="file" tone="slate" value={num(k.bwPages)} sub={pct(k.bwPages, k.pages) + " of volume"} />
              <KpiCard label="Colour pages" icon="file" tone="violet" value={num(k.colorPages)} sub={pct(k.colorPages, k.pages) + " of volume"} />
              <KpiCard label="Failed jobs" icon="xCircle" tone="red" alert={k.failed > 0} value={num(k.failed)} sub={`${k.failedNeedingAction} awaiting action`} onClick={() => router.push("/admin/jobs?status=failed")} />
              <KpiCard label="Pending jobs" icon="clock" tone="amber" value={num(k.pending)} sub="uploaded → printing (live)" onClick={() => router.push("/admin/jobs")} />
              <KpiCard label="Refunds" icon="undo" tone="amber" value={inr(k.refundsPaise)} sub={`${k.refundsCount} in period · ${k.refundsPendingCount} pending`} onClick={() => router.push("/admin/payments?tab=refunds")} />
              <KpiCard label="Machine uptime" icon="activity" tone={k.uptimePct != null && k.uptimePct < 95 ? "amber" : "green"} value={k.uptimePct == null ? "—" : k.uptimePct.toFixed(1) + "%"} sub="from heartbeat history" />
              <KpiCard label="Active kiosks" icon="kiosk" tone={k.activeKiosks < k.totalKiosks ? "amber" : "green"} alert={k.activeKiosks === 0 && k.totalKiosks > 0} value={`${k.activeKiosks}/${k.totalKiosks}`} sub="reporting heartbeats" onClick={() => router.push("/admin/kiosks")} />
            </>
          )}
      </div>

      {/* live machine status */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Live machine status</h2>
          <Link href="/admin/kiosks" className="inline-flex min-h-11 items-center text-[13px] font-medium text-brand-600 md:min-h-0">Manage kiosks →</Link>
        </div>
        {!data ? <Skeleton className="h-48" /> : data.kiosks.length === 0 ? (
          <Card><EmptyState icon="kiosk" title="No kiosks registered yet" hint="Kiosks appear here after they are added and their agent sends a heartbeat." /></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {data.kiosks.map((ks: Row) => (
              <Card key={ks.id} className={ks.status === "offline" ? "border-red-200" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{ks.name} <span className="font-normal text-slate-400">· {ks.id}</span></p>
                    <p className="truncate text-xs text-slate-500">{ks.location}</p>
                  </div>
                  <KioskBadge s={ks.status} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div><dt className="text-slate-400">Raspberry Pi</dt><dd className="mt-0.5 flex items-center gap-1.5 font-medium text-slate-800"><span className={`h-2 w-2 rounded-full ${ks.online ? "bg-emerald-500" : "bg-red-500"}`} />{ks.online ? "Connected" : "No heartbeat"}</dd></div>
                  <div><dt className="text-slate-400">Last heartbeat</dt><dd className="mt-0.5"><Heartbeat at={ks.lastHeartbeat} online={ks.online} /></dd></div>
                  <div><dt className="text-slate-400">Uptime</dt><dd className="mt-0.5 font-medium text-slate-800">{ks.uptimePct == null ? "—" : ks.uptimePct.toFixed(1) + "%"}</dd></div>
                </dl>
                {ks.status === "offline" && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Printer values below are last-known — the kiosk isn't reporting.</p>}
                <div className={`mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 ${ks.status === "offline" ? "opacity-60" : ""}`}>
                  {ks.printers.map((p: Row) => <PrinterMiniStatus key={p.id} p={p} />)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Hourly printing activity" subtitle={`Jobs by hour (IST) · ${periodLabel}`}>
          {!data ? <Skeleton className="h-[200px]" /> : <Chart title="Hourly jobs" labels={data.hours.map((h: Row) => hourLabel(h.hour))} series={[{ name: "Jobs", color: PALETTE.blue, values: data.hours.map((h: Row) => h.jobs - h.failed) }, { name: "Failed", color: PALETTE.red, values: data.hours.map((h: Row) => h.failed) }]} />}
          <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Most active hours (30 days):{" "}
            {data?.peakHours?.length ? data.peakHours.map((p: Row) => <Badge key={p.hour} tone="blue" className="ml-1">{hourLabel(p.hour)}–{hourLabel((p.hour + 1) % 24)} · {p.jobs}</Badge>) : "—"}
          </div>
        </Card>
        <Card title="Daily revenue" subtitle="Successful payments">
          {!data ? <Skeleton className="h-[200px]" /> : <Chart title="Daily revenue" labels={labels} series={[{ name: "Revenue", color: PALETTE.green, values: series.map((s) => s.revenuePaise / 100) }]} fmt={(n) => "₹" + Math.round(n).toLocaleString("en-IN")} axisFmt={(n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n)))} />}
        </Card>
        <Card title="B&W vs colour pages" subtitle="Pages printed per day">
          {!data ? <Skeleton className="h-[200px]" /> : (
            <>
              <Chart title="B&W vs colour pages" labels={labels} series={[{ name: "B&W", color: PALETTE.navy, values: series.map((s) => s.bwPages) }, { name: "Colour", color: PALETTE.violet, values: series.map((s) => s.colorPages) }]} />
              <div className="mt-2 flex items-center justify-between"><Legend items={[{ name: "B&W", color: PALETTE.navy }, { name: "Colour", color: PALETTE.violet }]} /></div>
            </>
          )}
        </Card>
        <Card title="Successful vs failed jobs" subtitle="Per day">
          {!data ? <Skeleton className="h-[200px]" /> : (
            <>
              <Chart title="Successful vs failed jobs" labels={labels} series={[{ name: "Successful", color: PALETTE.green, values: series.map((s) => s.completed) }, { name: "Failed", color: PALETTE.red, values: series.map((s) => s.failed) }]} />
              <div className="mt-2"><Legend items={[{ name: "Successful", color: PALETTE.green }, { name: "Failed", color: PALETTE.red }]} /></div>
            </>
          )}
        </Card>
        <Card title="Payment trends" subtitle="Payment attempts by outcome">
          {!data ? <Skeleton className="h-[200px]" /> : (
            <>
              <Chart type="line" area={false} title="Payment trends" labels={labels} series={[{ name: "Paid", color: PALETTE.green, values: series.map((s) => s.paymentsOk) }, { name: "Failed", color: PALETTE.red, values: series.map((s) => s.paymentsFailed) }, { name: "Pending", color: PALETTE.amber, values: series.map((s) => s.paymentsPending) }]} />
              <div className="mt-2"><Legend items={[{ name: "Paid", color: PALETTE.green }, { name: "Failed", color: PALETTE.red }, { name: "Pending", color: PALETTE.amber }]} /></div>
            </>
          )}
        </Card>
        <Card title="Print mix" subtitle={periodLabel}>
          {!data ? <Skeleton className="h-[160px]" /> : k.pages === 0 ? <EmptyState icon="file" title="No pages printed in this range" /> : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <Donut label="B&W versus colour" segments={[{ name: "B&W", value: k.bwPages, color: PALETTE.navy }, { name: "Colour", value: k.colorPages, color: PALETTE.violet }]} center={<div><p className="text-lg font-semibold tabular">{num(k.pages)}</p><p className="text-[11px] text-slate-500">pages</p></div>} />
              <div className="w-full min-w-0 flex-1"><HBar items={[{ label: "B&W", value: k.bwPages, sub: pct(k.bwPages, k.pages) }, { label: "Colour", value: k.colorPages, sub: pct(k.colorPages, k.pages) }]} fmt={num} color={PALETTE.blue} /></div>
            </div>
          )}
        </Card>
      </div>
      {data && data.alerts.length === 0 && k.failedNeedingAction === 0 && (
        <p className="flex items-center justify-center gap-2 py-2 text-[13px] text-slate-500"><Badge tone="green" dot>All clear</Badge> No open alerts. Severity scale: {Object.values(SEVERITY).map((s) => s.label).join(" · ")}</p>
      )}
    </div>
  );
}
