import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useGpxStore } from '../gpx/gpx-store'
import { syncGpxOverlay } from '../gpx/sync-gpx-overlay'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import type { BasemapId } from '../../lib/map-config'
import { registerMapStyleSync } from './map-style-sync'

type UseMapGpxOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}

/**
 * Keeps GPX overlays synchronized with the current style and layer visibility.
 */
export function useMapGpxOverlays(options: UseMapGpxOverlaysOptions): void {
  const imports = useGpxStore((state) => state.imports)
  const hiddenImportIds = useLayerVisibilityStore((state) => state.hiddenGpxImportIds)

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncGpxOverlay(map, imports, hiddenImportIds)
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [hiddenImportIds, imports, options.activeBasemapId, options.mapReadyVersion, options.mapRef])
}
