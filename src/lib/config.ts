// Shared product configuration.
// Pricing and hardware capabilities are served via /api/config.
// The server is always the source of truth; the frontend reads from the API.

// ─── Pricing ──────────────────────────────────────────────────────────────────
// These are default values. Production pricing is stored in the pricing_config DB table
// and served by the API. These values are used as fallback when the DB is not reachable.
export const PRICING = {
  bw:       2,    // Rupees per page — Black & White
  color:    8,    // Rupees per page — Colour
  currency: "INR",
  symbol:   "₹",
} as const;

// ─── Hardware capabilities ────────────────────────────────────────────────────
export const HARDWARE = {
  // Both printers support A4. No A3 tray fitted.
  paperSizes:       ["A4"] as string[],
  sides:            ["single", "double"] as string[],
  orientations:     ["portrait", "landscape"] as string[],
  pagesPerSheet:    [1, 2, 4, 6] as const,
  maxUploadBytes:   25 * 1024 * 1024,  // 25 MB per file
  maxFiles:         5,                  // Maximum documents per order
} as const;

// ─── File types ───────────────────────────────────────────────────────────────
export const ALLOWED_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png"] as const;

export type AllowedExt = typeof ALLOWED_EXT[number];

// ─── Type aliases ─────────────────────────────────────────────────────────────
export type ColorMode   = "bw" | "color";
export type Sides       = "single" | "double";
export type Orientation = "portrait" | "landscape";

// ─── PIN settings ─────────────────────────────────────────────────────────────
export const PIN_TTL_HOURS = 24;

// ─── Device ───────────────────────────────────────────────────────────────────
// The device ID of the single production PrintBar machine.
// Populated from the DEVICE_ID environment variable on the Pi.
export const DEVICE_ID = process.env.DEVICE_ID ?? "PB-K01";
export const KIOSK_ID = DEVICE_ID;

export const DEMO = {
  orderId: "PB-2026-00142",
  pin: "4827",
  token: "demo",
  expiredPin: "0000",
};

/** Prototype printer simulator speed (ms per page) for demo mode. */
export const PAGE_MS = 600;

export type KioskState = "ready" | "offline" | "paper_out" | "paper_jam" | "error";

// ─── Formatting ───────────────────────────────────────────────────────────────
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
