/* Role-based access control — client-safe definitions */

export const ROLES = {
  super_admin: "Super Admin",
  ops_admin: "Operations Admin",
  finance_admin: "Finance Admin",
  maintenance: "Maintenance Operator",
} as const;
export type Role = keyof typeof ROLES;

export const PERMISSIONS = {
  "overview.view": { label: "View overview dashboard", group: "General" },
  "jobs.view": { label: "View print jobs", group: "Print jobs" },
  "jobs.manage": { label: "Retry, cancel & reconcile jobs", group: "Print jobs" },
  "payments.view": { label: "View payments & refunds", group: "Finance" },
  "refunds.manage": { label: "Initiate & reconcile refunds", group: "Finance" },
  "pricing.view": { label: "View pricing", group: "Finance" },
  "pricing.manage": { label: "Publish pricing changes", group: "Finance" },
  "analytics.view": { label: "View analytics & reports", group: "Finance" },
  "reports.export": { label: "Export CSV / PDF reports", group: "Finance" },
  "printers.view": { label: "View printers", group: "Hardware" },
  "printers.control": { label: "Pause, resume, test print, clear queue", group: "Hardware" },
  "printers.configure": { label: "Configure printers (roles, priority, failover)", group: "Hardware" },
  "kiosks.view": { label: "View kiosks", group: "Hardware" },
  "kiosks.control": { label: "Maintenance mode, restart services", group: "Hardware" },
  "kiosks.configure": { label: "Enable/disable & configure kiosks", group: "Hardware" },
  "alerts.manage": { label: "Acknowledge & resolve alerts", group: "Hardware" },
  "inventory.view": { label: "View inventory", group: "Inventory" },
  "inventory.manage": { label: "Adjust stock & log purchases", group: "Inventory" },
  "customers.view": { label: "View customer activity", group: "Administration" },
  "audit.view": { label: "View audit & activity logs", group: "Administration" },
  "settings.view": { label: "View settings & system health", group: "Administration" },
  "settings.manage": { label: "Change system settings", group: "Administration" },
  "users.manage": { label: "Manage admins, roles & sessions", group: "Administration" },
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  ops_admin: [
    "overview.view", "jobs.view", "jobs.manage", "payments.view", "pricing.view", "analytics.view",
    "printers.view", "printers.control", "printers.configure", "kiosks.view", "kiosks.control", "kiosks.configure",
    "alerts.manage", "inventory.view", "inventory.manage", "customers.view", "audit.view", "settings.view",
  ],
  finance_admin: [
    "overview.view", "jobs.view", "payments.view", "refunds.manage", "pricing.view", "pricing.manage",
    "analytics.view", "reports.export", "inventory.view", "customers.view", "audit.view", "settings.view",
  ],
  maintenance: [
    "overview.view", "jobs.view", "printers.view", "printers.control", "kiosks.view",
    "alerts.manage", "inventory.view", "inventory.manage",
  ],
};

export const can = (perms: readonly string[] | undefined, p: Permission) => !!perms && perms.includes(p);
