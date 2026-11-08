import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { ApiError, audit, oneOf, route, str } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>("alerts.manage", async ({ params, user, ip, body }) => {
  const b = await body();
  const id = Number(params.id);
  const action = oneOf(b.action, "action", ["acknowledge", "resolve", "reopen"] as const);
  const [a] = await db.select().from(alerts).where(eq(alerts.id, id));
  if (!a) throw new ApiError(404, "Alert not found");
  const now = new Date();
  if (action === "acknowledge") {
    if (a.status !== "open") throw new ApiError(409, `Alert is already ${a.status}`);
    await db.update(alerts).set({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: user.name }).where(eq(alerts.id, id));
  } else if (action === "resolve") {
    if (a.status === "resolved") throw new ApiError(409, "Alert is already resolved");
    const note = str(b.note, "Resolution note", { optional: true, max: 200 });
    await db.update(alerts).set({ status: "resolved", resolvedAt: now, resolvedBy: user.name, resolutionNote: note || null, acknowledgedAt: a.acknowledgedAt ?? now, acknowledgedBy: a.acknowledgedBy ?? user.name }).where(eq(alerts.id, id));
  } else {
    if (a.status !== "resolved") throw new ApiError(409, "Only resolved alerts can be reopened");
    await db.update(alerts).set({ status: "open", resolvedAt: null, resolvedBy: null, resolutionNote: null }).where(eq(alerts.id, id));
  }
  await audit({ user, ip }, `alert.${action}`, "alert", id, { type: a.type, printer: a.printerId, kiosk: a.kioskId });
  return {
    ok: true,
    message: action === "resolve" ? "Marked resolved. If the hardware condition persists, the next agent report will raise it again." : action === "acknowledge" ? "Acknowledged" : "Reopened",
  };
});
