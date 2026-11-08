/* Pure, client-safe pricing logic (no DB imports). */
export type PricingConfig = {
  id?: number;
  bwPaise: number;
  colorPaise: number;
  duplexDiscountPct: number;
  minTxnPaise: number;
  config: {
    pagesPerSheet: number[];
    maxCopies: number;
    maxPages: number;
    singleSided: boolean;
    doubleSided: boolean;
  };
};

export const DEFAULT_PRICING: PricingConfig = {
  bwPaise: 200,
  colorPaise: 800,
  duplexDiscountPct: 0,
  minTxnPaise: 0,
  config: { pagesPerSheet: [1, 2, 4, 6], maxCopies: 50, maxPages: 200, singleSided: true, doubleSided: true },
};

export type QuoteInput = { pages: number; color: boolean; sided: "single" | "double"; pagesPerSheet: number; copies: number };

/** Single source of truth for price calculation — used by the dashboard preview AND the public quote API. */
export function calcQuote(p: PricingConfig, i: QuoteInput) {
  const errors: string[] = [];
  if (!(i.pages >= 1)) errors.push("Pages must be at least 1");
  if (i.pages > p.config.maxPages) errors.push(`Maximum ${p.config.maxPages} pages per job`);
  if (!p.config.pagesPerSheet.includes(i.pagesPerSheet)) errors.push(`${i.pagesPerSheet} pages per sheet is not offered`);
  if (i.sided === "single" && !p.config.singleSided) errors.push("Single-sided printing is disabled");
  if (i.sided === "double" && !p.config.doubleSided) errors.push("Double-sided printing is disabled");
  if (i.copies < 1 || i.copies > p.config.maxCopies) errors.push(`Copies must be between 1 and ${p.config.maxCopies}`);
  const base = i.color ? p.colorPaise : p.bwPaise;
  const perPage = i.sided === "double" ? (base * (100 - p.duplexDiscountPct)) / 100 : base;
  const printedPages = Math.max(0, i.pages) * Math.max(0, i.copies);
  const subtotal = Math.round(perPage * printedPages);
  const total = Math.max(subtotal, p.minTxnPaise);
  const logicalSheets = Math.ceil(i.pages / Math.max(1, i.pagesPerSheet));
  const sheets = (i.sided === "double" ? Math.ceil(logicalSheets / 2) : logicalSheets) * Math.max(0, i.copies);
  return {
    perPagePaise: perPage,
    printedPages,
    subtotalPaise: subtotal,
    minApplied: total > subtotal,
    totalPaise: total,
    sheets,
    valid: errors.length === 0,
    errors,
  };
}

