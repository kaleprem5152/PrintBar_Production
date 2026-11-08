import type { Metadata } from "next";
import { Workspace } from "@/components/print/Workspace";
import { DEVICE_ID, HARDWARE, PRICING } from "@/lib/config";
import { db } from "@/db";
import { devices, pricingConfig } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Start printing — PrintBar" };
export const dynamic = "force-dynamic";

export default async function PrintPage() {
  let bw: number = PRICING.bw;
  let color: number = PRICING.color;
  let billingBasis: "per_sheet" | "per_side" = "per_sheet";
  let minOrderAmount = 2;

  let outOfPaper = false;
  let paperReady = true;
  let maintenanceMode = false;

  try {
    const [latest] = await db
      .select()
      .from(pricingConfig)
      .orderBy(desc(pricingConfig.createdAt))
      .limit(1);
    if (latest) {
      bw = latest.bwPerPage;
      color = latest.colorPerPage;
      billingBasis = (latest.billingBasis as "per_sheet" | "per_side") ?? "per_sheet";
      minOrderAmount = latest.minOrderAmount;
    }

    const [dev] = await db.select().from(devices).where(eq(devices.id, DEVICE_ID)).limit(1);
    if (dev) {
      maintenanceMode = dev.maintenanceMode ?? false;
      const totalPaper = (dev.kyoceraPaper ?? 0) + (dev.canonPaper ?? 0);
      paperReady = dev.paperReady && totalPaper > 0;
      outOfPaper = !paperReady;
    }
  } catch {
    // Fallback to defaults
  }

  return (
    <Workspace
      cfg={{
        pricing: { bw, color, billingBasis, minOrderAmount },
        hardware: HARDWARE,
        paper: { outOfPaper, paperReady, maintenanceMode },
      }}
    />
  );
}
