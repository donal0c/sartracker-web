import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import type { BasemapId } from '../../lib/map-config'
import { useMeasurementStore } from '../measurements/measurement-store'
import {
  syncMeasurementOverlay,
  syncMeasurementPreviewOverlay,
} from '../measurements/sync-measurement-overlay'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'

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
  const measurementsVisible = useLayerVisibilityStore((state) => state.measurementsVisible)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncMeasurementOverlay(map, measurementsVisible ? measurements : [])
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)
    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [measurements, measurementsVisible, options.activeBasemapId, options.mapRef])

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
