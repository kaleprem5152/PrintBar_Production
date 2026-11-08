import { PRICING, type ColorMode, type Sides } from "./config";
import { DEFAULT_PRICING, type PricingConfig } from "./quote";

export { calcQuote, DEFAULT_PRICING } from "./quote";
export type { PricingConfig, QuoteInput } from "./quote";

export type PagesPerSheet = 1 | 2 | 4 | 6;

export type RangeResult = { count: number; error?: string };

/**
 * Parse a custom page range string like "1-5, 8, 11-13" against a document's total page count.
 */
export function parsePageRange(input: string | null | undefined, total: number): RangeResult {
  if (!input || !input.trim()) return { count: total };
  const set = new Set<number>();
  for (const raw of input.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { count: 0, error: "Use a format like 1-5, 8, 11-13" };
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a) return { count: 0, error: "Page ranges must go upward, e.g. 3-7" };
    if (b > total) return { count: 0, error: `This document has only ${total} page${total === 1 ? "" : "s"}` };
    for (let i = a; i <= b; i++) set.add(i);
  }
  if (set.size === 0) return { count: 0, error: "Enter at least one page" };
  return { count: set.size };
}

/** Set of 1-based page numbers selected by a range string (all pages when empty/invalid). */
export function expandRange(input: string | null | undefined, total: number): Set<number> {
  const all = new Set<number>();
  for (let i = 1; i <= total; i++) all.add(i);
  if (!input || !input.trim()) return all;
  if (parsePageRange(input, total).error) return all;
  const set = new Set<number>();
  for (const part of input.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

export type QuoteDocInput = {
  name:   string;
  pages:  number;
  range?: string | null;
};

export type PricingConfigParams = {
  bwPerPage?:           number; // in Rupees
  colorPerPage?:        number; // in Rupees
  billingBasis?:        "per_sheet" | "per_side";
  minOrderAmount?:      number; // in Rupees
  duplexDiscountPaise?: number; // in paise
};

export type PricingSnapshot = {
  bwRate:         number;
  colorRate:      number;
  billingBasis:   "per_sheet" | "per_side";
  minOrderAmount: number;
  calculatedAt:   string;
};

export type DetailedQuote = {
  lines: Array<{
    name:          string;
    totalPages:    number;
    selectedPages: number;
    range:         string | null;
  }>;
  pagesPerCopy:        number;
  copies:              number;
  totalLogicalPages:   number;
  pagesPerSheet:       PagesPerSheet;
  sides:               Sides;
  colorMode:           ColorMode;
  physicalSheets:      number; // Actual paper sheets required
  impressions:         number; // Printed sides
  billingBasis:        "per_sheet" | "per_side";
  rate:                number; // in Rupees per unit
  ratePaise:           number;
  subtotalPaise:       number;
  totalPaise:          number;
  amount:              number; // Final payable in Rupees (integer)
  pricingSnapshot:     PricingSnapshot;
  error?:              string;
};

/**
 * Calculates physical sheets based on N-up and duplex configuration.
 *
 * Formula:
 *   - Single-sided: CEIL(Logical pages / N-up)
 *   - Double-sided: CEIL(Logical pages / (N-up * 2))
 */
export function calculatePhysicalSheets(
  logicalPages: number,
  pagesPerSheet: PagesPerSheet = 1,
  sides: Sides = "single"
): number {
  if (logicalPages <= 0) return 0;
  const n = pagesPerSheet || 1;
  const factor = sides === "double" ? n * 2 : n;
  return Math.ceil(logicalPages / factor);
}

/**
 * Authoritative central pricing engine.
 * Calculates exact physical sheets, billable units, and integer paise total.
 * Never uses floating-point arithmetic for money.
 */
export function calculatePrintQuote(
  docs: QuoteDocInput[],
  options: {
    copies?:        number;
    colorMode?:     ColorMode;
    sides?:         Sides;
    pagesPerSheet?: PagesPerSheet;
    config?:        PricingConfigParams;
  }
): DetailedQuote {
  const copies = Math.max(1, Math.min(99, options.copies ?? 1));
  const colorMode = options.colorMode === "color" ? "color" : "bw";
  const sides = options.sides === "double" ? "double" : "single";
  const pagesPerSheet = options.pagesPerSheet ?? 1;

  const cfg = options.config ?? {};
  const bwRate = cfg.bwPerPage ?? PRICING.bw;
  const colorRate = cfg.colorPerPage ?? PRICING.color;
  const billingBasis = cfg.billingBasis ?? "per_sheet";
  const minOrderAmount = cfg.minOrderAmount ?? 2;

  let error: string | undefined;

  const lines = docs.map((d) => {
    const r = parsePageRange(d.range, d.pages);
    if (r.error && !error) error = `${d.name}: ${r.error}`;
    return {
      name:          d.name,
      totalPages:    d.pages,
      selectedPages: r.count,
      range:         d.range ?? null,
    };
  });

  const pagesPerCopy = lines.reduce((acc, l) => acc + l.selectedPages, 0);
  const totalLogicalPages = pagesPerCopy * copies;

  // Calculate physical sheets using imposition & duplex rules
  const physicalSheets = calculatePhysicalSheets(totalLogicalPages, pagesPerSheet, sides);

  // Calculate impressions (sides printed)
  // Single-sided: 1 impression per sheet.
  // Double-sided: 2 impressions per sheet (or 1 for the trailing single page on an odd sheet count).
  const sidesPerSheet = Math.ceil(totalLogicalPages / pagesPerSheet);
  const impressions = sides === "double" ? sidesPerSheet : physicalSheets;

  const applicableRateRupees = colorMode === "color" ? colorRate : bwRate;
  const ratePaise = applicableRateRupees * 100;

  // Calculate billable units based on configured business billing policy
  const billableUnits = billingBasis === "per_side" ? impressions : physicalSheets;

  // Integer paise arithmetic
  let subtotalPaise = billableUnits * ratePaise;

  // Apply minimum order constraint
  const minOrderPaise = minOrderAmount * 100;
  const totalPaise = Math.max(minOrderPaise, subtotalPaise);
  const amountRupees = Math.round(totalPaise / 100);

  const pricingSnapshot: PricingSnapshot = {
    bwRate,
    colorRate,
    billingBasis,
    minOrderAmount,
    calculatedAt: new Date().toISOString(),
  };

  return {
    lines,
    pagesPerCopy,
    copies,
    totalLogicalPages,
    pagesPerSheet,
    sides,
    colorMode,
    physicalSheets,
    impressions,
    billingBasis,
    rate: applicableRateRupees,
    ratePaise,
    subtotalPaise,
    totalPaise,
    amount: amountRupees,
    pricingSnapshot,
    error,
  };
}

/** Legacy signature adapter for backward compatibility */
export function buildQuote(
  docs: QuoteDocInput[],
  copies: number,
  mode: ColorMode,
  sides: Sides = "single",
  pagesPerSheet: PagesPerSheet = 1
): DetailedQuote {
  return calculatePrintQuote(docs, { copies, colorMode: mode, sides, pagesPerSheet });
}
