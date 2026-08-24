import { useEffect, useMemo, type RefObject } from 'react'
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
import { useActiveMissionDevicesStore } from '../tracking/active-mission-devices-store'
import { useExactBreadcrumbDotStore } from '../tracking/exact-breadcrumb-dot-store'
import { selectMissionTrackingSnapshot } from '../tracking/mission-active-tracking'
import { useTrackingStylePreferences } from '../tracking/tracking-style-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { useCoverageStore } from '../tracking/coverage-store'
import { syncCoverageOverlay } from '../tracking/sync-coverage-overlay'
import type { RenderableMapId } from '../../lib/map-config'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { registerMapStyleSync } from './map-style-sync'

type UseMapOverlaysOptions = {
  readonly activeBasemapId: RenderableMapId
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}

const EMPTY_TRACKING_SNAPSHOT: ReturnType<typeof useTrackingStore.getState>['snapshot'] = {
  devices: [],
  positions: [],
  breadcrumbs: [],
}

/**
 * Keeps tracking and marker overlays synchronized with the current map style.
 */
export function useMapOverlays(options: UseMapOverlaysOptions): void {
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const groupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const hiddenBreadcrumbDeviceIds = useLayerVisibilityStore((state) => state.hiddenBreadcrumbDeviceIds)
  const breadcrumbsVisible = useLayerVisibilityStore((state) => state.breadcrumbsVisible)
  const markerTypeVisibility = useLayerVisibilityStore((state) => state.markerTypeVisibility)
  const hiddenMarkerIds = useLayerVisibilityStore((state) => state.hiddenMarkerIds)
  const markerState = useMarkerStore((state) => state.markers)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const activeDeviceIds = useActiveMissionDevicesStore((state) => state.getActiveDeviceIds(missionId))
  const trackingStyle = useTrackingStylePreferences()
  const exactBreadcrumbDotState = useExactBreadcrumbDotStore((state) => state.state)
  const attentionByDevice = useStationaryAttentionStore((state) => state.byDevice)
  const coverageState = useCoverageStore((state) => state.state)
  const missionTrackingSnapshot = useMemo(
    () => selectMissionTrackingSnapshot(trackingSnapshot, activeDeviceIds),
    [activeDeviceIds, trackingSnapshot],
  )

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      syncTrackingOverlay(
        map,
        getEffectiveTrackingVisible(groupVisibility) ? missionTrackingSnapshot : EMPTY_TRACKING_SNAPSHOT,
        hiddenDeviceIds,
        hiddenBreadcrumbDeviceIds,
        getEffectiveTrackingVisible(groupVisibility) && breadcrumbsVisible,
        trackingStyle,
        exactBreadcrumbDotState,
        attentionByDevice,
      )
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
    breadcrumbsVisible,
    groupVisibility,
    hiddenBreadcrumbDeviceIds,
    hiddenDeviceIds,
    trackingStyle,
    exactBreadcrumbDotState,
    missionTrackingSnapshot,
    attentionByDevice,
  ])

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) return
    const synchronizeOverlay = () => {
      syncCoverageOverlay(
        map,
        coverageState.status === 'inactive' ? null : coverageState.tileCatalog,
      )
    }
    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    coverageState,
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
  ])

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = (signal: AbortSignal) => {
      return syncMarkerOverlay(
        map,
        markerState,
        getEffectiveMarkerTypeVisibility(groupVisibility, markerTypeVisibility),
        hiddenMarkerIds,
        signal,
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
