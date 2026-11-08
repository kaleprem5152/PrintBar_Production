import { db } from "@/db";
import { devices, pricingConfig } from "@/db/schema";
import { DEVICE_ID, HARDWARE, PRICING } from "@/lib/config";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  let pricing: {
    bw: number;
    color: number;
    currency: string;
    symbol: string;
    billingBasis: string;
    minOrderAmount: number;
  } = {
    bw:             PRICING.bw,
    color:          PRICING.color,
    currency:       PRICING.currency,
    symbol:         PRICING.symbol,
    billingBasis:   "per_sheet",
    minOrderAmount: 2,
  };

  let paper = {
    kyocera:         250,
    canon:           250,
    ready:           true,
    outOfPaper:      false,
    maintenanceMode: false,
  };

  try {
    const [latest] = await db
      .select()
      .from(pricingConfig)
      .orderBy(desc(pricingConfig.createdAt))
      .limit(1);

    if (latest) {
      pricing = {
        bw:             latest.bwPerPage,
        color:          latest.colorPerPage,
        currency:       latest.currency,
        symbol:         "₹",
        billingBasis:   latest.billingBasis,
        minOrderAmount: latest.minOrderAmount,
      };
    }

    const [dev] = await db.select().from(devices).where(eq(devices.id, DEVICE_ID)).limit(1);
    if (dev) {
      const kyoceraPaper = dev.kyoceraPaper ?? 250;
      const canonPaper = dev.canonPaper ?? 250;
      const ready = dev.paperReady && (kyoceraPaper > 0 || canonPaper > 0);
      paper = {
        kyocera:         kyoceraPaper,
        canon:           canonPaper,
        ready:           ready,
        outOfPaper:      !ready,
        maintenanceMode: dev.maintenanceMode ?? false,
      };
    }
  } catch (err) {
    console.warn("[config] DB fetch warning:", (err as Error).message);
  }

  return Response.json({
    pricing,
    hardware: HARDWARE,
    paper,
  });
}
