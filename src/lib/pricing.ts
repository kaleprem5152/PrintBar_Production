import { PRICING, type ColorMode } from "./config";

export type RangeResult = { count: number; error?: string };

/** Parse "1-5, 8, 11-13" against a document's total page count. */
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

export type QuoteDocInput = { name: string; pages: number; range?: string | null };

export type Quote = {
  lines: { name: string; selected: number }[];
  pagesPerCopy: number;
  copies: number;
  totalPages: number;
  rate: number;
  amount: number;
  error?: string;
};

export function buildQuote(docs: QuoteDocInput[], copies: number, mode: ColorMode): Quote {
  const rate = mode === "color" ? PRICING.color : PRICING.bw;
  let error: string | undefined;
  const lines = docs.map((d) => {
    const r = parsePageRange(d.range, d.pages);
    if (r.error && !error) error = `${d.name}: ${r.error}`;
    return { name: d.name, selected: r.count };
  });
  const pagesPerCopy = lines.reduce((s, l) => s + l.selected, 0);
  const totalPages = pagesPerCopy * copies;
  return { lines, pagesPerCopy, copies, totalPages, rate, amount: totalPages * rate, error };
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
