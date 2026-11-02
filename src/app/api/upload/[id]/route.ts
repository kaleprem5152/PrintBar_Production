import { deleteStoredFiles } from "@/lib/server/files";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteStoredFiles([id]);
  return Response.json({ ok: true });
}
