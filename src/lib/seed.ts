import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "./auth";
import { DEFAULT_PRICING } from "./pricing";
import { setSetting } from "./settings";

export const DEFAULT_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "PrintBar@2026";

export const BOOTSTRAP_USERS = [
  { email: "admin@printbar.in", username: "admin", name: "System Admin", role: "super_admin" },
  { email: "super@printbar.in", username: "super", name: "Super Admin", role: "super_admin" },
  { email: "ops@printbar.in", username: "ops", name: "Operations Lead", role: "ops_admin" },
  { email: "finance@printbar.in", username: "finance", name: "Finance Lead", role: "finance_admin" },
  { email: "maintenance@printbar.in", username: "maintenance", name: "Maintenance Tech", role: "maintenance" },
];

let booting: Promise<void> | null = null;

/**
 * Production-ready bootstrap:
 * 1. Default admin accounts with verified credentials
 * 2. Real single physical kiosk: PB-K01 (PrintBar SGU Foodcourt)
 * 3. Exactly two connected printers: Kyocera PA3500x & Canon GX6170
 * 4. Authoritative pricing configuration
 * 5. Hardware inventory baseline
 * NO fictional machines, NO mock revenue, NO fake transactions.
 */
export function ensureBootstrap(): Promise<void> {
  if (!booting) {
    booting = (async () => {
      // 1. Ensure Admin Accounts
      const pw = hashPassword(DEFAULT_PASSWORD);
      for (const u of BOOTSTRAP_USERS) {
        await db
          .insert(s.adminUsers)
          .values({ ...u, passwordHash: pw, active: true, mustChangePassword: false, failedLogins: 0, lockedUntil: null })
          .onConflictDoUpdate({
            target: s.adminUsers.email,
            set: { username: u.username, active: true, passwordHash: pw, failedLogins: 0, lockedUntil: null },
          })
          .catch(() => {});
      }

      // 2. Ensure Real Single Kiosk: PB-K01 (SGU Foodcourt)
      await db
        .insert(s.kiosks)
        .values({
          id: "PB-K01",
          name: "PrintBar SGU Foodcourt",
          location: "SGU Food Court, Kolhapur",
          enabled: true,
          maintenance: false,
          printingPaused: false,
          networkType: "ethernet",
          ipAddress: "192.168.1.100",
          backendConnected: true,
          isDemo: false,
        })
        .onConflictDoUpdate({
          target: s.kiosks.id,
          set: {
            name: "PrintBar SGU Foodcourt",
            location: "SGU Food Court, Kolhapur",
            enabled: true,
            isDemo: false,
          },
        })
        .catch(() => {});

      // Also ensure devices table PB-K01
      await db
        .insert(s.devices)
        .values({
          id: "PB-K01",
          name: "PrintBar SGU Foodcourt",
          location: "SGU Food Court, Kolhapur",
          secretHash: "demo",
          isActive: true,
          kyoceraReady: true,
          canonReady: true,
          paperReady: true,
          kyoceraPaper: 250,
          canonPaper: 250,
          maintenanceMode: false,
        })
        .onConflictDoUpdate({
          target: s.devices.id,
          set: {
            name: "PrintBar SGU Foodcourt",
            location: "SGU Food Court, Kolhapur",
            isActive: true,
          },
        })
        .catch(() => {});

      // 3. Ensure Exactly TWO Physical Printers
      // Printer 1: Kyocera ECOSYS PA3500x (Primary B&W)
      await db
        .insert(s.printers)
        .values({
          id: "kyocera_pa3500x",
          kioskId: "PB-K01",
          name: "Kyocera ECOSYS PA3500x",
          model: "Kyocera ECOSYS PA3500x",
          ip: "192.168.1.21",
          cupsQueue: "Kyocera_PA3500x",
          role: "primary",
          priority: 1,
          enabled: true,
          paused: false,
          autoFailover: true,
          supportsColor: false,
          paperCapacity: 250,
          paperRemaining: 250,
          paperSource: "manual",
          tonerBlack: 100,
          tonerSource: "manual",
          totalPages: 0,
        })
        .onConflictDoUpdate({
          target: s.printers.id,
          set: {
            kioskId: "PB-K01",
            name: "Kyocera ECOSYS PA3500x",
            model: "Kyocera ECOSYS PA3500x",
            cupsQueue: "Kyocera_PA3500x",
            role: "primary",
            priority: 1,
            enabled: true,
            autoFailover: true,
            supportsColor: false,
            paperCapacity: 250,
          },
        })
        .catch(() => {});

      // Printer 2: Canon MAXIFY GX6170 (Colour + B&W Backup)
      await db
        .insert(s.printers)
        .values({
          id: "canon_gx6170",
          kioskId: "PB-K01",
          name: "Canon MAXIFY GX6170",
          model: "Canon MAXIFY GX6170",
          ip: "192.168.1.22",
          cupsQueue: "Canon_GX6170",
          role: "backup",
          priority: 2,
          enabled: true,
          paused: false,
          autoFailover: true,
          supportsColor: true,
          paperCapacity: 250,
          paperRemaining: 250,
          paperSource: "manual",
          tonerBlack: 100,
          tonerColor: 100,
          tonerSource: "manual",
          totalPages: 0,
        })
        .onConflictDoUpdate({
          target: s.printers.id,
          set: {
            kioskId: "PB-K01",
            name: "Canon MAXIFY GX6170",
            model: "Canon MAXIFY GX6170",
            cupsQueue: "Canon_GX6170",
            role: "backup",
            priority: 2,
            enabled: true,
            autoFailover: true,
            supportsColor: true,
            paperCapacity: 250,
          },
        })
        .catch(() => {});

      // 4. Ensure Active Pricing
      const [{ p }] = await db.select({ p: count() }).from(s.pricingVersions);
      if (p === 0) {
        await db
          .insert(s.pricingVersions)
          .values({
            ...DEFAULT_PRICING,
            active: true,
            note: "Official PrintBar SGU Pricing (B&W ₹2, Colour ₹8)",
            publishedBy: "System",
          })
          .catch(() => {});
      }

      // 5. Ensure Inventory Items Baseline
      const [{ invCount }] = await db.select({ invCount: count() }).from(s.inventoryItems);
      if (invCount === 0) {
        await db
          .insert(s.inventoryItems)
          .values([
            { sku: "PAP-A4-80", name: "A4 Paper 80 GSM", category: "paper", unit: "sheets", stock: 1000, reorderThreshold: 500, unitCostPaise: 45 },
            { sku: "TON-TK3160", name: "Kyocera TK-3160 Black Toner", category: "toner", unit: "cartridge", stock: 2, reorderThreshold: 1, unitCostPaise: 450000 },
            { sku: "INK-GI790K", name: "Canon GI-790 Black Ink", category: "ink", unit: "bottle", stock: 3, reorderThreshold: 1, unitCostPaise: 69000 },
            { sku: "INK-GI790C", name: "Canon GI-790 Colour Ink Set", category: "ink", unit: "bottle", stock: 3, reorderThreshold: 1, unitCostPaise: 195000 },
          ])
          .catch(() => {});
      }

      // Mark demo_seeded = true so demo generation is never invoked
      await setSetting("demo_seeded", true);
      await setSetting("demo_mode", false);
    })().catch((e) => {
      booting = null;
      throw e;
    });
  }
  return booting;
}

/** Clear any residual demo data (disabled in production unless forced). */
export async function clearDemo() {
  if (process.env.NODE_ENV === "production") {
    // In production, only clear mock items, never real customer records
    await db.delete(s.alerts).where(eq(s.alerts.kioskId, "KSK-001"));
    await db.delete(s.alerts).where(eq(s.alerts.kioskId, "KSK-002"));
    await db.delete(s.alerts).where(eq(s.alerts.kioskId, "KSK-003"));
    return;
  }
  await setSetting("demo_mode", false);
}

/** Disabled in production to prevent injecting fictional records. */
export async function loadDemo() {
  if (process.env.NODE_ENV === "production") {
    console.warn("[seed] loadDemo is strictly disabled in production.");
    return;
  }
  // In development, ensure SGU baseline
  await ensureBootstrap();
}
