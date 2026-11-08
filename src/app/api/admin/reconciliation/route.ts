import "server-only";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { reconcilePendingOrders } from "@/lib/server/reconciliation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await reconcilePendingOrders();
    return Response.json({
      ok: true,
      ...outcome,
    });
  } catch (err) {
    console.error("[reconciliation] Job execution failed:", err);
    return Response.json(
      { error: "Reconciliation failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}

