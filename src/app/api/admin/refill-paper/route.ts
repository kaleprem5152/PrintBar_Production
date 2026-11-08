import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { logAuditEvent } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId = "PB-K01", printer, amount = 250 } = (await req.json().catch(() => ({}))) as {
    deviceId?: string;
    printer?: "kyocera" | "canon" | "both";
    amount?: number;
  };

  if (!printer || !["kyocera", "canon", "both"].includes(printer)) {
    return Response.json({ error: "printer must be 'kyocera', 'canon', or 'both'" }, { status: 400 });
  }

  try {
    const [current] = await db.select().from(devices).where(eq(devices.id, deviceId));
    if (!current) {
      return Response.json({ error: `Device ${deviceId} not found` }, { status: 404 });
    }

    let newKyocera = current.kyoceraPaper ?? 0;
    let newCanon = current.canonPaper ?? 0;

    if (printer === "kyocera" || printer === "both") {
      newKyocera += amount;
    }
    if (printer === "canon" || printer === "both") {
      newCanon += amount;
    }

    const paperReady = newKyocera > 0 || newCanon > 0;

    const [updated] = await db
      .update(devices)
      .set({
        kyoceraPaper: newKyocera,
        canonPaper:   newCanon,
        paperReady,
        updatedAt:    new Date(),
      })
      .where(eq(devices.id, deviceId))
      .returning();

    // Also update printers table
    try {
      const { printers } = await import("@/db/schema");
      const allPrinters = await db.select().from(printers);
      for (const prn of allPrinters) {
        const isCanon = prn.supportsColor || prn.id.toLowerCase().includes("canon") || prn.model.toLowerCase().includes("canon") || prn.name.toLowerCase().includes("colour") || prn.name.toLowerCase().includes("color");
        if ((isCanon && (printer === "canon" || printer === "both")) || (!isCanon && (printer === "kyocera" || printer === "both"))) {
          await db.update(printers).set({
            paperRemaining: (prn.paperRemaining ?? 0) + amount,
            paperSource: "manual",
          }).where(eq(printers.id, prn.id));
        }
      }
    } catch {
      // non-blocking
    }

    await logAuditEvent({
      eventType: "admin_action",
      deviceId,
      actorId: admin,
      details: {
        action: "paper_refill",
        printer,
        amountAdded: amount,
        kyoceraPaper: newKyocera,
        canonPaper: newCanon,
      },
    });

    return Response.json({
      ok: true,
      deviceId,
      kyoceraPaper: updated.kyoceraPaper,
      canonPaper:   updated.canonPaper,
      paperReady:   updated.paperReady,
      message: `Successfully refilled ${amount} sheets to ${printer}. Current Kyocera: ${updated.kyoceraPaper}, Canon: ${updated.canonPaper}.`,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

