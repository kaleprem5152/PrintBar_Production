import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { kiosks, printers } from "@/db/schema";
import { ApiError, audit, oneOf, route } from "@/lib/api";
import { enqueueCommand } from "@/lib/commands";
import { getStaleMs, kioskView } from "@/lib/live";

export const dynamic = "force-dynamic";

export const POST = route(null, async ({ user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["pause_all", "resume_all", "maintenance_on", "maintenance_off", "test_all", "check_connectivity"] as const);
  const need = { pause_all: "printers.control", resume_all: "printers.control", test_all: "printers.control", maintenance_on: "kiosks.control", maintenance_off: "kiosks.control", check_connectivity: "kiosks.view" }[action];
  if (!user.permissions.includes(need as never)) throw new ApiError(403, "You don't have permission to do this");
  if ((action === "pause_all" || action === "maintenance_on") && b.confirm !== true) throw new ApiError(400, "This action requires confirmation");
  const ks = await db.select().from(kiosks).where(eq(kiosks.enabled, true));

  if (action === "check_connectivity") {
    const stale = await getStaleMs();
    const v = ks.map((k) => kioskView(k, stale));
    return { ok: true, message: `${v.filter((k) => k.online).length}/${v.length} kiosks reporting heartbeats`, kiosks: v.map((k) => ({ id: k.id, name: k.name, online: k.online, lastHeartbeat: k.lastHeartbeat })) };
  }
  if (action === "test_all") {
    const ps = await db.select().from(printers).where(and(eq(printers.enabled, true)));
    let queued = 0;
    for (const p of ps) {
      const r = await enqueueCommand({ kioskId: p.kioskId, printerId: p.id, command: "test_print", by: user.name });
      if (!r.duplicate) queued++;
    }
    await audit({ user, ip }, "quick.test_all", "printer", "*", { queued });
    return { ok: true, message: `${queued} test print command(s) queued. Results appear in each printer's command history once agents report back.` };
  }
  const patch =
    action === "pause_all" ? { printingPaused: true }
    : action === "resume_all" ? { printingPaused: false }
    : action === "maintenance_on" ? { maintenance: true }
    : { maintenance: false };
  await db.update(kiosks).set(patch).where(eq(kiosks.enabled, true));
  await audit({ user, ip }, `quick.${action}`, "kiosk", "*", { kiosks: ks.length });
  return { ok: true, message: `Applied to ${ks.length} enabled kiosk(s). Agents and the customer app pick it up on their next sync.` };
});
