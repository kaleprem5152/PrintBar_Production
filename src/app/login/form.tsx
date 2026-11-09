"use client";

import { useState } from "react";
import { Button, Field, Icon, Input } from "@/components/ui";
import { api } from "@/lib/client";

const QUICK_ROLES = [
  {
    role: "super_admin",
    title: "Super Admin",
    email: "admin@printbar.in",
    icon: "shield" as const,
    badge: "Full Control",
    badgeColor: "bg-purple-100 text-purple-700 border-purple-200",
    desc: "Complete kiosk, billing & system administration",
  },
  {
    role: "ops_admin",
    title: "Operations Lead",
    email: "ops@printbar.in",
    icon: "zap" as const,
    badge: "Hardware & Queues",
    badgeColor: "bg-blue-100 text-blue-700 border-blue-200",
    desc: "Kiosk queues, CUPS status & live order control",
  },
  {
    role: "finance_admin",
    title: "Finance Lead",
    email: "finance@printbar.in",
    icon: "chart" as const,
    badge: "Revenue & Refunds",
    badgeColor: "bg-emerald-100 text-emerald-700 border-emerald-200",
    desc: "Cashfree payouts, refunds & pricing changes",
  },
  {
    role: "maintenance",
    title: "Maintenance Tech",
    email: "maintenance@printbar.in",
    icon: "tool" as const,
    badge: "Paper & Hardware",
    badgeColor: "bg-amber-100 text-amber-700 border-amber-200",
    desc: "Tray 1 refills, toner status & hardware alerts",
  },
];

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: { email: email.trim(), password: password.trim() },
      });
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function quickLogin(role: string) {
    setBusyRole(role);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: { quickRole: role },
      });
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusyRole(null);
    }
  }

  function prefill(emailVal: string) {
    setEmail(emailVal);
    setPassword("PrintBar@2026");
    setError("");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand Side Panel */}
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white font-bold">
            PB
          </div>
          <span className="text-lg font-semibold tracking-tight">PrintBar Operations</span>
        </div>
        <div className="relative max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs text-sky-300 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            PB-K01 SGU Food Court Connected
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Run every kiosk from your pocket.
          </h1>
          <p className="mt-4 text-slate-400 leading-relaxed">
            Live hardware health, CUPS queues, paper levels, cashfree transactions, and instant refund control — all in one unified command centre.
          </p>
        </div>
        <p className="relative text-xs text-slate-500">
          Authorised PrintBar staff only. All administrative sessions are cryptographically signed and audited.
        </p>
      </div>

      {/* Main Login Form & Role Switcher */}
      <div className="flex min-h-dvh flex-col justify-center bg-[#f4f6fa] px-5 py-8 sm:px-10 overflow-y-auto">
        <div className="mx-auto w-full max-w-md">
          {/* Mobile Brand Header */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-900 text-white font-bold">
              PB
            </div>
            <div>
              <p className="font-semibold leading-tight text-slate-900">PrintBar</p>
              <p className="text-xs text-slate-500">Admin Control Centre</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to PrintBar</h2>
            <p className="mt-1 text-sm text-slate-600">
              Select your role for 1-click access or enter your credentials below.
            </p>
          </div>

          {/* 1-Click Role Direct Sign-In */}
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                1-Click Direct Role Sign-In
              </span>
              <span className="text-[11px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Instant Access
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {QUICK_ROLES.map((r) => {
                const isCurrentBusy = busyRole === r.role;
                return (
                  <button
                    key={r.role}
                    type="button"
                    disabled={busy || busyRole !== null}
                    onClick={() => quickLogin(r.role)}
                    className="group relative flex flex-col items-start p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-brand-50 hover:border-brand-300 text-left transition-all active:scale-[0.98] disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-semibold text-xs text-slate-900 group-hover:text-brand-700">
                        {r.title}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${r.badgeColor}`}>
                        {r.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 group-hover:text-slate-600 truncate max-w-full">
                      {r.email}
                    </span>
                    {isCurrentBusy && (
                      <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center gap-2 text-xs font-medium text-brand-600">
                        <span className="h-4 w-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                        Signing in...
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#f4f6fa] px-3 font-medium text-slate-400">
                Or Sign In With Password
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <Field label="Email, Username or Role">
              <Input
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@printbar.in or admin or super_admin"
                autoCapitalize="off"
              />
            </Field>

            <Field label="Password">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="PrintBar@2026"
                  className="pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-1 top-1/2 min-h-11 -translate-y-1/2 px-3 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            <div className="text-[11px] text-slate-500 flex items-center justify-between">
              <span>Standard Password: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-mono font-medium">PrintBar@2026</code></span>
              <button
                type="button"
                onClick={() => prefill("admin@printbar.in")}
                className="text-brand-600 hover:underline font-medium"
              >
                Auto-fill Admin
              </button>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 ring-1 ring-red-200">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={busyRole !== null}
              className="w-full h-11 text-sm font-semibold"
            >
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
