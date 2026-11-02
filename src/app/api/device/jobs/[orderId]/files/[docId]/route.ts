/**
 * GET /api/device/jobs/[orderId]/files/[docId]
 *
 * Secure document download endpoint for the Raspberry Pi hardware agent.
 * Requires device HMAC-SHA256 authentication.
 * Only permits downloading files for orders assigned to this device.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { authenticateDevice } from "@/lib/server/device-auth";
import { getStoredFile } from "@/lib/server/files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orderId: string; docId: string }> };

const MIME_MAP: Record<string, string> = {
  pdf:  "application/pdf",
  doc:  "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
};

export async function GET(req: Request, ctx: Params) {
  const auth = await authenticateDevice(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  const { orderId, docId } = await ctx.params;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderId, orderId), eq(orders.deviceId, auth.deviceId!)));

  if (!order) {
    return Response.json({ error: "Order not found or not assigned to this device." }, { status: 404 });
  }

  // Validate that docId belongs to this order
  const orderDocs = order.docs as { id: string; name: string }[];
  const docMeta = orderDocs.find((d) => d.id === docId);
  if (!docMeta) {
    return Response.json({ error: "Document not found in order." }, { status: 404 });
  }

  const stored = await getStoredFile(docId);
  if (!stored) {
    return Response.json({ error: "Document file no longer available on server." }, { status: 410 });
  }

  const mimeType = MIME_MAP[stored.ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(stored.buffer), {
    status: 200,
    headers: {
      "Content-Type":        mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(stored.meta.name)}"`,
      "Content-Length":       String(stored.buffer.length),
      "Cache-Control":       "no-store, no-cache, must-revalidate",
    },
  });
}
