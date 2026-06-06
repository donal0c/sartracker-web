import { useEffect } from 'react'

import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useHelicopterStore } from '../helicopters/helicopter-store'
import { useMeasurementStore } from '../measurements/measurement-store'
import { createTauriLayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { createElectronLayerCatalogStore } from '../../infrastructure/layer-catalog-store/electron-layer-catalog-store'
import { getBrowserHarnessLayerCatalogStore } from '../browser-validation/browser-harness-layer-catalog-store'
import { useMarkerStore } from '../markers/marker-store'
import { shouldEnableMissionBrowserHarness } from '../mission/mission-browser-harness'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { useMissionStore } from '../mission/mission-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { applyLayerCatalogController, applyLayerCatalogRuntime, useLayerCatalogStore } from './layer-catalog-store'
import { startLayerCatalogRuntime } from './start-layer-catalog-runtime'

/**
 * Starts the layer catalog runtime and keeps mission-scoped catalog metadata
 * aligned with the current tracking, marker, and drawing snapshots.
 *
 * Picks the layer-catalog store at mount time based on whether the browser
 * harness is active so harness mode never invokes Tauri IPC for catalog
 * persistence.
 */
export function LayerCatalogRuntimeBridge() {
  const controller = useLayerCatalogStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const devices = useTrackingStore((state) => state.snapshot.devices)
  const markers = useMarkerStore((state) => state.markers)
  const drawings = useDrawingStore((state) => state.drawings)
  const helicopters = useHelicopterStore((state) => state.helicopters)
  const gpxImports = useGpxStore((state) => state.imports)
  const measurements = useMeasurementStore((state) => state.measurements)

  useEffect(() => {
    if (controller !== null) {
      return
    }

    let cancelled = false
    const layerCatalogStore = shouldEnableMissionBrowserHarness()
      ? getBrowserHarnessLayerCatalogStore()
      : isElectronRuntimeAvailable()
        ? createElectronLayerCatalogStore()
        : createTauriLayerCatalogStore()

    void startLayerCatalogRuntime({
      layerCatalogStore,
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
      measurements,
    })
  }, [controller, devices, drawings, gpxImports, helicopters, markers, measurements, missionId])

  return null
}
