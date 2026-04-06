/**
 * Service Worker for SAR Tracker tile caching.
 *
 * Strategy: Network-first with cache fallback for tile requests.
 * Non-tile requests pass through normally.
 */

const CACHE_NAME = 'sartracker-tiles-v1';

// Tile URL patterns we want to intercept and cache
const TILE_PATTERNS = [
  /tile\.opentopomap\.org/,
  /services\.arcgisonline\.com.*MapServer\/tile/,
  /tile\.openstreetmap\.org/,
];

function isTileRequest(url) {
  return TILE_PATTERNS.some((pattern) => pattern.test(url));
}

self.addEventListener('install', (event) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept tile requests
  if (!isTileRequest(request.url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // Network first
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
          // Cache a clone (response can only be consumed once)
          cache.put(request, networkResponse.clone());
          return networkResponse;
        }
      } catch {
        // Network failed — try cache
      }

      // Fall back to cache
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;

      // Nothing in cache either — return a transparent 1x1 PNG placeholder
      return new Response(
        Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0)),
        { headers: { 'Content-Type': 'image/png' } }
      );
    })()
  );
});
