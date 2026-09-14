/**
 * Registers the tile-caching service worker when the browser supports it.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) {
    return
  }

  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (error) {
    console.warn('Service worker registration failed.', error)
  }
}
