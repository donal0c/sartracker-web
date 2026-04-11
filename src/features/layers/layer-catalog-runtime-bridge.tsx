import { useEffect } from 'react'

import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useHelicopterStore } from '../helicopters/helicopter-store'
import { createTauriLayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { useMarkerStore } from '../markers/marker-store'
import { useMissionStore } from '../mission/mission-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { applyLayerCatalogController, applyLayerCatalogRuntime, useLayerCatalogStore } from './layer-catalog-store'
import { useLayerVisibilityStore } from './layer-visibility-store'
import { startLayerCatalogRuntime } from './start-layer-catalog-runtime'

/**
 * Starts the layer catalog runtime and keeps mission-scoped catalog metadata
 * aligned with the current tracking, marker, and drawing snapshots.
 */
export function LayerCatalogRuntimeBridge() {
  const controller = useLayerCatalogStore((state) => state.controller)
  const root = useLayerCatalogStore((state) => state.root)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const devices = useTrackingStore((state) => state.snapshot.devices)
  const markers = useMarkerStore((state) => state.markers)
  const drawings = useDrawingStore((state) => state.drawings)
  const helicopters = useHelicopterStore((state) => state.helicopters)
  const gpxImports = useGpxStore((state) => state.imports)
  const hydrateCatalogVisibility = useLayerVisibilityStore(
    (state) => state.hydrateCatalogVisibility,
  )

  useEffect(() => {
    if (controller !== null) {
      return
    }

    let cancelled = false
    void startLayerCatalogRuntime({
      layerCatalogStore: createTauriLayerCatalogStore(),
      applyRuntime: applyLayerCatalogRuntime,
    }).then((nextController) => {
      if (!cancelled) {
        applyLayerCatalogController(nextController)
      }
    })

    return () => {
      cancelled = true
    }
  }, [controller])

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshCatalog({
      missionId,
      devices,
      markers,
      drawings,
      helicopters,
      gpxImports,
    })
  }, [controller, devices, drawings, gpxImports, helicopters, markers, missionId])

  useEffect(() => {
    hydrateCatalogVisibility(missionId, root)
  }, [hydrateCatalogVisibility, missionId, root])

  return null
}
