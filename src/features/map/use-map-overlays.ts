import { useEffect, useRef, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import {
  getEffectiveMarkerTypeVisibility,
  getEffectiveTrackingVisible,
} from '../layers/effective-overlay-visibility'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { useMarkerStore } from '../markers/marker-store'
import { syncMarkerOverlay } from '../markers/sync-marker-overlay'
import { useMissionStore } from '../mission/mission-store'
import { syncTrackingOverlay } from '../tracking/sync-tracking-overlay'
import { buildTrackingInitialExtent } from '../tracking/tracking-viewport'
import { useTrackingStore } from '../tracking/tracking-store'
import type { BasemapId } from '../../lib/map-config'
import { registerMapStyleSync } from './map-style-sync'

type UseMapOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}

const TRACKING_INITIAL_FIT_PADDING_PX = 64
const TRACKING_INITIAL_FIT_MAX_ZOOM = 16
const TRACKING_INITIAL_FIT_DURATION_MS = 0

/**
 * Keeps tracking and marker overlays synchronized with the current map style.
 */
export function useMapOverlays(options: UseMapOverlaysOptions): void {
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const groupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const breadcrumbsVisible = useLayerVisibilityStore((state) => state.breadcrumbsVisible)
  const markerTypeVisibility = useLayerVisibilityStore((state) => state.markerTypeVisibility)
  const hiddenMarkerIds = useLayerVisibilityStore((state) => state.hiddenMarkerIds)
  const markerState = useMarkerStore((state) => state.markers)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionInitialFitRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncTrackingOverlay(
        map,
        getEffectiveTrackingVisible(groupVisibility) ? trackingSnapshot : emptyTrackingSnapshot(),
        hiddenDeviceIds,
        getEffectiveTrackingVisible(groupVisibility) && breadcrumbsVisible,
      )

      if (missionId === null) {
        return
      }

      if (missionInitialFitRef.current[missionId]) {
        return
      }

      const extent = buildTrackingInitialExtent(trackingSnapshot)
      if (extent === null) {
        return
      }

      map.fitBounds(extent, {
        padding: TRACKING_INITIAL_FIT_PADDING_PX,
        maxZoom: TRACKING_INITIAL_FIT_MAX_ZOOM,
        duration: TRACKING_INITIAL_FIT_DURATION_MS,
      })
      missionInitialFitRef.current[missionId] = true
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
    breadcrumbsVisible,
    groupVisibility,
    hiddenDeviceIds,
    missionId,
    trackingSnapshot,
  ])

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      void syncMarkerOverlay(
        map,
        markerState,
        getEffectiveMarkerTypeVisibility(groupVisibility, markerTypeVisibility),
        hiddenMarkerIds,
      )
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    groupVisibility,
    hiddenMarkerIds,
    markerState,
    markerTypeVisibility,
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
  ])
}

/**
 * Returns an empty snapshot so hidden tracking groups remove devices and breadcrumbs from the map.
 */
function emptyTrackingSnapshot(): ReturnType<typeof useTrackingStore.getState>['snapshot'] {
  return {
    devices: [],
    positions: [],
    breadcrumbs: [],
  }
}
