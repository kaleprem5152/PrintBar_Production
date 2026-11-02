// Shared product configuration. The server is the source of truth for pricing
// and hardware capabilities (served via /api/config); the client reads from it.

export const PRICING = { bw: 2, color: 8, currency: "INR", symbol: "₹" } as const;

export const HARDWARE = {
  // Installed printer: A4 only (no A3 tray), duplex unit fitted.
  paperSizes: ["A4"] as string[],
  sides: ["single", "double"] as string[],
  orientations: ["portrait", "landscape"] as string[],
  maxUploadBytes: 25 * 1024 * 1024,
  maxFiles: 5,
};

export const ALLOWED_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png"] as const;

export type ColorMode = "bw" | "color";
export type Sides = "single" | "double";
export type Orientation = "portrait" | "landscape";

export const DEMO = {
  orderId: "PB-2026-00142",
  pin: "4827",
  token: "demo",
  expiredPin: "0000",
};

export const KIOSK_ID = "PB-K01";
/** Prototype printer simulator speed (ms per page). */
export const PAGE_MS = 600;
export const PIN_TTL_HOURS = 24;

export type KioskState = "ready" | "offline" | "paper_out" | "paper_jam" | "error";

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
