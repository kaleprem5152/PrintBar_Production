import { listRecentOrders } from "@/lib/server/orders";
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
    const list = await listRecentOrders(limit);
    return Response.json({ orders: list });
  } catch (err) {
    console.error("[admin orders] error:", err);
    return Response.json({ error: "Failed to load orders." }, { status: 500 });
  }
}
