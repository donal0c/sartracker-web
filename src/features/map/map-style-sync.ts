import type maplibregl from 'maplibre-gl'

const INITIAL_RETRY_DELAY_MS = 50
const MAX_RETRY_DELAY_MS = 2_000

/**
 * Runs a map overlay sync as soon as the style structure can accept app-owned
 * sources and layers, without waiting for slow or unavailable basemap tiles.
 * Repeats on style/idle transitions so late mission data and basemap changes
 * cannot drop operational overlays.
 */
export function registerMapStyleSync(
  map: maplibregl.Map,
  synchronize: () => void,
): () => void {
  let retryTimer: number | null = null
  let retryDelayMs = INITIAL_RETRY_DELAY_MS

  const clearRetry = () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    retryDelayMs = INITIAL_RETRY_DELAY_MS
  }

  const scheduleRetry = () => {
    if (retryTimer !== null) {
      return
    }
    const delayMs = retryDelayMs
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS)
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      runIfReady()
    }, delayMs)
  }

  const runIfReady = () => {
    if (!hasStyleStructure(map)) {
      scheduleRetry()
      return
    }

    try {
      synchronize()
      clearRetry()
    } catch (error) {
      console.error('Map overlay synchronization failed; retrying.', error)
      scheduleRetry()
    }
  }

  map.on('style.load', runIfReady)
  map.on('idle', runIfReady)
  runIfReady()

  return () => {
    clearRetry()
    map.off('style.load', runIfReady)
    map.off('idle', runIfReady)
  }
}

/** Returns true once the current style has created at least one base layer. */
function hasStyleStructure(map: maplibregl.Map): boolean {
  try {
    return (map.getStyle().layers?.length ?? 0) > 0
  } catch {
    return false
  }
}
