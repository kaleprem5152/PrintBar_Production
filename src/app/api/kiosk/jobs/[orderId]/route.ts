/**
 * GET  /api/kiosk/jobs/[orderId]  — Poll job status (kiosk polling during printing)
 * POST /api/kiosk/jobs/[orderId]  — Start or resume printing from kiosk touchscreen
 */
import { findByOrderId, toPublic, getKioskState, updateOrderStatus } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const o = await findByOrderId(orderId);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(toPublic(o, false));
}

export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const o = await findByOrderId(orderId);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });

  const printerState = await getKioskState();
  if (printerState !== "ready") {
    return Response.json({ error: printerState }, { status: 409 });
  }

  // Handle Demo/simulation order (simulated printer advance)
  if (o.isDemo) {
    o.status = "printing";
    o.printStartedAt = new Date();
    o.failureReason = null;
    o.updatedAt = new Date();
    await updateOrderStatus(o.orderId, "printing");
    return Response.json(toPublic(o, false));
  }

  // Real order flow: Customer tapped "Print" at kiosk
  const updated = await updateOrderStatus(o.orderId, "queued");
  return Response.json(toPublic(updated ?? o, false));
}
