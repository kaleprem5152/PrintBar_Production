"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, MeContext, useApi, useMe, type Me } from "@/lib/client";
import { ROLES } from "@/lib/rbac";
import { Badge, Button, cx, Icon, Modal, UiProvider, useUi } from "./ui";

type NavItem = { href: string; label: string; icon: string; perm?: string; short?: string };
export const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "overview", perm: "overview.view" },
  { href: "/admin/jobs", label: "Print Jobs", icon: "jobs", perm: "jobs.view", short: "Jobs" },
  { href: "/admin/printers", label: "Printers", icon: "printer", perm: "printers.view" },
  { href: "/admin/kiosks", label: "Kiosks", icon: "kiosk", perm: "kiosks.view" },
  { href: "/admin/payments", label: "Payments & Refunds", icon: "payments", perm: "payments.view", short: "Payments" },
  { href: "/admin/pricing", label: "Pricing", icon: "pricing", perm: "pricing.view" },
  { href: "/admin/inventory", label: "Inventory", icon: "inventory", perm: "inventory.view" },
  { href: "/admin/analytics", label: "Analytics & Reports", icon: "analytics", perm: "analytics.view", short: "Analytics" },
  { href: "/admin/notifications", label: "Notifications", icon: "bell", short: "Alerts" },
  { href: "/admin/customers", label: "Customers", icon: "users", perm: "customers.view" },
  { href: "/admin/audit", label: "Activity & Audit Logs", icon: "audit", perm: "audit.view", short: "Audit" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

const isActive = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

type InstallEvt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export function useInstall() {
  const [evt, setEvt] = useState<InstallEvt | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setInstalled(standalone);
    const w = window as unknown as { __pbInstall?: InstallEvt };
    if (w.__pbInstall) setEvt(w.__pbInstall);
    const h = (e: Event) => { e.preventDefault(); w.__pbInstall = e as InstallEvt; setEvt(e as InstallEvt); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  return { canInstall: !!evt && !installed, installed, install: async () => { await evt?.prompt(); setEvt(null); } };
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <UiProvider>
      <ShellInner>{children}</ShellInner>
    </UiProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: me, reload } = useApi<Me>("/api/admin/session", { interval: 20000 });
  const [drawer, setDrawer] = useState(false);
  const [quick, setQuick] = useState(false);
  const [online, setOnline] = useState(true);
  const install = useInstall();

  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const on = () => setOnline(true), off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    window.location.href = "/login";
  }, []);

  const items = NAV.filter((n) => !n.perm || me?.permissions.includes(n.perm));
  const current = NAV.find((n) => isActive(path, n.href));
  const mobileBottom = ["/admin", "/admin/jobs", "/admin/printers", "/admin/notifications"].map((h) => NAV.find((n) => n.href === h)!);
  const bellCount = (me?.unread ?? 0);

  return (
    <MeContext.Provider value={{ me: me ?? null, reloadMe: reload }}>
      <div className="min-h-dvh lg:pl-64">
        {/* desktop sidebar */}
        <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-900 text-slate-300 lg:flex">
          <Brand />
          <FleetPill />
          <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
            {items.map((n) => <NavLink key={n.href} n={n} active={isActive(path, n.href)} badge={n.href === "/admin/notifications" ? (me?.alerts.critical ?? 0) || bellCount : 0} />)}
          </nav>
          <UserCard onSignOut={signOut} />
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <div className="no-print fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-slate-950/60" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] animate-slide-in flex-col bg-navy-900 text-slate-300 shadow-2xl">
              <div className="flex items-center justify-between pr-2"><Brand /><button aria-label="Close menu" onClick={() => setDrawer(false)} className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-navy-700"><Icon name="x" /></button></div>
              <FleetPill />
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="All sections">
                {items.map((n) => <NavLink key={n.href} n={n} active={isActive(path, n.href)} badge={n.href === "/admin/notifications" ? (me?.alerts.critical ?? 0) || bellCount : 0} />)}
                {install.canInstall && (
                  <button onClick={install.install} className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-lg border border-dashed border-navy-600 px-3 text-sm text-slate-300 hover:bg-navy-800"><Icon name="phone" className="h-5 w-5" />Install app on this phone</button>
                )}
              </nav>
              <UserCard onSignOut={signOut} />
            </div>
          </div>
        )}

        {/* top bar */}
        <header className="no-print pt-safe sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex h-14 items-center gap-1 px-2 md:px-6">
            <button aria-label="Open menu" onClick={() => setDrawer(true)} className="grid h-11 w-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"><Icon name="menu" /></button>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-semibold text-slate-900 lg:text-[15px]">{current?.label ?? "PrintBar Admin"}</p>
            </div>
            <span className="hidden md:block"><Button variant="secondary" size="sm" icon="zap" onClick={() => setQuick(true)}>Quick actions</Button></span>
            <button aria-label="Quick actions" onClick={() => setQuick(true)} className="grid h-11 w-11 place-items-center rounded-lg text-brand-600 hover:bg-blue-50 md:hidden"><Icon name="zap" /></button>
            <Link href="/admin/notifications" aria-label={`Notifications${bellCount ? `, ${bellCount} unread` : ""}`} className="relative grid h-11 w-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100">
              <Icon name="bell" />
              {bellCount > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white">{bellCount > 99 ? "99+" : bellCount}</span>}
            </Link>
          </div>
          {!online && <div className="bg-slate-800 px-4 py-1.5 text-center text-xs text-white">You're offline — live data is paused</div>}
          {me && me.alerts.critical > 0 && (
            <Link href="/admin/notifications?tab=alerts" className="flex items-center gap-2 bg-red-600 px-4 py-2 text-[13px] font-medium text-white">
              <Icon name="alert" className="h-4 w-4" /><span className="flex-1 truncate">{me.alerts.critical} critical alert{me.alerts.critical > 1 ? "s" : ""} need attention</span><span className="flex items-center gap-1 text-xs opacity-90">View <Icon name="chevronRight" className="h-3.5 w-3.5" /></span>
            </Link>
          )}
          {me && (me.fleet.paused > 0 || me.fleet.maintenance > 0) && (
            <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
              <Icon name="pause" className="h-3.5 w-3.5" />
              {me.fleet.paused > 0 && <span>Printing paused on {me.fleet.paused} kiosk{me.fleet.paused > 1 ? "s" : ""}</span>}
              {me.fleet.maintenance > 0 && <span>· {me.fleet.maintenance} in maintenance mode</span>}
            </div>
          )}
        </header>

        <main className="print-full mx-auto w-full max-w-[1400px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-4 md:px-6 md:pt-6 lg:pb-10">
          {me?.demo && (
            <div className="no-print mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1"><b>Demo dataset</b> — sample data with simulated heartbeats. <Link href="/admin/settings?tab=system" className="font-medium underline">Manage</Link></p>
            </div>
          )}
          {me?.mustChangePassword && (
            <div className="no-print mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">Default password in use. <Link href="/admin/settings?tab=profile" className="font-medium underline">Change it now</Link>.</p>
            </div>
          )}
          {children}
        </main>

        {/* mobile bottom nav */}
        <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden" aria-label="Primary">
          <ul className="mx-auto grid max-w-xl grid-cols-5">
            {mobileBottom.map((n) => {
              const active = isActive(path, n.href);
              const badge = n.href === "/admin/notifications" ? (me?.alerts.critical ?? 0) || bellCount : 0;
              return (
                <li key={n.href}>
                  <Link href={n.href} className={cx("relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition", active ? "text-brand-600" : "text-slate-500")} aria-current={active ? "page" : undefined}>
                    <span className="relative"><Icon name={n.icon} className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                      {badge > 0 && <span className="absolute -right-2 -top-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">{badge > 99 ? "99+" : badge}</span>}
                    </span>
                    {n.short ?? n.label}
                    {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-brand-600" />}
                  </Link>
                </li>
              );
            })}
            <li>
              <button onClick={() => setDrawer(true)} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500"><Icon name="menu" className="h-[22px] w-[22px]" strokeWidth={1.8} />More</button>
            </li>
          </ul>
        </nav>

        <QuickActions open={quick} onClose={() => setQuick(false)} onDone={reload} navigate={(h) => { setQuick(false); router.push(h); }} />
      </div>
    </MeContext.Provider>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-3 px-5 pt-[env(safe-area-inset-top)]">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-lg shadow-blue-600/30"><Icon name="printer" className="h-[18px] w-[18px]" /></div>
      <div className="leading-tight"><p className="text-[15px] font-semibold tracking-tight text-white">PrintBar</p><p className="text-[11px] text-slate-400">Admin Control Centre</p></div>
    </div>
  );
}

function FleetPill() {
  const { me } = useMe();
  if (!me) return <div className="mx-4 my-2 h-14 animate-pulse rounded-lg bg-navy-800" />;
  const ok = me.fleet.online === me.fleet.total;
  return (
    <div className="mx-4 my-2 flex items-center gap-3 rounded-lg bg-navy-800 px-3 py-2.5">
      <span className={cx("h-2.5 w-2.5 rounded-full", ok ? "bg-emerald-400 live-dot text-emerald-400" : "bg-amber-400")} />
      <div className="min-w-0 text-xs leading-tight"><p className="font-medium text-white">{me.fleet.online}/{me.fleet.total} kiosks online</p><p className="text-slate-400">{me.alerts.total} open alert{me.alerts.total === 1 ? "" : "s"}</p></div>
    </div>
  );
}

function NavLink({ n, active, badge }: { n: NavItem; active: boolean; badge?: number }) {
  return (
    <Link href={n.href} aria-current={active ? "page" : undefined} className={cx("group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition", active ? "bg-brand-600/15 text-white ring-1 ring-inset ring-brand-500/30" : "text-slate-400 hover:bg-navy-800 hover:text-white")}>
      <Icon name={n.icon} className={cx("h-[18px] w-[18px]", active ? "text-brand-500" : "text-slate-500 group-hover:text-slate-300")} />
      <span className="flex-1 truncate">{n.label}</span>
      {!!badge && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{badge}</span>}
    </Link>
  );
}

function UserCard({ onSignOut }: { onSignOut: () => void }) {
  const { me } = useMe();
  return (
    <div className="pb-safe border-t border-navy-700 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{me?.user.name.split(" ").map((s) => s[0]).slice(0, 2).join("") ?? "·"}</div>
        <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-medium text-white">{me?.user.name ?? "…"}</p><p className="truncate text-xs text-slate-400">{me ? ROLES[me.user.role as keyof typeof ROLES] : ""}</p></div>
        <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-navy-700 hover:text-white"><Icon name="logout" className="h-[18px] w-[18px]" /></button>
      </div>
    </div>
  );
}

/* ───────────── quick actions ───────────── */
function QuickActions({ open, onClose, onDone, navigate }: { open: boolean; onClose: () => void; onDone: () => void; navigate: (h: string) => void }) {
  const { me } = useMe();
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  const [conn, setConn] = useState<{ id: string; name: string; online: boolean }[] | null>(null);
  const can = (p: string) => !!me?.permissions.includes(p);

  const run = async (action: string, confirmOpts?: Parameters<typeof confirm>[0]) => {
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    setBusy(action);
    try {
      const r = await api<{ message: string; kiosks?: { id: string; name: string; online: boolean }[] }>("/api/admin/quick", { method: "POST", body: { action, confirm: !!confirmOpts } });
      if (r.kiosks) setConn(r.kiosks);
      toast("success", r.message);
      onDone();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const Tile = ({ icon, label, sub, onClick, disabled, tone = "default", id }: { icon: string; label: string; sub?: string; onClick: () => void; disabled?: boolean; tone?: "default" | "danger" | "good"; id?: string }) => (
    <button disabled={disabled || busy !== null} onClick={onClick} className={cx("flex min-h-[72px] items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.98] disabled:opacity-40", tone === "danger" ? "border-red-200 bg-red-50/60" : tone === "good" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white hover:bg-slate-50")}>
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-lg", tone === "danger" ? "bg-red-100 text-red-600" : tone === "good" ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-600")}>
        {busy === id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name={icon} className="h-5 w-5" />}
      </span>
      <span className="min-w-0 leading-tight"><span className="block text-[13px] font-semibold text-slate-900">{label}</span>{sub && <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>}</span>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Quick actions" size="lg">
      <div className="space-y-5">
        {me && (
          <div className="flex flex-wrap gap-2">
            <Badge tone={me.fleet.online === me.fleet.total ? "green" : "amber"} dot>{me.fleet.online}/{me.fleet.total} kiosks online</Badge>
            <Badge tone={me.alerts.critical ? "red" : "slate"} dot>{me.alerts.critical} critical</Badge>
            {me.fleet.paused > 0 && <Badge tone="amber">Printing paused ×{me.fleet.paused}</Badge>}
            {me.fleet.maintenance > 0 && <Badge tone="amber">Maintenance ×{me.fleet.maintenance}</Badge>}
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Control</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Tile id="pause_all" icon="pause" tone="danger" label="Pause all printing" sub="Stops new jobs on every kiosk" disabled={!can("printers.control")} onClick={() => run("pause_all", { title: "Pause all printing?", message: "Customers will not be able to start new print jobs on any enabled kiosk until you resume.", confirmLabel: "Pause printing", tone: "danger" })} />
            <Tile id="resume_all" icon="play" tone="good" label="Resume printing" sub="Re-enable on all kiosks" disabled={!can("printers.control")} onClick={() => run("resume_all")} />
            <Tile id="maintenance_on" icon="wrench" label="Maintenance mode ON" sub="Show 'under maintenance' to customers" disabled={!can("kiosks.control")} onClick={() => run("maintenance_on", { title: "Enable maintenance mode on all kiosks?", message: "Kiosks will show a maintenance screen and stop taking jobs.", confirmLabel: "Enable", tone: "warn" })} />
            <Tile id="maintenance_off" icon="check" label="Maintenance mode OFF" disabled={!can("kiosks.control")} onClick={() => run("maintenance_off")} />
            <Tile id="test_all" icon="printer" label="Run printer test" sub="Queue a test page on every printer" disabled={!can("printers.control")} onClick={() => run("test_all")} />
            <Tile id="check_connectivity" icon="wifi" label="Check kiosk connectivity" sub="Heartbeat status now" disabled={!can("kiosks.view")} onClick={() => run("check_connectivity")} />
          </div>
          {conn && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {conn.map((k) => <li key={k.id} className="flex items-center justify-between px-3 py-2.5"><span>{k.name} <span className="text-slate-400">{k.id}</span></span><Badge tone={k.online ? "green" : "red"} dot>{k.online ? "Online" : "Offline"}</Badge></li>)}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Go to</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Tile icon="alert" label="Critical alerts" sub={`${me?.alerts.critical ?? 0} open`} onClick={() => navigate("/admin/notifications?tab=alerts&severity=critical")} />
            <Tile icon="printer" label="Printer status" onClick={() => navigate("/admin/printers")} disabled={!can("printers.view")} />
            <Tile icon="jobs" label="Failed jobs" onClick={() => navigate("/admin/jobs?status=failed")} disabled={!can("jobs.view")} />
            <Tile icon="undo" label="Pending refunds" onClick={() => navigate("/admin/payments?tab=refunds&status=requested")} disabled={!can("payments.view")} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
