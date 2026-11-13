/* PLOT TWIST! service worker
 * What works offline (after one online visit): every screen, saves (localStorage),
 * all art and fonts. What needs internet: nothing yet. Future AI features will.
 * Strategy: precache the app routes + their JS/CSS; cache-first for static files;
 * network-first for pages, falling back to the cached copy when offline.
 * Bump VERSION to force clients to refresh their cache.
 */
const VERSION = "plot-twist-v0.2.1";
const ROUTES = ["/", "/worlds", "/studio", "/builder", "/play", "/load"];
const STATIC = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(STATIC);
  const assets = new Set();
  for (const route of ROUTES) {
    try {
      const res = await fetch(route, { cache: "no-store" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(route, res);
      // Paths can contain route groups like "(game)", so parentheses are allowed.
      for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\]+/g)) assets.add(m[0].replace(/\)+$/, (p) => (m[0].includes("(") ? p : "")));
      for (const m of html.matchAll(/\/assets\/[^"'\s)\\]+\.png/g)) assets.add(m[0]);
    } catch {
      /* skip routes that fail; they'll be cached on first visit */
    }
  }
  await Promise.all([...assets].map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, cached copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // Static files (hashed JS/CSS, fonts, art, icons): cache first.
  if (/^\/(_next\/static|assets|icons)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Next.js RSC/prefetch requests: network, then cache.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || Response.error()),
  );
});
