import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { useMarkerStore } from '../markers/marker-store'
import { syncMarkerOverlay } from '../markers/sync-marker-overlay'
import { syncTrackingOverlay } from '../tracking/sync-tracking-overlay'
import { useTrackingStore } from '../tracking/tracking-store'
import type { BasemapId } from '../../lib/map-config'

type UseMapOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Keeps tracking and marker overlays synchronized with the current map style.
 */
export function useMapOverlays(options: UseMapOverlaysOptions): void {
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const breadcrumbsVisible = useLayerVisibilityStore((state) => state.breadcrumbsVisible)
  const markerTypeVisibility = useLayerVisibilityStore((state) => state.markerTypeVisibility)
  const hiddenMarkerIds = useLayerVisibilityStore((state) => state.hiddenMarkerIds)
  const markerState = useMarkerStore((state) => state.markers)

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncTrackingOverlay(map, trackingSnapshot, hiddenDeviceIds, breadcrumbsVisible)
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)

    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [options.activeBasemapId, options.mapRef, breadcrumbsVisible, hiddenDeviceIds, trackingSnapshot])

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      void syncMarkerOverlay(map, markerState, markerTypeVisibility, hiddenMarkerIds)
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)

    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [hiddenMarkerIds, markerState, markerTypeVisibility, options.activeBasemapId, options.mapRef])
}
