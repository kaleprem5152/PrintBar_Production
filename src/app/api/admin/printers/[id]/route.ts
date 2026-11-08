import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts, deviceCommands, jobLogs, kiosks, maintenanceRecords, printAttempts, printerEvents, printers, printJobs,
} from "@/db/schema";
import { ApiError, audit, int, oneOf, route, str } from "@/lib/api";
import { enqueueCommand, COMMAND_LABELS } from "@/lib/commands";
import { evaluatePrinterAlerts, resolveAlerts } from "@/lib/alerts";
import { MAINTENANCE_TYPES } from "@/lib/constants";
import { getGroup } from "@/lib/settings";
import { getStaleMs, kioskView, printerView } from "@/lib/live";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const [p] = await db.select().from(printers).where(eq(printers.id, id));
  if (!p) throw new ApiError(404, "Printer not found");
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, p.kioskId));
  return { p, k };
}

export const GET = route<{ id: string }>("printers.view", async ({ params }) => {
  const { p, k } = await load(params.id);
  const stale = await getStaleMs();
  const kv = k ? kioskView(k, stale) : null;
  const events = await db.select().from(printerEvents).where(eq(printerEvents.printerId, p.id)).orderBy(desc(printerEvents.createdAt)).limit(40);
  const maintenance = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.printerId, p.id)).orderBy(desc(maintenanceRecords.createdAt)).limit(40);
  const queue = await db
    .select({ a: printAttempts, j: printJobs })
    .from(printAttempts)
    .innerJoin(printJobs, eq(printJobs.id, printAttempts.jobId))
    .where(and(eq(printAttempts.printerId, p.id), inArray(printAttempts.status, ["queued", "printing"])));
  const commands = await db.select().from(deviceCommands).where(eq(deviceCommands.printerId, p.id)).orderBy(desc(deviceCommands.createdAt)).limit(15);
  const openAlerts = await db.select().from(alerts).where(and(eq(alerts.printerId, p.id), ne(alerts.status, "resolved"))).orderBy(desc(alerts.createdAt));
  const g = await getGroup("processing");
  const siblings = await db.select({ id: printers.id, name: printers.name, role: printers.role }).from(printers).where(eq(printers.kioskId, p.kioskId));
  return {
    printer: printerView(p, kv?.online ?? false),
    kiosk: kv && { id: kv.id, name: kv.name, status: kv.status, online: kv.online, lastHeartbeat: kv.lastHeartbeat },
    events,
    maintenance,
    queue: queue.map((q) => ({ attemptId: q.a.id, status: q.a.status, jobId: q.j.id, fileName: q.j.fileName, pages: q.j.pages, pagesPrinted: q.a.pagesPrinted, startedAt: q.a.startedAt, cupsJobId: q.a.cupsJobId })),
    commands,
    alerts: openAlerts,
    jobTimeoutSec: g.jobTimeoutSec,
    siblings,
  };
});

export const PATCH = route<{ id: string }>("printers.configure", async ({ params, user, ip, body }) => {
  const b = await body();
  const { p } = await load(params.id);
  const patch: Partial<typeof printers.$inferInsert> = {};
  if (b.name !== undefined) patch.name = str(b.name, "Name", { max: 60 });
  if (b.ip !== undefined) patch.ip = str(b.ip, "IP address", { optional: true, max: 45 }) || null;
  if (b.priority !== undefined) patch.priority = int(b.priority, "Priority", { min: 1, max: 9 });
  if (b.enabled !== undefined) patch.enabled = !!b.enabled;
  if (b.autoFailover !== undefined) patch.autoFailover = !!b.autoFailover;
  if (b.role !== undefined) patch.role = oneOf(b.role, "Role", ["primary", "backup"] as const);
  if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to update");
  await db.transaction(async (tx) => {
    if (patch.role === "primary" && p.role !== "primary") {
      await tx.update(printers).set({ role: "backup" }).where(and(eq(printers.kioskId, p.kioskId), eq(printers.role, "primary")));
    }
    if (patch.role === "backup" && p.role === "primary") {
      const others = await tx.select().from(printers).where(and(eq(printers.kioskId, p.kioskId), ne(printers.id, p.id)));
      if (!others.length) throw new ApiError(409, "This is the kiosk's only printer — it must remain primary");
      if (!others.some((o) => o.role === "primary")) {
        const next = others.sort((a, c) => a.priority - c.priority)[0];
        await tx.update(printers).set({ role: "primary" }).where(eq(printers.id, next.id));
      }
    }
    await tx.update(printers).set(patch).where(eq(printers.id, p.id));
    await tx.insert(printerEvents).values({ printerId: p.id, kind: "config", message: `Config changed by ${user.name}: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ")}` });
  });
  await audit({ user, ip }, "printer.config", "printer", p.id, { from: Object.fromEntries(Object.keys(patch).map((k) => [k, (p as Record<string, unknown>)[k]])), to: patch });
  return { ok: true, message: "Printer configuration saved. Kiosk agents pick it up on their next heartbeat." };
});

export const POST = route<{ id: string }>(["printers.control"], async ({ params, user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["pause", "resume", "test_print", "clear_queue", "fetch_cups_queue", "refill_paper", "refill_250", "set_levels", "log_maintenance"] as const);
  const { p } = await load(params.id);
  const done = async (message: string, details: Record<string, unknown> = {}) => {
    await audit({ user, ip }, `printer.${action}`, "printer", p.id, details);
    return { ok: true, message };
  };

  if (action === "pause" || action === "resume") {
    await db.update(printers).set({ paused: action === "pause" }).where(eq(printers.id, p.id));
    await db.insert(printerEvents).values({ printerId: p.id, kind: "config", message: `Printing ${action}d by ${user.name}` });
    return done(action === "pause" ? "Printing paused. New jobs will not be routed to this printer." : "Printing resumed.");
  }
  if (action === "test_print" || action === "fetch_cups_queue") {
    const { duplicate } = await enqueueCommand({ kioskId: p.kioskId, printerId: p.id, command: action, by: user.name });
    return done(duplicate ? "An identical command is already queued." : `${COMMAND_LABELS[action]} queued. It runs when the kiosk agent next polls — check command history for the result.`);
  }
  if (action === "clear_queue") {
    const g = await getGroup("processing");
    const cutoff = new Date(Date.now() - g.jobTimeoutSec * 1000);
    const stuck = await db
      .select()
      .from(printAttempts)
      .where(and(eq(printAttempts.printerId, p.id), inArray(printAttempts.status, ["queued", "printing"]), lt(printAttempts.startedAt, cutoff)));
    if (!stuck.length) throw new ApiError(409, `Nothing is stuck. Only attempts older than the ${g.jobTimeoutSec}s job timeout can be cleared — active jobs are never touched.`);
    await db.transaction(async (tx) => {
      for (const a of stuck) {
        await tx.update(printAttempts).set({ status: "failed", error: "Timed out — cleared by admin", endedAt: new Date() }).where(eq(printAttempts.id, a.id));
        await tx.update(printJobs).set({ status: a.pagesPrinted > 0 ? "partially_completed" : "failed", errorCode: "cups_timeout", errorMessage: "Stuck job cleared by admin", updatedAt: new Date() }).where(eq(printJobs.id, a.jobId));
        await tx.insert(jobLogs).values({ jobId: a.jobId, level: "warn", message: `Stuck attempt #${a.attemptNo} cleared by ${user.name}. Customer is eligible for retry/refund — no automatic reprint.` });
      }
    });
    await enqueueCommand({ kioskId: p.kioskId, printerId: p.id, command: "clear_stuck_jobs", payload: { jobIds: stuck.map((s) => s.jobId) }, by: user.name });
    return done(`${stuck.length} stuck job(s) marked failed and a CUPS clean-up command was queued.`, { jobs: stuck.map((s) => s.jobId) });
  }
  if (action === "refill_paper" || action === "refill_250") {
    const refillQty = action === "refill_250" ? 250 : (Number(b.amount) || 250);
    const newRemaining = Math.max(0, (p.paperRemaining ?? 0) + refillQty);
    await db.update(printers).set({ paperRemaining: newRemaining, paperSource: "manual" }).where(eq(printers.id, p.id));
    await db.insert(maintenanceRecords).values({ printerId: p.id, type: "paper_refill", note: `Tray refilled with ${refillQty} sheets (now ${newRemaining} sheets)`, performedBy: user.name });

    // Synchronize devices table so customer upload & payment allow printing
    try {
      const { devices } = await import("@/db/schema");
      const isCanon = p.supportsColor || p.id.toLowerCase().includes("canon") || p.model.toLowerCase().includes("canon") || p.name.toLowerCase().includes("colour") || p.name.toLowerCase().includes("color");
      const [dev] = await db.select().from(devices).limit(1);
      if (dev) {
        let kyoceraPaper = dev.kyoceraPaper ?? 0;
        let canonPaper = dev.canonPaper ?? 0;
        if (isCanon) {
          canonPaper += refillQty;
        } else {
          kyoceraPaper += refillQty;
        }
        await db.update(devices).set({
          kyoceraPaper,
          canonPaper,
          paperReady: (kyoceraPaper > 0 || canonPaper > 0),
          updatedAt: new Date(),
        }).where(eq(devices.id, dev.id));
      }
    } catch {
      // safe fallback
    }

    const [fresh] = await db.select().from(printers).where(eq(printers.id, p.id));
    await resolveAlerts({ printerId: p.id, types: ["paper_out", "paper_low"] }, user.name, "Paper tray refilled");
    await evaluatePrinterAlerts(fresh);
    return done(`Paper refilled with ${refillQty} sheets (Total remaining: ${newRemaining}).`);
  }
  if (action === "set_levels") {
    const patch: Partial<typeof printers.$inferInsert> = {};
    const lvl = (v: unknown, n: string) => int(v, n, { min: 0, max: n === "Paper" ? p.paperCapacity : 100 });
    if (b.paper != null && b.paper !== "") { patch.paperRemaining = lvl(b.paper, "Paper"); patch.paperSource = "manual"; }
    if (b.tonerBlack != null && b.tonerBlack !== "") { patch.tonerBlack = lvl(b.tonerBlack, "Toner"); patch.tonerSource = "manual"; }
    if (b.tonerColor != null && b.tonerColor !== "") { patch.tonerColor = lvl(b.tonerColor, "Colour toner"); patch.tonerSource = "manual"; }
    if (b.drumLife != null && b.drumLife !== "") { patch.drumLife = lvl(b.drumLife, "Drum"); patch.drumSource = "manual"; }
    if (!Object.keys(patch).length) throw new ApiError(400, "Enter at least one level");
    await db.update(printers).set(patch).where(eq(printers.id, p.id));
    const [fresh] = await db.select().from(printers).where(eq(printers.id, p.id));
    await evaluatePrinterAlerts(fresh);
    return done("Levels saved and marked as manually entered.", patch);
  }
  const type = oneOf(b.type, "Type", Object.keys(MAINTENANCE_TYPES) as [string, ...string[]]);
  await db.insert(maintenanceRecords).values({
    printerId: p.id,
    type,
    note: str(b.note, "Note", { optional: true, max: 300 }) || null,
    costPaise: b.costRupees ? Math.round(Number(b.costRupees) * 100) || 0 : 0,
    performedBy: user.name,
  });
  if (type === "drum_replace") await db.update(printers).set({ drumLife: 100, drumSource: "manual" }).where(eq(printers.id, p.id));
  if (type === "toner_replace") await db.update(printers).set({ tonerBlack: 100, tonerSource: "manual" }).where(eq(printers.id, p.id));
  const [fresh] = await db.select().from(printers).where(eq(printers.id, p.id));
  await evaluatePrinterAlerts(fresh);
  return done("Maintenance record added.", { type });
});
