import { ApiError, audit, oneOf, route } from "@/lib/api";
import { clearDemo, loadDemo } from "@/lib/seed";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const POST = route("users.manage", async ({ user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["load", "clear"] as const);
  if (b.confirm !== true) throw new ApiError(400, "Confirmation required");
  if (action === "clear") {
    await clearDemo();
    await setSetting("demo_seeded", true);
    await audit({ user, ip }, "demo.clear", "system", "demo");
    return { ok: true, message: "All fleet, job, payment and inventory data removed. Admin accounts, pricing and audit history were kept." };
  }
  await loadDemo();
  await audit({ user, ip }, "demo.load", "system", "demo");
  return { ok: true, message: "Demo dataset loaded (replaces existing operational data)." };
});
