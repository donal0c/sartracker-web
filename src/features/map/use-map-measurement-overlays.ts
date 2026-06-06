import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import type { RenderableMapId } from '../../lib/map-config'
import { getEffectiveMeasurementsVisible } from '../layers/effective-overlay-visibility'
import { useMeasurementStore } from '../measurements/measurement-store'
import {
  syncMeasurementOverlay,
  syncMeasurementPreviewOverlay,
} from '../measurements/sync-measurement-overlay'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { registerMapStyleSync } from './map-style-sync'

type UseMapMeasurementOverlaysOptions = {
  readonly activeBasemapId: RenderableMapId
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
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
  const groupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const measurementsVisible = useLayerVisibilityStore((state) => state.measurementsVisible)
  const hiddenMeasurementIds = useLayerVisibilityStore((state) => state.hiddenMeasurementIds)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncMeasurementOverlay(
        map,
        getEffectiveMeasurementsVisible(groupVisibility, measurementsVisible) ? measurements : [],
        hiddenMeasurementIds,
      )
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    groupVisibility,
    hiddenMeasurementIds,
    measurements,
    measurementsVisible,
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
  ])

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
        draftStart: getEffectiveMeasurementsVisible(groupVisibility, measurementsVisible)
          ? draftStart
          : null,
        hoverPoint: getEffectiveMeasurementsVisible(groupVisibility, measurementsVisible)
          ? hoverPoint
          : null,
      })
    }

    return registerMapStyleSync(map, synchronizePreview)
  }, [
    draftStart,
    groupVisibility,
    hoverPoint,
    measurementsVisible,
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
  ])
}
