import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { pricingVersions } from "@/db/schema";
import { DEFAULT_PRICING, type PricingConfig } from "@/lib/quote";

export async function getActivePricing(): Promise<PricingConfig & { id: number; createdAt: Date; publishedBy: string | null }> {
  const [row] = await db.select().from(pricingVersions).where(eq(pricingVersions.active, true)).orderBy(desc(pricingVersions.id)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(pricingVersions)
    .values({ ...DEFAULT_PRICING, active: true, note: "Default pricing", publishedBy: "System" })
    .returning();
  return created;
}
