import type { Metadata } from "next";
import { DemoClient } from "@/components/site/DemoClient";

export const metadata: Metadata = { title: "Prototype demo — PrintBar" };

export default function DemoPage() {
  return <DemoClient />;
}
