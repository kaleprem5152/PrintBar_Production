import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { PRICING } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [cfg] = await db
      .select()
      .from(pricingConfig)
      .orderBy(desc(pricingConfig.id))
      .limit(1);

    if (cfg) {
      return Response.json({
        bwPerPage: cfg.bwPerPage,
        colorPerPage: cfg.colorPerPage,
        billingBasis: cfg.billingBasis,
        minOrderAmount: cfg.minOrderAmount,
        currency: cfg.currency,
        effectiveFrom: cfg.effectiveFrom,
      });
    }

    return Response.json({
      bwPerPage: PRICING.bw,
      colorPerPage: PRICING.color,
      billingBasis: "per_sheet",
      minOrderAmount: 2,
      currency: "INR",
      effectiveFrom: new Date(),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bwPerPage, colorPerPage, billingBasis, minOrderAmount } = (await req.json().catch(() => ({}))) as {
    bwPerPage?: number;
    colorPerPage?: number;
    billingBasis?: "per_sheet" | "per_side";
    minOrderAmount?: number;
  };

  if (!bwPerPage || !colorPerPage) {
    return Response.json({ error: "bwPerPage and colorPerPage are required." }, { status: 400 });
  }

  if (bwPerPage < 1 || colorPerPage < 1) {
    return Response.json({ error: "Prices must be positive integers." }, { status: 400 });
  }

  try {
    const [inserted] = await db
      .insert(pricingConfig)
      .values({
        bwPerPage: Math.round(bwPerPage),
        colorPerPage: Math.round(colorPerPage),
        billingBasis: billingBasis ?? "per_sheet",
        minOrderAmount: minOrderAmount ? Math.round(minOrderAmount) : 2,
        createdBy: admin,
      })
      .returning();

    return Response.json({ ok: true, config: inserted });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

