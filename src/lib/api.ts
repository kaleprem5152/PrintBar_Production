import type { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getAuth, type AuthUser } from "./auth";
import type { Permission } from "./rbac";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type Ctx<P> = {
  req: NextRequest;
  user: AuthUser;
  params: P;
  ip: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: () => Promise<Record<string, any>>;
};

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Wraps a route handler with authentication, RBAC, JSON-only mutations and uniform errors. */
export function route<P = Record<string, string>>(
  perm: Permission | Permission[] | null,
  handler: (c: Ctx<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await getAuth();
      if (!user) throw new ApiError(401, "Not authenticated");
      if (perm) {
        const need = Array.isArray(perm) ? perm : [perm];
        if (!need.some((p) => user.permissions.includes(p))) throw new ApiError(403, "You don't have permission to do this");
      }
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && !(req.headers.get("content-type") ?? "").includes("application/json")) {
        throw new ApiError(415, "JSON body required");
      }
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const out = await handler({
        req,
        user,
        params,
        ip: clientIp(req),
        body: async () => {
          try {
            const b = await req.json();
            return b && typeof b === "object" ? b : {};
          } catch {
            throw new ApiError(400, "Invalid JSON body");
          }
        },
      });
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
      const msg = e instanceof Error ? e.message : "Unexpected error";
      // Unique-index violations (duplicate retry / duplicate refund guards)
      if (/duplicate key|unique constraint/i.test(msg) || (e as { code?: string })?.code === "23505") {
        return Response.json({ error: "Duplicate operation blocked — an identical action is already in progress." }, { status: 409 });
      }
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function audit(
  c: { user: Pick<AuthUser, "id" | "name" | "role"> | null; ip?: string | null },
  action: string,
  entity?: string,
  entityId?: string | number,
  details: Record<string, unknown> = {},
) {
  await db.insert(auditLogs).values({
    userId: c.user?.id ?? null,
    userName: c.user?.name ?? "System",
    role: c.user?.role ?? null,
    action,
    entity: entity ?? null,
    entityId: entityId != null ? String(entityId) : null,
    details,
    ip: c.ip ?? null,
  });
}

/* ── validation helpers ── */
export function str(v: unknown, name: string, o: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v == null || v === "") {
    if (o.optional) return "";
    throw new ApiError(400, `${name} is required`);
  }
  if (typeof v !== "string") throw new ApiError(400, `${name} must be text`);
  const s = v.trim();
  if (o.min && s.length < o.min) throw new ApiError(400, `${name} must be at least ${o.min} characters`);
  if (s.length > (o.max ?? 500)) throw new ApiError(400, `${name} is too long`);
  return s;
}

export function int(v: unknown, name: string, o: { min?: number; max?: number } = {}): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) throw new ApiError(400, `${name} must be a whole number`);
  if (o.min != null && n < o.min) throw new ApiError(400, `${name} must be ≥ ${o.min}`);
  if (o.max != null && n > o.max) throw new ApiError(400, `${name} must be ≤ ${o.max}`);
  return n;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new ApiError(400, `${name} must be one of: ${allowed.join(", ")}`);
  return v as T;
}

export function pageParams(sp: URLSearchParams, defSize = 20) {
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(sp.get("size") ?? defSize) || defSize));
  return { page, size, offset: (page - 1) * size };
}

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD (IST days, inclusive) → [from, toExclusive). */
export function dateRange(sp: URLSearchParams, defaultDays = 7): { from: Date; to: Date; days: number } {
  const dayMs = 86400_000;
  const istOffset = 5.5 * 3600_000;
  const startOfIstDay = (d: Date) => new Date(Math.floor((d.getTime() + istOffset) / dayMs) * dayMs - istOffset);
  const parse = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+05:30`) : null);
  const today = startOfIstDay(new Date());
  const to = parse(sp.get("to"));
  const from = parse(sp.get("from"));
  const end = to ? new Date(to.getTime() + dayMs) : new Date(today.getTime() + dayMs);
  const start = from ?? new Date(end.getTime() - defaultDays * dayMs);
  const safeStart = start.getTime() >= end.getTime() ? new Date(end.getTime() - dayMs) : start;
  return { from: safeStart, to: end, days: Math.max(1, Math.round((end.getTime() - safeStart.getTime()) / dayMs)) };
}
