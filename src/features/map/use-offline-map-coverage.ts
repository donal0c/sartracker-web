import { useCallback, useMemo, useState, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import {
  getBasemapById,
  getRenderableMapLabel,
  isOfficialMapId,
  type RenderableMapId,
} from '../../lib/map-config'
import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import {
  MAP_TILE_CACHE_NAME,
  buildOfflineCoverageTileUrls,
  createCheckingOfflineMapCoverage,
  createErroredOfflineMapCoverage,
  createUnavailableOfflineMapCoverage,
  createUncheckedOfflineMapCoverage,
  describeOfficialOfflineMapCoverage,
  describeOfflineMapCoverage,
  type OfflineMapCoverage,
  type OfflineMapCoverageBounds,
} from './offline-map-coverage'

type CacheStorageWindow = Window & {
  readonly caches?: CacheStorage
}

type OfflineMapCoverageState = {
  readonly basemapId: RenderableMapId
  readonly coverage: OfflineMapCoverage
}

export type OfflineMapCoverageController = {
  readonly coverage: OfflineMapCoverage
  readonly checkCurrentViewCoverage: () => Promise<void>
}

/**
 * Provides an operator-triggered preflight check for visible offline tile coverage.
 */
export function useOfflineMapCoverage(
  activeBasemapId: RenderableMapId,
  mapRef: RefObject<maplibregl.Map | null>,
): OfflineMapCoverageController {
  const uncheckedCoverage = useMemo(() => createUncheckedOfflineMapCoverage(), [])
  const [coverageState, setCoverageState] = useState<OfflineMapCoverageState>(() => ({
    basemapId: activeBasemapId,
    coverage: uncheckedCoverage,
  }))
  const coverage =
    coverageState.basemapId === activeBasemapId ? coverageState.coverage : uncheckedCoverage

  const checkCurrentViewCoverage = useCallback(async () => {
    const map = mapRef.current

    if (isOfficialMapId(activeBasemapId)) {
      await checkOfficialMapCoverage(activeBasemapId, map, setCoverageState)
      return
    }

    const cacheStorage = (window as CacheStorageWindow).caches

    if (map === null) {
      setCoverageState({
        basemapId: activeBasemapId,
        coverage: createUnavailableOfflineMapCoverage('Map is not ready yet.'),
      })
      return
    }

    if (cacheStorage === undefined) {
      setCoverageState({
        basemapId: activeBasemapId,
        coverage: createUnavailableOfflineMapCoverage(
          'This browser cannot inspect cached map tiles.',
        ),
      })
      return
    }

    setCoverageState({
      basemapId: activeBasemapId,
      coverage: createCheckingOfflineMapCoverage(),
    })

    try {
      const basemap = getBasemapById(activeBasemapId)
      const zoom = Math.min(basemap.maxZoom, Math.max(0, Math.floor(map.getZoom())))
      const tileUrls = buildOfflineCoverageTileUrls(activeBasemapId, readMapBounds(map), zoom)
      const cache = await cacheStorage.open(MAP_TILE_CACHE_NAME)
      const cachedTiles = await countCachedTiles(cache, tileUrls)

      setCoverageState({
        basemapId: activeBasemapId,
        coverage: describeOfflineMapCoverage({
          basemapLabel: basemap.label,
          cachedTiles,
          totalTiles: tileUrls.length,
          zoom,
        }),
      })
    } catch {
      setCoverageState({
        basemapId: activeBasemapId,
        coverage: createErroredOfflineMapCoverage(),
      })
    }
  }, [activeBasemapId, mapRef])

  return {
    coverage,
    checkCurrentViewCoverage,
  }
}

async function checkOfficialMapCoverage(
  activeBasemapId: RenderableMapId,
  map: maplibregl.Map | null,
  setCoverageState: (state: OfflineMapCoverageState) => void,
): Promise<void> {
  if (map === null) {
    setCoverageState({
      basemapId: activeBasemapId,
      coverage: createUnavailableOfflineMapCoverage('Map is not ready yet.'),
    })
    return
  }

  setCoverageState({
    basemapId: activeBasemapId,
    coverage: createCheckingOfflineMapCoverage(),
  })

  try {
    const settings = await loadAppSettings()
    const packageForMap = settings.officialMaps.packages.find(
      (mapPackage) => mapPackage.mapId === activeBasemapId,
    )
    const readyPackage = settings.officialMaps.packages.find(
      (mapPackage) => mapPackage.mapId === activeBasemapId && mapPackage.status === 'ready',
    )

    if (readyPackage?.bounds !== null && readyPackage?.bounds !== undefined) {
      setCoverageState({
        basemapId: activeBasemapId,
        coverage: describeOfficialOfflineMapCoverage({
          basemapLabel: getRenderableMapLabel(activeBasemapId),
          packageBounds: readyPackage.bounds,
          viewBounds: readMapBounds(map),
          zoom: Math.max(0, Math.floor(map.getZoom())),
        }),
      })
      return
    }

    setCoverageState({
      basemapId: activeBasemapId,
      coverage: createUnavailableOfflineMapCoverage(
        describeUnavailableOfficialCoverage(activeBasemapId, packageForMap?.status),
      ),
    })
  } catch {
    setCoverageState({
      basemapId: activeBasemapId,
      coverage: createErroredOfflineMapCoverage(),
    })
  }
}

function describeUnavailableOfficialCoverage(
  activeBasemapId: RenderableMapId,
  packageStatus: string | undefined,
): string {
  const label = getRenderableMapLabel(activeBasemapId)
  if (packageStatus === 'missing') {
    return `${label}: the registered official map package is missing.`
  }
  if (packageStatus === 'invalid') {
    return `${label}: the registered official map package is unreadable.`
  }
  return `${label}: no ready official offline package is registered.`
}

/**
 * Reads the current MapLibre viewport bounds into a serializable coverage model.
 */
function readMapBounds(map: maplibregl.Map): OfflineMapCoverageBounds {
  const bounds = map.getBounds()

  return {
    east: bounds.getEast(),
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    west: bounds.getWest(),
  }
}

/**
 * Counts how many expected tile URLs are already present in the tile cache.
 */
async function countCachedTiles(cache: Cache, tileUrls: readonly string[]): Promise<number> {
  const matches = await Promise.all(tileUrls.map((tileUrl) => cache.match(tileUrl)))

  return matches.filter((match) => match !== undefined).length
}
