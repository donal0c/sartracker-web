import { useEffect } from 'react'

import { createTauriLayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { createTauriMissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
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
    const missionStore = shouldEnableMissionBrowserHarness()
      ? getBrowserHarnessStore()
      : createTauriMissionStore()

    void startMissionReviewRuntime({
      missionStore,
      layerCatalogStore: createTauriLayerCatalogStore(),
      applyRuntime: applyMissionReviewRuntime,
    }).then((nextController) => {
      if (!cancelled) {
        applyMissionReviewController(nextController)
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

    void controller.load(preferredMissionId)
  }, [controller, preferredMissionId])

  return null
}
