import { describe, expect, it } from 'vitest'

import { describeOfflineMapReadiness } from '../../src/features/map/offline-map-readiness'

describe('offline map readiness', () => {
  it('marks offline tiles unavailable when service workers are unsupported', () => {
    expect(
      describeOfflineMapReadiness({
        basemapLabel: 'OpenTopoMap',
        cacheStorageSupported: true,
        online: true,
        serviceWorkerReady: false,
        serviceWorkerSupported: false,
      }),
    ).toEqual({
      detail: 'This browser cannot cache map tiles for field use.',
      label: 'Offline tiles unavailable',
      status: 'unavailable',
      tone: 'danger',
    })
  })

  it('marks offline tiles unavailable when cache storage is unsupported', () => {
    expect(
      describeOfflineMapReadiness({
        basemapLabel: 'OpenTopoMap',
        cacheStorageSupported: false,
        online: true,
        serviceWorkerReady: true,
        serviceWorkerSupported: true,
      }),
    ).toEqual({
      detail: 'This browser cannot cache map tiles for field use.',
      label: 'Offline tiles unavailable',
      status: 'unavailable',
      tone: 'danger',
    })
  })

  it('marks the cache as arming while the service worker is not controlling the app', () => {
    expect(
      describeOfflineMapReadiness({
        basemapLabel: 'OpenTopoMap',
        cacheStorageSupported: true,
        online: true,
        serviceWorkerReady: false,
        serviceWorkerSupported: true,
      }),
    ).toEqual({
      detail: 'Keep network available until the tile cache worker controls the app.',
      label: 'Offline tiles arming',
      status: 'limited',
      tone: 'warning',
    })
  })

  it('reports viewed-tile caching as ready while online', () => {
    expect(
      describeOfflineMapReadiness({
        basemapLabel: 'OpenTopoMap',
        cacheStorageSupported: true,
        online: true,
        serviceWorkerReady: true,
        serviceWorkerSupported: true,
      }),
    ).toEqual({
      detail: 'OpenTopoMap: tiles viewed now are available offline.',
      label: 'Viewed tiles cache ready',
      status: 'ready',
      tone: 'success',
    })
  })

  it('reports the explicit viewed-tiles-only failure mode while offline', () => {
    expect(
      describeOfflineMapReadiness({
        basemapLabel: 'OpenTopoMap',
        cacheStorageSupported: true,
        online: false,
        serviceWorkerReady: true,
        serviceWorkerSupported: true,
      }),
    ).toEqual({
      detail: 'OpenTopoMap: unviewed tiles may be blank or degraded.',
      label: 'Offline: viewed tiles only',
      status: 'limited',
      tone: 'warning',
    })
  })
})
