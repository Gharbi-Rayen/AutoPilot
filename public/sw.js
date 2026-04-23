/**
 * AutoPilot Service Worker — Full Offline Support
 *
 * Strategy:
 * - App shell (HTML pages, JS, CSS, fonts, icons): Cache-first
 * - Navigation requests: App-shell fallback when offline
 * - Everything else: Network-first with cache fallback
 *
 * No server API calls are made by the offline PWA, so no API bypass needed.
 */

const CACHE_VERSION = "autopilot-v4";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = [
  "/",
  "/workflows/",
  "/workflows/editor/",
  "/executions/",
  "/executions/detail/",
  "/manifest.json",
  "/logos/logo.svg",
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(SHELL_URLS).catch((err) => {
          console.warn("[SW] Shell precache partial failure:", err);
        }),
      )
      .then(() => self.skipWaiting()),
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests → try network, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then(
            (cached) =>
              cached ??
              caches
                .match("/workflows/")
                .then((shell) => shell ?? caches.match("/")),
          ),
      ),
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images, workers) → cache-first
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/logos/") ||
    url.pathname.startsWith("/workers/") ||
    url.pathname === "/pdf.worker.min.mjs" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".mjs") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff2");

  if (isStaticAsset) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const network = await fetch(request);
        if (network.ok) cache.put(request, network.clone());
        return network;
      }),
    );
    return;
  }

  // Everything else → network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          // Clone synchronously before any async gap; the original is returned below
          const cloned = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached ?? new Response("", { status: 504, statusText: "Offline" })),
      ),
  );
});
