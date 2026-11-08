/* Client-safe constants shared by API + UI */

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "slate";

export const TZ = "Asia/Kolkata";

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Uploaded", tone: "slate" },
  awaiting_payment: { label: "Awaiting Payment", tone: "amber" },
  payment_successful: { label: "Payment Successful", tone: "blue" },
  queued: { label: "Queued", tone: "blue" },
  processing: { label: "Processing", tone: "violet" },
  printing: { label: "Printing", tone: "violet" },
  completed: { label: "Completed", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  partially_completed: { label: "Partially Completed", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refund_pending: { label: "Refund Pending", tone: "amber" },
  refunded: { label: "Refunded", tone: "slate" },
};
export const PENDING_JOB_STATUSES = ["uploaded", "awaiting_payment", "payment_successful", "queued", "processing", "printing"];
export const ACTIVE_PRINT_STATUSES = ["queued", "processing", "printing"];

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" },
  success: { label: "Paid", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  refunded: { label: "Refunded", tone: "slate" },
  partially_refunded: { label: "Part-refunded", tone: "violet" },
};

export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Requested", tone: "amber" },
  processing: { label: "Processing", tone: "blue" },
  success: { label: "Refunded", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

export type Severity = "critical" | "warning" | "info";
export const SEVERITY: Record<Severity, { label: string; tone: Tone; rank: number }> = {
  critical: { label: "Critical", tone: "red", rank: 3 },
  warning: { label: "Warning", tone: "amber", rank: 2 },
  info: { label: "Info", tone: "blue", rank: 1 },
};

export const ALERT_TYPES: Record<string, { label: string; severity: Severity; action: string }> = {
  paper_out: { label: "Paper out", severity: "critical", action: "Load up to 250 sheets in the paper tray, then press resume on the printer. Mark the tray as refilled in PrintBar." },
  paper_low: { label: "Low paper", severity: "warning", action: "Top up the paper tray soon. Check the paper stock in Inventory and reorder if needed." },
  paper_jam: { label: "Paper jam", severity: "critical", action: "Open the rear and front covers, remove jammed sheets carefully, close covers and send a test print. Do not clear the queue until the jam is cleared." },
  printer_disconnected: { label: "Printer disconnected", severity: "critical", action: "Check the USB/network cable and printer power. If the printer is on, restart the printing service from the kiosk page." },
  toner_low: { label: "Toner low", severity: "warning", action: "Order a replacement cartridge. Print quality may degrade; plan to swap within a few days." },
  ink_low: { label: "Ink low", severity: "warning", action: "Order replacement ink. Avoid colour jobs if the colour level is critically low." },
  drum_warning: { label: "Drum warning", severity: "warning", action: "Drum is near end of life. Schedule a drum replacement and log it as a maintenance record." },
  printer_error: { label: "Printer error", severity: "critical", action: "Open the CUPS queue and diagnostics for details. Power-cycle the printer if the error persists." },
  pi_offline: { label: "Raspberry Pi offline", severity: "critical", action: "Check Pi power and network. If the kiosk has a UPS, check its status. Restart the kiosk agent remotely once it is back." },
  kiosk_offline: { label: "Kiosk offline", severity: "critical", action: "No heartbeat received. Check mains power, router and mobile data. On-site visit may be needed." },
  power_warning: { label: "Power warning", severity: "warning", action: "UPS reports battery or mains issues. Verify mains supply and UPS battery health." },
  network_issue: { label: "Network issue", severity: "warning", action: "Kiosk reports unstable connectivity. Check Wi-Fi signal / router; consider switching to Ethernet or backup LTE." },
  info: { label: "Information", severity: "info", action: "No action required." },
};

export const NOTIFICATION_TYPES: Record<string, string> = {
  printer_offline: "Printer offline",
  paper_out: "Paper out",
  low_consumable: "Low consumable",
  print_failure: "Print failures",
  payment_failure: "Payment failures",
  refund_update: "Refund updates",
  pi_offline: "Raspberry Pi disconnection",
  kiosk_offline: "Kiosk offline",
};

export const ALERT_TO_NOTIFICATION: Record<string, string> = {
  printer_disconnected: "printer_offline",
  paper_out: "paper_out",
  paper_low: "low_consumable",
  toner_low: "low_consumable",
  ink_low: "low_consumable",
  drum_warning: "low_consumable",
  paper_jam: "print_failure",
  printer_error: "print_failure",
  pi_offline: "pi_offline",
  kiosk_offline: "kiosk_offline",
  power_warning: "kiosk_offline",
  network_issue: "kiosk_offline",
};

export const INVENTORY_CATEGORIES: Record<string, string> = {
  paper: "Paper",
  toner: "Toner",
  ink: "Ink",
  drum: "Drum",
  parts: "Maintenance parts",
};

export const MAINTENANCE_TYPES: Record<string, string> = {
  paper_refill: "Paper refill",
  toner_replace: "Toner replaced",
  drum_replace: "Drum replaced",
  cleaning: "Cleaning",
  repair: "Repair",
  inspection: "Inspection",
};

export const DEFAULT_SETTINGS = {
  general: { businessName: "PrintBar", supportPhone: "", supportEmail: "", currency: "INR", timezone: TZ },
  upload: { maxFileMB: 25, maxPagesPerJob: 200, allowedTypes: ["pdf", "docx", "jpg", "png"] },
  processing: { jobTimeoutSec: 300, maxRetries: 2, autoFailover: true, defaultPaperCapacity: 250 },
  cleanup: { deleteDocumentsAfterMin: 30, purgeLogsAfterDays: 90 },
  network: { heartbeatIntervalSec: 30, staleAfterSec: 90 },
  finance: { monthlyFixedCostsPaise: 0, fixedCostsNote: "" },
};
export type SettingsGroup = keyof typeof DEFAULT_SETTINGS;
