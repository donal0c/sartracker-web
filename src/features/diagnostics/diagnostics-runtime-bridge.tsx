import { useEffect } from 'react'

import { createTauriLayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { createElectronLayerCatalogStore } from '../../infrastructure/layer-catalog-store/electron-layer-catalog-store'
import { getBrowserHarnessLayerCatalogStore } from '../browser-validation/browser-harness-layer-catalog-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import {
  exportDiagnosticsReport,
  exportSupportBundle,
} from '../../infrastructure/support-report/tauri-support-report-store'
import { createElectronMissionStore } from '../../infrastructure/mission-store/electron-mission-store'
import { createTauriMissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { loadAppSettings, loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { APP_VERSION } from '../../lib/app-version'
import { getDependencySmoke } from '../../lib/dependency-smoke'
import { getDesktopRuntimeKind, isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { useLayerCatalogStore } from '../layers/layer-catalog-store'
import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useHelicopterStore } from '../helicopters/helicopter-store'
import { useMarkerStore } from '../markers/marker-store'
import { useMeasurementStore } from '../measurements/measurement-store'
import { useMissionStore } from '../mission/mission-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { shouldEnableMissionBrowserHarness } from '../mission/mission-browser-harness'
import { applyDiagnosticsController, applyDiagnosticsRuntime, useDiagnosticsStore } from './diagnostics-store'
import { readDiagnosticEvents } from './diagnostic-event-log'
import { startDiagnosticsRuntime } from './start-diagnostics-runtime'

/**
 * Starts the diagnostics runtime once and keeps it connected to the current app snapshots.
 */
export function DiagnosticsRuntimeBridge() {
  const controller = useDiagnosticsStore((state) => state.controller)

  useEffect(() => {
    if (controller !== null) {
      return
    }

    let cancelled = false
    const harnessActive = shouldEnableMissionBrowserHarness()
    const electronActive = isElectronRuntimeAvailable()
    const missionStore = harnessActive
      ? getBrowserHarnessStore()
      : electronActive
        ? createElectronMissionStore()
        : createTauriMissionStore()
    const layerCatalogStore = harnessActive
      ? getBrowserHarnessLayerCatalogStore()
      : electronActive
        ? createElectronLayerCatalogStore()
        : createTauriLayerCatalogStore()

    void startDiagnosticsRuntime({
      appVersion: APP_VERSION,
      getRuntimeKind: getDesktopRuntimeKind,
      getUserAgent: () => (typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent),
      getDependencySmoke,
      loadSettings: loadAppSettings,
      loadRuntimeBootstrapSettings: () => loadRuntimeBootstrapSettings(false),
      missionStore,
      layerCatalogStore,
      readMissionRuntime: () => {
        const state = useMissionStore.getState()
        return {
          phase: state.phase,
          currentMission: state.currentMission,
          recoverableMission: state.recoverableMission,
        }
      },
      readMissionGovernanceRuntime: () => ({
        governanceMission: useMissionStore.getState().governanceMission,
      }),
      readTrackingRuntime: () => {
        const state = useTrackingStore.getState()
        return {
          status: state.status,
          snapshot: state.snapshot,
        }
      },
      readLayerCatalogRuntime: () => {
        const state = useLayerCatalogStore.getState()
        return {
          missionId: state.missionId,
          metadataEntryCount: state.metadataEntries.length,
          loading: state.loading,
          error: state.error,
        }
      },
      readDiagnosticEvents,
      exportReport: exportDiagnosticsReport,
      exportSupportBundle,
      refreshLayerCatalogIfActive: async (targetMissionId) => {
        const layerCatalogController = useLayerCatalogStore.getState().controller
        const missionId = useMissionStore.getState().currentMission?.id ?? null
        if (layerCatalogController === null || targetMissionId !== missionId) {
          return
        }

        await layerCatalogController.refreshCatalog({
          missionId,
          devices: useTrackingStore.getState().snapshot.devices,
          markers: useMarkerStore.getState().markers,
          drawings: useDrawingStore.getState().drawings,
          helicopters: useHelicopterStore.getState().helicopters,
          gpxImports: useGpxStore.getState().imports,
          measurements: useMeasurementStore.getState().measurements,
        })
      },
      applyRuntime: applyDiagnosticsRuntime,
    }).then((nextController) => {
      if (!cancelled) {
        applyDiagnosticsController(nextController)
      }
    })

    return () => {
      cancelled = true
    }
  }, [controller])

  return null
}
