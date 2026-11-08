/* PrintBar Admin service worker — installability, offline notice and Web Push display.
   API responses are never cached (operational data must be live). */
const OFFLINE_HTML = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<body style="font-family:system-ui;background:#0b1220;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><h1 style="font-size:20px">You're offline</h1><p style="color:#94a3b8">PrintBar Admin needs a connection to show live kiosk data. Reconnect and try again.</p>
<button onclick="location.reload()" style="margin-top:12px;padding:12px 20px;border-radius:10px;border:0;background:#2563eb;color:#fff;font-size:16px">Retry</button></div></body>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "content-type": "text/html" } })));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "PrintBar", body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "PrintBar alert", {
      body: data.body || "",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      tag: data.tag || "printbar",
      data: { url: data.url || "/admin/notifications?tab=alerts" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
