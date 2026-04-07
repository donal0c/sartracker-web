const CACHE_NAME = 'sartracker-map-tiles-v1'
const TILE_HOSTS = new Set([
  'tile.opentopomap.org',
  'services.arcgisonline.com',
  'tile.openstreetmap.org',
])

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || !TILE_HOSTS.has(url.hostname)) {
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) {
        return cached
      }

      try {
        const response = await fetch(request)
        if (response.ok) {
          await cache.put(request, response.clone())
        }
        return response
      } catch (error) {
        const fallback = await cache.match(request, { ignoreSearch: true })
        if (fallback) {
          return fallback
        }

        throw error
      }
    }),
  )
})
