/* public/sw.js — minimal service worker for the installed app.
 *
 * Scope is deliberately narrow. This is a live dashboard: plate counts, poll
 * results and attendance are only useful when current, so nothing from the API
 * is ever cached. Serving a stale meal count would be worse than showing an
 * error. What it does do:
 *
 *   1. Satisfies the install criteria (a fetch handler must exist).
 *   2. Pre-caches the app shell so an installed launch isn't a blank screen.
 *   3. Shows an offline fallback for page navigations instead of the
 *      browser's dinosaur, which looks broken in a standalone window.
 */
// Namespaced per product — bump this to force old caches out.
const VERSION = "chefo-booking-v1";
const SHELL = `${VERSION}-shell`;

// Only static, versioned assets — never an API response.
const SHELL_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // Individual failures must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic — always straight to the network so the
  // dashboard can't show yesterday's numbers.
  if (url.pathname.startsWith("/api/")) return;

  // Page loads: network first, cache only as an offline fallback.
  // `cache: "no-store"` bypasses the browser's OWN HTTP cache too, not just
  // this service worker's Cache Storage — without it, a plain fetch() can
  // still be silently satisfied from the browser's http cache even though
  // this handler "always" runs, and the same staleness bug just moves one
  // layer down instead of actually going away.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          new Response(
            `<!doctype html><meta charset="utf-8">
             <meta name="viewport" content="width=device-width,initial-scale=1">
             <title>Chefo Booking — offline</title>
             <style>
               body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
                    font-family:system-ui,sans-serif;background:#f6f7f5;color:#1c2520;padding:24px}
               .b{max-width:340px;text-align:center}
               h1{font-size:19px;margin:0 0 8px}
               p{font-size:14px;line-height:1.6;color:#5b6660;margin:0 0 18px}
               button{font:inherit;font-weight:600;background:#206e4e;color:#fff;border:0;
                      border-radius:8px;padding:10px 18px;cursor:pointer}
             </style>
             <div class="b">
               <h1>You're offline</h1>
               <p>Chefo Booking needs a connection to show live counts and bookings. Reconnect and try again.</p>
               <button onclick="location.reload()">Retry</button>
             </div>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
          )
        )
    );
    return;
  }

  // Static build assets: network first, same as navigations. This app is
  // under active development on `next dev`, where chunk filenames are NOT
  // guaranteed content-hashed the way a production build's are — a
  // cache-first rule here kept serving whatever a device first cached,
  // silently hiding every code change made since. Cache is now only ever a
  // fallback for genuinely being offline, never the default.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});

/* -------------------------------------------------------------------------
 * Web Push (VAPID) — the backend sends a JSON-stringified
 * {title, body, icon, badge, vibrate, data:{url}} payload (see
 * services/pushService.js). Clicking the notification focuses an existing
 * Chefo tab if one's open, otherwise opens data.url in a new one.
 * ------------------------------------------------------------------------- */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "Chefo", body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Chefo", {
      body: payload.body || "",
      icon: payload.icon || "/icons/icon-192.png",
      badge: payload.badge || "/icons/icon-192.png",
      vibrate: payload.vibrate,
      data: payload.data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
