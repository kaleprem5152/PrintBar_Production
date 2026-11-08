"use client";

import { useEffect, useState } from "react";
import { JobDetail } from "@/components/job-detail";
import { JobBadge, ModeBadge, PayBadge, RefundBadge, type Row } from "@/components/domain";
import { Badge, Card, Col, DataList, ErrorState, KV, Modal, Notice, PageHeader, Pagination, SearchInput, Skeleton, Tabs, type SortState } from "@/components/ui";
import { qs, useApi, useDebounced } from "@/lib/client";
import { dateTime, inr, num, relTime } from "@/lib/format";

export default function Customers() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "recent", dir: "desc" });
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, sort]);
  const { data, error, loading, reload } = useApi<Row>(`/api/admin/customers${qs({ q: dq, page, sort: sort.key, dir: sort.dir })}`);

  const cols: Col<Row>[] = [
    { key: "ref", header: "Customer reference", primary: true, render: (c) => <span className="font-mono text-[13px] font-medium text-slate-900">{c.ref}</span> },
    { key: "spend", header: "Total spend", sort: "spend", align: "right", secondary: true, render: (c) => <span className="font-medium tabular">{inr(c.spendPaise)}</span> },
    { key: "jobs", header: "Jobs", sort: "jobs", align: "right", render: (c) => <span className="tabular">{num(c.jobs)}</span> },
    { key: "pages", header: "Pages printed", sort: "pages", align: "right", render: (c) => <span className="tabular">{num(c.pages)}</span> },
    { key: "failed", header: "Failed", sort: "failed", align: "right", render: (c) => c.failed > 0 ? <Badge tone="red">{c.failed}</Badge> : <span className="text-slate-400">0</span> },
    { key: "refunded", header: "Refunded", align: "right", render: (c) => <span className="tabular">{c.refundedPaise ? inr(c.refundedPaise) : "—"}</span> },
    { key: "last", header: "Last activity", sort: "recent", render: (c) => <span className="whitespace-nowrap text-xs text-slate-500">{relTime(c.last)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" subtitle="Activity by anonymous customer reference" />
      <Notice tone="blue" icon="lock" title="Privacy by design">Customers are identified only by an opaque reference. No names, phone numbers or documents are stored here, and original files stay under PrintBar's automatic deletion policy — admin access can never bypass it.</Notice>
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4"><SearchInput value={q} onChange={setQ} placeholder="Search customer reference" /></div>
        <DataList rows={data?.rows} cols={cols} rowKey={(c) => c.ref} loading={loading} error={error} retry={reload} sort={sort} onSort={setSort} onRowClick={(c) => setOpen(c.ref)} />
        {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
      <CustomerDetail refId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

type Tab = "jobs" | "tx" | "refunds";
function CustomerDetail({ refId, onClose }: { refId: string | null; onClose: () => void }) {
  const { data, error, reload } = useApi<Row>(refId ? `/api/admin/customers?ref=${encodeURIComponent(refId)}` : null);
  const [tab, setTab] = useState<Tab>("jobs");
  const [job, setJob] = useState<string | null>(null);
  const jobs: Row[] = data?.jobs ?? [];
  const failed = jobs.filter((j) => ["failed", "partially_completed", "refund_pending", "refunded"].includes(j.status));
  return (
    <Modal open={!!refId} onClose={onClose} title={<span className="font-mono">{refId}</span>} size="lg">
      {error && !data ? <ErrorState error={error} retry={reload} /> : !data ? <Skeleton className="h-48" /> : (
        <div>
          <dl className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <KV label="Jobs">{jobs.length}</KV>
            <KV label="Pages printed">{num(jobs.reduce((a, j) => a + j.pagesPrinted, 0))}</KV>
            <KV label="Failed jobs">{failed.length}</KV>
            <KV label="Refunds">{data.refunds.length}</KV>
          </dl>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "jobs", label: "Jobs" }, { value: "tx", label: "Transactions" }, { value: "refunds", label: "Refunds" }]} />
          {tab === "jobs" && <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{jobs.map((j) => <li key={j.id}><button onClick={() => setJob(j.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"><span className="min-w-0"><span className="block font-mono text-[13px]">{j.id}</span><span className="flex items-center gap-2 text-xs text-slate-500"><ModeBadge mode={j.colorMode} />{j.pages}p · {inr(j.amountPaise)} · {relTime(j.createdAt)}</span></span><JobBadge s={j.status} /></button></li>)}</ul>}
          {tab === "tx" && <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{data.transactions.map((t: Row) => <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]"><span className="min-w-0"><span className="block font-mono">{t.orderId}</span><span className="text-xs text-slate-500">{dateTime(t.createdAt)} · {t.method?.toUpperCase()}</span></span><span className="text-right"><span className="block font-medium tabular">{inr(t.amountPaise)}</span><PayBadge s={t.status} /></span></li>)}</ul>}
          {tab === "refunds" && (data.refunds.length === 0 ? <p className="text-sm text-slate-500">No refunds for this customer.</p> : <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{data.refunds.map((r: Row) => <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]"><span className="min-w-0"><span className="block font-mono">{r.refundRef}</span><span className="text-xs text-slate-500">{r.reason}</span></span><span className="text-right"><span className="block font-medium tabular">{inr(r.amountPaise)}</span><RefundBadge s={r.status} /></span></li>)}</ul>)}
        </div>
      )}
      <JobDetail id={job} onClose={() => setJob(null)} onChanged={reload} />
    </Modal>
  );
}
