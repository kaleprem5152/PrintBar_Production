/**
 * GET  /api/kiosk/jobs/[orderId]  — Poll job status (kiosk polling during printing)
 * POST /api/kiosk/jobs/[orderId]  — Start or resume printing from kiosk touchscreen
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { findByOrderId, toPublic, getKioskState } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const o = await findByOrderId(orderId);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(toPublic(o, false));
}

export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: "start" | "resume" };

  const [o] = await db.select().from(orders).where(eq(orders.orderId, orderId));
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });

  const printerState = await getKioskState();
  if (printerState !== "ready") {
    return Response.json({ error: printerState }, { status: 409 });
  }

  // Handle Demo order (simulated printer)
  if (o.isDemo) {
    const now = new Date();
    const [updated] = await db
      .update(orders)
      .set({
        status:         "printing",
        printStartedAt: now,
        failureReason:  null,
        updatedAt:      now,
      })
      .where(eq(orders.id, o.id))
      .returning();

    return Response.json(toPublic(updated, false));
  }

  // Real order flow: Customer tapped "Print" at kiosk
  // Transition to "queued" so Raspberry Pi agent claims it
  const [updated] = await db
    .update(orders)
    .set({
      status:        "queued",
      failureReason: null,
      updatedAt:     new Date(),
    })
    .where(eq(orders.id, o.id))
    .returning();

  return Response.json(toPublic(updated, false));
}
