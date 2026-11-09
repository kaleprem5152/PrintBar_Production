import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "./auth";
import { calcQuote, DEFAULT_PRICING } from "./pricing";
import { getSetting, setSetting } from "./settings";

export const DEFAULT_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "PrintBar@2026";
export const BOOTSTRAP_USERS = [
  { email: "admin@printbar.in", username: "admin", name: "System Admin", role: "super_admin" },
  { email: "super@printbar.in", username: "super", name: "Super Admin", role: "super_admin" },
  { email: "ops@printbar.in", username: "ops", name: "Operations Lead", role: "ops_admin" },
  { email: "finance@printbar.in", username: "finance", name: "Finance Lead", role: "finance_admin" },
  { email: "maintenance@printbar.in", username: "maintenance", name: "Maintenance Tech", role: "maintenance" },
];

let booting: Promise<void> | null = null;

/** First-run bootstrap: default admin accounts, active pricing and (once) the labelled demo dataset. */
export function ensureBootstrap(): Promise<void> {
  if (!booting) {
    booting = (async () => {
      const pw = hashPassword(DEFAULT_PASSWORD);
      for (const u of BOOTSTRAP_USERS) {
        await db
          .insert(s.adminUsers)
          .values({ ...u, passwordHash: pw, active: true, mustChangePassword: false })
          .onConflictDoUpdate({
            target: s.adminUsers.email,
            set: { username: u.username, active: true },
          })
          .catch(() => {});
      }
      const [{ p }] = await db.select({ p: count() }).from(s.pricingVersions);
      if (p === 0) {
        await db.insert(s.pricingVersions).values({ ...DEFAULT_PRICING, active: true, note: "Default pricing", publishedBy: "System" });
      }
      const seeded = await getSetting<boolean | null>("demo_seeded", null);
      if (seeded === null) {
        await loadDemo();
        await setSetting("demo_seeded", true);
      }
    })().catch((e) => {
      booting = null;
      throw e;
    });
  }
  return booting;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function chunked<T>(rows: T[], fn: (c: T[]) => Promise<unknown>, size = 250) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function clearDemo() {
  for (const t of [
    s.kiosks, s.printers, s.printerEvents, s.maintenanceRecords, s.connectivityEvents, s.kioskLogs, s.deviceCommands,
    s.printJobs, s.printAttempts, s.jobLogs, s.payments, s.refunds, s.alerts, s.notifications, s.inventoryItems, s.inventoryMovements,
  ]) {
    await db.delete(t);
  }
  await setSetting("demo_mode", false);
  await setSetting("finance", { monthlyFixedCostsPaise: 0, fixedCostsNote: "" });
}

export async function loadDemo() {
  const rand = rng(20260);
  const R = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
  const ago = (ms: number) => new Date(now - ms);
  const IST = 5.5 * HOUR;
  const todayStart = Math.floor((now + IST) / DAY) * DAY - IST;
  const istHourNow = Math.floor(((now + IST) % DAY) / HOUR);

  await clearDemo();
  await setSetting("demo_mode", true);
  await setSetting("finance", { monthlyFixedCostsPaise: 1500000, fixedCostsNote: "Demo: rent share, electricity & connectivity (₹15,000/mo)" });

  /* ── kiosks & printers ── */
  await db.insert(s.kiosks).values([
    { id: "KSK-001", name: "Central Library", location: "Central Library, Ground Floor — Pune", lastHeartbeat: new Date(), softwareVersion: "2.4.1", networkType: "wifi", ipAddress: "192.168.1.10", backendConnected: true, piTempC: 52, piCpuPct: 18, piMemPct: 41, diskPct: 37, upsStatus: null, isDemo: true, createdAt: ago(120 * DAY) },
    { id: "KSK-002", name: "Tech Park Lobby", location: "Tech Park, Tower B Lobby — Pune", lastHeartbeat: new Date(), softwareVersion: "2.4.1", networkType: "ethernet", ipAddress: "10.20.0.14", backendConnected: true, piTempC: 58, piCpuPct: 34, piMemPct: 52, diskPct: 44, upsStatus: "on_mains", isDemo: true, createdAt: ago(100 * DAY) },
    { id: "KSK-003", name: "Metro Station", location: "Metro Station Concourse — Pune", lastHeartbeat: ago(3 * HOUR), softwareVersion: "2.3.9", networkType: "lte", ipAddress: "100.64.12.7", backendConnected: false, piTempC: 61, piCpuPct: 22, piMemPct: 47, diskPct: 63, upsStatus: null, isDemo: true, createdAt: ago(60 * DAY) },
  ]);
  const P = (o: Partial<typeof s.printers.$inferInsert> & { id: string; kioskId: string; name: string; model: string }) => ({
    isDemo: true, connected: true, state: "idle", lastHeartbeat: new Date(), createdAt: ago(90 * DAY), ...o,
  });
  await db.insert(s.printers).values([
    P({ id: "PRN-001", kioskId: "KSK-001", name: "Library Mono A", model: "HP LaserJet Pro M404dn", ip: "192.168.1.21", cupsQueue: "HP_M404dn", role: "primary", priority: 1, paperRemaining: 143, paperSource: "estimated", tonerBlack: 62, tonerSource: "telemetry", drumLife: 71, drumSource: "telemetry", totalPages: 41820, lastSuccessfulPrintAt: ago(7 * MIN) }),
    P({ id: "PRN-002", kioskId: "KSK-001", name: "Library Mono B", model: "Brother HL-L2350DW", ip: "192.168.1.22", cupsQueue: "Brother_L2350", role: "backup", priority: 2, paperRemaining: 210, paperSource: "estimated", tonerSource: "unsupported", drumSource: "unsupported", totalPages: 18240, lastSuccessfulPrintAt: ago(2 * DAY) }),
    P({ id: "PRN-003", kioskId: "KSK-002", name: "Tech Park Colour", model: "Canon PIXMA G3770", ip: "10.20.0.31", cupsQueue: "Canon_G3770", role: "primary", priority: 1, supportsColor: true, paperRemaining: 96, paperSource: "manual", tonerBlack: 38, tonerColor: 12, tonerSource: "telemetry", drumSource: "unsupported", totalPages: 22610, lastSuccessfulPrintAt: ago(19 * MIN) }),
    P({ id: "PRN-004", kioskId: "KSK-002", name: "Tech Park Mono", model: "HP LaserJet Pro M404dn", ip: "10.20.0.32", cupsQueue: "HP_M404dn", role: "backup", priority: 2, state: "error", errorCode: "paper_jam", errorMessage: "Paper jam in rear door (CUPS: media-jam-error)", paperRemaining: 180, paperSource: "estimated", tonerBlack: 74, tonerSource: "telemetry", drumLife: 8, drumSource: "telemetry", totalPages: 30115, lastSuccessfulPrintAt: ago(40 * MIN) }),
    P({ id: "PRN-005", kioskId: "KSK-003", name: "Metro Mono", model: "HP LaserJet M111w", ip: "100.64.12.20", cupsQueue: "HP_M111w", role: "primary", priority: 1, paperRemaining: 18, paperSource: "estimated", tonerSource: "unsupported", drumSource: "unsupported", totalPages: 9980, lastSuccessfulPrintAt: ago(3 * HOUR + 10 * MIN), lastHeartbeat: ago(3 * HOUR) }),
  ]);

  /* ── jobs ── */
  type J = typeof s.printJobs.$inferInsert;
  const jobs: J[] = [];
  const pay: (typeof s.payments.$inferInsert & { refund?: "success" | "requested" | "processing"; refundAmt?: number })[] = [];
  const attempts: (typeof s.printAttempts.$inferInsert)[] = [];
  const logs: (typeof s.jobLogs.$inferInsert)[] = [];
  const refs = Array.from({ length: 70 }, (_, i) => "CU-" + (0x1a2b3c + i * 7919).toString(16).toUpperCase().slice(0, 6));
  const files = ["Resume_final.pdf", "Assignment_3.pdf", "Invoice_0824.pdf", "Boarding_pass.pdf", "Lecture_notes_unit2.pdf", "Form_16.pdf", "Project_report.docx", "Aadhaar_copy.jpg", "Rent_agreement.pdf", "Exam_hall_ticket.pdf", "Presentation_slides.pdf", "Medical_report.pdf", "Notes_chapter5.pdf", "Cover_letter.docx", "Scan_0021.png"];
  const hourW = [0, 0, 0, 0, 0, 1, 2, 4, 7, 9, 10, 10, 9, 7, 7, 8, 9, 10, 8, 6, 4, 2, 1, 0];
  const pickHour = (maxH: number) => {
    const w = hourW.map((x, h) => (h <= maxH ? x : 0));
    let r = rand() * w.reduce((a, b) => a + b, 0);
    for (let h = 0; h < 24; h++) { r -= w[h]; if (r <= 0) return h; }
    return 10;
  };
  const errs = [
    ["paper_jam", "Paper jam reported by CUPS (media-jam-error)"],
    ["cups_timeout", "CUPS job timed out after 300s"],
    ["printer_offline", "Printer unreachable when job started"],
    ["paper_out", "Tray empty (media-empty-error)"],
  ];
  let seq = 0;
  const usedPrinters: Record<string, number> = {};

  function addJob(o: {
    createdAt: Date; status: string; kioskId: string; printerId: string; color?: boolean; pages?: number;
    printed?: number; docDeleted?: boolean; payStatus?: string; refund?: "success" | "requested" | "processing" | null; err?: string[]; copies?: number; attemptsN?: number;
  }) {
    const id = `PJ-${240100 + seq++}`;
    const color = o.color ?? false;
    const pages = o.pages ?? Math.max(1, Math.round(Math.pow(rand(), 2) * 38) + 1);
    const copies = o.copies ?? (rand() < 0.85 ? 1 : R(2, 3));
    const sided = rand() < 0.4 ? "double" : "single";
    const pps = pick([1, 1, 1, 1, 2, 2, 4, 6]);
    const q = calcQuote(DEFAULT_PRICING, { pages, color, sided, pagesPerSheet: pps, copies });
    const total = pages * copies;
    const printed = o.printed ?? (o.status === "completed" ? total : 0);
    const ps = o.payStatus ?? (["uploaded"].includes(o.status) ? "none" : ["awaiting_payment"].includes(o.status) ? "pending" : "success");
    const err = o.err;
    jobs.push({
      id, customerRef: pick(refs), fileName: pick(files), pages, colorMode: color ? "color" : "bw", sided, pagesPerSheet: pps, copies,
      amountPaise: q.totalPaise,
      paymentStatus: o.refund === "success" ? (o.status === "refunded" ? "refunded" : "partially_refunded") : ps === "none" ? "pending" : ps,
      status: o.status, kioskId: o.kioskId, printerId: o.printerId, pagesPrinted: printed,
      errorCode: err?.[0] ?? (o.status === "cancelled" ? "cancelled" : null), errorMessage: err?.[1] ?? null,
      retryCount: 0, documentDeletedAt: o.docDeleted ? new Date(o.createdAt.getTime() + 30 * MIN) : null,
      createdAt: o.createdAt, updatedAt: new Date(o.createdAt.getTime() + 2 * MIN),
    });
    if (ps !== "none") {
      const success = ps === "success" || ps === "refunded" || ps === "partially_refunded";
      const refundAmt = o.refund ? (o.status === "partially_completed" || (o.refund !== "success" && printed > 0) ? Math.round((q.totalPaise * (total - printed)) / total) : q.totalPaise) : 0;
      pay.push({
        jobId: id, orderId: `ORD-${id}`, amountPaise: q.totalPaise,
        feePaise: success ? Math.round(q.totalPaise * 0.02) : 0,
        method: pick(["upi", "upi", "upi", "upi", "card", "netbanking", "wallet"]),
        status: success ? "success" : ps === "failed" ? "failed" : "pending",
        transactionId: success ? `CF${R(1000000000, 9999999999)}` : null,
        failureReason: ps === "failed" ? pick(["User dropped / abandoned", "Bank declined the transaction", "UPI collect request expired"]) : null,
        customerStatus: o.refund === "success" ? (o.status === "refunded" ? "Refunded" : "Partially refunded") : o.refund === "processing" ? "Refund processing" : o.refund === "requested" ? "Refund requested" : success ? "Paid" : ps === "failed" ? "Payment failed" : "Awaiting payment",
        createdAt: o.createdAt, paidAt: success ? new Date(o.createdAt.getTime() + 40_000) : null,
        refund: o.refund ?? undefined, refundAmt,
        refundedPaise: o.refund === "success" ? refundAmt : 0,
      });
    }
    if (["completed", "failed", "partially_completed", "refunded", "refund_pending"].includes(o.status)) {
      const n = o.attemptsN ?? 1;
      for (let a = 1; a <= n; a++) {
        const last = a === n;
        const okLast = o.status === "completed" || (o.status === "refunded" && printed === total);
        attempts.push({
          jobId: id, attemptNo: a, printerId: o.printerId, cupsJobId: String(R(1000, 9999)),
          status: last ? (okLast ? "succeeded" : printed > 0 ? "partial" : "failed") : "failed",
          pagesPrinted: last ? printed : 0, error: last && okLast ? null : (err?.[1] ?? "CUPS error"),
          startedAt: new Date(o.createdAt.getTime() + a * 60_000), endedAt: new Date(o.createdAt.getTime() + a * 60_000 + R(8, 70) * 1000),
        });
      }
      logs.push({ jobId: id, level: "info", message: "Job received from customer app", createdAt: o.createdAt });
      logs.push({ jobId: id, level: "info", message: "Payment confirmed by Cashfree", createdAt: new Date(o.createdAt.getTime() + 40_000) });
      logs.push({ jobId: id, level: "info", message: `Sent to CUPS queue on ${o.printerId}`, createdAt: new Date(o.createdAt.getTime() + 60_000) });
      if (err) logs.push({ jobId: id, level: "error", message: err[1], createdAt: new Date(o.createdAt.getTime() + 90_000) });
      if (o.status === "completed") logs.push({ jobId: id, level: "info", message: `Printed ${printed}/${total} pages`, createdAt: new Date(o.createdAt.getTime() + 100_000) });
    }
    if (printed) usedPrinters[o.printerId] = (usedPrinters[o.printerId] ?? 0) + printed;
    return id;
  }

  for (let d = 29; d >= 0; d--) {
    const dayStart = todayStart - d * DAY;
    const dow = new Date(dayStart + IST).getUTCDay();
    const n = d === 0 ? R(14, 20) : (dow === 0 ? R(8, 12) : R(15, 24));
    for (let i = 0; i < n; i++) {
      const h = pickHour(d === 0 ? Math.max(6, istHourNow - 1) : 23);
      const createdAt = new Date(dayStart + h * HOUR + R(0, 59) * MIN + R(0, 59) * 1000);
      if (createdAt.getTime() > now - 40 * MIN) continue;
      const recentOffline = createdAt.getTime() > now - 3 * HOUR;
      const kiosk = recentOffline ? pick(["KSK-001", "KSK-002"]) : pick(["KSK-001", "KSK-001", "KSK-002", "KSK-002", "KSK-003"]);
      const color = kiosk === "KSK-002" && rand() < 0.45;
      const printerId = color ? "PRN-003" : kiosk === "KSK-001" ? (rand() < 0.93 ? "PRN-001" : "PRN-002") : kiosk === "KSK-002" ? (rand() < 0.85 ? "PRN-003" : "PRN-004") : "PRN-005";
      const r = rand();
      if (r < 0.9) addJob({ createdAt, status: "completed", kioskId: kiosk, printerId, color, docDeleted: true, attemptsN: rand() < 0.04 ? 2 : 1, err: undefined });
      else if (r < 0.94) addJob({ createdAt, status: "refunded", kioskId: kiosk, printerId, color, docDeleted: true, err: pick(errs), refund: "success" });
      else if (r < 0.96) {
        const pages = R(8, 30);
        addJob({ createdAt, status: "partially_completed", kioskId: kiosk, printerId, color, pages, copies: 1, printed: Math.round(pages * 0.55), docDeleted: true, err: errs[0], refund: "success" });
      } else addJob({ createdAt, status: "cancelled", kioskId: kiosk, printerId, color, docDeleted: true, payStatus: pick(["failed", "failed", "pending"]) });
    }
  }
  // fix: jobs marked "refunded" must be status refunded with full refund; "failed" with refund success → refunded.
  for (const j of jobs) if (j.status === "failed" && j.paymentStatus === "refunded") j.status = "refunded";
  // Scenario jobs (operationally interesting right now)
  addJob({ createdAt: ago(12 * MIN), status: "failed", kioskId: "KSK-002", printerId: "PRN-004", pages: 14, copies: 1, printed: 0, err: errs[0], payStatus: "success" });
  addJob({ createdAt: ago(22 * MIN), status: "failed", kioskId: "KSK-002", printerId: "PRN-003", color: true, pages: 6, copies: 1, printed: 0, err: errs[1] });
  addJob({ createdAt: ago(9 * MIN), status: "partially_completed", kioskId: "KSK-002", printerId: "PRN-004", pages: 20, copies: 1, printed: 11, err: errs[0] });
  addJob({ createdAt: ago(3 * HOUR + 30 * MIN), status: "failed", kioskId: "KSK-003", printerId: "PRN-005", pages: 9, copies: 2, printed: 0, err: errs[2], docDeleted: true });
  addJob({ createdAt: ago(20 * HOUR), status: "refund_pending", kioskId: "KSK-001", printerId: "PRN-001", pages: 12, copies: 1, printed: 0, err: errs[3], docDeleted: true, refund: "processing" });
  addJob({ createdAt: ago(4 * HOUR), status: "refund_pending", kioskId: "KSK-001", printerId: "PRN-001", pages: 5, copies: 1, printed: 0, err: errs[1], docDeleted: true, refund: "requested" });
  addJob({ createdAt: ago(1 * MIN), status: "printing", kioskId: "KSK-001", printerId: "PRN-001", pages: 18, copies: 1, printed: 6 });
  addJob({ createdAt: ago(2 * MIN), status: "queued", kioskId: "KSK-001", printerId: "PRN-001", pages: 4, copies: 1, printed: 0 });
  addJob({ createdAt: ago(4 * MIN), status: "awaiting_payment", kioskId: "KSK-002", printerId: "PRN-003", color: true, pages: 3, copies: 1 });
  addJob({ createdAt: ago(1 * MIN), status: "uploaded", kioskId: "KSK-002", printerId: "PRN-003", pages: 7, copies: 1 });

  await chunked(jobs, (c) => db.insert(s.printJobs).values(c));
  const insertedPay: { id: number; orderId: string }[] = [];
  await chunked(pay, async (c) => {
    const rows = await db.insert(s.payments).values(c.map(({ refund: _r, refundAmt: _a, ...p }) => p)).returning({ id: s.payments.id, orderId: s.payments.orderId });
    insertedPay.push(...rows);
  });
  const payId = new Map(insertedPay.map((p) => [p.orderId, p.id]));
  const refundRows: (typeof s.refunds.$inferInsert)[] = [];
  for (const p of pay) {
    if (!p.refund) continue;
    const full = p.refundAmt === p.amountPaise;
    refundRows.push({
      refundRef: `RF-${p.jobId}-1`, paymentId: payId.get(p.orderId)!, jobId: p.jobId, amountPaise: p.refundAmt ?? 0, type: full ? "full" : "partial",
      reason: "Print failed — refund for unprinted pages", status: p.refund,
      gatewayRefundId: p.refund === "requested" ? null : `CFR${R(100000, 999999)}`,
      gatewayStatus: p.refund === "success" ? "SUCCESS" : p.refund === "processing" ? "PENDING" : null,
      gatewayMessage: p.refund === "requested" ? "Awaiting gateway submission" : null,
      initiatedBy: "Kabir Shah", createdAt: new Date((p.createdAt as Date).getTime() + 3 * HOUR), updatedAt: new Date((p.createdAt as Date).getTime() + 3 * HOUR),
      completedAt: p.refund === "success" ? new Date((p.createdAt as Date).getTime() + 5 * HOUR) : null,
    });
  }
  await chunked(refundRows, (c) => db.insert(s.refunds).values(c));
  await chunked(attempts, (c) => db.insert(s.printAttempts).values(c));
  await chunked(logs, (c) => db.insert(s.jobLogs).values(c));
  // live attempt for the "printing"/"queued" scenario jobs
  const live = jobs.slice(-4, -2);
  await db.insert(s.printAttempts).values([
    { jobId: live[0].id, attemptNo: 1, printerId: "PRN-001", status: "printing", pagesPrinted: 6, cupsJobId: "5521" },
    { jobId: live[1].id, attemptNo: 1, printerId: "PRN-001", status: "queued" },
  ]);
  await db.update(s.printers).set({ state: "printing" }).where(sql`${s.printers.id} = 'PRN-001'`);
  for (const [id, n] of Object.entries(usedPrinters)) {
    void id; void n; // totals are baseline + telemetry; baseline above already includes history
  }

  /* ── alerts, notifications, events ── */
  const A = (o: typeof s.alerts.$inferInsert) => o;
  const sev = { paper_jam: "critical", ink_low: "warning", paper_low: "warning", kiosk_offline: "critical", paper_out: "critical", printer_disconnected: "critical", toner_low: "warning", network_issue: "warning", drum_warning: "warning" } as const;
  const act = (t: keyof typeof sev) => ({ severity: sev[t] });
  void act;
  const { ALERT_TYPES } = await import("./constants");
  const mk = (type: string, kioskId: string, printerId: string | null, details: string, createdAt: Date, extra: Partial<typeof s.alerts.$inferInsert> = {}) =>
    A({ type, kioskId, printerId, severity: ALERT_TYPES[type].severity, title: `${ALERT_TYPES[type].label} · ${printerId ?? kioskId}`, details, suggestedAction: ALERT_TYPES[type].action, source: "agent", createdAt, ...extra });
  await db.insert(s.alerts).values([
    mk("paper_jam", "KSK-002", "PRN-004", "Paper jam in rear door (CUPS: media-jam-error). 2 jobs affected.", ago(25 * MIN)),
    mk("kiosk_offline", "KSK-003", null, "No heartbeat for 3h. Raspberry Pi, network or power may be down (cannot be distinguished remotely).", ago(3 * HOUR), { source: "system" }),
    mk("ink_low", "KSK-002", "PRN-003", "Colour ink at 12% (reported by printer).", ago(2 * HOUR)),
    mk("drum_warning", "KSK-002", "PRN-004", "Drum life 8% (reported by printer).", ago(6 * HOUR), { status: "acknowledged", acknowledgedAt: ago(5 * HOUR), acknowledgedBy: "Ravi Patil" }),
    mk("paper_low", "KSK-003", "PRN-005", "18/250 sheets left (estimated from page counts — no tray sensor).", ago(1 * DAY), { status: "acknowledged", acknowledgedAt: ago(20 * HOUR), acknowledgedBy: "Diya Nair" }),
    mk("paper_out", "KSK-001", "PRN-001", "Tray empty (estimated).", ago(1 * DAY + 4 * HOUR), { status: "resolved", resolvedAt: ago(1 * DAY + 3 * HOUR), resolvedBy: "Ravi Patil", resolutionNote: "Refilled 250 sheets" }),
    mk("printer_disconnected", "KSK-001", "PRN-002", "USB device not found by CUPS.", ago(2 * DAY), { status: "resolved", resolvedAt: ago(2 * DAY - HOUR), resolvedBy: "System (auto-resolved)", resolutionNote: "Condition cleared" }),
    mk("toner_low", "KSK-001", "PRN-001", "Toner at 14% (reported by printer).", ago(4 * DAY), { status: "resolved", resolvedAt: ago(3 * DAY), resolvedBy: "Ravi Patil", resolutionNote: "Cartridge replaced" }),
    mk("network_issue", "KSK-002", null, "Packet loss 38% over 10 min.", ago(6 * DAY), { status: "resolved", resolvedAt: ago(6 * DAY - 30 * MIN), resolvedBy: "System (auto-resolved)" }),
  ]);
  await db.insert(s.notifications).values([
    { type: "print_failure", severity: "critical", title: "Paper jam · PRN-004", body: "Paper jam in rear door. 2 jobs affected.", link: "/admin/notifications?tab=alerts", createdAt: ago(25 * MIN) },
    { type: "print_failure", severity: "warning", title: "2 paid jobs failed at Tech Park Lobby", body: "Review retry or refund options.", link: "/admin/jobs?status=failed", createdAt: ago(12 * MIN) },
    { type: "low_consumable", severity: "warning", title: "Ink low · PRN-003", body: "Colour ink at 12%.", link: "/admin/inventory", createdAt: ago(2 * HOUR) },
    { type: "kiosk_offline", severity: "critical", title: "Kiosk offline · KSK-003", body: "No heartbeat for 3h.", link: "/admin/kiosks", createdAt: ago(3 * HOUR) },
    { type: "refund_update", severity: "info", title: "Refund RF-requested for a failed job", body: "Awaiting gateway confirmation.", link: "/admin/payments?tab=refunds", createdAt: ago(4 * HOUR) },
    { type: "payment_failure", severity: "warning", title: "Payment failure spike", body: "3 failed UPI payments in the last hour.", link: "/admin/payments?status=failed", createdAt: ago(5 * HOUR) },
    { type: "low_consumable", severity: "warning", title: "Colour ink set below reorder threshold", body: "1 left, threshold 2.", link: "/admin/inventory", createdAt: ago(1 * DAY) },
  ]);
  const ce = (kioskId: string, kind: string, t: Date, detail: string) => ({ kioskId, kind, detail, createdAt: t });
  await db.insert(s.connectivityEvents).values([
    ce("KSK-001", "online", ago(100 * DAY), "Initial connect"), ce("KSK-002", "online", ago(90 * DAY), "Initial connect"), ce("KSK-003", "online", ago(60 * DAY), "Initial connect"),
    ce("KSK-001", "offline", ago(5 * DAY), "Heartbeat timeout"), ce("KSK-001", "online", ago(5 * DAY - 40 * MIN), "Heartbeat resumed"),
    ce("KSK-002", "offline", ago(12 * DAY), "Heartbeat timeout"), ce("KSK-002", "online", ago(12 * DAY - 25 * MIN), "Heartbeat resumed"),
    ce("KSK-003", "offline", ago(8 * DAY), "Heartbeat timeout"), ce("KSK-003", "online", ago(8 * DAY - 2 * HOUR), "Heartbeat resumed"),
    ce("KSK-003", "offline", ago(3 * HOUR), "Heartbeat timeout"),
  ]);
  await db.insert(s.printerEvents).values([
    { printerId: "PRN-004", kind: "error", code: "paper_jam", message: "Paper jam in rear door (media-jam-error)", createdAt: ago(25 * MIN) },
    { printerId: "PRN-004", kind: "error", code: "paper_jam", message: "Paper jam — cleared by on-site operator", createdAt: ago(9 * DAY) },
    { printerId: "PRN-001", kind: "error", code: "paper_out", message: "Tray empty", createdAt: ago(1 * DAY + 4 * HOUR) },
    { printerId: "PRN-001", kind: "info", message: "Toner cartridge replaced", createdAt: ago(3 * DAY) },
    { printerId: "PRN-002", kind: "error", code: "printer_disconnected", message: "USB device not found by CUPS", createdAt: ago(2 * DAY) },
    { printerId: "PRN-003", kind: "error", code: "printer_error", message: "Ink absorber near full warning", createdAt: ago(15 * DAY) },
    { printerId: "PRN-005", kind: "error", code: "printer_disconnected", message: "Printer unreachable (kiosk offline)", createdAt: ago(3 * HOUR) },
  ]);
  await db.insert(s.maintenanceRecords).values([
    { printerId: "PRN-001", type: "toner_replace", note: "HP 58A replaced at 41,100 pages", costPaise: 680000, performedBy: "Ravi Patil", createdAt: ago(3 * DAY) },
    { printerId: "PRN-001", type: "paper_refill", note: "250 sheets loaded", costPaise: 0, performedBy: "Ravi Patil", createdAt: ago(1 * DAY + 3 * HOUR) },
    { printerId: "PRN-004", type: "repair", note: "Rear-door jam cleared, pickup roller inspected", costPaise: 0, performedBy: "Ravi Patil", createdAt: ago(9 * DAY) },
    { printerId: "PRN-003", type: "cleaning", note: "Printhead cleaning cycle", costPaise: 0, performedBy: "Ravi Patil", createdAt: ago(20 * DAY) },
    { printerId: "PRN-002", type: "inspection", note: "USB cable replaced", costPaise: 15000, performedBy: "Diya Nair", createdAt: ago(2 * DAY - HOUR) },
  ]);
  const kl = (kioskId: string, level: string, message: string, t: Date) => ({ kioskId, level, message, createdAt: t });
  await db.insert(s.kioskLogs).values([
    kl("KSK-001", "info", "agent[2.4.1] heartbeat ok (rtt 84ms)", ago(1 * MIN)), kl("KSK-001", "info", "cups: job 5521 started on HP_M404dn", ago(1 * MIN)),
    kl("KSK-001", "warn", "wifi: signal -71dBm (weak)", ago(30 * MIN)), kl("KSK-001", "info", "printer HP_M404dn: toner 62%", ago(45 * MIN)),
    kl("KSK-002", "error", "cups: HP_M404dn media-jam-error", ago(25 * MIN)), kl("KSK-002", "error", "job PJ failed: printer in error state", ago(12 * MIN)),
    kl("KSK-002", "info", "ups: on mains, battery 100%", ago(10 * MIN)), kl("KSK-002", "warn", "canon G3770: colour ink 12%", ago(2 * HOUR)),
    kl("KSK-003", "error", "backend: connection timeout (3 retries)", ago(3 * HOUR)), kl("KSK-003", "warn", "lte: signal degraded", ago(3 * HOUR + 4 * MIN)), kl("KSK-003", "info", "agent[2.3.9] heartbeat ok", ago(3 * HOUR + 6 * MIN)),
  ]);
  await db.insert(s.deviceCommands).values([
    { kioskId: "KSK-001", command: "restart_agent", idempotencyKey: "seed:restart:1", status: "succeeded", result: "Agent restarted in 6s", requestedBy: "Diya Nair", createdAt: ago(5 * DAY), completedAt: ago(5 * DAY - MIN) },
    { kioskId: "KSK-002", printerId: "PRN-003", command: "test_print", idempotencyKey: "seed:test:1", status: "succeeded", result: "Test page printed", requestedBy: "Ravi Patil", createdAt: ago(20 * DAY), completedAt: ago(20 * DAY - MIN) },
  ]);

  /* ── pricing history ── */
  await db.update(s.pricingVersions).set({ active: false });
  await db.insert(s.pricingVersions).values([
    { bwPaise: 200, colorPaise: 700, duplexDiscountPct: 0, minTxnPaise: 0, config: DEFAULT_PRICING.config, note: "Launch pricing", active: false, publishedBy: "Aarav Mehta", createdAt: ago(80 * DAY) },
    { ...DEFAULT_PRICING, note: "Colour raised to ₹8 (ink cost)", active: true, publishedBy: "Kabir Shah", createdAt: ago(25 * DAY) },
  ]);

  /* ── inventory ── */
  const itemDefs = [
    { sku: "PAP-A4-80", name: "A4 Paper 80 GSM", category: "paper", unit: "sheets", stock: 3200, reorderThreshold: 1500, unitCostPaise: 45 },
    { sku: "TON-HP58A", name: "HP 58A Black Toner", category: "toner", unit: "cartridge", stock: 2, reorderThreshold: 1, unitCostPaise: 680000 },
    { sku: "TON-BR2410", name: "Brother TN-2410 Toner", category: "toner", unit: "cartridge", stock: 1, reorderThreshold: 1, unitCostPaise: 320000 },
    { sku: "INK-GI790K", name: "Canon GI-790 Black Ink", category: "ink", unit: "bottle", stock: 4, reorderThreshold: 2, unitCostPaise: 69000 },
    { sku: "INK-GI790C", name: "Canon GI-790 Colour Set (C/M/Y)", category: "ink", unit: "set", stock: 1, reorderThreshold: 2, unitCostPaise: 195000 },
    { sku: "DRM-CF232A", name: "HP CF232A Imaging Drum", category: "drum", unit: "unit", stock: 1, reorderThreshold: 1, unitCostPaise: 520000 },
    { sku: "PRT-ROLLER", name: "Pickup Roller Kit", category: "parts", unit: "kit", stock: 3, reorderThreshold: 2, unitCostPaise: 95000 },
  ];
  const items = await db.insert(s.inventoryItems).values(itemDefs).returning();
  const by = (sku: string) => items.find((i) => i.sku === sku)!;
  const mv: (typeof s.inventoryMovements.$inferInsert)[] = [];
  const paper = by("PAP-A4-80");
  // paper consumption from real job data (sheets)
  const sheetsByDay = new Map<number, number>();
  for (const j of jobs) {
    if (!j.pagesPrinted) continue;
    const logical = Math.ceil(j.pages / j.pagesPerSheet!);
    const sheets = (j.sided === "double" ? Math.ceil(logical / 2) : logical) * j.copies!;
    const dayIdx = Math.floor(((j.createdAt as Date).getTime() + IST) / DAY);
    sheetsByDay.set(dayIdx, (sheetsByDay.get(dayIdx) ?? 0) + sheets);
  }
  for (const [d, q] of sheetsByDay) mv.push({ itemId: paper.id, kind: "consumption", qty: -q, note: "Daily paper consumption (from print jobs)", byName: "System", createdAt: new Date(d * DAY - IST + 23 * HOUR) });
  mv.push({ itemId: paper.id, kind: "purchase", qty: 5000, unitCostPaise: 45, supplier: "Sharma Stationers", reference: "INV-2291", note: "10 reams", byName: "Diya Nair", createdAt: ago(21 * DAY) });
  mv.push({ itemId: paper.id, kind: "purchase", qty: 5000, unitCostPaise: 44, supplier: "Sharma Stationers", reference: "INV-2410", note: "10 reams", byName: "Diya Nair", createdAt: ago(48 * DAY) });
  const pur = (sku: string, qty: number, d: number, sup: string, ref: string) => mv.push({ itemId: by(sku).id, kind: "purchase", qty, unitCostPaise: by(sku).unitCostPaise, supplier: sup, reference: ref, byName: "Diya Nair", createdAt: ago(d * DAY) });
  pur("TON-HP58A", 2, 6, "OfficeMart", "OM-8812"); pur("INK-GI790K", 4, 14, "Canon Care", "CC-1190"); pur("INK-GI790C", 2, 14, "Canon Care", "CC-1190");
  pur("DRM-CF232A", 1, 33, "OfficeMart", "OM-8120"); pur("TON-BR2410", 1, 40, "OfficeMart", "OM-7991"); pur("PRT-ROLLER", 3, 29, "Spares Hub", "SH-455");
  mv.push({ itemId: by("TON-HP58A").id, kind: "consumption", qty: -1, note: "Replaced in PRN-001", byName: "Ravi Patil", createdAt: ago(3 * DAY) });
  mv.push({ itemId: by("INK-GI790K").id, kind: "consumption", qty: -2, note: "Refilled PRN-003", byName: "Ravi Patil", createdAt: ago(9 * DAY) });
  mv.push({ itemId: by("INK-GI790C").id, kind: "consumption", qty: -1, note: "Refilled PRN-003", byName: "Ravi Patil", createdAt: ago(9 * DAY) });
  mv.push({ itemId: paper.id, kind: "adjustment", qty: -120, note: "Damaged / water-soaked ream corner", byName: "Ravi Patil", createdAt: ago(10 * DAY) });
  // opening balances so ledger equals stock
  for (const it of items) {
    const sum = mv.filter((m) => m.itemId === it.id).reduce((a, m) => a + m.qty, 0);
    mv.push({ itemId: it.id, kind: "adjustment", qty: it.stock - sum, note: "Opening balance (demo dataset)", byName: "System", createdAt: ago(60 * DAY) });
  }
  await chunked(mv, (c) => db.insert(s.inventoryMovements).values(c));

  /* ── audit ── */
  const users = await db.select().from(s.adminUsers);
  const u = (role: string) => users.find((x) => x.role === role);
  const au = (role: string, action: string, entity: string, entityId: string, details: Record<string, unknown>, t: Date) => ({ userId: u(role)?.id ?? null, userName: u(role)?.name ?? "System", role, action, entity, entityId, details, ip: "203.0.113.24", createdAt: t });
  await db.insert(s.auditLogs).values([
    au("finance_admin", "pricing.publish", "pricing", "2", { bw: "₹2", color: "₹7 → ₹8" }, ago(25 * DAY)),
    au("ops_admin", "printer.config", "printer", "PRN-001", { role: "primary", priority: 1 }, ago(14 * DAY)),
    au("ops_admin", "kiosk.command", "kiosk", "KSK-001", { command: "restart_agent" }, ago(5 * DAY)),
    au("maintenance", "alert.resolve", "alert", "6", { note: "Refilled 250 sheets" }, ago(1 * DAY + 3 * HOUR)),
    au("finance_admin", "refund.initiate", "job", "demo", { amount: "₹16", reason: "Print failed" }, ago(20 * HOUR)),
    au("super_admin", "demo.load", "system", "demo", { note: "Demo dataset loaded" }, new Date()),
  ]);
}
