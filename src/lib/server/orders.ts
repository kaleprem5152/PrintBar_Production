import "server-only";
import { randomBytes } from "crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, devices, orders, type OrderDoc } from "@/db/schema";
import { PIN_TTL_HOURS } from "@/lib/config";

export type OrderRow = typeof orders.$inferSelect;

// ─── Order references ─────────────────────────────────────────────────────────

/** Generate a human-readable order reference: PB-2026-NNNNN */
export function newOrderRef(id: number) {
  const year = new Date().getFullYear();
  return `PB-${year}-${String(id).padStart(5, "0")}`;
}

export function expiryFromNow() {
  return new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
}

// ─── PIN management ───────────────────────────────────────────────────────────

/** Generate a 4-digit PIN not currently in use by any active order */
export async function generatePin(): Promise<string> {
  const activeOrders = await db
    .select({ pin: orders.pin })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["paid", "pin_accepted", "queued", "claimed", "processing", "printing", "fallback_pending", "fallback_printing", "failed"]),
        gt(orders.expiresAt, new Date()),
      ),
    );
  const usedPins = new Set(activeOrders.map((a) => a.pin).filter(Boolean));

  for (let i = 0; i < 500; i++) {
    const n = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
    const pin = String(n);
    if (!usedPins.has(pin)) return pin;
  }
  throw new Error("No PIN available — too many active orders");
}

// ─── Order state machine ──────────────────────────────────────────────────────

/**
 * Allowed status transitions.
 * Key: current status. Value: set of statuses it can transition to.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created:           ["pending_payment", "cancelled"],
  pending_payment:   ["payment_pending", "payment_failed", "paid", "cancelled"],
  payment_pending:   ["paid", "payment_failed"],
  payment_failed:    ["pending_payment"],
  paid:              ["pin_accepted", "cancelled", "refund_pending"],
  pin_accepted:      ["queued", "cancelled"],
  queued:            ["claimed"],
  claimed:           ["processing", "failed"],
  processing:        ["printing", "failed"],
  printing:          ["completed", "fallback_pending", "failed"],
  fallback_pending:  ["fallback_printing", "failed"],
  fallback_printing: ["completed", "failed"],
  completed:         [],
  failed:            ["refund_pending"],
  cancelled:         ["refund_pending"],
  refund_pending:    ["refunded"],
  refunded:          [],
};

/** Validate that a status transition is allowed */
export function isValidTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Demo & Seeding ───────────────────────────────────────────────────────────

const DEMO_DOC: OrderDoc = {
  id: "demo-semester-notes",
  name: "Semester_Notes.pdf",
  size: 482_000,
  pages: 30,
  selected: 30,
  range: null,
  estimated: false,
  kind: "pdf",
};

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  try {
    await db
      .insert(devices)
      .values([
        {
          id: "PB-K01",
          name: "PrintBar Kiosk 01",
          location: "Central Library · Ground floor",
          secretHash: "demo",
          kyoceraReady: true,
          canonReady: true,
        },
        {
          id: "PB-K02",
          name: "PrintBar Kiosk 02",
          location: "Engineering Block · Lobby",
          secretHash: "demo",
          kyoceraReady: true,
          canonReady: true,
        },
        {
          id: "PB-K03",
          name: "PrintBar Kiosk 03",
          location: "Student Centre · Level 1",
          secretHash: "demo",
          kyoceraReady: true,
          canonReady: true,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(orders)
      .values({
        orderId: "PB-2026-00142",
        token: "demo",
        pin: "4827",
        status: "paid",
        docs: [DEMO_DOC],
        pagesPerCopy: 30,
        copies: 1,
        colorMode: "bw",
        paperSize: "A4",
        sides: "single",
        orientation: "portrait",
        amount: 60,
        rateApplied: 2,
        pagesToPrint: 30,
        isDemo: true,
        paidAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 365),
      })
      .onConflictDoNothing();

    await db
      .insert(orders)
      .values({
        orderId: "PB-2026-00139",
        token: "expired",
        pin: "0000",
        status: "paid",
        docs: [{ ...DEMO_DOC, id: "demo-expired", name: "Lab_Report.pdf", pages: 8, selected: 8 }],
        pagesPerCopy: 8,
        copies: 1,
        colorMode: "color",
        paperSize: "A4",
        sides: "single",
        orientation: "portrait",
        amount: 64,
        rateApplied: 8,
        pagesToPrint: 8,
        isDemo: true,
        paidAt: new Date(Date.now() - 1000 * 3600 * 48),
        expiresAt: new Date(Date.now() - 1000 * 3600 * 24),
      })
      .onConflictDoNothing();

    seeded = true;
  } catch {
    /* If DB is not yet connected/migrated, fail gracefully */
  }
}

export async function resetDemo() {
  await ensureSeed();
  try {
    await db
      .update(orders)
      .set({
        status: "paid",
        pin: "4827",
        pagesPrinted: 0,
        printBaseline: 0,
        printStartedAt: null,
        failureReason: null,
        filesDeleted: false,
        completedAt: null,
        paidAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 365),
      })
      .where(eq(orders.orderId, "PB-2026-00142"));

    await db
      .update(devices)
      .set({ kyoceraReady: true, canonReady: true, maintenanceMode: false, updatedAt: new Date() })
      .where(eq(devices.id, "PB-K01"));
  } catch {
    /* ignore */
  }
}

let demoStateOverride: string | null = null;

export function setDemoStateOverride(state: string | null) {
  demoStateOverride = state;
}

export async function getKioskState(id = "PB-K01"): Promise<string> {
  if (demoStateOverride) return demoStateOverride;
  const status = await getDevicePrinterStatus(id);
  if (status.maintenanceMode) return "offline";
  if (!status.kyoceraReady && !status.canonReady) return "offline";
  return "ready";
}

export function signPayment(orderId: string, paymentId: string) {
  const { createHmac } = require("crypto");
  const secret = process.env.CASHFREE_CLIENT_SECRET || "printbar-test-secret";
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

/** Demo simulation: advances the simulated printer if isDemo is true */
export async function advance(o: OrderRow): Promise<OrderRow> {
  if (!o.isDemo || o.status !== "printing" || !o.printStartedAt) return o;
  const elapsed = Date.now() - o.printStartedAt.getTime();
  const printed = Math.min(o.pagesToPrint, o.printBaseline + Math.floor(elapsed / 600));
  const state = await getKioskState();

  if (printed >= o.pagesToPrint) {
    const [u] = await db
      .update(orders)
      .set({ status: "completed", pagesPrinted: o.pagesToPrint, filesDeleted: true, completedAt: new Date(), pin: null })
      .where(eq(orders.id, o.id))
      .returning();
    return u ?? o;
  }
  if (state !== "ready") {
    const [u] = await db
      .update(orders)
      .set({ status: "failed", pagesPrinted: printed, failureReason: state })
      .where(eq(orders.id, o.id))
      .returning();
    return u ?? o;
  }
  if (printed !== o.pagesPrinted) {
    const [u] = await db.update(orders).set({ pagesPrinted: printed }).where(eq(orders.id, o.id)).returning();
    return u ?? o;
  }
  return o;
}

// ─── Order queries ────────────────────────────────────────────────────────────

export async function findByOrderId(orderId: string): Promise<OrderRow | null> {
  await ensureSeed();
  const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId));
  if (!o) return null;
  return o.isDemo ? advance(o) : o;
}

export async function findByToken(orderId: string, token: string): Promise<OrderRow | null> {
  await ensureSeed();
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.token, token)));
  if (!o) return null;
  return o.isDemo ? advance(o) : o;
}

// ─── Public order shape ───────────────────────────────────────────────────────

/** Derive the filename currently being printed based on page counters */
function currentDocument(o: OrderRow): string | null {
  const activeStatuses = ["printing", "fallback_printing", "failed", "fallback_pending"];
  if (!activeStatuses.includes(o.status)) return null;
  let pos = o.pagesPrinted % Math.max(1, o.pagesPerCopy);
  for (const d of (o.docs as OrderDoc[])) {
    if (pos < d.selected) return d.name;
    pos -= d.selected;
  }
  return (o.docs as OrderDoc[])[o.docs.length - 1]?.name ?? null;
}

/** Shape returned to the customer browser — never exposes internals */
export function toPublic(o: OrderRow, withPin: boolean) {
  const docs = o.docs as OrderDoc[];
  const showPin = withPin && (o.status === "paid" || o.status === "pin_accepted");
  const progress = o.pagesToPrint
    ? Math.round((o.pagesPrinted / o.pagesToPrint) * 100)
    : 0;

  return {
    orderId:         o.orderId,
    status:          o.status,
    docs:            docs.map((d) => ({
      name:     d.name,
      pages:    d.pages,
      selected: d.selected,
      range:    d.range,
      size:     d.size,
    })),
    pagesPerCopy:    o.pagesPerCopy,
    copies:          o.copies,
    colorMode:       o.colorMode as "bw" | "color",
    paperSize:       o.paperSize,
    sides:           o.sides as "single" | "double",
    orientation:     o.orientation,
    amount:          o.amount,
    totalPages:      o.pagesToPrint,
    pagesPrinted:    o.pagesPrinted,
    pagesRemaining:  Math.max(0, o.pagesToPrint - o.pagesPrinted),
    progress,
    currentDocument: currentDocument(o),
    failureReason:   o.failureReason,
    filesDeleted:    o.filesDeleted,
    pin:             showPin ? o.pin : null,
    paidAt:          o.paidAt,
    expiresAt:       o.expiresAt,
    completedAt:     o.completedAt,
  };
}

export type PublicOrder = ReturnType<typeof toPublic>;

// ─── Device / kiosk state ─────────────────────────────────────────────────────

/** Get the current state of the named printer for a given device */
export async function getDevicePrinterStatus(deviceId: string) {
  const [d] = await db.select().from(devices).where(eq(devices.id, deviceId));
  if (!d) return { kyoceraReady: false, canonReady: false, maintenanceMode: true };
  return {
    kyoceraReady:    d.kyoceraReady ?? false,
    canonReady:      d.canonReady ?? false,
    maintenanceMode: d.maintenanceMode,
    lastHeartbeat:   d.lastHeartbeat,
  };
}

// ─── Audit logging ────────────────────────────────────────────────────────────

export async function logAuditEvent(params: {
  eventType: typeof auditEvents.$inferInsert["eventType"];
  orderId?: string;
  deviceId?: string;
  actorId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditEvents).values({
      eventType:  params.eventType,
      orderId:    params.orderId,
      deviceId:   params.deviceId,
      actorId:    params.actorId,
      details:    params.details,
      ipAddress:  params.ipAddress,
    });
  } catch (err) {
    // Audit log failure must not break the main flow
    console.error("[audit] Failed to write audit event:", err);
  }
}
