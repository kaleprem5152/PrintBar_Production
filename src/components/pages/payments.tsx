"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { JobDetail } from "@/components/job-detail";
import { PayBadge, RefundBadge, type Row } from "@/components/domain";
import { Badge, Button, Card, Col, DataList, KpiCard, LiveBadge, Notice, PageHeader, Pagination, presetRange, RangePicker, SearchInput, Select, Tabs, useUi, type Range, type SortState } from "@/components/ui";
import { api, qs, useApi, useCan, useDebounced } from "@/lib/client";
import { dateTime, inr, relTime } from "@/lib/format";

type Tab = "transactions" | "refunds";

export default function Payments() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "refunds" ? "refunds" : "transactions");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "created", dir: "desc" });
  const [range, setRange] = useState<Range>(presetRange("30d"));
  const dq = useDebounced(q);
  const { toast } = useUi();
  const can = useCan();
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setPage(1), [dq, status, method, range, sort, tab]);
  useEffect(() => setStatus(tab === "refunds" ? (sp.get("status") ?? "") : (sp.get("status") ?? "")), [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useApi<Row>(tab === "transactions" ? `/api/admin/payments${qs({ q: dq, status, method, page, sort: sort.key, dir: sort.dir, from: range.from, to: range.to })}` : `/api/admin/payments${qs({ from: range.from, to: range.to, size: 1 })}`, { interval: 20000 });
  const ref = useApi<Row>(tab === "refunds" ? `/api/admin/refunds${qs({ q: dq, status, page })}` : null, { interval: 20000 });
  const reload = () => { pay.reload(); ref.reload(); };
  const s = pay.data?.summary;
  const rs = pay.data?.refundSummary;
  const gw = pay.data?.gateway;

  const reconcile = async (id: number) => {
    setBusy(id);
    try { const r = await api<Row>("/api/admin/refunds", { method: "POST", body: { action: "reconcile", id } }); toast(r.refund.status === "failed" ? "error" : "success", r.message); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };

  const payCols: Col<Row>[] = [
    { key: "order", header: "Order", primary: true, render: (p) => <div className="min-w-0"><p className="font-mono text-[13px] font-medium text-slate-900">{p.orderId}</p><p className="truncate font-mono text-xs text-slate-500">{p.transactionId ?? "no transaction"}</p></div> },
    { key: "amount", header: "Amount", sort: "amount", align: "right", secondary: true, render: (p) => <span className="font-medium tabular">{inr(p.amountPaise)}</span> },
    { key: "status", header: "Status", render: (p) => <PayBadge s={p.status} /> },
    { key: "method", header: "Method", render: (p) => <span className="text-[13px] uppercase">{p.method ?? "—"}</span> },
    { key: "fee", header: "Gateway fee", sort: "fee", align: "right", render: (p) => <span className="tabular">{p.status === "success" ? inr(p.feePaise) : "—"}</span> },
    { key: "refund", header: "Refund", render: (p) => p.refundedPaise > 0 ? <Badge tone="violet">{inr(p.refundedPaise)} refunded</Badge> : <span className="text-slate-400">—</span> },
    { key: "cust", header: "Customer sees", hideBelow: "lg", render: (p) => <span className="text-xs text-slate-600">{p.customerStatus ?? "—"}</span> },
    { key: "job", header: "Job", render: (p) => <span className="font-mono text-xs text-brand-600">{p.jobId}</span> },
    { key: "created", header: "Time", sort: "created", render: (p) => <span title={dateTime(p.createdAt)} className="whitespace-nowrap text-xs text-slate-500">{relTime(p.createdAt)}</span> },
  ];
  const refCols: Col<Row>[] = [
    { key: "ref", header: "Refund", primary: true, render: (r) => <div className="min-w-0"><p className="font-mono text-[13px] font-medium text-slate-900">{r.refundRef}</p><p className="truncate text-xs text-slate-500">{r.reason}</p></div> },
    { key: "status", header: "Status", secondary: true, render: (r) => <RefundBadge s={r.status} /> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-medium tabular">{inr(r.amountPaise)} <span className="text-xs font-normal text-slate-400">{r.type}</span></span> },
    { key: "job", header: "Job", render: (r) => <span className="font-mono text-xs text-brand-600">{r.jobId}</span> },
    { key: "gw", header: "Gateway ref", hideBelow: "lg", render: (r) => <div className="text-xs"><p className="font-mono">{r.gatewayRefundId ?? "not submitted"}</p><p className="text-slate-400">{r.gatewayMessage ?? r.gatewayStatus ?? ""}</p></div> },
    { key: "by", header: "Initiated by", render: (r) => <span className="text-[13px]">{r.initiatedBy}</span> },
    { key: "created", header: "Created", render: (r) => <span className="whitespace-nowrap text-xs text-slate-500">{relTime(r.createdAt)}</span> },
    { key: "act", header: "", render: (r) => (r.status === "requested" || r.status === "processing") && can("refunds.manage") ? <Button size="sm" icon="refresh" loading={busy === r.id} onClick={(e) => { e.stopPropagation(); reconcile(r.id); }}>Reconcile</Button> : null },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Payments & Refunds" subtitle="Cashfree transactions, refund workflow and reconciliation" actions={<LiveBadge updatedAt={pay.updatedAt} refreshing={pay.refreshing} onRefresh={reload} />} />
      {gw && (gw.configured ? (
        <Notice tone="green" icon="checkCircle" title={`Cashfree connected (${gw.environment})`}>Credentials are held server-side and never shown. Refund success is only recorded after gateway confirmation (response, reconcile or signed webhook <code>/api/webhooks/cashfree</code>).</Notice>
      ) : (
        <Notice tone="amber" title="Cashfree is not configured on this backend">Set <code>CASHFREE_APP_ID</code>, <code>CASHFREE_SECRET_KEY</code> and <code>CASHFREE_ENV</code>. Until then refunds are recorded as <b>Requested</b> and nothing is sent to the gateway or marked successful.</Notice>
      ))}
      <RangePicker value={range} onChange={setRange} presets={["today", "7d", "30d"]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Successful" icon="checkCircle" tone="green" value={inr(s?.okPaise)} sub={`${s?.okCount ?? 0} payments`} onClick={() => { setTab("transactions"); setStatus("success"); }} />
        <KpiCard label="Pending" icon="clock" tone="amber" value={inr(s?.pendingPaise)} sub={`${s?.pendingCount ?? 0} payments`} onClick={() => { setTab("transactions"); setStatus("pending"); }} />
        <KpiCard label="Failed" icon="xCircle" tone="red" value={inr(s?.failedPaise)} sub={`${s?.failedCount ?? 0} payments`} onClick={() => { setTab("transactions"); setStatus("failed"); }} />
        <KpiCard label="Gateway fees" icon="payments" tone="slate" value={inr(s?.feesPaise)} sub="on successful payments" />
        <KpiCard label="Refunds in flight" icon="undo" tone="amber" value={inr(rs?.activePaise)} sub={`${rs?.activeCount ?? 0} awaiting gateway`} onClick={() => { setTab("refunds"); setStatus(""); }} />
        <KpiCard label="Refunded (all time)" icon="undo" tone="violet" value={inr(rs?.donePaise)} sub={`${rs?.doneCount ?? 0} confirmed`} />
      </div>

      <Tabs<Tab> value={tab} onChange={(t) => { setTab(t); setStatus(""); }} tabs={[{ value: "transactions", label: "Transactions" }, { value: "refunds", label: "Refunds", badge: rs?.activeCount || undefined }]} />
      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <SearchInput value={q} onChange={setQ} placeholder={tab === "transactions" ? "Search order, transaction, job or customer" : "Search refund ref, job or gateway id"} />
          <div className="grid grid-cols-2 gap-2 md:flex">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {tab === "transactions" ? <><option value="success">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Has refund</option></> : <><option value="requested">Requested</option><option value="processing">Processing</option><option value="success">Refunded</option><option value="failed">Failed</option></>}
            </Select>
            {tab === "transactions" && <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">All methods</option><option value="upi">UPI</option><option value="card">Card</option><option value="netbanking">Netbanking</option><option value="wallet">Wallet</option></Select>}
          </div>
        </div>
        {tab === "transactions" ? (
          <>
            <DataList rows={pay.data?.rows} cols={payCols} rowKey={(p) => p.id} loading={pay.loading} error={pay.error} retry={pay.reload} sort={sort} onSort={setSort} onRowClick={(p) => setOpenJob(p.jobId)} />
            {pay.data && <Pagination page={pay.data.page} size={pay.data.size} total={pay.data.total} onPage={setPage} />}
          </>
        ) : (
          <>
            <DataList rows={ref.data?.rows} cols={refCols} rowKey={(r) => r.id} loading={ref.loading} error={ref.error} retry={ref.reload} onRowClick={(r) => setOpenJob(r.jobId)} />
            {ref.data && <Pagination page={ref.data.page} size={ref.data.size} total={ref.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <p className="text-xs text-slate-500">To refund: open the job (tap a row) → Refund. Every refund creates an audit entry with reason, amount and administrator.</p>
      <JobDetail id={openJob} onClose={() => setOpenJob(null)} onChanged={reload} />
    </div>
  );
}
