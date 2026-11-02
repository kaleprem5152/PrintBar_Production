"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

type K = { id: string; name: string; location: string; state: string };

const LABEL: Record<string, { text: string; cls: string }> = {
  ready: { text: "Ready", cls: "bg-ok-soft text-ok" },
  paper_out: { text: "Paper out", cls: "bg-amber-100 text-warn" },
  paper_jam: { text: "Temporarily unavailable", cls: "bg-amber-100 text-warn" },
  offline: { text: "Offline", cls: "bg-red-50 text-bad" },
  error: { text: "Temporarily unavailable", cls: "bg-amber-100 text-warn" },
};

export function KioskFinder() {
  const [list, setList] = useState<K[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/kiosks")
        .then((r) => r.json())
        .then((d) => alive && setList(d.kiosks))
        .catch(() => {});
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section id="kiosks" className="border-y border-line bg-paper-2/50">
      <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">Find a kiosk</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Collect from a kiosk <span className="font-display italic font-normal">near you.</span>
            </h2>
          </div>
          <p className="text-[13px] text-mute">Sample locations · status updates live</p>
        </div>
        <ul className="mt-10 grid gap-3 md:grid-cols-3">
          {(list ?? [null, null, null]).map((k, i) => (
            <li key={k?.id ?? i} className="flex items-start gap-4 rounded-[22px] border border-line bg-white p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paper-2">
                <Icon name="pin" size={20} />
              </span>
              {k ? (
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{k.name}</p>
                  <p className="mt-0.5 text-[14px] text-mute">{k.location}</p>
                  <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${(LABEL[k.state] ?? LABEL.error).cls}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {(LABEL[k.state] ?? LABEL.error).text}
                  </span>
                </div>
              ) : (
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-paper-2" />
                  <div className="h-3 w-44 animate-pulse rounded bg-paper-2" />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
