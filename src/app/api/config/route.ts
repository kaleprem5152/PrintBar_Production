import { HARDWARE, PRICING } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ pricing: PRICING, hardware: HARDWARE });
}
