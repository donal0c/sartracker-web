import { useEffect } from 'react'

import { createTauriLayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { createElectronLayerCatalogStore } from '../../infrastructure/layer-catalog-store/electron-layer-catalog-store'
import { createElectronMissionStore } from '../../infrastructure/mission-store/electron-mission-store'
import { createTauriMissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { getBrowserHarnessLayerCatalogStore } from '../browser-validation/browser-harness-layer-catalog-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { shouldEnableMissionBrowserHarness } from '../mission/mission-browser-harness'
import { useMissionStore } from '../mission/mission-store'
import {
  applyMissionReviewController,
  applyMissionReviewRuntime,
  useMissionReviewStore,
} from './mission-review-store'
import { startMissionReviewRuntime } from './start-mission-review-runtime'

/**
 * Starts the mission review runtime so the review workspace can inspect persisted mission data.
 *
 * Picks both the mission store and the layer-catalog store based on whether the
 * browser harness is active so harness mode never invokes Tauri IPC.
 */
export function MissionReviewRuntimeBridge() {
  const controller = useMissionReviewStore((state) => state.controller)
  const preferredMissionId = useMissionStore(
    (state) =>
      state.currentMission?.id ??
      state.governanceMission?.id ??
      state.recoverableMission?.id ??
      null,
  )

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

    void startMissionReviewRuntime({
      missionStore,
      layerCatalogStore,
      applyRuntime: applyMissionReviewRuntime,
    }).then((nextController) => {
      if (!cancelled) {
        applyMissionReviewController(nextController)
      }
    }).catch((error: unknown) => {
      applyMissionReviewRuntime({
        missions: [],
        selectedMissionId: null,
        snapshot: null,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Mission review failed to start.',
      })
    })

    return () => {
      cancelled = true
    }
  }, [controller])

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.load(preferredMissionId)
  }, [controller, preferredMissionId])

  return null
}
