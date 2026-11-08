import "server-only";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { sweepOldFiles } from "@/lib/server/files";

export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await sweepOldFiles();
    return Response.json({ ok: true, sweptFilesCount: outcome.swept });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

