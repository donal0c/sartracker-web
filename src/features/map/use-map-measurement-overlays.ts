import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import type { BasemapId } from '../../lib/map-config'
import { useMeasurementStore } from '../measurements/measurement-store'
import {
  syncMeasurementOverlay,
  syncMeasurementPreviewOverlay,
} from '../measurements/sync-measurement-overlay'

type UseMapMeasurementOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Keeps completed and in-progress measurement overlays synchronized with the map.
 */
export function useMapMeasurementOverlays(
  options: UseMapMeasurementOverlaysOptions,
): void {
  const measurements = useMeasurementStore((state) => state.measurements)
  const draftStart = useMeasurementStore((state) => state.draftStart)
  const hoverPoint = useMeasurementStore((state) => state.hoverPoint)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncMeasurementOverlay(map, measurements)
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)
    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [measurements, options.activeBasemapId, options.mapRef])

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const synchronizePreview = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncMeasurementPreviewOverlay(map, {
        draftStart,
        hoverPoint,
      })
    }

    synchronizePreview()
    map.on('styledata', synchronizePreview)
    return () => {
      map.off('styledata', synchronizePreview)
    }
  }, [draftStart, hoverPoint, options.activeBasemapId, options.mapRef])
}
