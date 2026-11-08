"use client";

import { useEffect, useState } from "react";
import { Button, Field, Icon, Input } from "@/components/ui";
import { ROLES } from "@/lib/rbac";
import { api } from "@/lib/client";

type Hint = { show: boolean; password?: string; accounts?: { email: string; role: string }[] };

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    api<Hint>("/api/auth/hint").then(setHint).catch(() => setHint({ show: false }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600"><Icon name="printer" /></div><span className="text-lg font-semibold">PrintBar</span></div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Run every kiosk from your pocket.</h1>
          <p className="mt-4 text-slate-400">Live hardware health, job & refund control, pricing and reports — one operations command centre built for your phone.</p>
        </div>
        <p className="relative text-xs text-slate-500">Authorised PrintBar staff only. Activity is logged.</p>
      </div>
      <div className="flex min-h-dvh flex-col justify-center bg-[#f4f6fa] px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-900 text-white"><Icon name="printer" /></div><div><p className="font-semibold leading-tight">PrintBar</p><p className="text-xs text-slate-500">Admin Control Centre</p></div></div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your administrator account.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email or Username"><Input type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin or you@printbar.in" autoCapitalize="off" /></Field>
            <Field label="Password">
              <div className="relative">
                <Input type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-16" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1/2 min-h-11 -translate-y-1/2 px-3 text-xs font-medium text-brand-600">{show ? "Hide" : "Show"}</button>
              </div>
            </Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
            <Button type="submit" variant="primary" loading={busy} className="w-full">Sign in</Button>
          </form>
          {hint?.show && (
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-[13px] text-blue-900">
              <p className="font-semibold">First-run accounts</p>
              <p className="mt-0.5 text-blue-800">Tap an account to fill the form. Password: <code className="rounded bg-white px-1.5 py-0.5 font-mono">{hint.password}</code>. This hint disappears once an account has been used.</p>
              <ul className="mt-3 space-y-1.5">
                {hint.accounts?.map((a) => (
                  <li key={a.email}>
                    <button type="button" onClick={() => { setEmail(a.email); setPassword(hint.password ?? ""); }} className="flex min-h-11 w-full items-center justify-between rounded-lg bg-white px-3 text-left ring-1 ring-blue-200 hover:ring-blue-400">
                      <span className="truncate">{a.email}</span><span className="ml-2 shrink-0 text-xs text-slate-500">{ROLES[a.role as keyof typeof ROLES]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
