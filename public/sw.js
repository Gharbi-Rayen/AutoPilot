// Minimal service worker — makes the app installable as a PWA.
// No offline caching of API calls (the app requires the server to function).
// Static assets are served normally by the browser cache.

const CACHE_NAME = "autopilot-static-v1";

// Cache only the shell assets that never change between sessions.
const PRECACHE_URLS = ["/workflows", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Remove old cache versions
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls, Inngest, or tRPC — always go to network.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/trpc/") ||
    url.pathname.startsWith("/monitoring")
  ) {
    return;
  }

  // For navigation requests: network-first, fall back to cache.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }

  // For everything else: network-first (standard behaviour).
});
