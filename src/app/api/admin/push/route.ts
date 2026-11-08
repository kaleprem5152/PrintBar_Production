import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { ApiError, audit, route, str } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Web Push registration. Subscriptions are stored per admin, but delivery requires the backend to be configured with
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ a web-push sender). Until then the UI reports push as "not active".
 */
export const GET = route(null, async ({ user }) => {
  const [{ n }] = await db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  return {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    backendConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    deviceCount: n,
  };
});

export const POST = route(null, async ({ user, ip, body, req }) => {
  if (!process.env.VAPID_PUBLIC_KEY) throw new ApiError(503, "Push is not configured on the backend (VAPID keys missing)");
  const b = await body();
  const sub = b.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  const endpoint = str(sub?.endpoint, "endpoint", { max: 1000 });
  const p256dh = str(sub?.keys?.p256dh, "p256dh", { max: 300 });
  const auth = str(sub?.keys?.auth, "auth", { max: 100 });
  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint, p256dh, auth, userAgent: req.headers.get("user-agent")?.slice(0, 200) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh, auth } });
  await audit({ user, ip }, "push.subscribe", "user", user.id);
  return { ok: true, message: "This device is registered for push" };
});

export const DELETE = route(null, async ({ user, ip, body }) => {
  const b = await body();
  const endpoint = str(b.endpoint, "endpoint", { max: 1000 });
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
  await audit({ user, ip }, "push.unsubscribe", "user", user.id);
  return { ok: true };
});
