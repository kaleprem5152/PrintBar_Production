import type { Metadata } from "next";
import { Workspace } from "@/components/print/Workspace";
import { HARDWARE, PRICING } from "@/lib/config";

export const metadata: Metadata = { title: "Start printing — PrintBar" };

export default function PrintPage() {
  // Pricing and hardware capabilities come from the backend configuration.
  return <Workspace cfg={{ pricing: { bw: PRICING.bw, color: PRICING.color }, hardware: HARDWARE }} />;
}
