/**
 * Registers the tile-caching service worker when the browser supports it.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (error) {
    console.warn('Service worker registration failed.', error)
  }
}
