"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export class ApiErr extends Error {
  constructor(
    public status: number,
    message: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public data?: any,
  ) {
    super(message);
  }
}

export async function api<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  url: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiErr(0, "Network error — check your connection");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/")) {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
    throw new ApiErr(401, "Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErr(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

export function useApi<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  url: string | null,
  opts: { interval?: number } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiErr | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async (silent: boolean) => {
    const u = urlRef.current;
    if (!u) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await api<T>(u, { signal: c.signal });
      if (c.signal.aborted) return;
      setData(d);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e as ApiErr);
    } finally {
      if (!c.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    void load(data !== null);
    return () => ctl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, load]);

  useEffect(() => {
    if (!opts.interval || !url) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const t = setInterval(tick, opts.interval);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [opts.interval, url, load]);

  return { data, error, loading, refreshing, updatedAt, reload: () => load(true), setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Build a query string from defined, non-empty values. */
export function qs(o: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
}

/* ───────── session context ───────── */
export type Me = {
  user: { id: number; name: string; email: string; role: string };
  permissions: string[];
  mustChangePassword: boolean;
  demo: boolean;
  unread: number;
  alerts: { critical: number; total: number };
  fleet: { total: number; online: number; paused: number; maintenance: number };
  gatewayConfigured: boolean;
};
export const MeContext = createContext<{ me: Me | null; reloadMe: () => void }>({ me: null, reloadMe: () => {} });
export const useMe = () => useContext(MeContext);
export const useCan = () => {
  const { me } = useMe();
  return (p: string) => !!me?.permissions.includes(p);
};
