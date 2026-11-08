import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_SETTINGS, type SettingsGroup } from "./constants";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from "./rbac";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (!row) return fallback;
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return { ...fallback, ...(row.value as object) } as T;
  }
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, by?: string) {
  await db
    .insert(settings)
    .values({ key, value, updatedByName: by ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date(), updatedByName: by ?? null } });
}

export async function getGroup<G extends SettingsGroup>(g: G): Promise<(typeof DEFAULT_SETTINGS)[G]> {
  return getSetting(g, DEFAULT_SETTINGS[g]);
}

export async function getRolePermissions(role: string): Promise<Permission[]> {
  if (role === "super_admin") return ALL_PERMISSIONS;
  const overrides = await getSetting<Record<string, Permission[]>>("role_permissions", {});
  const list = overrides[role] ?? DEFAULT_ROLE_PERMISSIONS[role as Role] ?? [];
  return list.filter((p) => ALL_PERMISSIONS.includes(p));
}

export async function allRolePermissions(): Promise<Record<Role, Permission[]>> {
  const overrides = await getSetting<Record<string, Permission[]>>("role_permissions", {});
  const out = {} as Record<Role, Permission[]>;
  for (const r of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
    out[r] = r === "super_admin" ? ALL_PERMISSIONS : (overrides[r] ?? DEFAULT_ROLE_PERMISSIONS[r]);
  }
  return out;
}
