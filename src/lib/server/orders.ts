import "server-only";
import { randomBytes } from "crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, devices, orders, type OrderDoc } from "@/db/schema";
import { PIN_TTL_HOURS } from "@/lib/config";

export type OrderRow = typeof orders.$inferSelect;

// ─── Order references ─────────────────────────────────────────────────────────

/** Generate a human-readable order reference: PB-YYYY-NNNNN */
export function newOrderRef(id: number) {
  const year = new Date().getFullYear();
  return `PB-${year}-${String(id).padStart(5, "0")}`;
}

export function expiryFromNow() {
  return new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
}

// ─── In-Memory Fallback Store (When Postgres is not connected) ─────────────────

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

let nextMemoryId = 145;
const memoryOrders = new Map<string, OrderRow>();
const memoryDevices = new Map<string, typeof devices.$inferSelect>();

function initMemoryStore() {
  if (memoryOrders.size > 0) return;

  const demoOrder: OrderRow = {
    id: 142,
    orderId: "PB-2026-00142",
    token: "demo",
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
    cashfreeOrderId: null,
    cashfreePaymentId: null,
    paidAt: new Date(),
    pin: "4827",
    expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 365),
    deviceId: "PB-K01",
    printerUsed: "kyocera_pa3500x",
    fallbackPrinter: null,
    cupsJobId: null,
    fallbackCupsJobId: null,
    printStartedAt: null,
    printClaimedAt: null,
    pagesPrinted: 0,
    printBaseline: 0,
    fallbackAt: null,
    completedAt: null,
    failureReason: null,
    filesDeleted: false,
    filesDeletedAt: null,
    isDemo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const expiredOrder: OrderRow = {
    id: 139,
    orderId: "PB-2026-00139",
    token: "expired",
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
    cashfreeOrderId: null,
    cashfreePaymentId: null,
    paidAt: new Date(Date.now() - 1000 * 3600 * 48),
    pin: "0000",
    expiresAt: new Date(Date.now() - 1000 * 3600 * 24),
    deviceId: "PB-K01",
    printerUsed: "canon_gx6170",
    fallbackPrinter: null,
    cupsJobId: null,
    fallbackCupsJobId: null,
    printStartedAt: null,
    printClaimedAt: null,
    pagesPrinted: 8,
    printBaseline: 0,
    fallbackAt: null,
    completedAt: null,
    failureReason: null,
    filesDeleted: true,
    filesDeletedAt: new Date(),
    isDemo: true,
    createdAt: new Date(Date.now() - 1000 * 3600 * 48),
    updatedAt: new Date(Date.now() - 1000 * 3600 * 48),
  };

  memoryOrders.set(demoOrder.orderId, demoOrder);
  memoryOrders.set(expiredOrder.orderId, expiredOrder);

  memoryDevices.set("PB-K01", {
    id: "PB-K01",
    name: "PrintBar Kiosk 01",
    location: "Central Library · Ground floor",
    secretHash: "demo",
    isActive: true,
    lastHeartbeat: new Date(),
    kyoceraReady: true,
    canonReady: true,
    maintenanceMode: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  memoryDevices.set("PB-K02", {
    id: "PB-K02",
    name: "PrintBar Kiosk 02",
    location: "Engineering Block · Lobby",
    secretHash: "demo",
    isActive: true,
    lastHeartbeat: new Date(),
    kyoceraReady: true,
    canonReady: true,
    maintenanceMode: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  memoryDevices.set("PB-K03", {
    id: "PB-K03",
    name: "PrintBar Kiosk 03",
    location: "Student Centre · Level 1",
    secretHash: "demo",
    isActive: true,
    lastHeartbeat: new Date(),
    kyoceraReady: true,
    canonReady: true,
    maintenanceMode: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

initMemoryStore();

// ─── PIN management ───────────────────────────────────────────────────────────

/** Generate a 4-digit PIN not currently in use by any active order */
export async function generatePin(): Promise<string> {
  const usedPins = new Set<string>();

  try {
    const activeOrders = await db
      .select({ pin: orders.pin })
      .from(orders)
      .where(
        and(
          inArray(orders.status, ["paid", "pin_accepted", "queued", "claimed", "processing", "printing", "fallback_pending", "fallback_printing", "failed"]),
          gt(orders.expiresAt, new Date()),
        ),
      );
    activeOrders.forEach((a) => {
      if (a.pin) usedPins.add(a.pin);
    });
  } catch {
    // Check in-memory store
    memoryOrders.forEach((o) => {
      if (o.pin && o.expiresAt && o.expiresAt.getTime() > Date.now()) {
        usedPins.add(o.pin);
      }
    });
  }

  for (let i = 0; i < 500; i++) {
    const n = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
    const pin = String(n);
    if (!usedPins.has(pin)) return pin;
  }
  throw new Error("No PIN available — too many active orders");
}

// ─── Order state machine ──────────────────────────────────────────────────────

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

export function isValidTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Seed & Reset ─────────────────────────────────────────────────────────────

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  initMemoryStore();

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

    seeded = true;
  } catch {
    /* If DB is not yet connected, memory store serves the demo */
    seeded = true;
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
    const o = memoryOrders.get("PB-2026-00142");
    if (o) {
      o.status = "paid";
      o.pin = "4827";
      o.pagesPrinted = 0;
      o.printBaseline = 0;
      o.printStartedAt = null;
      o.failureReason = null;
      o.filesDeleted = false;
      o.completedAt = null;
      o.paidAt = new Date();
      o.expiresAt = new Date(Date.now() + 1000 * 3600 * 24 * 365);
    }
    const d = memoryDevices.get("PB-K01");
    if (d) {
      d.kyoceraReady = true;
      d.canonReady = true;
      d.maintenanceMode = false;
      d.updatedAt = new Date();
    }
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
  const elapsed = Date.now() - new Date(o.printStartedAt).getTime();
  const printed = Math.min(o.pagesToPrint, o.printBaseline + Math.floor(elapsed / 600));
  const state = await getKioskState();

  if (printed >= o.pagesToPrint) {
    try {
      const [u] = await db
        .update(orders)
        .set({ status: "completed", pagesPrinted: o.pagesToPrint, filesDeleted: true, completedAt: new Date(), pin: null })
        .where(eq(orders.id, o.id))
        .returning();
      if (u) return u;
    } catch {
      o.status = "completed";
      o.pagesPrinted = o.pagesToPrint;
      o.filesDeleted = true;
      o.completedAt = new Date();
      o.pin = null;
      memoryOrders.set(o.orderId, o);
      return o;
    }
  }

  if (state !== "ready") {
    try {
      const [u] = await db
        .update(orders)
        .set({ status: "failed", pagesPrinted: printed, failureReason: state })
        .where(eq(orders.id, o.id))
        .returning();
      if (u) return u;
    } catch {
      o.status = "failed";
      o.pagesPrinted = printed;
      o.failureReason = state;
      memoryOrders.set(o.orderId, o);
      return o;
    }
  }

  if (printed !== o.pagesPrinted) {
    try {
      const [u] = await db.update(orders).set({ pagesPrinted: printed }).where(eq(orders.id, o.id)).returning();
      if (u) return u;
    } catch {
      o.pagesPrinted = printed;
      memoryOrders.set(o.orderId, o);
      return o;
    }
  }

  return o;
}

// ─── Order Queries & Mutations (DB + In-Memory Fallback) ───────────────────────

export async function createOrderRecord(data: {
  token: string;
  docs: OrderDoc[];
  pagesPerCopy: number;
  copies: number;
  colorMode: "bw" | "color";
  paperSize: string;
  sides: "single" | "double";
  orientation: "portrait" | "landscape";
  amount: number;
  rateApplied: number;
  pagesToPrint: number;
  isDemo?: boolean;
}): Promise<OrderRow> {
  const isDemo = data.isDemo ?? false;

  try {
    const tmpId = `TMP-${randomBytes(6).toString("hex")}`;
    const [inserted] = await db
      .insert(orders)
      .values({
        orderId: tmpId,
        token: data.token,
        status: "created",
        docs: data.docs,
        pagesPerCopy: data.pagesPerCopy,
        copies: data.copies,
        colorMode: data.colorMode,
        paperSize: data.paperSize,
        sides: data.sides,
        orientation: data.orientation,
        amount: data.amount,
        rateApplied: data.rateApplied,
        pagesToPrint: data.pagesToPrint,
        isDemo,
      })
      .returning();

    const orderId = newOrderRef(inserted.id);
    const [finalRow] = await db
      .update(orders)
      .set({ orderId, updatedAt: new Date() })
      .where(eq(orders.id, inserted.id))
      .returning();

    return finalRow ?? { ...inserted, orderId };
  } catch (err) {
    console.warn("[orders] Database insert unavailable, using resilient fallback store:", (err as Error).message);
    const memId = nextMemoryId++;
    const orderId = newOrderRef(memId);
    const row: OrderRow = {
      id: memId,
      orderId,
      token: data.token,
      status: "created",
      docs: data.docs,
      pagesPerCopy: data.pagesPerCopy,
      copies: data.copies,
      colorMode: data.colorMode,
      paperSize: data.paperSize,
      sides: data.sides,
      orientation: data.orientation,
      amount: data.amount,
      rateApplied: data.rateApplied,
      pagesToPrint: data.pagesToPrint,
      cashfreeOrderId: null,
      cashfreePaymentId: null,
      paidAt: null,
      pin: null,
      expiresAt: null,
      deviceId: "PB-K01",
      printerUsed: data.colorMode === "color" ? "canon_gx6170" : "kyocera_pa3500x",
      fallbackPrinter: null,
      cupsJobId: null,
      fallbackCupsJobId: null,
      printStartedAt: null,
      printClaimedAt: null,
      pagesPrinted: 0,
      printBaseline: 0,
      fallbackAt: null,
      completedAt: null,
      failureReason: null,
      filesDeleted: false,
      filesDeletedAt: null,
      isDemo: true, // Always allow demo printing for local fallback
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryOrders.set(orderId, row);
    return row;
  }
}

export async function findByOrderId(orderId: string): Promise<OrderRow | null> {
  await ensureSeed();

  try {
    const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId));
    if (o) return o.isDemo ? advance(o) : o;
  } catch {
    /* fallback to memory store */
  }

  const mem = memoryOrders.get(orderId);
  if (mem) return advance(mem);
  return null;
}

export async function findByToken(orderId: string, token: string): Promise<OrderRow | null> {
  await ensureSeed();

  try {
    const [o] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderId, orderId), eq(orders.token, token)));
    if (o) return o.isDemo ? advance(o) : o;
  } catch {
    /* fallback to memory store */
  }

  const mem = memoryOrders.get(orderId);
  if (mem && (mem.token === token || mem.isDemo)) return advance(mem);
  return null;
}

export async function updateOrderPaymentState(params: {
  orderId: string;
  cashfreeOrderId: string;
  status?: typeof orders.$inferSelect["status"];
}): Promise<OrderRow | null> {
  const status = params.status ?? "pending_payment";

  try {
    const [u] = await db
      .update(orders)
      .set({
        cashfreeOrderId: params.cashfreeOrderId,
        status,
        updatedAt: new Date(),
      })
      .where(eq(orders.orderId, params.orderId))
      .returning();
    if (u) return u;
  } catch {
    /* fallback to memory store */
  }

  const mem = memoryOrders.get(params.orderId);
  if (mem) {
    mem.cashfreeOrderId = params.cashfreeOrderId;
    mem.status = status;
    mem.updatedAt = new Date();
    return mem;
  }
  return null;
}

export async function markOrderPaid(params: {
  orderId: string;
  paymentId: string;
  pin: string;
  paymentMethod?: string;
}): Promise<OrderRow> {
  const now = new Date();
  const expiresAt = expiryFromNow();

  try {
    const [u] = await db
      .update(orders)
      .set({
        status: "paid",
        pin: params.pin,
        cashfreePaymentId: params.paymentId,
        paidAt: now,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(orders.orderId, params.orderId))
      .returning();
    if (u) return u;
  } catch {
    /* fallback to memory store */
  }

  const mem = memoryOrders.get(params.orderId);
  if (mem) {
    mem.status = "paid";
    mem.pin = params.pin;
    mem.cashfreePaymentId = params.paymentId;
    mem.paidAt = now;
    mem.expiresAt = expiresAt;
    mem.updatedAt = now;
    return mem;
  }

  throw new Error("Order not found to mark as paid");
}

export async function findOrderByPin(pin: string): Promise<OrderRow | null> {
  await ensureSeed();

  try {
    const [o] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.pin, pin),
          inArray(orders.status, [
            "paid",
            "pin_accepted",
            "queued",
            "claimed",
            "processing",
            "printing",
            "fallback_pending",
            "fallback_printing",
            "failed",
          ]),
        ),
      )
      .orderBy(desc(orders.id));
    if (o) return o;
  } catch {
    /* fallback to memory */
  }

  for (const o of memoryOrders.values()) {
    if (o.pin === pin) return o;
  }
  return null;
}

export async function updateOrderStatus(orderId: string, status: typeof orders.$inferSelect["status"]): Promise<OrderRow | null> {
  try {
    const [u] = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.orderId, orderId))
      .returning();
    if (u) return u;
  } catch {
    /* fallback to memory */
  }

  const mem = memoryOrders.get(orderId);
  if (mem) {
    mem.status = status;
    mem.updatedAt = new Date();
    return mem;
  }
  return null;
}

export async function listRecentOrders(limit = 50): Promise<OrderRow[]> {
  await ensureSeed();

  try {
    const list = await db.select().from(orders).orderBy(desc(orders.id)).limit(limit);
    if (list.length > 0) return list;
  } catch {
    /* fallback to memory */
  }

  return Array.from(memoryOrders.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

// ─── Public order shape ───────────────────────────────────────────────────────

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

export function toPublic(o: OrderRow, withPin: boolean) {
  const docs = (o.docs as OrderDoc[]) || [];
  const showPin = withPin && (o.status === "paid" || o.status === "pin_accepted");
  const progress = o.pagesToPrint ? Math.round((o.pagesPrinted / o.pagesToPrint) * 100) : 0;

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

export async function getDevicePrinterStatus(deviceId: string) {
  try {
    const [d] = await db.select().from(devices).where(eq(devices.id, deviceId));
    if (d) {
      return {
        kyoceraReady:    d.kyoceraReady ?? false,
        canonReady:      d.canonReady ?? false,
        maintenanceMode: d.maintenanceMode,
        lastHeartbeat:   d.lastHeartbeat,
      };
    }
  } catch {
    /* fallback to memory */
  }

  const mem = memoryDevices.get(deviceId);
  if (mem) {
    return {
      kyoceraReady:    mem.kyoceraReady ?? true,
      canonReady:      mem.canonReady ?? true,
      maintenanceMode: mem.maintenanceMode,
      lastHeartbeat:   mem.lastHeartbeat,
    };
  }

  return {
    kyoceraReady:    true,
    canonReady:      true,
    maintenanceMode: false,
    lastHeartbeat:   new Date(),
  };
}

export async function setDeviceMaintenance(deviceId: string, maintenanceMode: boolean) {
  try {
    await db
      .update(devices)
      .set({ maintenanceMode, updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
  } catch {
    const mem = memoryDevices.get(deviceId);
    if (mem) {
      mem.maintenanceMode = maintenanceMode;
      mem.updatedAt = new Date();
    }
  }
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
  } catch {
    // Fail silently in memory fallback mode
  }
}
