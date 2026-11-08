"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Row } from "@/components/domain";
import { NotificationPrefs } from "@/components/pages/notifications";
import { useInstall } from "@/components/shell";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, KV, Modal, Notice, PageHeader, Select, Skeleton, Tabs, Toggle, useUi } from "@/components/ui";
import { api, useApi, useCan, useMe } from "@/lib/client";
import { dateTime, relTime } from "@/lib/format";
import { PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/rbac";

type Tab = "system" | "operations" | "team" | "security" | "profile" | "notifications";

export default function Settings() {
  const sp = useSearchParams();
  const can = useCan();
  const all: { value: Tab; label: string; show: boolean }[] = [
    { value: "system", label: "System health", show: can("settings.view") },
    { value: "operations", label: "Operations", show: can("settings.view") },
    { value: "team", label: "Team & roles", show: can("users.manage") },
    { value: "security", label: "Security & sessions", show: true },
    { value: "notifications", label: "Notifications", show: true },
    { value: "profile", label: "My profile", show: true },
  ];
  const tabs = all.filter((t) => t.show);
  const want = sp.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(want && tabs.some((t) => t.value === want) ? want : tabs[0].value);
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="System control, access management and your account" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />
      {tab === "system" && <System />}
      {tab === "operations" && <Operations />}
      {tab === "team" && <Team />}
      {tab === "security" && <Security />}
      {tab === "notifications" && <NotificationPrefs />}
      {tab === "profile" && <Profile />}
    </div>
  );
}

/* ───────── system health ───────── */
function Health({ ok, label, detail, warn }: { ok: boolean; label: string; detail: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${ok ? "bg-emerald-50 text-emerald-600" : warn ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}><Icon name={ok ? "check" : "alert"} className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{label}</p><p className="mt-0.5 text-[13px] text-slate-500">{detail}</p></div>
    </div>
  );
}

function System() {
  const { data, error, loading, reload } = useApi<Row>("/api/admin/settings", { interval: 30000 });
  const can = useCan();
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  const install = useInstall();
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Skeleton className="h-96" />;
  const h = data.health;
  const demo = async (action: "load" | "clear") => {
    const ok = await confirm(action === "clear"
      ? { title: "Remove all operational data?", message: "Deletes kiosks, printers, jobs, payments, refunds, alerts and inventory. Admin accounts, pricing and the audit log are kept. This cannot be undone.", confirmLabel: "Delete data", tone: "danger", requireText: "DELETE" }
      : { title: "Load the demo dataset?", message: "REPLACES all current kiosks, jobs, payments and inventory with sample data.", confirmLabel: "Replace with demo data", tone: "danger", requireText: "REPLACE" });
    if (!ok) return;
    setBusy(action);
    try { const r = await api<Row>("/api/admin/demo", { method: "POST", body: { action, confirm: true } }); toast("success", r.message); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Health ok={h.database.ok} label="Database" detail={h.database.ok ? `PostgreSQL reachable · ${h.database.latencyMs} ms` : "Database unreachable"} />
        <Health ok label="Backend" detail={`Node ${h.node} · up ${Math.round(h.uptimeSec / 60)} min · pricing v${h.pricingVersion}`} />
        <Health ok={h.cashfree.configured} warn label={`Cashfree payments${h.cashfree.configured ? ` (${h.cashfree.environment})` : ""}`} detail={h.cashfree.configured ? <>App ID <code>{h.cashfree.appIdHint}</code> · secret key {h.cashfree.secretSet ? "set (hidden)" : "missing"} · webhook secret {h.cashfree.webhookSecretSet ? "set" : "missing"}</> : "Not configured — refunds stay “Requested”. Set CASHFREE_APP_ID / CASHFREE_SECRET_KEY / CASHFREE_ENV."} />
        <Health ok={h.agentAuthConfigured} warn label="Kiosk agent API" detail={h.agentAuthConfigured ? `Shared secret configured · ${h.queuedCommands} command(s) queued` : "KIOSK_AGENT_SECRET is not set — kiosks can't send heartbeats or fetch commands yet."} />
        <Health ok={h.push.vapidPublic && h.push.vapidPrivate} warn label="Web Push sender" detail={h.push.vapidPublic && h.push.vapidPrivate ? "VAPID keys configured" : "VAPID keys not configured — mobile push is inactive (in-dashboard notifications still work)."} />
        <Health ok={h.kiosks > 0} warn label="Fleet" detail={`${h.kiosks} kiosk(s) · ${h.printers} printer(s) registered`} />
      </div>
      <Notice tone="blue" icon="lock" title="Secrets are never displayed">API credentials live only in server environment variables. This page shows presence and a masked hint — never the value.</Notice>

      <Card title="Mobile app (PWA)" padded>
        <p className="text-[13px] text-slate-600">{install.installed ? "Running as an installed app." : install.canInstall ? "Install PrintBar Admin on this phone for one-tap access." : "To install: open the browser menu → Add to Home Screen (Chrome/Edge show an Install option when available)."}</p>
        {install.canInstall && <Button className="mt-3" variant="primary" icon="phone" onClick={install.install}>Install app</Button>}
      </Card>

      <Card title="Kiosk agent API contract" subtitle="What the Raspberry Pi agent calls (header x-agent-key: KIOSK_AGENT_SECRET)" padded>
        <ul className="divide-y divide-slate-100 text-[13px]">
          {[
            ["POST", "/api/agent/heartbeat", "Kiosk + printer telemetry. Returns desired config (enabled / maintenance / paused / printer roles)."],
            ["GET", "/api/agent/commands?kioskId=", "Fetch queued commands (restart, test print, print_job retries…)."],
            ["POST", "/api/agent/commands/{id}", "Acknowledge a command: {status: succeeded|failed, result}."],
            ["POST", "/api/agent/jobs/{id}", "Report print-attempt progress for retried jobs."],
            ["POST", "/api/webhooks/cashfree", "Cashfree signed webhook (REFUND_STATUS_WEBHOOK)."],
            ["GET", "/api/public/pricing", "Active price card + optional quote — used by the customer app."],
          ].map(([m, p, d]) => <li key={p} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3"><span className="flex items-center gap-2"><Badge tone={m === "GET" ? "green" : "blue"}>{m}</Badge><code className="break-all text-xs">{p}</code></span><span className="text-slate-500 sm:ml-auto sm:max-w-md sm:text-right">{d}</span></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Full contract: <code>docs/ADMIN_API_CONTRACT.md</code>. Features that depend on these endpoints show “queued — awaiting agent” until the agent confirms.</p>
      </Card>

      {can("users.manage") && (
        <Card title="Demo data" subtitle={h.demo ? "A sample dataset is currently loaded (kiosk heartbeats are simulated)." : "No demo data loaded."} padded>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button loading={busy === "load"} onClick={() => demo("load")} icon="refresh">Reload demo dataset</Button>
            <Button variant="danger" loading={busy === "clear"} onClick={() => demo("clear")} icon="ban">Clear all operational data</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Use “Clear” before connecting real kiosks. Admin accounts, pricing history and audit logs are preserved.</p>
        </Card>
      )}
    </div>
  );
}

/* ───────── operations settings ───────── */
type FieldSpec = { key: string; label: string; type: "number" | "text" | "toggle" | "list" | "rupees"; hint?: string; suffix?: string };
const GROUPS: { group: string; title: string; desc: string; fields: FieldSpec[] }[] = [
  { group: "general", title: "General kiosk settings", desc: "Shown to customers on kiosks and receipts", fields: [{ key: "businessName", label: "Business name", type: "text" }, { key: "supportPhone", label: "Support phone", type: "text" }, { key: "supportEmail", label: "Support email", type: "text" }] },
  { group: "upload", title: "File upload limits", desc: "Enforced by the customer app and backend", fields: [{ key: "maxFileMB", label: "Max file size", type: "number", suffix: "MB" }, { key: "maxPagesPerJob", label: "Max pages per job", type: "number" }, { key: "allowedTypes", label: "Allowed file types", type: "list", hint: "Comma separated, e.g. pdf, docx, jpg" }] },
  { group: "processing", title: "Print processing & job timeouts", desc: "How jobs are retried and timed out", fields: [{ key: "jobTimeoutSec", label: "Job timeout", type: "number", suffix: "seconds", hint: "Attempts older than this count as stuck" }, { key: "maxRetries", label: "Max admin retries per job", type: "number" }, { key: "autoFailover", label: "Automatic failover to backup printer", type: "toggle" }, { key: "defaultPaperCapacity", label: "Default paper tray capacity", type: "number", suffix: "sheets" }] },
  { group: "cleanup", title: "Automatic cleanup", desc: "Retention policy — admins cannot override document deletion", fields: [{ key: "deleteDocumentsAfterMin", label: "Delete customer documents after processing", type: "number", suffix: "minutes" }, { key: "purgeLogsAfterDays", label: "Purge operational logs after", type: "number", suffix: "days" }] },
  { group: "network", title: "Network & heartbeat", desc: "Offline detection thresholds", fields: [{ key: "heartbeatIntervalSec", label: "Agent heartbeat interval", type: "number", suffix: "seconds" }, { key: "staleAfterSec", label: "Mark kiosk offline after", type: "number", suffix: "seconds", hint: "Must exceed the heartbeat interval" }] },
  { group: "finance", title: "Finance", desc: "Used to separate contribution from net profit in reports", fields: [{ key: "monthlyFixedCostsPaise", label: "Monthly fixed costs", type: "rupees", hint: "Rent share, electricity, connectivity — prorated in reports" }, { key: "fixedCostsNote", label: "Note", type: "text" }] },
];

function Operations() {
  const { data, error, loading, reload } = useApi<Row>("/api/admin/settings");
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/pricing" className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"><Icon name="pricing" className="text-brand-600" /><span className="text-sm font-medium">Pricing configuration</span><Icon name="chevronRight" className="ml-auto h-4 w-4 text-slate-400" /></Link>
        <Link href="/admin/printers" className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"><Icon name="printer" className="text-brand-600" /><span className="text-sm font-medium">Printer configuration</span><Icon name="chevronRight" className="ml-auto h-4 w-4 text-slate-400" /></Link>
        <Link href="/admin/settings?tab=notifications" className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"><Icon name="bell" className="text-brand-600" /><span className="text-sm font-medium">Notification preferences</span><Icon name="chevronRight" className="ml-auto h-4 w-4 text-slate-400" /></Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => <GroupForm key={g.group} spec={g} values={data.groups[g.group]} onSaved={reload} />)}
      </div>
    </div>
  );
}

function GroupForm({ spec, values, onSaved }: { spec: (typeof GROUPS)[number]; values: Row; onSaved: () => void }) {
  const can = useCan();
  const { toast } = useUi();
  const init = () => Object.fromEntries(spec.fields.map((f) => [f.key, f.type === "list" ? (values[f.key] as string[]).join(", ") : f.type === "rupees" ? String(values[f.key] / 100) : values[f.key]]));
  const [v, setV] = useState<Row>(init);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(init());
  const save = async () => {
    setBusy(true);
    try {
      const out: Row = {};
      for (const f of spec.fields) out[f.key] = f.type === "rupees" ? Math.round(Number(v[f.key]) * 100) : f.type === "number" ? Number(v[f.key]) : v[f.key];
      const r = await api<Row>("/api/admin/settings", { method: "PATCH", body: { group: spec.group, values: out } });
      toast("success", r.message);
      onSaved();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title={spec.title} subtitle={spec.desc} padded>
      <div className="space-y-3">
        {spec.fields.map((f) => f.type === "toggle" ? (
          <Toggle key={f.key} checked={!!v[f.key]} disabled={!can("settings.manage")} onChange={(x) => setV({ ...v, [f.key]: x })} label={f.label} />
        ) : (
          <Field key={f.key} label={`${f.label}${f.suffix ? ` (${f.suffix})` : f.type === "rupees" ? " (₹)" : ""}`} hint={f.hint}>
            <Input type={f.type === "number" || f.type === "rupees" ? "number" : "text"} inputMode={f.type === "text" || f.type === "list" ? undefined : "decimal"} value={v[f.key] ?? ""} disabled={!can("settings.manage")} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      {can("settings.manage") ? <Button className="mt-4" variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save changes</Button> : <p className="mt-3 text-xs text-slate-500">View only — your role can't change settings.</p>}
    </Card>
  );
}

/* ───────── team & roles ───────── */
function Team() {
  const { data, error, loading, reload } = useApi<Row>("/api/admin/users");
  const { me } = useMe();
  const { toast, confirm } = useUi();
  const [add, setAdd] = useState(false);
  const [reset, setReset] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "ops_admin", password: "" });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState<Record<string, string[]> | null>(null);
  const [openRole, setOpenRole] = useState<string | null>(null);

  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Skeleton className="h-96" />;
  const m: Record<string, string[]> = matrix ?? data.matrix;

  const patch = async (id: number, body: Row, okMsg?: string) => {
    try { const r = await api<Row>("/api/admin/users", { method: "PATCH", body: { id, ...body } }); toast("success", okMsg ?? r.message); reload(); return true; } catch (e) { toast("error", (e as Error).message); return false; }
  };
  const groups = Object.entries(Object.entries(PERMISSIONS).reduce<Record<string, [string, string][]>>((a, [k, v]) => { (a[v.group] ??= []).push([k, v.label]); return a; }, {}));

  return (
    <div className="space-y-4">
      <Card title="Administrators" action={<Button size="sm" variant="primary" icon="plus" onClick={() => setAdd(true)}>Add admin</Button>} padded={false}>
        <ul className="mt-3 divide-y divide-slate-100">
          {data.users.map((u: Row) => (
            <li key={u.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{u.name} {u.id === me?.user.id && <Badge tone="blue">You</Badge>}</p><p className="truncate text-xs text-slate-500">{u.email}</p></div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{!u.active && <Badge tone="slate">Inactive</Badge>}{u.locked && <Badge tone="red">Locked</Badge>}{u.defaultPassword && <Badge tone="amber">Temp password</Badge>}</div>
              </div>
              <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
                <Select aria-label="Role" value={u.role} disabled={u.id === me?.user.id} onChange={async (e) => { if (await confirm({ title: "Change role?", message: `${u.name} will be signed out and get ${ROLES[e.target.value as Role]} access.`, confirmLabel: "Change role" })) patch(u.id, { role: e.target.value }); }}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                <Button size="sm" onClick={() => { setReset(u); setPw(""); }}>Reset password</Button>
                {u.locked ? <Button size="sm" onClick={() => patch(u.id, { unlock: true }, "Account unlocked")}>Unlock</Button> : <span />}
                <Button size="sm" variant={u.active ? "secondary" : "primary"} disabled={u.id === me?.user.id} onClick={async () => { if (!u.active || (await confirm({ title: `Deactivate ${u.name}?`, message: "They'll be signed out everywhere immediately.", confirmLabel: "Deactivate", tone: "danger" }))) patch(u.id, { active: !u.active }); }}>{u.active ? "Deactivate" : "Activate"}</Button>
              </div>
              <p className="text-xs text-slate-400">Last login {u.lastLoginAt ? relTime(u.lastLoginAt) : "never"}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Roles & permissions" subtitle="Toggle what each role can do. Changes apply on the next request and are audited." padded={false}>
        <ul className="mt-3 divide-y divide-slate-100">
          {(Object.keys(ROLES) as Role[]).map((r) => {
            const open = openRole === r;
            return (
              <li key={r}>
                <button onClick={() => setOpenRole(open ? null : r)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left" aria-expanded={open}>
                  <span><span className="block text-sm font-medium text-slate-900">{ROLES[r]}</span><span className="text-xs text-slate-500">{m[r].length} of {Object.keys(PERMISSIONS).length} permissions</span></span>
                  <Icon name={open ? "chevronUp" : "chevronDown"} className="h-4 w-4 text-slate-400" />
                </button>
                {open && (
                  <div className="space-y-4 bg-slate-50/60 px-4 pb-4 pt-1">
                    {r === "super_admin" && <p className="text-xs text-slate-500">Super Admin always has every permission.</p>}
                    {groups.map(([gname, perms]) => (
                      <div key={gname}>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{gname}</p>
                        {perms.map(([k, label]) => <Toggle key={k} label={label} checked={m[r].includes(k)} disabled={r === "super_admin"} onChange={(on) => setMatrix({ ...m, [r]: on ? [...m[r], k] : m[r].filter((x) => x !== k) })} />)}
                      </div>
                    ))}
                    {r !== "super_admin" && matrix && JSON.stringify(matrix[r]) !== JSON.stringify(data.matrix[r]) && (
                      <Button variant="primary" onClick={async () => { try { const x = await api<Row>("/api/admin/users", { method: "PUT", body: { role: r, permissions: matrix[r] } }); toast("success", x.message); setMatrix(null); reload(); } catch (e) { toast("error", (e as Error).message); } }}>Save {ROLES[r]} permissions</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Modal open={add} onClose={() => setAdd(false)} title="Add administrator" size="sm" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { const r = await api<Row>("/api/admin/users", { method: "POST", body: form }); toast("success", r.message); setAdd(false); setForm({ name: "", email: "", role: "ops_admin", password: "" }); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); } }}>Create</Button></>}>
        <div className="space-y-3">
          <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoCapitalize="off" /></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Temporary password" hint="10+ chars with upper-case, lower-case and a number"><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" /></Field>
        </div>
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`Reset password · ${reset?.name}`} size="sm" footer={<><Button onClick={() => setReset(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (reset && (await patch(reset.id, { resetPassword: pw }))) setReset(null); }}>Reset & sign out</Button></>}>
        <Field label="New temporary password" hint="They must change it after signing in"><Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
      </Modal>
    </div>
  );
}

/* ───────── security & sessions ───────── */
function Security() {
  const can = useCan();
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useApi<Row>(`/api/admin/sessions${all ? "?all=1" : ""}`);
  const { toast, confirm } = useUi();
  const dev = (ua: string | null) => (!ua ? "Unknown device" : /iPhone|iPad/.test(ua) ? "iOS device" : /Android/.test(ua) ? "Android device" : /Windows/.test(ua) ? "Windows PC" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Browser");
  return (
    <div className="space-y-4">
      <Card title="Active sessions" subtitle={all ? "All administrators" : "Your signed-in devices"} action={can("users.manage") ? <Button size="sm" onClick={() => setAll(!all)}>{all ? "Only mine" : "Show everyone"}</Button> : undefined} padded={false}>
        {error && !data ? <ErrorState error={error} retry={reload} /> : loading && !data ? <div className="p-4"><Skeleton className="h-24" /></div> : !data?.sessions.length ? <EmptyState icon="lock" title="No active sessions" /> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.sessions.map((s: Row) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon name={/iOS|Android/.test(dev(s.userAgent)) ? "phone" : "kiosk"} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{dev(s.userAgent)} {s.current && <Badge tone="green">This device</Badge>}</p><p className="truncate text-xs text-slate-500">{all ? `${s.userName} · ` : ""}{s.ip ?? "unknown IP"} · active {relTime(s.lastSeenAt)} · expires {dateTime(s.expiresAt)}</p></div>
                {!s.current && <Button size="sm" onClick={async () => { if (await confirm({ title: "Revoke this session?", confirmLabel: "Revoke", tone: "danger" })) { try { await api("/api/admin/sessions", { method: "DELETE", body: { id: s.id } }); toast("success", "Session revoked"); reload(); } catch (e) { toast("error", (e as Error).message); } } }}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 p-4"><Button icon="logout" onClick={async () => { if (await confirm({ title: "Sign out of all other devices?", confirmLabel: "Sign out others", tone: "danger" })) { try { const r = await api<Row>("/api/admin/sessions", { method: "DELETE", body: { scope: "others" } }); toast("success", r.message); reload(); } catch (e) { toast("error", (e as Error).message); } } }}>Sign out other devices</Button></div>
      </Card>
      <Card title="Security policy" padded>
        <ul className="space-y-2 text-[13px] text-slate-600">
          {["Passwords are salted and hashed with scrypt; never stored or logged in plain text.", "5 failed sign-ins lock the account for 15 minutes.", "Sessions use HttpOnly, SameSite cookies and expire after 12 hours.", "All state-changing requests require a JSON body and a valid session; permissions are checked on the server for every action.", "Refunds, pricing, printer, kiosk, role and settings changes are written to the append-only audit log.", "Payment gateway credentials exist only in server environment variables."].map((t) => <li key={t} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-emerald-500" />{t}</li>)}
        </ul>
      </Card>
    </div>
  );
}

/* ───────── profile ───────── */
function Profile() {
  const { me, reloadMe } = useMe();
  const { toast } = useUi();
  const [name, setName] = useState(me?.user.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState<string | null>(null);
  if (!me) return <Skeleton className="h-64" />;
  const perms = me.permissions as Permission[];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Profile" padded>
          <dl className="mb-4 grid grid-cols-2 gap-4"><KV label="Email">{me.user.email}</KV><KV label="Role"><Badge tone="blue">{ROLES[me.user.role as Role]}</Badge></KV></dl>
          <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button className="mt-3" variant="primary" disabled={name.trim() === me.user.name || name.trim().length < 2} loading={busy === "name"} onClick={async () => { setBusy("name"); try { const r = await api<Row>("/api/admin/profile", { method: "PATCH", body: { name } }); toast("success", r.message); reloadMe(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); } }}>Save name</Button>
        </Card>
        <Card title="Change password" padded>
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" hint="10+ characters with upper-case, lower-case and a number"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.next ? "Passwords don't match" : undefined}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" variant="primary" disabled={!pw.current || !pw.next || pw.next !== pw.confirm} loading={busy === "pw"} onClick={async () => { setBusy("pw"); try { const r = await api<Row>("/api/admin/profile", { method: "POST", body: { current: pw.current, next: pw.next } }); toast("success", r.message); setPw({ current: "", next: "", confirm: "" }); reloadMe(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); } }}>Update password</Button>
        </Card>
      </div>
      <Card title="My permissions" subtitle={`${perms.length} granted to ${ROLES[me.user.role as Role]}`} padded>
        <div className="space-y-3">
          {Object.entries(Object.entries(PERMISSIONS).reduce<Record<string, [string, string][]>>((a, [k, v]) => { (a[v.group] ??= []).push([k, v.label]); return a; }, {})).map(([g, list]) => (
            <div key={g}><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              <ul className="space-y-1">{list.map(([k, l]) => <li key={k} className={`flex items-center gap-2 text-[13px] ${perms.includes(k as Permission) ? "text-slate-800" : "text-slate-400 line-through"}`}><Icon name={perms.includes(k as Permission) ? "check" : "x"} className={`h-3.5 w-3.5 ${perms.includes(k as Permission) ? "text-emerald-500" : "text-slate-300"}`} />{l}</li>)}</ul></div>
          ))}
        </div>
      </Card>
    </div>
  );
}
