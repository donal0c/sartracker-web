export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  await navigator.serviceWorker.register('/sw.js')
}
