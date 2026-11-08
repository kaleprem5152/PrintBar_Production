import type { NextRequest } from "next/server";
import { calcQuote } from "@/lib/pricing";
import { getActivePricing } from "@/lib/server/active-pricing";

export const dynamic = "force-dynamic";

/**
 * Public, read-only pricing contract for the customer app + backend.
 *   GET /api/public/pricing                       → active price card
 *   GET /api/public/pricing?pages=12&color=1&sided=double&pps=2&copies=2 → server-side quote (same calculator as the dashboard)
 */
export async function GET(req: NextRequest) {
  const p = await getActivePricing();
  const sp = req.nextUrl.searchParams;
  const card = {
    version: p.id,
    currency: "INR",
    bwPaise: p.bwPaise,
    colorPaise: p.colorPaise,
    duplexDiscountPct: p.duplexDiscountPct,
    minTxnPaise: p.minTxnPaise,
    options: p.config,
    publishedAt: p.createdAt,
  };
  if (!sp.has("pages")) return Response.json(card, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  const quote = calcQuote(p, {
    pages: Number(sp.get("pages")),
    color: sp.get("color") === "1" || sp.get("color") === "true",
    sided: sp.get("sided") === "double" ? "double" : "single",
    pagesPerSheet: Number(sp.get("pps") ?? 1),
    copies: Number(sp.get("copies") ?? 1),
  });
  return Response.json({ ...card, quote }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
