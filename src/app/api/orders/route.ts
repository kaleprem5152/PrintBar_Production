import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, type OrderDoc } from "@/db/schema";
import { HARDWARE } from "@/lib/config";
import { buildQuote } from "@/lib/pricing";
import { ensureSeed, newOrderRef } from "@/lib/server/orders";
import { readMeta, type FileMeta } from "@/lib/server/files";

export const dynamic = "force-dynamic";

type Body = {
  docs?: { id: string; name: string; size: number; pages: number; range?: string | null; estimated?: boolean; kind?: string }[];
  copies?: number;
  colorMode?: string;
  paperSize?: string;
  sides?: string;
  orientation?: string;
};

export async function POST(req: Request) {
  await ensureSeed();
  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.docs?.length || b.docs.length > HARDWARE.maxFiles) {
    return Response.json({ error: "Add at least one document." }, { status: 400 });
  }
  const copies = Math.floor(Number(b.copies));
  if (!(copies >= 1 && copies <= 99)) return Response.json({ error: "Copies must be between 1 and 99." }, { status: 400 });
  const colorMode = b.colorMode === "color" ? "color" : b.colorMode === "bw" ? "bw" : null;
  if (!colorMode) return Response.json({ error: "Choose a colour mode." }, { status: 400 });
  const paperSize = b.paperSize ?? "A4";
  const sides = b.sides ?? "single";
  const orientation = b.orientation ?? "portrait";
  if (!HARDWARE.paperSizes.includes(paperSize)) return Response.json({ error: "Paper size not supported by this kiosk." }, { status: 400 });
  if (!HARDWARE.sides.includes(sides)) return Response.json({ error: "Printing sides option not supported." }, { status: 400 });
  if (!HARDWARE.orientations.includes(orientation)) return Response.json({ error: "Orientation not supported." }, { status: 400 });

  // Page counts come from the server's own upload record (never from the client), and the
  // total and amount are always computed here.
  const metas: FileMeta[] = [];
  for (const d of b.docs) {
    const meta = await readMeta(d.id);
    if (!meta) {
      return Response.json({ error: `${d.name} is no longer available. Please upload it again.` }, { status: 409 });
    }
    metas.push(meta);
  }
  const quote = buildQuote(
    b.docs.map((d, i) => ({ name: metas[i].name, pages: metas[i].pages, range: d.range ?? null })),
    copies,
    colorMode,
  );
  if (quote.error || quote.pagesPerCopy < 1) {
    return Response.json({ error: quote.error ?? "Select at least one page." }, { status: 400 });
  }

  const docs: OrderDoc[] = b.docs.map((d, i) => ({
    id: d.id,
    name: metas[i].name,
    size: metas[i].size,
    pages: metas[i].pages,
    selected: quote.lines[i].selected,
    range: d.range?.trim() ? d.range.trim() : null,
    estimated: metas[i].estimated,
    kind: metas[i].kind,
  }));

  const token = randomBytes(12).toString("hex");
  const [row] = await db
    .insert(orders)
    .values({
      orderId: `TMP-${randomBytes(6).toString("hex")}`,
      token,
      status: "pending_payment",
      docs,
      pagesPerCopy: quote.pagesPerCopy,
      copies,
      colorMode,
      paperSize,
      sides,
      orientation,
      amount: quote.amount,
      pagesToPrint: quote.totalPages,
    })
    .returning();
  const orderId = newOrderRef(row.id);
  await db.update(orders).set({ orderId }).where(eq(orders.id, row.id));

  return Response.json({ orderId, token, amount: quote.amount, quote });
}
