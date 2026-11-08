import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { connectivityEvents, deviceCommands, kioskLogs, kiosks, printers } from "@/db/schema";
import { ApiError, audit, oneOf, route, str } from "@/lib/api";
import { COMMAND_LABELS, enqueueCommand } from "@/lib/commands";
import { getStaleMs, kioskView, printerView } from "@/lib/live";
import { computeUptime } from "@/lib/uptime";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>("kiosks.view", async ({ params }) => {
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, params.id));
  if (!k) throw new ApiError(404, "Kiosk not found");
  const kv = kioskView(k, await getStaleMs());
  const ps = await db.select().from(printers).where(eq(printers.kioskId, k.id)).orderBy(printers.priority);
  const events = await db.select().from(connectivityEvents).where(eq(connectivityEvents.kioskId, k.id)).orderBy(desc(connectivityEvents.createdAt)).limit(30);
  const logs = await db.select().from(kioskLogs).where(eq(kioskLogs.kioskId, k.id)).orderBy(desc(kioskLogs.createdAt)).limit(60);
  const commands = await db.select().from(deviceCommands).where(eq(deviceCommands.kioskId, k.id)).orderBy(desc(deviceCommands.createdAt)).limit(20);
  const up = await computeUptime(new Date(Date.now() - 30 * 86400_000), new Date());
  return { kiosk: kv, printers: ps.map((p) => printerView(p, kv.online)), events, logs, commands, uptime30d: up.perKiosk[k.id] ?? null };
});

export const PATCH = route<{ id: string }>(["kiosks.configure", "kiosks.control"], async ({ params, user, ip, body }) => {
  const b = await body();
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, params.id));
  if (!k) throw new ApiError(404, "Kiosk not found");
  const patch: Partial<typeof kiosks.$inferInsert> = {};
  const can = (p: string) => user.permissions.includes(p as never);
  if (b.enabled !== undefined) {
    if (!can("kiosks.configure")) throw new ApiError(403, "Requires kiosk configuration permission");
    if (b.enabled === false && b.confirm !== true) throw new ApiError(400, "Disabling a kiosk requires confirmation");
    patch.enabled = !!b.enabled;
  }
  if (b.maintenance !== undefined) {
    if (!can("kiosks.control")) throw new ApiError(403, "Requires kiosk control permission");
    if (b.maintenance === true && b.confirm !== true) throw new ApiError(400, "Maintenance mode requires confirmation");
    patch.maintenance = !!b.maintenance;
  }
  if (b.printingPaused !== undefined) {
    if (!can("kiosks.control")) throw new ApiError(403, "Requires kiosk control permission");
    patch.printingPaused = !!b.printingPaused;
  }
  if (b.name !== undefined || b.location !== undefined) {
    if (!can("kiosks.configure")) throw new ApiError(403, "Requires kiosk configuration permission");
    if (b.name !== undefined) patch.name = str(b.name, "Name", { max: 60 });
    if (b.location !== undefined) patch.location = str(b.location, "Location", { max: 120 });
  }
  if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to update");
  await db.update(kiosks).set(patch).where(eq(kiosks.id, k.id));
  await audit({ user, ip }, "kiosk.config", "kiosk", k.id, { to: patch });
  return { ok: true, message: "Saved. The kiosk agent and customer app read this state from the backend — it applies on their next sync." };
});

export const POST = route<{ id: string }>("kiosks.control", async ({ params, user, ip, body }) => {
  const b = await body();
  const command = oneOf(b.command, "command", ["restart_agent", "restart_print_service", "run_diagnostics", "fetch_logs"] as const);
  if ((command === "restart_agent" || command === "restart_print_service") && b.confirm !== true) throw new ApiError(400, "This action requires confirmation");
  const [k] = await db.select().from(kiosks).where(eq(kiosks.id, params.id));
  if (!k) throw new ApiError(404, "Kiosk not found");
  const { duplicate } = await enqueueCommand({ kioskId: k.id, command, by: user.name });
  await audit({ user, ip }, "kiosk.command", "kiosk", k.id, { command, duplicate });
  return {
    ok: true,
    message: duplicate
      ? "The same command is already queued for this kiosk."
      : `${COMMAND_LABELS[command]} queued. It is delivered when the kiosk agent next polls the backend${kioskView(k).online ? "" : " — the kiosk is currently OFFLINE, so it will wait until it reconnects"}.`,
  };
});
