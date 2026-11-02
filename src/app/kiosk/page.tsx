import type { Metadata } from "next";
import { FitStage } from "@/components/kiosk/FitStage";
import { KioskApp } from "@/components/kiosk/KioskApp";

export const metadata: Metadata = { title: "PrintBar Kiosk" };

export default function KioskPage() {
  return (
    <FitStage>
      <KioskApp />
    </FitStage>
  );
}
