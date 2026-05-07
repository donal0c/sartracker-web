import { useEffect, useState } from 'react'

import { getBasemapById, type BasemapId } from '../../lib/map-config'
import {
  describeOfflineMapReadiness,
  type OfflineMapReadiness,
} from './offline-map-readiness'

type ServiceWorkerNavigator = Navigator & {
  readonly serviceWorker?: ServiceWorkerContainer
}

/**
 * Reads browser runtime support for viewed-tile offline map reuse.
 */
export function useOfflineMapReadiness(activeBasemapId: BasemapId): OfflineMapReadiness {
  const [readiness, setReadiness] = useState(() => readOfflineMapReadiness(activeBasemapId))

  useEffect(() => {
    let cancelled = false

    function updateReadiness(): void {
      if (!cancelled) {
        setReadiness(readOfflineMapReadiness(activeBasemapId))
      }
    }

    updateReadiness()

    window.addEventListener('online', updateReadiness)
    window.addEventListener('offline', updateReadiness)

    const serviceWorker = (navigator as ServiceWorkerNavigator).serviceWorker
    serviceWorker?.addEventListener('controllerchange', updateReadiness)
    void serviceWorker?.ready.then(updateReadiness).catch(() => updateReadiness())

    return () => {
      cancelled = true
      window.removeEventListener('online', updateReadiness)
      window.removeEventListener('offline', updateReadiness)
      serviceWorker?.removeEventListener('controllerchange', updateReadiness)
    }
  }, [activeBasemapId])

  return readiness
}

/**
 * Converts browser service-worker/cache support into operator-facing map readiness.
 */
function readOfflineMapReadiness(activeBasemapId: BasemapId): OfflineMapReadiness {
  const serviceWorker = (navigator as ServiceWorkerNavigator).serviceWorker

  return describeOfflineMapReadiness({
    basemapLabel: getBasemapById(activeBasemapId).label,
    cacheStorageSupported: 'caches' in window,
    online: navigator.onLine,
    serviceWorkerReady: serviceWorker?.controller !== null && serviceWorker?.controller !== undefined,
    serviceWorkerSupported: serviceWorker !== undefined,
  })
}
