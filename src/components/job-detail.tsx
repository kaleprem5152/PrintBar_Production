"use client";

import { useState } from "react";
import { api, ApiErr, useApi, useCan } from "@/lib/client";
import { dateTime, inr, relTime } from "@/lib/format";
import { Badge, Button, ErrorState, Field, Icon, Input, KV, Modal, Notice, Select, Skeleton, useUi } from "./ui";
import { JobBadge, ModeBadge, PayBadge, RefundBadge, type Row } from "./domain";

export function JobDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged?: () => void }) {
  const { data, error, loading, reload } = useApi<Row>(id ? `/api/admin/jobs/${id}` : null);
  const { toast, confirm } = useUi();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const [findings, setFindings] = useState<Row[] | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Print failed — refund for unprinted pages");

  const act = async (action: string, extra: Row = {}) => {
    if (!id) return;
    setBusy(action);
    try {
      const r = await api<Row>(`/api/admin/jobs/${id}`, { method: "POST", body: { action, ...extra } });
      toast("success", r.message);
      if (r.findings) setFindings(r.findings);
      await reload();
      onChanged?.();
      return true;
    } catch (e) {
      toast("error", (e as ApiErr).message);
    } finally {
      setBusy(null);
    }
  };

  const job = data?.job;
  const total = job ? job.pages * job.copies : 0;

  return (
    <Modal open={!!id} onClose={() => { onClose(); setFindings(null); setRefundOpen(false); }} title={job ? <span className="font-mono">{job.id}</span> : "Job"} size="xl">
      {error && !data ? <ErrorState error={error} retry={reload} /> : loading || !job ? (
        <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><JobBadge s={job.status} /><PayBadge s={job.paymentStatus} /><ModeBadge mode={job.colorMode} /><span className="text-xs text-slate-500">{dateTime(job.createdAt)} · {relTime(job.createdAt)}</span></div>

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KV label="Customer ref" mono>{job.customerRef}</KV>
            <KV label="File">{job.fileName}</KV>
            <KV label="Pages × copies">{job.pages} × {job.copies} = {total}</KV>
            <KV label="Printed">{job.pagesPrinted}/{total}</KV>
            <KV label="Sides">{job.sided === "double" ? "Double-sided" : "Single-sided"}</KV>
            <KV label="Pages per sheet">{job.pagesPerSheet}</KV>
            <KV label="Printer">{job.printerId ?? "—"} <span className="text-slate-400">{job.kioskId}</span></KV>
            <KV label="Amount">{inr(job.amountPaise)}</KV>
          </dl>

          <Notice tone="blue" icon="lock" title="Customer document">
            {data.documentPolicy.deleted ? "The uploaded file has been deleted under PrintBar's retention policy." : `The uploaded file is auto-deleted ${data.documentPolicy.deleteAfterMin} min after processing.`} Admins can never open or download customer documents — only metadata is shown.
          </Notice>

          {job.errorMessage && <Notice tone="red" title={`Error: ${job.errorCode ?? "print_error"}`}>{job.errorMessage}</Notice>}

          {/* actions */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Actions</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Button icon="retry" variant="primary" disabled={!data.retry.ok || !can("jobs.manage")} loading={busy === "retry"} onClick={async () => { if (await confirm({ title: "Retry this print job?", message: "Prints the already-paid job again on a healthy printer. No new payment is created, and only one attempt can run at a time.", confirmLabel: "Retry print" })) act("retry"); }}>Retry print</Button>
              <Button icon="ban" disabled={!data.cancel.ok || !can("jobs.manage")} loading={busy === "cancel"} onClick={async () => { if (await confirm({ title: "Cancel this job?", message: "The job will not be printed. If it was paid, the customer becomes eligible for a refund.", confirmLabel: "Cancel job", tone: "danger" })) act("cancel"); }}>Cancel job</Button>
              <Button icon="undo" disabled={!data.refund.ok || !can("refunds.manage")} onClick={() => { setAmount((data.refund.eligiblePaise / 100).toFixed(2)); setRefundOpen((o) => !o); }}>Refund…</Button>
              <Button icon="refresh" disabled={!can("jobs.manage")} loading={busy === "reconcile"} onClick={() => act("reconcile")}>Reconcile</Button>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {!data.retry.ok && ["failed", "partially_completed"].includes(job.status) && <li>• Retry unavailable: {data.retry.reason}</li>}
              {!data.refund.ok && ["failed", "partially_completed", "cancelled", "refund_pending"].includes(job.status) && <li>• Refund unavailable: {data.refund.blockers[0]}</li>}
            </ul>
          </div>

          {refundOpen && data.refund.ok && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Refund calculation</h3>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KV label="Paid">{inr(data.refund.paidPaise)}</KV>
                <KV label="Verified printed">{data.refund.printedPages}/{data.refund.totalPages} pages</KV>
                <KV label="Unprinted pages">{data.refund.unprintedPages}</KV>
                <KV label="Eligible refund"><b>{inr(data.refund.eligiblePaise)}</b></KV>
              </dl>
              <p className="text-xs text-slate-600">Printed-page count comes from the attempt records below ({data.attempts.length} attempt{data.attempts.length === 1 ? "" : "s"}). Eligible = amount × unprinted ÷ total, minus refunds already made or in flight.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Refund amount (₹)" hint={`Max ${inr(data.refund.eligiblePaise)} · partial refunds allowed`}><Input type="number" inputMode="decimal" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Reason (recorded in audit trail)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
              </div>
              {!data.gateway && <Notice tone="amber" title="Cashfree not configured on this backend">The refund will be recorded as <b>Requested</b> and will not be sent or marked successful until gateway credentials are set and the refund is reconciled.</Notice>}
              <Button variant="warn" icon="undo" loading={busy === "refund"} onClick={async () => {
                const paise = Math.round(Number(amount) * 100);
                if (!(paise >= 100)) return toast("error", "Enter a valid amount (min ₹1)");
                if (await confirm({ title: `Refund ${inr(paise)}?`, message: <>Creates a {paise === data.refund.paidPaise ? "full" : "partial"} refund through Cashfree. It can't be duplicated and shows as <b>Refunded</b> only after gateway confirmation.</>, confirmLabel: "Initiate refund", tone: "warn" })) {
                  if (await act("refund", { amountPaise: paise, reason })) setRefundOpen(false);
                }
              }}>Initiate refund</Button>
            </div>
          )}

          {findings && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Reconciliation result</h3>
              <ul className="space-y-1.5 text-[13px]">{findings.map((f, i) => <li key={i} className="flex gap-2"><Badge tone={f.level === "ok" ? "green" : f.level === "warn" ? "amber" : f.level === "fixed" ? "blue" : "slate"}>{f.level}</Badge><span className="min-w-0">{f.text}</span></li>)}</ul>
            </div>
          )}

          {/* payment */}
          {data.payment ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Payment transaction</h3>
              <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-4">
                <KV label="Order ID" mono>{data.payment.orderId}</KV>
                <KV label="Transaction ID" mono>{data.payment.transactionId ?? "—"}</KV>
                <KV label="Status"><PayBadge s={data.payment.status} /></KV>
                <KV label="Method">{data.payment.method?.toUpperCase() ?? "—"}</KV>
                <KV label="Amount">{inr(data.payment.amountPaise)}</KV>
                <KV label="Gateway fee">{inr(data.payment.feePaise)}</KV>
                <KV label="Refunded">{inr(data.payment.refundedPaise)}</KV>
                <KV label="Customer sees">{data.payment.customerStatus ?? "—"}</KV>
              </dl>
              {data.refunds.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {data.refunds.map((r: Row) => (
                    <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-[13px]">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{r.refundRef}</span><RefundBadge s={r.status} /></div>
                      <p className="mt-1 text-slate-600">{inr(r.amountPaise)} · {r.type} · by {r.initiatedBy} · {relTime(r.createdAt)}</p>
                      <p className="text-xs text-slate-500">{r.reason}{r.gatewayMessage ? ` — ${r.gatewayMessage}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : can("payments.view") ? <p className="text-sm text-slate-500">No payment record exists for this job.</p> : null}

          {/* attempts */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Print attempts</h3>
            {data.attempts.length === 0 ? <p className="text-sm text-slate-500">No print attempt has started yet.</p> : (
              <ul className="space-y-2">
                {data.attempts.map((a: Row) => (
                  <li key={a.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-[13px]">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${a.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : a.status === "failed" ? "bg-red-100 text-red-700" : a.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>#{a.attemptNo}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium capitalize text-slate-800">{a.status} <span className="font-normal text-slate-500">· {a.printerId} · CUPS {a.cupsJobId ?? "—"}</span></p>
                      <p className="text-xs text-slate-500">{a.pagesPrinted} pages printed · {dateTime(a.startedAt)}{a.endedAt ? ` → ${dateTime(a.endedAt)}` : ""}</p>
                      {a.error && <p className="mt-1 text-xs text-red-600">{a.error}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* logs */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="terminal" className="h-4 w-4" />Job log</h3>
            <div className="scroll-thin max-h-56 overflow-y-auto rounded-lg bg-navy-900 p-3 font-mono text-[12px] leading-relaxed">
              {data.logs.length === 0 ? <span className="text-slate-500">No log entries.</span> : data.logs.map((l: Row) => (
                <div key={l.id} className={l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-300" : "text-slate-300"}><span className="text-slate-500">{dateTime(l.createdAt)}</span> {l.message}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function JobFilterSelect({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full md:w-auto">{children}</Select>;
}
