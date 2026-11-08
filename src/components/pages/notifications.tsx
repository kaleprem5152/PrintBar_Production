"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertRow, type Row } from "@/components/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, LiveBadge, Modal, Notice, PageHeader, Pagination, Segmented, Select, Skeleton, SearchInput, Tabs, Toggle, cx, useUi } from "@/components/ui";
import { NOTIFICATION_TYPES, SEVERITY, type Severity } from "@/lib/constants";
import { api, qs, useApi, useCan, useDebounced, useMe } from "@/lib/client";
import { dateTime, relTime } from "@/lib/format";

type Tab = "alerts" | "inbox" | "prefs";

export default function Notifications() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((["alerts", "inbox", "prefs"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "alerts") as Tab);
  const { me } = useMe();
  return (
    <div className="space-y-4">
      <PageHeader title="Notifications & Alerts" subtitle="Hardware alerts, event notifications and delivery preferences" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "alerts", label: "Hardware alerts", badge: me?.alerts.total || undefined }, { value: "inbox", label: "Notification centre", badge: me?.unread || undefined }, { value: "prefs", label: "Preferences" }]} />
      {tab === "alerts" && <Alerts initialSeverity={sp.get("severity") ?? ""} />}
      {tab === "inbox" && <Inbox />}
      {tab === "prefs" && <NotificationPrefs />}
    </div>
  );
}

function Alerts({ initialSeverity }: { initialSeverity: string }) {
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState(initialSeverity);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [status, severity, dq]);
  const { data, error, loading, refreshing, updatedAt, reload } = useApi<Row>(`/api/admin/alerts${qs({ status, severity, q: dq, page })}`, { interval: 10000 });
  const { reloadMe } = useMe();
  const can = useCan();
  const { toast } = useUi();
  const [resolving, setResolving] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const act = async (a: Row, action: string, n?: string) => {
    setBusy(a.id);
    try { const r = await api<Row>(`/api/admin/alerts/${a.id}`, { method: "POST", body: { action, note: n } }); toast("success", r.message); setResolving(null); setNote(""); reload(); reloadMe(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };
  const count = (sev: string) => (data?.counts ?? []).filter((c: Row) => c.status !== "resolved" && c.severity === sev).reduce((a: number, c: Row) => a + c.n, 0);

  if (error && !data) return <ErrorState error={error} retry={reload} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {(["critical", "warning", "info"] as Severity[]).map((s) => (
          <button key={s} onClick={() => { setStatus("active"); setSeverity(severity === s ? "" : s); }} className={cx("rounded-xl border bg-white p-3 text-left transition", severity === s ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200")}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{SEVERITY[s].label}</p>
            <p className={cx("mt-1 text-2xl font-semibold tabular", s === "critical" && count(s) > 0 ? "text-red-600" : "text-slate-900")}>{count(s)}</p>
          </button>
        ))}
      </div>
      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <Segmented value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "resolved", label: "History" }, { value: "all", label: "All" }]} />
          <SearchInput value={q} onChange={setQ} placeholder="Search printer, kiosk or text" />
          <div className="ml-auto"><LiveBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={reload} /></div>
        </div>
        <div className="space-y-3 p-4">
          {loading && !data ? <><Skeleton className="h-24" /><Skeleton className="h-24" /></> : !data?.rows.length ? <EmptyState icon="checkCircle" title={status === "active" ? "No active alerts" : "No alerts found"} hint={status === "active" ? "All hardware is reporting normally." : undefined} /> : data.rows.map((a: Row) => (
            <AlertRow key={a.id} a={a}>
              {a.status === "resolved" && <p className="mt-1 text-xs text-slate-500">Resolved by {a.resolvedBy} · {relTime(a.resolvedAt)}{a.resolutionNote ? ` · “${a.resolutionNote}”` : ""}</p>}
              {a.status === "acknowledged" && <p className="mt-1 text-xs text-slate-500">Acknowledged by {a.acknowledgedBy} · {relTime(a.acknowledgedAt)}</p>}
              <button onClick={() => setOpen(open === a.id ? null : a.id)} className="mt-2 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-brand-600">{open === a.id ? "Hide" : "Suggested action"} <Icon name={open === a.id ? "chevronUp" : "chevronDown"} className="h-3.5 w-3.5" /></button>
              {open === a.id && <div className="mt-1 rounded-lg bg-white p-3 text-[13px] text-slate-700 ring-1 ring-slate-200"><p className="font-medium text-slate-900">What to do</p><p className="mt-0.5">{a.suggestedAction}</p><p className="mt-2 text-xs text-slate-400">Raised {dateTime(a.createdAt)} · source: {a.source}{a.printerId ? ` · printer ${a.printerId}` : ""}{a.kioskId ? ` · kiosk ${a.kioskId}` : ""}</p></div>}
              {can("alerts.manage") && a.status !== "resolved" && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-xs">
                  {a.status === "open" ? <Button size="sm" loading={busy === a.id} onClick={() => act(a, "acknowledge")} icon="check">Acknowledge</Button> : <span />}
                  <Button size="sm" variant="primary" onClick={() => { setResolving(a); setNote(""); }}>Resolve…</Button>
                </div>
              )}
              {can("alerts.manage") && a.status === "resolved" && <Button size="sm" className="mt-2" loading={busy === a.id} onClick={() => act(a, "reopen")}>Reopen</Button>}
            </AlertRow>
          ))}
        </div>
        {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
      <Modal open={!!resolving} onClose={() => setResolving(null)} title="Resolve alert" size="sm" footer={<><Button onClick={() => setResolving(null)}>Cancel</Button><Button variant="primary" loading={busy === resolving?.id} onClick={() => resolving && act(resolving, "resolve", note)}>Mark resolved</Button></>}>
        <p className="mb-3 text-sm text-slate-600">{resolving?.title}</p>
        <Field label="Resolution note" hint="What was done? Recorded in the alert history and audit log."><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Cleared jam, test print OK" /></Field>
        <p className="mt-3 text-xs text-slate-500">If the hardware condition is still present, the next kiosk heartbeat will raise the alert again.</p>
      </Modal>
    </div>
  );
}

function Inbox() {
  const [unread, setUnread] = useState(false);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [unread, type]);
  const { data, error, loading, reload } = useApi<Row>(`/api/admin/notifications${qs({ unread: unread ? 1 : "", type, page })}`, { interval: 15000 });
  const { reloadMe } = useMe();
  const router = useRouter();
  const { toast } = useUi();
  const read = async (n: Row) => { if (!n.read) { await api("/api/admin/notifications", { method: "POST", body: { action: "read", id: n.id } }).catch(() => {}); reload(); reloadMe(); } };
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <Segmented value={unread ? "unread" : "all"} onChange={(v) => setUnread(v === "unread")} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-56"><option value="">All types</option>{Object.entries(NOTIFICATION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Button className="sm:ml-auto" size="sm" icon="check" onClick={async () => { await api("/api/admin/notifications", { method: "POST", body: { action: "read_all" } }); toast("success", "All marked as read"); reload(); reloadMe(); }}>Mark all read</Button>
      </div>
      {loading && !data ? <div className="space-y-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : !data?.rows.length ? <EmptyState icon="bell" title={unread ? "You're all caught up" : "No notifications"} /> : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((n: Row) => (
            <li key={n.id}>
              <button onClick={async () => { await read(n); if (n.link) router.push(n.link); }} className={cx("flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left transition active:bg-slate-50", !n.read && "bg-blue-50/40")}>
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-600")} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className={cx("text-sm text-slate-900", !n.read && "font-semibold")}>{n.title}</span><Badge tone={SEVERITY[n.severity as Severity]?.tone ?? "neutral"}>{NOTIFICATION_TYPES[n.type] ?? n.type}</Badge></span>
                  {n.body && <span className="mt-0.5 block text-[13px] text-slate-600">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-slate-400">{relTime(n.createdAt)}</span>
                </span>
                <Icon name="chevronRight" className="mt-1 h-4 w-4 text-slate-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function b64ToU8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function PushCard() {
  const { data, reload } = useApi<Row>("/api/admin/push");
  const { toast } = useUi();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { setPerm("unsupported"); setSubscribed(false); return; }
    setPerm(Notification.permission);
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      if (!data?.vapidPublicKey) throw new Error("The backend has no VAPID keys configured, so push can't be enabled yet.");
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") throw new Error("Permission was not granted. Allow notifications in your browser settings.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(data.vapidPublicKey) as BufferSource });
      await api("/api/admin/push", { method: "POST", body: { subscription: sub.toJSON() } });
      setSubscribed(true);
      toast("success", "This device is registered for push");
      reload();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api("/api/admin/push", { method: "DELETE", body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setSubscribed(false);
      toast("info", "Push disabled on this device");
      reload();
    } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };

  const active = subscribed && data?.backendConfigured && perm === "granted";
  const steps: [string, boolean, string][] = [
    ["Browser supports push", perm !== "unsupported", perm === "unsupported" ? "Not supported here. On iPhone, add PrintBar Admin to the Home Screen first (iOS 16.4+)." : "Supported"],
    ["Backend push sender configured", !!data?.backendConfigured, data?.backendConfigured ? "VAPID keys present" : "Needs VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY on the server"],
    ["Notification permission", perm === "granted", perm === "granted" ? "Granted" : perm === "denied" ? "Blocked in browser settings" : "Not requested yet"],
    ["This device registered", !!subscribed, subscribed ? "Registered" : "Not registered"],
  ];
  return (
    <Card title="Mobile push notifications" action={active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="slate">Not active</Badge>}>
      <ul className="space-y-2.5">
        {steps.map(([t, ok, d]) => <li key={t} className="flex items-start gap-3 text-[13px]"><Icon name={ok ? "checkCircle" : "xCircle"} className={cx("mt-0.5 h-4 w-4", ok ? "text-emerald-500" : "text-slate-300")} /><div><p className="font-medium text-slate-800">{t}</p><p className="text-slate-500">{d}</p></div></li>)}
      </ul>
      {subscribed && !data?.backendConfigured && <div className="mt-3"><Notice tone="amber" title="Registered, but not delivering">Push stays inactive until the backend has a configured web-push sender. No notifications will arrive yet.</Notice></div>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {!subscribed ? <Button variant="primary" icon="bell" loading={busy} disabled={perm === "unsupported" || perm === "denied" || !data?.backendConfigured} onClick={enable}>Enable push on this device</Button> : <Button loading={busy} onClick={disable}>Disable on this device</Button>}
      </div>
      <p className="mt-2 text-xs text-slate-500">{data?.deviceCount ?? 0} device(s) registered on your account.</p>
    </Card>
  );
}

export function NotificationPrefs() {
  const { data, error, reload } = useApi<Row>("/api/admin/notifications?size=1");
  const [p, setP] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  useEffect(() => { if (data && !p) setP(data.prefs); }, [data, p]);
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (!p) return <Skeleton className="h-64" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api<Row>("/api/admin/notifications", { method: "POST", body: { action: "save_prefs", prefs: p } }); toast("success", r.message); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Delivery" padded>
          <Toggle checked={p.inApp} onChange={(v) => setP({ ...p, inApp: v })} label="In-dashboard notifications" hint="Bell icon, notification centre and unread badges" />
          <Toggle checked={p.push} onChange={(v) => setP({ ...p, push: v })} label="Mobile push notifications" hint="Wanted on my devices (needs the card on the right to be active)" />
          <div className="mt-2"><Field label="Minimum severity"><Select value={p.minSeverity} onChange={(e) => setP({ ...p, minSeverity: e.target.value })}><option value="info">Everything</option><option value="warning">Warnings and critical</option><option value="critical">Critical only</option></Select></Field></div>
        </Card>
        <Card title="Notify me about" padded>
          <div className="divide-y divide-slate-100">
            {Object.entries(NOTIFICATION_TYPES).map(([k, label]) => <Toggle key={k} checked={p.types[k]} onChange={(v) => setP({ ...p, types: { ...p.types, [k]: v } })} label={label} />)}
          </div>
        </Card>
        <Button variant="primary" loading={busy} onClick={save} className="w-full sm:w-auto">Save preferences</Button>
      </div>
      <PushCard />
    </div>
  );
}
