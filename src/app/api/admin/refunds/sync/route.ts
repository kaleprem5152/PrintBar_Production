import "server-only";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { syncPendingRefunds } from "@/lib/server/refunds";

export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncPendingRefunds();
    return Response.json({ ok: true, syncedCount: results.synced, details: results });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

