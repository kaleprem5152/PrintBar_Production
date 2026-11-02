import "server-only";
import { createHmac, randomBytes } from "crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { kiosks, orders, type OrderDoc } from "@/db/schema";
import { DEMO, KIOSK_ID, PAGE_MS, PIN_TTL_HOURS, type KioskState } from "@/lib/config";
import { deleteStoredFiles } from "./files";

export type OrderRow = typeof orders.$inferSelect;

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
  await db
    .insert(kiosks)
    .values([
      { id: KIOSK_ID, name: "PrintBar Kiosk 01", location: "Central Library · Ground floor" },
      { id: "PB-K02", name: "PrintBar Kiosk 02", location: "Engineering Block · Lobby" },
      { id: "PB-K03", name: "PrintBar Kiosk 03", location: "Student Centre · Level 1" },
    ])
    .onConflictDoNothing();
  await db
    .insert(orders)
    .values({
      orderId: DEMO.orderId,
      token: DEMO.token,
      pin: DEMO.pin,
      status: "paid",
      docs: [DEMO_DOC],
      pagesPerCopy: 30,
      copies: 1,
      colorMode: "bw",
      amount: 60,
      pagesToPrint: 30,
      isDemo: true,
      paidAt: new Date(),
      paymentRef: "prototype",
      expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 365),
    })
    .onConflictDoNothing();
  await db
    .insert(orders)
    .values({
      orderId: "PB-2026-00139",
      token: "expired",
      pin: DEMO.expiredPin,
      status: "paid",
      docs: [{ ...DEMO_DOC, id: "demo-expired", name: "Lab_Report.pdf", pages: 8, selected: 8 }],
      pagesPerCopy: 8,
      copies: 1,
      colorMode: "color",
      amount: 64,
      pagesToPrint: 8,
      isDemo: true,
      paidAt: new Date(Date.now() - 1000 * 3600 * 48),
      paymentRef: "prototype",
      expiresAt: new Date(Date.now() - 1000 * 3600 * 24),
    })
    .onConflictDoNothing();
  seeded = true;
}

export async function resetDemo() {
  await ensureSeed();
  await db
    .update(orders)
    .set({
      status: "paid",
      pin: DEMO.pin,
      pagesPrinted: 0,
      printBaseline: 0,
      printStartedAt: null,
      failureReason: null,
      filesDeleted: false,
      completedAt: null,
      paidAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 365),
    })
    .where(eq(orders.orderId, DEMO.orderId));
  await db.update(kiosks).set({ state: "ready", updatedAt: new Date() }).where(eq(kiosks.id, KIOSK_ID));
}

export async function getKioskState(id = KIOSK_ID): Promise<KioskState> {
  await ensureSeed();
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, id));
  return (k?.state ?? "ready") as KioskState;
}

export function signPayment(orderId: string, paymentId: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET || "printbar-prototype-secret";
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

export async function generatePin(): Promise<string> {
  const active = await db
    .select({ pin: orders.pin })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["paid", "pin_accepted", "printing", "failed"]),
        gt(orders.expiresAt, new Date()),
      ),
    );
  const used = new Set(active.map((a) => a.pin));
  used.add(DEMO.pin);
  used.add(DEMO.expiredPin);
  for (let i = 0; i < 200; i++) {
    const n = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
    const pin = String(n);
    if (!used.has(pin)) return pin;
  }
  throw new Error("No PIN available");
}

export function newOrderRef(id: number) {
  return `PB-2026-${String(142 + id).padStart(5, "0")}`;
}

export function expiryFromNow() {
  return new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
}

/** Moves a printing job forward using the (prototype) printer simulator and the kiosk's reported state. */
export async function advance(o: OrderRow): Promise<OrderRow> {
  if (o.status !== "printing" || !o.printStartedAt) return o;
  const elapsed = Date.now() - o.printStartedAt.getTime();
  const printed = Math.min(o.pagesToPrint, o.printBaseline + Math.floor(elapsed / PAGE_MS));
  const state = await getKioskState();

  if (printed >= o.pagesToPrint) {
    await deleteStoredFiles(o.docs.map((d) => d.id));
    const [u] = await db
      .update(orders)
      .set({ status: "completed", pagesPrinted: o.pagesToPrint, filesDeleted: true, completedAt: new Date(), pin: null })
      .where(eq(orders.id, o.id))
      .returning();
    return u;
  }
  if (state !== "ready") {
    const [u] = await db
      .update(orders)
      .set({ status: "failed", pagesPrinted: printed, failureReason: state })
      .where(eq(orders.id, o.id))
      .returning();
    return u;
  }
  if (printed !== o.pagesPrinted) {
    const [u] = await db.update(orders).set({ pagesPrinted: printed }).where(eq(orders.id, o.id)).returning();
    return u;
  }
  return o;
}

export async function findByOrderId(orderId: string) {
  await ensureSeed();
  const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId));
  return o ? advance(o) : null;
}

function currentDocument(o: OrderRow): string | null {
  if (o.status !== "printing" && o.status !== "failed") return null;
  let pos = o.pagesPrinted % Math.max(1, o.pagesPerCopy);
  for (const d of o.docs) {
    if (pos < d.selected) return d.name;
    pos -= d.selected;
  }
  return o.docs[o.docs.length - 1]?.name ?? null;
}

export function toPublic(o: OrderRow, withPin: boolean) {
  return {
    orderId: o.orderId,
    status: o.status,
    docs: o.docs.map((d) => ({ name: d.name, pages: d.pages, selected: d.selected, range: d.range, size: d.size })),
    pagesPerCopy: o.pagesPerCopy,
    copies: o.copies,
    colorMode: o.colorMode as "bw" | "color",
    paperSize: o.paperSize,
    sides: o.sides as "single" | "double",
    orientation: o.orientation,
    amount: o.amount,
    totalPages: o.pagesToPrint,
    pagesPrinted: o.pagesPrinted,
    pagesRemaining: Math.max(0, o.pagesToPrint - o.pagesPrinted),
    progress: o.pagesToPrint ? Math.round((o.pagesPrinted / o.pagesToPrint) * 100) : 0,
    currentDocument: currentDocument(o),
    failureReason: o.failureReason,
    filesDeleted: o.filesDeleted,
    pin: withPin && o.status === "paid" ? o.pin : null,
    paidAt: o.paidAt,
    expiresAt: o.expiresAt,
    completedAt: o.completedAt,
  };
}

export type PublicOrder = ReturnType<typeof toPublic>;
