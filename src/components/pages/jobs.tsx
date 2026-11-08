"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { JobDetail, JobFilterSelect } from "@/components/job-detail";
import { JobBadge, ModeBadge, PayBadge, type Row } from "@/components/domain";
import { Card, Col, DataList, LiveBadge, PageHeader, Pagination, RangePicker, SearchInput, type Range, type SortState, presetRange, cx } from "@/components/ui";
import { JOB_STATUS, PAYMENT_STATUS } from "@/lib/constants";
import { dateTime, inr, relTime } from "@/lib/format";
import { qs, useApi, useDebounced } from "@/lib/client";

export default function Jobs() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [payment, setPayment] = useState("");
  const [mode, setMode] = useState("");
  const [printer, setPrinter] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "created", dir: "desc" });
  const [range, setRange] = useState<Range | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status, payment, mode, printer, range, sort]);

  const url = `/api/admin/jobs${qs({ q: dq, status, payment, mode, printer, page, sort: sort.key, dir: sort.dir, from: range?.from, to: range?.to })}`;
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>(url, { interval: 15000 });
  const { data: pr } = useApi<Row>("/api/admin/printers");

  const cols: Col<Row>[] = [
    { key: "id", header: "Job", sort: "id", primary: true, render: (j) => <div className="min-w-0"><p className="font-mono text-[13px] font-medium text-slate-900">{j.id}</p><p className="truncate text-xs text-slate-500">{j.fileName}</p></div> },
    { key: "status", header: "Status", sort: "status", secondary: true, render: (j) => <JobBadge s={j.status} /> },
    { key: "customer", header: "Customer", render: (j) => <span className="font-mono text-xs">{j.customerRef}</span> },
    { key: "pages", header: "Pages", sort: "pages", render: (j) => <span className="tabular">{j.pages}{j.copies > 1 ? ` ×${j.copies}` : ""}<span className="text-slate-400"> · {j.pagesPrinted} printed</span></span> },
    { key: "mode", header: "Mode", render: (j) => <ModeBadge mode={j.colorMode} /> },
    { key: "layout", header: "Layout", hideBelow: "lg", render: (j) => <span className="text-[13px]">{j.sided === "double" ? "Duplex" : "Simplex"} · {j.pagesPerSheet}-up</span> },
    { key: "amount", header: "Amount", sort: "amount", align: "right", render: (j) => <span className="font-medium tabular">{inr(j.amountPaise)}</span> },
    { key: "payment", header: "Payment", render: (j) => <PayBadge s={j.paymentStatus} /> },
    { key: "printer", header: "Printer", hideBelow: "lg", render: (j) => <span className="text-[13px]">{j.printerId ?? "—"}</span> },
    { key: "created", header: "Created", sort: "created", render: (j) => <span title={dateTime(j.createdAt)} className="whitespace-nowrap text-xs text-slate-500">{relTime(j.createdAt)}</span> },
  ];

  const chips = ["", "failed", "partially_completed", "refund_pending", "queued", "printing", "completed"];

  return (
    <div className="space-y-4">
      <PageHeader title="Print Jobs" subtitle="Search, inspect and operate every job" actions={<LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} />} />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {chips.map((c) => {
          const n = c ? data?.statusCounts?.[c] ?? 0 : Object.values<number>(data?.statusCounts ?? {}).reduce((a, b) => a + b, 0);
          return (
            <button key={c || "all"} onClick={() => setStatus(c)} className={cx("flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-inset transition md:min-h-9", status === c ? "bg-navy-800 text-white ring-navy-800" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50")}>
              {c ? JOB_STATUS[c].label : "All"}<span className={cx("tabular text-xs", status === c ? "text-slate-300" : "text-slate-400")}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card padded={false}>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Search job ID, customer ref or file" />
            <div className="grid grid-cols-2 gap-2 md:flex">
              <JobFilterSelect label="Status" value={status} onChange={setStatus}><option value="">Any status</option>{Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</JobFilterSelect>
              <JobFilterSelect label="Payment" value={payment} onChange={setPayment}><option value="">Any payment</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</JobFilterSelect>
              <JobFilterSelect label="Colour mode" value={mode} onChange={setMode}><option value="">Any mode</option><option value="bw">B&W only</option><option value="color">Colour only</option></JobFilterSelect>
              <JobFilterSelect label="Printer" value={printer} onChange={setPrinter}><option value="">Any printer</option>{pr?.printers?.map((p: Row) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}</JobFilterSelect>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {range ? <RangePicker value={range} onChange={setRange} presets={["today", "7d", "30d"]} /> : <button onClick={() => setRange(presetRange("7d"))} className="inline-flex min-h-11 items-center text-[13px] font-medium text-brand-600 md:min-h-0">+ Filter by date</button>}
            {range && <button onClick={() => setRange(null)} className="inline-flex min-h-11 items-center text-[13px] text-slate-500 md:min-h-0">Clear dates</button>}
            {(q || status || payment || mode || printer || range) && <button onClick={() => { setQ(""); setStatus(""); setPayment(""); setMode(""); setPrinter(""); setRange(null); }} className="ml-auto inline-flex min-h-11 items-center text-[13px] font-medium text-slate-600 md:min-h-0">Reset all</button>}
          </div>
        </div>
        <DataList rows={data?.rows} cols={cols} rowKey={(j) => j.id} loading={loading} error={error} retry={reload} sort={sort} onSort={setSort} onRowClick={(j) => setOpenId(j.id)} />
        {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>

      <JobDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
