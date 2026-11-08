"use client";

import { useState } from "react";
import { Heartbeat, PrinterBadge, RoleBadge, type Row } from "@/components/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, KV, LiveBadge, Meter, Modal, Notice, PageHeader, Select, Skeleton, SourceTag, Tabs, Toggle, useUi } from "@/components/ui";
import { MAINTENANCE_TYPES } from "@/lib/constants";
import { api, useApi, useCan } from "@/lib/client";
import { dateTime, num, relTime } from "@/lib/format";

export default function Printers() {
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>("/api/admin/printers", { interval: 15000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const { toast, confirm } = useUi();
  const can = useCan();

  const patch = async (id: string, body: Row, msg?: string) => {
    try {
      const r = await api<Row>(`/api/admin/printers/${id}`, { method: "PATCH", body });
      toast("success", msg ?? r.message);
      reload();
    } catch (e) { toast("error", (e as Error).message); }
  };
  const control = async (id: string, action: string) => {
    try {
      const r = await api<Row>(`/api/admin/printers/${id}`, { method: "POST", body: { action } });
      toast("success", r.message);
      reload();
    } catch (e) { toast("error", (e as Error).message); }
  };

  if (error && !data) return <ErrorState error={error} retry={reload} />;
  const byKiosk: Record<string, Row[]> = {};
  for (const p of data?.printers ?? []) (byKiosk[p.kioskId] ??= []).push(p);

  return (
    <div className="space-y-5">
      <PageHeader title="Printers" subtitle="Fleet health, primary / backup assignment and controls" actions={<LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} />} />
      <Notice tone="blue" title="About paper & toner values">
        Every level carries a source tag: <SourceTag source="telemetry" /> from the printer, <SourceTag source="estimated" /> counted from pages printed, <SourceTag source="manual" /> typed in by an admin, or <SourceTag source="unsupported" /> when the model has no sensor.
      </Notice>
      {loading && !data ? <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : !data?.printers.length ? (
        <Card><EmptyState icon="printer" title="No printers registered" hint="Printers appear after a kiosk agent reports them." /></Card>
      ) : data.kiosks.map((k: Row) => {
        const list = byKiosk[k.id] ?? [];
        if (!list.length) return null;
        const primary = list.find((p) => p.role === "primary");
        const backup = list.filter((p) => p.role === "backup");
        return (
          <section key={k.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-slate-900">{k.name} <span className="font-normal text-slate-400">· {k.id}</span></h2>
              <Badge tone={k.online ? "green" : "red"} dot>{k.online ? "Kiosk online" : "Kiosk offline"}</Badge>
              <span className="text-xs text-slate-500">Primary <b className="text-slate-700">{primary?.id ?? "none"}</b> → Backup <b className="text-slate-700">{backup.map((b) => b.id).join(", ") || "none"}</b>{primary && backup.length > 0 && <> · failover {backup.some((b) => b.autoFailover) && primary.autoFailover ? "on" : "off"}</>}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {list.map((p) => (
                <Card key={p.id} className={p.live === "error" || p.live === "disconnected" ? "border-red-200" : ""}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{p.name} <span className="font-normal text-slate-400">· {p.id}</span></p>
                      <p className="truncate text-xs text-slate-500">{p.model}{p.supportsColor ? " · colour" : " · mono"}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5"><PrinterBadge s={p.live} /><RoleBadge role={p.role} /></div>
                  </div>
                  {p.errorMessage && p.live === "error" && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{p.errorMessage}</p>}
                  {p.live === "unreachable" && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">Kiosk offline — values below are last known.</p>}
                  <div className="mt-3 grid gap-3">
                    <Meter label="Paper" value={p.paperRemaining} source={p.paperRemaining == null ? "unsupported" : p.paperSource} max={p.paperCapacity} low={10} detail={`/ ${p.paperCapacity}`} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Meter label={p.tonerColor != null ? "Black" : "Toner / ink"} value={p.tonerBlack} source={p.tonerSource} />
                      {p.tonerColor != null ? <Meter label="Colour" value={p.tonerColor} source={p.tonerSource} /> : <Meter label="Drum" value={p.drumLife} source={p.drumSource} />}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                    <KV label="IP">{p.ip ?? "—"}</KV>
                    <KV label="Total pages">{num(p.totalPages)}</KV>
                    <KV label="30-day volume">{num(p.monthPages)}</KV>
                    <KV label="Last print">{relTime(p.lastSuccessfulPrintAt)}</KV>
                    <KV label="Heartbeat"><Heartbeat at={p.lastHeartbeat} online={p.connection === "connected"} /></KV>
                    <KV label="Open alerts">{p.openAlerts ? <Badge tone="red">{p.openAlerts}</Badge> : "None"}</KV>
                  </dl>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {can("printers.control") && <Button size="sm" icon={p.paused ? "play" : "pause"} onClick={() => control(p.id, p.paused ? "resume" : "pause")}>{p.paused ? "Resume" : "Pause"}</Button>}
                    {can("printers.control") && (
                      <Button size="sm" icon="file" variant="secondary" onClick={() => control(p.id, "refill_250")}>+250 Refill</Button>
                    )}
                    {can("printers.configure") && (
                      <Button size="sm" icon="power" variant={p.enabled ? "secondary" : "primary"} onClick={async () => {
                        if (p.enabled && !(await confirm({ title: `Disable ${p.name}?`, message: "No jobs will be routed to this printer until it is enabled again.", confirmLabel: "Disable", tone: "danger" }))) return;
                        patch(p.id, { enabled: !p.enabled }, p.enabled ? "Printer disabled" : "Printer enabled");
                      }}>{p.enabled ? "Disable" : "Enable"}</Button>
                    )}
                    <Button size="sm" variant="dark" icon="eye" onClick={() => setOpenId(p.id)} className={!can("printers.control") && !can("printers.configure") ? "col-span-2 sm:col-span-4" : ""}>Details</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
      <PrinterDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}

type Tab = "controls" | "diagnostics" | "queue" | "history";

function PrinterDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<Row>(id ? `/api/admin/printers/${id}` : null, { interval: id ? 10000 : undefined });
  const [tab, setTab] = useState<Tab>("controls");
  const { toast, confirm } = useUi();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const [levels, setLevels] = useState({ paper: "", tonerBlack: "", tonerColor: "", drumLife: "" });
  const [maint, setMaint] = useState({ type: "inspection", note: "", costRupees: "" });
  const p = data?.printer;

  const post = async (action: string, body: Row = {}, ok?: () => void) => {
    setBusy(action);
    try {
      const r = await api<Row>(`/api/admin/printers/${id}`, { method: "POST", body: { action, ...body } });
      toast("success", r.message);
      ok?.();
      await reload();
      onChanged();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };
  const patch = async (body: Row) => {
    setBusy("patch");
    try {
      const r = await api<Row>(`/api/admin/printers/${id}`, { method: "PATCH", body });
      toast("success", r.message);
      await reload();
      onChanged();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };

  const diag: [string, string, string][] = p ? [
    ["Connection", p.connection === "unknown" ? "Unknown (kiosk offline)" : p.connection, "telemetry"],
    ["State", `${p.state}${p.errorCode ? ` · ${p.errorCode}` : ""}`, "telemetry"],
    ["IP address", p.ip ?? "—", "manual"],
    ["CUPS queue", p.cupsQueue ?? "—", "manual"],
    ["Paper remaining", p.paperRemaining == null ? "—" : `${p.paperRemaining}/${p.paperCapacity} sheets`, p.paperRemaining == null ? "unsupported" : p.paperSource],
    ["Toner black", p.tonerBlack == null ? "—" : `${p.tonerBlack}%`, p.tonerBlack == null ? "unsupported" : p.tonerSource],
    ["Toner colour", p.tonerColor == null ? "—" : `${p.tonerColor}%`, p.tonerColor == null ? "unsupported" : p.tonerSource],
    ["Drum life", p.drumLife == null ? "—" : `${p.drumLife}%`, p.drumLife == null ? "unsupported" : p.drumSource],
    ["Total pages", num(p.totalPages), "telemetry"],
  ] : [];

  return (
    <Modal open={!!id} onClose={onClose} title={p ? `${p.name} · ${p.id}` : "Printer"} size="xl">
      {error && !data ? <ErrorState error={error} retry={reload} /> : !p ? <Skeleton className="h-64" /> : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2"><PrinterBadge s={p.live} /><RoleBadge role={p.role} /><span className="text-xs text-slate-500">{p.model} · kiosk {data.kiosk?.name} ({data.kiosk?.online ? "online" : "offline"})</span></div>
          {data.alerts.length > 0 && <div className="mb-4 space-y-2">{data.alerts.map((a: Row) => <Notice key={a.id} tone={a.severity === "critical" ? "red" : "amber"} title={a.title}>{a.details} <span className="block pt-1 text-slate-500">Suggested: {a.suggestedAction}</span></Notice>)}</div>}
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "controls", label: "Controls" }, { value: "diagnostics", label: "Diagnostics" }, { value: "queue", label: "Queue", badge: data.queue.length || undefined }, { value: "history", label: "History" }]} />

          {tab === "controls" && (
            <div className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Button icon={p.paused ? "play" : "pause"} disabled={!can("printers.control")} loading={busy === (p.paused ? "resume" : "pause")} onClick={() => post(p.paused ? "resume" : "pause")}>{p.paused ? "Resume printing" : "Pause printing"}</Button>
                <Button icon="printer" disabled={!can("printers.control")} loading={busy === "test_print"} onClick={async () => { if (await confirm({ title: "Send a test print?", message: "Uses one sheet of paper. The command is queued for the kiosk agent.", confirmLabel: "Send test page" })) post("test_print"); }}>Send test print</Button>
                <Button icon="terminal" disabled={!can("printers.control")} loading={busy === "fetch_cups_queue"} onClick={() => post("fetch_cups_queue")}>Fetch CUPS queue</Button>
                <Button icon="ban" variant="danger" disabled={!can("printers.control")} loading={busy === "clear_queue"} onClick={async () => { if (await confirm({ title: "Clear stuck jobs?", message: `Only attempts older than the ${data.jobTimeoutSec}s timeout are cleared and marked failed (customers then qualify for retry or refund). Active jobs are never touched.`, confirmLabel: "Clear stuck jobs", tone: "danger" })) post("clear_queue"); }}>Clear stuck jobs</Button>
              </div>

              <Card title="Role, priority & failover" padded>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Assignment"><Select value={p.role} disabled={!can("printers.configure")} onChange={(e) => patch({ role: e.target.value })}><option value="primary">Primary</option><option value="backup">Backup</option></Select></Field>
                  <Field label="Priority" hint="1 = first choice"><Select value={p.priority} disabled={!can("printers.configure")} onChange={(e) => patch({ priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
                  <div className="self-end"><Toggle checked={p.autoFailover} disabled={!can("printers.configure")} onChange={(v) => patch({ autoFailover: v })} label="Automatic failover" hint="Accept jobs when primary fails" /></div>
                </div>
                <Toggle checked={p.enabled} disabled={!can("printers.configure")} onChange={async (v) => { if (!v && !(await confirm({ title: "Disable printer?", message: "No jobs will be routed here.", tone: "danger", confirmLabel: "Disable" }))) return; patch({ enabled: v }); }} label="Printer enabled" />
              </Card>

              <Card title="Update levels manually" subtitle="Use when the printer has no sensor or reports wrong values. Values are tagged Manual." padded>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label={`Paper (0–${p.paperCapacity})`}><Input type="number" inputMode="numeric" value={levels.paper} onChange={(e) => setLevels({ ...levels, paper: e.target.value })} /></Field>
                  <Field label="Toner black %"><Input type="number" inputMode="numeric" value={levels.tonerBlack} onChange={(e) => setLevels({ ...levels, tonerBlack: e.target.value })} /></Field>
                  <Field label="Toner colour %"><Input type="number" inputMode="numeric" value={levels.tonerColor} onChange={(e) => setLevels({ ...levels, tonerColor: e.target.value })} /></Field>
                  <Field label="Drum %"><Input type="number" inputMode="numeric" value={levels.drumLife} onChange={(e) => setLevels({ ...levels, drumLife: e.target.value })} /></Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={!can("printers.control")} loading={busy === "set_levels"} onClick={() => post("set_levels", levels, () => setLevels({ paper: "", tonerBlack: "", tonerColor: "", drumLife: "" }))}>Save levels</Button>
                  <Button icon="file" variant="secondary" disabled={!can("printers.control")} loading={busy === "refill_250"} onClick={() => post("refill_250", { amount: 250 })}>+250 Paper Refill</Button>
                  <Button icon="file" disabled={!can("printers.control")} loading={busy === "refill_paper"} onClick={() => post("refill_paper")}>Full tray ({p.paperCapacity})</Button>
                </div>
              </Card>
            </div>
          )}

          {tab === "diagnostics" && (
            <div className="space-y-4">
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {diag.map(([k, v, s]) => <li key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="text-slate-500">{k}</span><span className="flex items-center gap-2 text-right font-medium text-slate-900">{v}<SourceTag source={s === "manual" && (k === "IP address" || k === "CUPS queue") ? "manual" : s} /></span></li>)}
              </ul>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent commands to this printer</h3>
                {data.commands.length === 0 ? <p className="text-sm text-slate-500">No commands sent yet.</p> : (
                  <ul className="space-y-2">{data.commands.map((c: Row) => <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-[13px]"><div className="flex items-center justify-between gap-2"><span className="font-medium">{c.command.replace(/_/g, " ")}</span><Badge tone={c.status === "succeeded" ? "green" : c.status === "failed" ? "red" : c.status === "queued" ? "amber" : "blue"} dot>{c.status === "queued" ? "Queued — awaiting agent" : c.status}</Badge></div><p className="text-xs text-slate-500">{c.requestedBy} · {relTime(c.createdAt)}{c.result ? ` · ${c.result}` : ""}</p></li>)}</ul>
                )}
              </div>
            </div>
          )}

          {tab === "queue" && (
            <div className="space-y-3">
              <Notice tone="blue" title="PrintBar queue vs CUPS queue">Below are attempts PrintBar believes are queued or printing on this printer. A live CUPS snapshot requires the kiosk agent — use "Fetch CUPS queue"; the agent reports the result in command history.</Notice>
              {data.queue.length === 0 ? <EmptyState icon="check" title="Queue is empty" /> : (
                <ul className="space-y-2">{data.queue.map((q: Row) => <li key={q.attemptId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-[13px]"><div className="min-w-0"><p className="font-mono">{q.jobId}</p><p className="truncate text-xs text-slate-500">{q.fileName} · {q.pagesPrinted}/{q.pages} pages · CUPS {q.cupsJobId ?? "—"}</p></div><div className="text-right"><Badge tone={q.status === "printing" ? "blue" : "amber"} dot>{q.status}</Badge><p className="mt-1 text-xs text-slate-400">{relTime(q.startedAt)}</p></div></li>)}</ul>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Error history</h3>
                {data.events.length === 0 ? <p className="text-sm text-slate-500">No events recorded.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{data.events.map((e: Row) => <li key={e.id} className="flex gap-3 px-4 py-2.5 text-[13px]"><Icon name={e.kind === "error" ? "alert" : e.kind === "config" ? "settings" : "info"} className={`mt-0.5 h-4 w-4 ${e.kind === "error" ? "text-red-500" : "text-slate-400"}`} /><div className="min-w-0 flex-1"><p className="text-slate-800">{e.message}</p><p className="text-xs text-slate-400">{dateTime(e.createdAt)}</p></div></li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Maintenance history</h3>
                {can("printers.control") && (
                  <div className="mb-3 grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
                    <Field label="Type"><Select value={maint.type} onChange={(e) => setMaint({ ...maint, type: e.target.value })}>{Object.entries(MAINTENANCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                    <Field label="Note"><Input value={maint.note} onChange={(e) => setMaint({ ...maint, note: e.target.value })} maxLength={300} /></Field>
                    <Field label="Cost (₹)"><Input type="number" inputMode="decimal" value={maint.costRupees} onChange={(e) => setMaint({ ...maint, costRupees: e.target.value })} /></Field>
                    <Button variant="primary" loading={busy === "log_maintenance"} onClick={() => post("log_maintenance", maint, () => setMaint({ type: "inspection", note: "", costRupees: "" }))}>Add</Button>
                  </div>
                )}
                {data.maintenance.length === 0 ? <p className="text-sm text-slate-500">No maintenance recorded.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{data.maintenance.map((m: Row) => <li key={m.id} className="px-4 py-2.5 text-[13px]"><div className="flex items-center justify-between gap-2"><span className="font-medium">{MAINTENANCE_TYPES[m.type] ?? m.type}</span><span className="text-xs text-slate-400">{dateTime(m.createdAt)}</span></div><p className="text-slate-600">{m.note}</p><p className="text-xs text-slate-400">by {m.performedBy}{m.costPaise ? ` · ₹${m.costPaise / 100}` : ""}</p></li>)}</ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
