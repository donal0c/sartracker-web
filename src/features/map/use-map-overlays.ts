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
import { useExactBreadcrumbDotStore } from '../tracking/exact-breadcrumb-dot-store'
import { useTrackingStylePreferences } from '../tracking/tracking-style-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { useCoverageStore } from '../tracking/coverage-store'
import {
  isCoverageOverlayAttached,
  selectCoverageOverlaySyncInputs,
  syncCoverageOverlay,
} from '../tracking/sync-coverage-overlay'
import {
  selectCoverageChunkKeys,
  useCoverageFilterStore,
} from '../tracking/coverage-filter-store'
import type { RenderableMapId } from '../../lib/map-config'
import type { CoverageManifest } from '../../infrastructure/mission-store/tauri-mission-store'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { registerMapOverlaySync } from './register-map-overlay-sync'
import { clearTrackingVisibleOnMap, reportTrackingVisibleOnMap } from './tracking-visibility-report'

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
  const trackingStyle = useTrackingStylePreferences()
  const exactBreadcrumbDotState = useExactBreadcrumbDotStore((state) => state.state)
  const attentionByDevice = useStationaryAttentionStore((state) => state.byDevice)
  const coverageState = useCoverageStore((state) => state.state)
  const coverageController = useCoverageStore((state) => state.controller)
  const omittedCoverageDeviceIds = useCoverageFilterStore((state) => state.omittedDeviceIds)
  const omittedCoveragePeriodKeys = useCoverageFilterStore((state) => state.omittedPeriodKeys)
  // Only the catalog and the selected keys decide what the map draws; other
  // coverage churn must not restart an in-flight source load [DON-338 REN-3].
  const coverageSyncInputs = selectCoverageOverlaySyncInputs(coverageState, missionId, {
    omittedDeviceIds: omittedCoverageDeviceIds,
    omittedPeriodKeys: omittedCoveragePeriodKeys,
  })
  const coverageCatalog = coverageSyncInputs.catalog
  const coverageSelectionSignature = coverageSyncInputs.selectionSignature
  const latestCoverageManifest = useRef<CoverageManifest | null>(null)
  useEffect(() => {
    latestCoverageManifest.current = coverageState.status !== 'inactive' &&
      coverageState.missionId === missionId
      ? coverageState.manifest
      : null
  }, [coverageState, missionId])

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      const trackingVisible = getEffectiveTrackingVisible(groupVisibility)
      syncTrackingOverlay(
        map,
        trackingVisible ? trackingSnapshot : EMPTY_TRACKING_SNAPSHOT,
        hiddenDeviceIds,
        hiddenBreadcrumbDeviceIds,
        trackingVisible && breadcrumbsVisible,
        trackingStyle,
        exactBreadcrumbDotState,
        attentionByDevice,
      )
      reportTrackingVisibleOnMap(trackingVisible)
    }

    const unregister = registerMapOverlaySync(map, 'tracking', 'tracking', synchronizeOverlay)
    return () => {
      unregister()
      clearTrackingVisibleOnMap()
    }
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
    trackingSnapshot,
    attentionByDevice,
  ])

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) return
    const catalog = coverageCatalog
    const synchronizeOverlay = async (signal: AbortSignal) => {
      const manifest = latestCoverageManifest.current
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
            ...(catalog.activationId === undefined
              ? {}
              : { activationId: catalog.activationId }),
            message: 'Coverage map source activation failed.',
          })
        }
        throw error
      }
    }
    return registerMapOverlaySync(map, 'coverage', 'coverage', synchronizeOverlay, {
      onStyleUnavailable: () => {
        coverageController?.notifyRendererDetached()
      },
    })
  }, [
    coverageCatalog,
    coverageSelectionSignature,
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

    return registerMapOverlaySync(map, 'markers', 'markers', synchronizeOverlay)
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
