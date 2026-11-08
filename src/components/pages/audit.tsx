"use client";

import { useEffect, useState } from "react";
import type { Row } from "@/components/domain";
import { Badge, Card, Col, DataList, KV, Modal, PageHeader, Pagination, RangePicker, SearchInput, Select, presetRange, type Range } from "@/components/ui";
import { qs, useApi, useDebounced } from "@/lib/client";
import { dateTime, relTime, titleCase } from "@/lib/format";
import { ROLES } from "@/lib/rbac";

const AREAS = ["auth", "job", "refund", "payment", "printer", "kiosk", "pricing", "inventory", "alert", "settings", "user", "role", "session", "quick", "report", "notifications", "push", "profile", "demo"];
const tone = (a: string) => (a.startsWith("refund") || a.startsWith("pricing") ? "amber" : a.includes("failed") || a.startsWith("user") || a.startsWith("role") ? "red" : a.startsWith("auth") ? "slate" : "blue") as "amber" | "red" | "slate" | "blue";

export default function Audit() {
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [range, setRange] = useState<Range | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Row | null>(null);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, area, range]);
  const { data, error, loading, reload } = useApi<Row>(`/api/admin/audit${qs({ q: dq, area, page, from: range?.from, to: range?.to })}`, { interval: 30000 });

  const cols: Col<Row>[] = [
    { key: "action", header: "Action", primary: true, render: (a) => <div className="min-w-0"><Badge tone={tone(a.action)}>{a.action}</Badge>{a.entityId && <span className="ml-2 font-mono text-xs text-slate-500">{a.entity} {a.entityId}</span>}</div> },
    { key: "when", header: "When", secondary: true, render: (a) => <span className="whitespace-nowrap text-xs text-slate-500" title={dateTime(a.createdAt)}>{relTime(a.createdAt)}</span> },
    { key: "who", header: "Administrator", render: (a) => <span className="text-[13px]">{a.userName}{a.role && <span className="text-slate-400"> · {ROLES[a.role as keyof typeof ROLES] ?? a.role}</span>}</span> },
    { key: "ip", header: "IP", hideBelow: "lg", render: (a) => <span className="font-mono text-xs text-slate-500">{a.ip ?? "—"}</span> },
    { key: "details", header: "Details", hideBelow: "lg", render: (a) => <span className="line-clamp-1 max-w-xs text-xs text-slate-500">{summarize(a.details)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Activity & Audit Logs" subtitle="Every pricing change, refund, printer and kiosk action — who, what, when" />
      <Card padded={false}>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Search action, admin or entity" />
            <Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)} className="md:w-52"><option value="">All areas</option>{AREAS.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</Select>
          </div>
          {range ? <div className="flex flex-wrap items-center gap-3"><RangePicker value={range} onChange={setRange} /><button onClick={() => setRange(null)} className="min-h-11 text-[13px] text-slate-500 md:min-h-0">Clear dates</button></div> : <button onClick={() => setRange(presetRange("7d"))} className="inline-flex min-h-11 items-center text-[13px] font-medium text-brand-600 md:min-h-0">+ Filter by date</button>}
        </div>
        <DataList rows={data?.rows} cols={cols} rowKey={(a) => a.id} loading={loading} error={error} retry={reload} onRowClick={setOpen} />
        {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
      <p className="text-xs text-slate-500">Audit entries are append-only: the dashboard offers no way to edit or delete them.</p>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ""} size="md">
        {open && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <KV label="Administrator">{open.userName}</KV>
              <KV label="Role">{ROLES[open.role as keyof typeof ROLES] ?? open.role ?? "System"}</KV>
              <KV label="Entity">{open.entity ?? "—"} {open.entityId}</KV>
              <KV label="IP address" mono>{open.ip ?? "—"}</KV>
              <KV label="Time">{dateTime(open.createdAt)}</KV>
            </dl>
            <pre className="scroll-thin max-h-72 overflow-auto rounded-lg bg-navy-900 p-3 text-xs leading-relaxed text-slate-200">{JSON.stringify(open.details ?? {}, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}

function summarize(d: unknown) {
  if (!d || typeof d !== "object") return "";
  const s = JSON.stringify(d);
  return s === "{}" ? "" : s.slice(0, 120);
}
