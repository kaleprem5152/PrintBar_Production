import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { ensureSeed } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeed();

  try {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.isActive, true))
      .orderBy(asc(devices.id));

    if (rows.length > 0) {
      const now = Date.now();
      const kiosks = rows.map((d) => {
        let state = "ready";
        const isStale = d.lastHeartbeat
          ? now - new Date(d.lastHeartbeat).getTime() > 120_000
          : false;

        if (d.maintenanceMode || isStale) {
          state = "offline";
        } else if (d.kyoceraReady === false && d.canonReady === false) {
          state = "error";
        }

        return {
          id: d.id,
          name: d.name,
          location: d.location,
          state,
        };
      });

      return Response.json({ kiosks });
    }
  } catch {
    /* fallback to default kiosks */
  }

  return Response.json({
    kiosks: [
      { id: "PB-K01", name: "PrintBar Kiosk 01", location: "Central Library · Ground floor", state: "ready" },
      { id: "PB-K02", name: "PrintBar Kiosk 02", location: "Engineering Block · Lobby", state: "ready" },
      { id: "PB-K03", name: "PrintBar Kiosk 03", location: "Student Centre · Level 1", state: "ready" },
    ],
  });
}
