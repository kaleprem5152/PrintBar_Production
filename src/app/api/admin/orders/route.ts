import { desc } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));

  try {
    const list = await db
      .select({
        id:            orders.id,
        orderId:       orders.orderId,
        status:        orders.status,
        colorMode:     orders.colorMode,
        pagesToPrint:  orders.pagesToPrint,
        pagesPrinted:  orders.pagesPrinted,
        copies:        orders.copies,
        amount:        orders.amount,
        pin:           orders.pin,
        deviceId:      orders.deviceId,
        printerUsed:   orders.printerUsed,
        failureReason: orders.failureReason,
        paidAt:        orders.paidAt,
        completedAt:   orders.completedAt,
        createdAt:     orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.id))
      .limit(limit);

    return Response.json({ orders: list });
  } catch (err) {
    console.error("[admin orders] error:", err);
    return Response.json({ error: "Failed to load orders." }, { status: 500 });
  }
}
