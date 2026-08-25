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
import {
  isCoverageOverlayAttached,
  syncCoverageOverlay,
} from '../tracking/sync-coverage-overlay'
import {
  selectCoverageChunkKeys,
  useCoverageFilterStore,
} from '../tracking/coverage-filter-store'
import { selectCoverageCatalogForMission } from '../tracking/mission-coverage-scope'
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
  const coverageController = useCoverageStore((state) => state.controller)
  const omittedCoverageDeviceIds = useCoverageFilterStore((state) => state.omittedDeviceIds)
  const omittedCoveragePeriodKeys = useCoverageFilterStore((state) => state.omittedPeriodKeys)
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
    const synchronizeOverlay = async (signal: AbortSignal) => {
      const catalog = selectCoverageCatalogForMission(coverageState, missionId)
      let activation: Awaited<ReturnType<typeof syncCoverageOverlay>> | null = null
      try {
        if (
          catalog !== null &&
          coverageController !== null &&
          !isCoverageOverlayAttached(map, catalog)
        ) {
          coverageController.notifyRendererDetached(catalog)
        }
        activation = await syncCoverageOverlay(map, catalog, {
          omittedDeviceIds: omittedCoverageDeviceIds,
          omittedPeriodKeys: omittedCoveragePeriodKeys,
        }, signal)
        const manifest = coverageState.status !== 'inactive' &&
          coverageState.missionId === missionId
          ? coverageState.manifest
          : null
        await coverageController?.notifySelectionApplied(selectCoverageChunkKeys(manifest, {
          omittedDeviceIds: omittedCoverageDeviceIds,
          omittedPeriodKeys: omittedCoveragePeriodKeys,
        }))
        if (catalog === null || coverageController === null) {
          activation.commit()
          activation.finalize()
        } else {
          await coverageController.notifyCatalogApplied(catalog, activation)
        }
      } catch (error) {
        activation?.rollback()
        if (error instanceof Error && error.name === 'AbortError') return
        const period = catalog?.periods[0]
        if (period !== undefined && catalog !== null) {
          coverageController?.notifyRendererFailure({
            missionId: catalog.missionId,
            periodKey: period.periodKey,
            revisionDigest: period.revisionDigest,
            message: 'Coverage map source activation failed.',
          })
        }
        throw error
      }
    }
    return registerMapStyleSync(map, synchronizeOverlay, {
      onStyleUnavailable: () => {
        coverageController?.notifyRendererDetached()
      },
    })
  }, [
    coverageState,
    coverageController,
    omittedCoverageDeviceIds,
    omittedCoveragePeriodKeys,
    missionId,
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
