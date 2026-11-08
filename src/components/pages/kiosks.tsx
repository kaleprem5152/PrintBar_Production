"use client";

import { useState } from "react";
import { Heartbeat, KioskBadge, PrinterBadge, type Row } from "@/components/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, KV, LiveBadge, Modal, Notice, PageHeader, Skeleton, Tabs, Toggle, useUi } from "@/components/ui";
import { api, useApi, useCan } from "@/lib/client";
import { dateTime, relTime } from "@/lib/format";

export default function Kiosks() {
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>("/api/admin/kiosks", { interval: 15000 });
  const [openId, setOpenId] = useState<string | null>(null);
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  return (
    <div className="space-y-4">
      <PageHeader title="Kiosks" subtitle="Raspberry Pi connectivity, maintenance mode and remote service control" actions={<LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} />} />
      {loading && !data ? <Skeleton className="h-64" /> : !data?.kiosks.length ? <Card><EmptyState icon="kiosk" title="No kiosks registered" /></Card> : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {data.kiosks.map((k: Row) => (
            <Card key={k.id} className={k.status === "offline" ? "border-red-200" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{k.name}</p><p className="truncate text-xs text-slate-500">{k.id} · {k.location}</p></div>
                <KioskBadge s={k.status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <KV label="Raspberry Pi"><span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${k.online ? "bg-emerald-500" : "bg-red-500"}`} />{k.online ? "Connected" : "No heartbeat"}</span></KV>
                <KV label="Last heartbeat"><Heartbeat at={k.lastHeartbeat} online={k.online} /></KV>
                <KV label="Backend link">{k.online && k.backendConnected ? "Connected" : "Down"}</KV>
                <KV label="Network">{k.networkType ? k.networkType.toUpperCase() : "—"} {k.ipAddress && <span className="text-slate-400">{k.ipAddress}</span>}</KV>
                <KV label="Software">{k.softwareVersion ? `v${k.softwareVersion}` : "—"}</KV>
                <KV label="30-day uptime">{k.uptime30d == null ? "—" : k.uptime30d.toFixed(1) + "%"}</KV>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {k.printers.map((p: Row) => <span key={p.id} className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200"><Icon name="printer" className="h-3.5 w-3.5 text-slate-400" />{p.id}<PrinterBadge s={p.live} /></span>)}
              </div>
              {k.pendingCommands > 0 && <p className="mt-3 text-xs text-amber-700"><Icon name="clock" className="mr-1 inline h-3.5 w-3.5" />{k.pendingCommands} command(s) waiting for the agent</p>}
              <Button className="mt-4 w-full" variant="dark" icon="eye" onClick={() => setOpenId(k.id)}>Manage kiosk</Button>
            </Card>
          ))}
        </div>
      )}
      <KioskDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}

type Tab = "controls" | "diagnostics" | "logs" | "connectivity";

function KioskDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<Row>(id ? `/api/admin/kiosks/${id}` : null, { interval: id ? 10000 : undefined });
  const [tab, setTab] = useState<Tab>("controls");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; location: string } | null>(null);
  const { toast, confirm } = useUi();
  const can = useCan();
  const k = data?.kiosk;

  const done = async (r: Row) => { toast("success", r.message); await reload(); onChanged(); };
  const patch = async (body: Row, key: string) => {
    setBusy(key);
    try { await done(await api<Row>(`/api/admin/kiosks/${id}`, { method: "PATCH", body })); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };
  const cmd = async (command: string, needsConfirm?: { title: string; message: string }) => {
    if (needsConfirm && !(await confirm({ ...needsConfirm, confirmLabel: "Confirm", tone: "danger" }))) return;
    setBusy(command);
    try { await done(await api<Row>(`/api/admin/kiosks/${id}`, { method: "POST", body: { command, confirm: !!needsConfirm } })); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Modal open={!!id} onClose={onClose} title={k ? `${k.name} · ${k.id}` : "Kiosk"} size="xl">
      {error && !data ? <ErrorState error={error} retry={reload} /> : !k ? <Skeleton className="h-64" /> : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2"><KioskBadge s={k.status} /><span className="text-xs text-slate-500">{k.location}</span></div>
          {!k.online && k.enabled && <div className="mb-4"><Notice tone="red" title="Kiosk is offline">Commands are queued and delivered when the agent reconnects. Whether the Raspberry Pi, network or power failed can't be determined remotely.</Notice></div>}
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "controls", label: "Controls" }, { value: "diagnostics", label: "Diagnostics" }, { value: "logs", label: "System logs" }, { value: "connectivity", label: "Connectivity" }]} />

          {tab === "controls" && (
            <div className="space-y-5">
              <Card padded>
                <Toggle checked={k.enabled} disabled={!can("kiosks.configure") || busy === "enabled"} label="Kiosk enabled" hint="Disabled kiosks take no jobs and are excluded from uptime alerts"
                  onChange={async (v) => { if (!v && !(await confirm({ title: `Disable ${k.name}?`, message: "Customers won't be able to print here until it is re-enabled.", confirmLabel: "Disable kiosk", tone: "danger", requireText: k.id }))) return; patch({ enabled: v, confirm: true }, "enabled"); }} />
                <Toggle checked={k.maintenance} disabled={!can("kiosks.control") || busy === "maintenance"} label="Maintenance mode" hint="Customers see a maintenance screen"
                  onChange={async (v) => { if (v && !(await confirm({ title: "Enable maintenance mode?", message: "New jobs are blocked on this kiosk.", confirmLabel: "Enable", tone: "warn" }))) return; patch({ maintenance: v, confirm: true }, "maintenance"); }} />
                <Toggle checked={k.printingPaused} disabled={!can("kiosks.control") || busy === "printingPaused"} label="Pause printing" hint="Keeps the kiosk online but stops printing" onChange={(v) => patch({ printingPaused: v }, "printingPaused")} />
              </Card>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Remote commands</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button icon="power" variant="danger" disabled={!can("kiosks.control")} loading={busy === "restart_agent"} onClick={() => cmd("restart_agent", { title: "Restart kiosk agent?", message: "The agent restarts in a few seconds; any print in progress may fail. Delivered via the authorised backend command queue." })}>Restart kiosk agent</Button>
                  <Button icon="printer" variant="danger" disabled={!can("kiosks.control")} loading={busy === "restart_print_service"} onClick={() => cmd("restart_print_service", { title: "Restart printing service (CUPS)?", message: "Active print jobs on this kiosk may fail and need retry or refund." })}>Restart printing service</Button>
                  <Button icon="cpu" disabled={!can("kiosks.control")} loading={busy === "run_diagnostics"} onClick={() => cmd("run_diagnostics")}>Run diagnostics</Button>
                  <Button icon="terminal" disabled={!can("kiosks.control")} loading={busy === "fetch_logs"} onClick={() => cmd("fetch_logs")}>Collect system logs</Button>
                </div>
                <p className="mt-2 text-xs text-slate-500">Commands are queued — they run only when the kiosk agent polls <code>/api/agent/commands</code>. Status below updates from the agent, never optimistically.</p>
              </div>

              {can("kiosks.configure") && (
                <Card title="Update configuration" padded>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Display name"><Input value={form?.name ?? k.name} onChange={(e) => setForm({ name: e.target.value, location: form?.location ?? k.location })} /></Field>
                    <Field label="Location"><Input value={form?.location ?? k.location} onChange={(e) => setForm({ name: form?.name ?? k.name, location: e.target.value })} /></Field>
                  </div>
                  <Button className="mt-3" variant="primary" disabled={!form} loading={busy === "cfg"} onClick={async () => { await patch(form!, "cfg"); setForm(null); }}>Save</Button>
                </Card>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Command history</h3>
                {data.commands.length === 0 ? <p className="text-sm text-slate-500">No commands sent.</p> : (
                  <ul className="space-y-2">{data.commands.map((c: Row) => <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-[13px]"><div className="flex items-center justify-between gap-2"><span className="font-medium">{c.command.replace(/_/g, " ")}{c.printerId ? ` · ${c.printerId}` : ""}</span><Badge tone={c.status === "succeeded" ? "green" : c.status === "failed" ? "red" : c.status === "queued" ? "amber" : "blue"} dot>{c.status === "queued" ? "Queued — awaiting agent" : c.status}</Badge></div><p className="text-xs text-slate-500">{c.requestedBy} · {relTime(c.createdAt)}{c.result ? ` · ${c.result}` : ""}</p></li>)}</ul>
                )}
              </div>
            </div>
          )}

          {tab === "diagnostics" && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-3">
                <KV label="Raspberry Pi temp">{k.piTempC != null ? `${k.piTempC}°C` : "Not reported"}</KV>
                <KV label="CPU load">{k.piCpuPct != null ? `${k.piCpuPct}%` : "Not reported"}</KV>
                <KV label="Memory">{k.piMemPct != null ? `${k.piMemPct}%` : "Not reported"}</KV>
                <KV label="Disk used">{k.diskPct != null ? `${k.diskPct}%` : "Not reported"}</KV>
                <KV label="UPS / power">{k.upsStatus ? k.upsStatus.replace(/_/g, " ") : "Not supported / not reported"}</KV>
                <KV label="Agent version">{k.softwareVersion ? `v${k.softwareVersion}` : "—"}</KV>
                <KV label="Network">{k.networkType?.toUpperCase() ?? "—"}</KV>
                <KV label="IP">{k.ipAddress ?? "—"}</KV>
                <KV label="Last heartbeat">{dateTime(k.lastHeartbeat)}</KV>
              </dl>
              <h3 className="text-sm font-semibold text-slate-900">Printers on this kiosk</h3>
              <ul className="space-y-2">{data.printers.map((p: Row) => <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-[13px]"><span>{p.name} <span className="text-slate-400">{p.id} · {p.ip}</span></span><PrinterBadge s={p.live} /></li>)}</ul>
            </div>
          )}

          {tab === "logs" && (
            <div className="scroll-thin max-h-[50vh] overflow-y-auto rounded-lg bg-navy-900 p-3 font-mono text-[12px] leading-relaxed">
              {data.logs.length === 0 ? <span className="text-slate-500">No logs received from this kiosk.</span> : data.logs.map((l: Row) => (
                <div key={l.id} className={l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-300" : "text-slate-300"}><span className="text-slate-500">{dateTime(l.createdAt)}</span> [{l.level}] {l.message}</div>
              ))}
            </div>
          )}

          {tab === "connectivity" && (
            <div>
              <p className="mb-3 text-sm text-slate-600">30-day uptime: <b>{data.uptime30d == null ? "—" : data.uptime30d.toFixed(2) + "%"}</b></p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.events.map((e: Row) => <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${e.kind === "online" ? "bg-emerald-500" : "bg-red-500"}`} />{e.kind === "online" ? "Came online" : "Went offline"}<span className="text-slate-400">{e.detail}</span></span><span className="text-xs text-slate-500">{dateTime(e.createdAt)}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
