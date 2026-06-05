import { describe, expect, it } from 'vitest'

import {
  describeOfflineMapReadiness,
  describeOfficialMapReadiness,
} from '../../src/features/map/offline-map-readiness'
import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

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

  it('reports official offline map ready from a registered package', () => {
    expect(
      describeOfficialMapReadiness({
        activeMapId: 'official_discovery_topo',
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/reeks.mbtiles',
              status: 'ready',
              bounds: [-10.25, 51.85, -9.45, 52.35],
              minZoom: 8,
              maxZoom: 16,
              tileCount: 31_729,
              tileFormat: 'png',
              createdAt: '2026-06-05T10:00:00.000Z',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official Discovery Topo package is ready.',
            },
          ],
        },
      }),
    ).toEqual({
      detail: 'Discovery Topo: local official package ready for z8-z16. Use Check View before relying on a specific area.',
      label: 'Official offline map ready',
      status: 'ready',
      tone: 'success',
    })
  })

  it('reports official map package missing and unreadable states', () => {
    expect(
      describeOfficialMapReadiness({
        activeMapId: 'official_discovery_topo',
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/reeks.mbtiles',
              status: 'missing',
              bounds: null,
              minZoom: null,
              maxZoom: null,
              tileCount: 0,
              tileFormat: '',
              createdAt: '',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official map package file was not found.',
            },
          ],
        },
      }),
    ).toEqual({
      detail: 'Discovery Topo: the registered local package cannot be found. Reconnect or replace the local map package.',
      label: 'Official map package missing',
      status: 'unavailable',
      tone: 'danger',
    })

    expect(
      describeOfficialMapReadiness({
        activeMapId: 'official_discovery_topo',
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/reeks.mbtiles',
              status: 'invalid',
              bounds: null,
              minZoom: null,
              maxZoom: null,
              tileCount: 0,
              tileFormat: '',
              createdAt: '',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official map package could not be read as MBTiles.',
            },
          ],
        },
      }),
    ).toEqual({
      detail: 'Discovery Topo: the registered local package is unreadable. Recheck the MBTiles package before field use.',
      label: 'Official map package unreadable',
      status: 'unavailable',
      tone: 'danger',
    })
  })

  it('reports online official source, unavailable official maps, and public fallback only states', () => {
    expect(
      describeOfficialMapReadiness({
        activeMapId: 'official_discovery_topo',
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          sourceType: 'mapgenie_file',
          status: 'configured',
          availableSources: ['official_discovery_topo'],
          serviceCount: 1,
        },
      }),
    ).toEqual({
      detail: 'Discovery Topo: online MapGenie source is configured, but no local offline package is ready.',
      label: 'Official online source configured',
      status: 'limited',
      tone: 'warning',
    })

    expect(
      describeOfficialMapReadiness({
        activeMapId: 'official_discovery_topo',
        officialMaps: DEFAULT_APP_SETTINGS.officialMaps,
      }),
    ).toEqual({
      detail: 'Discovery Topo: no local official package or online official source is configured.',
      label: 'Official maps unavailable',
      status: 'unavailable',
      tone: 'danger',
    })

    expect(
      describeOfficialMapReadiness({
        activeMapId: 'opentopomap',
        officialMaps: DEFAULT_APP_SETTINGS.officialMaps,
      }),
    ).toEqual({
      detail: 'OpenTopoMap is a public fallback map. Licensed official map packages are not active for this view.',
      label: 'Public fallback only',
      status: 'limited',
      tone: 'neutral',
    })
  })
})
