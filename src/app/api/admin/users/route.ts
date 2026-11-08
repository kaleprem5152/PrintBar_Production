import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { ApiError, audit, oneOf, route, str } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { ALL_PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/rbac";
import { allRolePermissions, getSetting, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const roleKeys = Object.keys(ROLES) as Role[];

function checkPassword(pw: string) {
  if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
    throw new ApiError(400, "Password must be 10+ characters with upper-case, lower-case and a number");
  }
}

export const GET = route("users.manage", async () => {
  const users = await db.select().from(adminUsers).orderBy(adminUsers.id);
  return {
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, defaultPassword: u.mustChangePassword, locked: !!u.lockedUntil && u.lockedUntil > new Date() })),
    roles: ROLES,
    matrix: await allRolePermissions(),
  };
});

export const POST = route("users.manage", async ({ user, ip, body }) => {
  const b = await body();
  const email = str(b.email, "Email", { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "Enter a valid email");
  const password = str(b.password, "Temporary password", { max: 100 });
  checkPassword(password);
  const [row] = await db
    .insert(adminUsers)
    .values({ email, name: str(b.name, "Name", { max: 80 }), role: oneOf(b.role, "Role", roleKeys), passwordHash: hashPassword(password) })
    .returning();
  await audit({ user, ip }, "user.create", "user", row.id, { email, role: row.role });
  return { ok: true, message: "Admin created. They must change the temporary password after first login." };
});

export const PATCH = route("users.manage", async ({ user, ip, body }) => {
  const b = await body();
  const id = Number(b.id);
  const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!target) throw new ApiError(404, "User not found");
  const patch: Partial<typeof adminUsers.$inferInsert> = {};
  if (b.role !== undefined) patch.role = oneOf(b.role, "Role", roleKeys);
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.unlock) { patch.lockedUntil = null; patch.failedLogins = 0; }
  if (b.resetPassword) {
    const pw = str(b.resetPassword, "Password", { max: 100 });
    checkPassword(pw);
    patch.passwordHash = hashPassword(pw);
    patch.mustChangePassword = true;
  }
  if (id === user.id && (patch.role || patch.active === false)) throw new ApiError(400, "You can't change your own role or deactivate yourself");
  if ((patch.role && patch.role !== "super_admin" && target.role === "super_admin") || (patch.active === false && target.role === "super_admin")) {
    const supers = await db.select({ id: adminUsers.id }).from(adminUsers).where(and(eq(adminUsers.role, "super_admin"), eq(adminUsers.active, true), ne(adminUsers.id, id)));
    if (!supers.length) throw new ApiError(409, "At least one active Super Admin is required");
  }
  if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to update");
  await db.update(adminUsers).set(patch).where(eq(adminUsers.id, id));
  if (patch.active === false || patch.passwordHash || patch.role) {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.userId, id), isNull(adminSessions.revokedAt)));
  }
  await audit({ user, ip }, "user.update", "user", id, { role: patch.role, active: patch.active, passwordReset: !!patch.passwordHash, unlock: !!b.unlock });
  return { ok: true, message: "User updated" + (patch.passwordHash || patch.role || patch.active === false ? " — their sessions were signed out." : "") };
});

/** Edit the permission matrix for a role (Super Admin is always full-access). */
export const PUT = route("users.manage", async ({ user, ip, body }) => {
  const b = await body();
  const role = oneOf(b.role, "Role", roleKeys);
  if (role === "super_admin") throw new ApiError(400, "Super Admin permissions can't be reduced");
  const perms = (Array.isArray(b.permissions) ? b.permissions : []).filter((p: string) => ALL_PERMISSIONS.includes(p as Permission));
  const overrides = await getSetting<Record<string, string[]>>("role_permissions", {});
  const before = (await allRolePermissions())[role];
  overrides[role] = perms;
  await setSetting("role_permissions", overrides, user.name);
  await audit({ user, ip }, "role.permissions", "role", role, { before, after: perms });
  return { ok: true, message: `${ROLES[role]} permissions updated. Applies on the next request.` };
});

void desc; void gt;
