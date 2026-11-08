import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { alerts, notifications, printers } from "@/db/schema";
import { ALERT_TO_NOTIFICATION, ALERT_TYPES, type Severity } from "./constants";

type PrinterRow = typeof printers.$inferSelect;

export async function notify(n: { type: string; severity?: Severity; title: string; body?: string; link?: string }) {
  await db.insert(notifications).values({
    type: n.type,
    severity: n.severity ?? "info",
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
  });
  // Web Push fan-out is backend-dependent (VAPID keys + web-push sender). See docs/ADMIN_API_CONTRACT.md.
}

export async function raiseAlert(a: {
  kioskId?: string | null;
  printerId?: string | null;
  type: string;
  details?: string;
  severity?: Severity;
  source?: string;
  kioskLabel?: string;
}) {
  const meta = ALERT_TYPES[a.type] ?? ALERT_TYPES.info;
  const existing = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.type, a.type),
        ne(alerts.status, "resolved"),
        a.kioskId ? eq(alerts.kioskId, a.kioskId) : isNull(alerts.kioskId),
        a.printerId ? eq(alerts.printerId, a.printerId) : isNull(alerts.printerId),
      ),
    )
    .limit(1);
  if (existing.length) return null;
  const severity = a.severity ?? meta.severity;
  const [row] = await db
    .insert(alerts)
    .values({
      kioskId: a.kioskId ?? null,
      printerId: a.printerId ?? null,
      type: a.type,
      severity,
      title: `${meta.label}${a.printerId ? ` · ${a.printerId}` : a.kioskId ? ` · ${a.kioskId}` : ""}`,
      details: a.details ?? null,
      suggestedAction: meta.action,
      source: a.source ?? "agent",
    })
    .returning();
  await notify({
    type: ALERT_TO_NOTIFICATION[a.type] ?? "print_failure",
    severity,
    title: row.title,
    body: a.details,
    link: "/admin/notifications?tab=alerts",
  });
  return row;
}

export async function resolveAlerts(
  where: { kioskId?: string; printerId?: string; types?: string[] },
  by = "System (auto-resolved)",
  note = "Condition cleared",
) {
  const conds = [ne(alerts.status, "resolved")];
  if (where.kioskId) conds.push(eq(alerts.kioskId, where.kioskId));
  if (where.printerId) conds.push(eq(alerts.printerId, where.printerId));
  if (where.types) conds.push(inArray(alerts.type, where.types));
  await db.update(alerts).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: by, resolutionNote: note }).where(and(...conds));
}

/** Derive hardware alerts from the latest reported printer state. Telemetry vs estimate is stated in details. */
export async function evaluatePrinterAlerts(p: PrinterRow) {
  if (!p.enabled) return;
  const src = (s: string) => (s === "telemetry" ? "reported by printer" : s === "manual" ? "manually entered" : "estimated");
  const checks: Record<string, string | null> = {
    printer_disconnected: !p.connected ? "Kiosk agent reports the printer is not reachable (CUPS/USB/network)." : null,
    paper_out:
      p.connected && ((p.paperRemaining != null && p.paperRemaining <= 0) || p.errorCode === "paper_out")
        ? `Tray empty (${src(p.paperSource)}).`
        : null,
    paper_low:
      p.paperRemaining != null && p.paperRemaining > 0 && p.paperRemaining <= Math.round(p.paperCapacity * 0.1)
        ? `${p.paperRemaining}/${p.paperCapacity} sheets left (${src(p.paperSource)}).`
        : null,
    paper_jam: p.errorCode === "paper_jam" ? p.errorMessage ?? "Paper jam reported." : null,
    toner_low:
      p.tonerSource !== "unsupported" && ((p.tonerBlack != null && p.tonerBlack <= 15) || (p.tonerColor != null && p.tonerColor <= 15))
        ? `Toner at ${Math.min(p.tonerBlack ?? 100, p.tonerColor ?? 100)}% (${src(p.tonerSource)}).`
        : null,
    drum_warning:
      p.drumSource !== "unsupported" && p.drumLife != null && p.drumLife <= 10 ? `Drum life ${p.drumLife}% (${src(p.drumSource)}).` : null,
    printer_error:
      p.state === "error" && p.errorCode !== "paper_out" && p.errorCode !== "paper_jam" ? p.errorMessage ?? "Printer reported an error." : null,
  };
  for (const [type, details] of Object.entries(checks)) {
    if (details) await raiseAlert({ kioskId: p.kioskId, printerId: p.id, type, details });
    else await resolveAlerts({ printerId: p.id, types: [type] });
  }
}
