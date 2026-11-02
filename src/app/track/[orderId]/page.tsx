import type { Metadata } from "next";
import { OrderView } from "@/components/print/OrderView";

export const metadata: Metadata = { title: "Your print job — PrintBar" };

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ k?: string; new?: string; embed?: string }>;
}) {
  const { orderId } = await params;
  const sp = await searchParams;
  return <OrderView orderId={orderId} token={sp.k ?? ""} isNew={sp.new === "1"} embed={sp.embed === "1"} />;
}
