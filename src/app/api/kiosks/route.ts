import { asc } from "drizzle-orm";
import { db } from "@/db";
import { kiosks } from "@/db/schema";
import { ensureSeed } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeed();
  const rows = await db.select().from(kiosks).orderBy(asc(kiosks.id));
  return Response.json({ kiosks: rows.map((k) => ({ id: k.id, name: k.name, location: k.location, state: k.state })) });
}
