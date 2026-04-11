import type maplibregl from 'maplibre-gl'

/**
 * Runs a map overlay sync immediately when the style is ready and again on
 * style/idle transitions so late-arriving mission data is not dropped during
 * initial map boot.
 */
export function registerMapStyleSync(
  map: maplibregl.Map,
  synchronize: () => void,
): () => void {
  let retryTimer: number | null = null

  const runIfReady = () => {
    if (!map.isStyleLoaded()) {
      if (retryTimer === null) {
        retryTimer = window.setTimeout(() => {
          retryTimer = null
          runIfReady()
        }, 50)
      }
      return
    }

    synchronize()
  }

  runIfReady()
  map.on('styledata', runIfReady)
  map.on('idle', runIfReady)

  return () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
    }
    map.off('styledata', runIfReady)
    map.off('idle', runIfReady)
  }
}
