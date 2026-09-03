import { useEffect } from 'react'

import { createElectronLayerCatalogStore } from '../../infrastructure/layer-catalog-store/electron-layer-catalog-store'
import { createElectronMissionStore } from '../../infrastructure/mission-store/electron-mission-store'
import { createElectronArchiveReviewSource } from '../../infrastructure/archive-review/electron-archive-review-source'
import type { ArchiveReviewPublicSession } from '../../infrastructure/archive-review/archive-review-types'
import { createBrowserArchiveReviewHarness } from '../browser-validation/browser-archive-review-harness'
import { getBrowserHarnessLayerCatalogStore } from '../browser-validation/browser-harness-layer-catalog-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { shouldEnableMissionBrowserHarness } from '../mission/mission-browser-harness'
import {
  applyMissionArchiveReviewController,
  applyMissionArchiveReviewRuntime,
  resetMissionArchiveReviewStore,
} from './mission-archive-review-store'
import {
  applyMissionReviewController,
  applyMissionReviewRuntime,
  useMissionReviewStore,
} from './mission-review-store'
import { startMissionArchiveReviewRuntime } from './start-mission-archive-review-runtime'
import { getMissionReviewMissionStore } from './mission-review-runtime-context'
import {
  createMissionReviewRuntimeState,
  startMissionReviewRuntime,
  type StartMissionReviewRuntimeDependencies,
} from './start-mission-review-runtime'

/**
 * Starts the mission review runtime so the review workspace can inspect persisted mission data.
 *
 * Picks both the mission store and the layer-catalog store based on whether the
 * browser harness is active so harness mode never invokes Tauri IPC.
 */
export function MissionReviewRuntimeBridge() {
  useEffect(() => {
    if (useMissionReviewStore.getState().controller !== null) {
      return
    }

    let cancelled = false
    let teardownLiveResumeAllowed = false
    let sourceGeneration = 0
    let archiveController: Awaited<ReturnType<typeof startMissionArchiveReviewRuntime>> | null = null
    const harnessActive = shouldEnableMissionBrowserHarness()
    const electronActive = isElectronRuntimeAvailable()
    if (!harnessActive && !electronActive) {
      applyMissionReviewRuntime(createMissionReviewRuntimeState({
        error: 'Mission evidence and replay require the supported Electron desktop runtime. Historical Tauri storage is not an operational PR5 evidence store.',
      }))
      return
    }
    const missionStore = harnessActive
      ? getBrowserHarnessStore()
      : getMissionReviewMissionStore() ?? createElectronMissionStore()
    const layerCatalogStore = harnessActive
      ? getBrowserHarnessLayerCatalogStore()
      : createElectronLayerCatalogStore()
    const browserArchiveReviewHarness = harnessActive
      ? createBrowserArchiveReviewHarness({
          missionStore: getBrowserHarnessStore(),
          layerCatalogStore: getBrowserHarnessLayerCatalogStore(),
        })
      : null

    /** Starts one source generation and prevents a superseded source from publishing. */
    const switchMissionReviewSource = async (input:
      | { readonly source: 'live' }
      | {
          readonly source: 'archive'
          readonly archiveSession: ArchiveReviewPublicSession
        }
    ): Promise<void> => {
      if (cancelled && !(teardownLiveResumeAllowed && input.source === 'live')) {
        throw new Error('Mission Review source owner is closed.')
      }
      const generation = ++sourceGeneration
      const sourceDependencies: Omit<StartMissionReviewRuntimeDependencies, 'applyRuntime'> =
        input.source === 'live'
          ? {
              source: 'live',
              archiveSession: null,
              missionStore,
              layerCatalogStore,
            }
          : (() => {
              const archiveSource = browserArchiveReviewHarness === null
                ? createElectronArchiveReviewSource(input.archiveSession)
                : browserArchiveReviewHarness.createSource(input.archiveSession)
              return {
                source: 'archive' as const,
                archiveSession: input.archiveSession,
                missionStore: archiveSource,
                layerCatalogStore: {
                  listMetadata: archiveSource.listLayerCatalogMetadata,
                },
              }
            })()
      const nextController = await startMissionReviewRuntime({
        ...sourceDependencies,
        applyRuntime: (runtime) => {
          if (!cancelled && generation === sourceGeneration) {
            applyMissionReviewRuntime(runtime)
          }
        },
      })
      if (cancelled || generation !== sourceGeneration) return
      applyMissionReviewController(nextController)
    }

    void (async () => {
      try {
        await switchMissionReviewSource({ source: 'live' })
      } catch {
        if (!cancelled) {
          applyMissionReviewRuntime(
            createMissionReviewRuntimeState({
              error: 'Mission review failed to start.',
            }),
          )
        }
        return
      }
      if ((!electronActive && browserArchiveReviewHarness === null) || cancelled) return
      const bridge = browserArchiveReviewHarness?.archiveReview
        ?? window.sartrackerElectron?.archiveReview
      if (bridge === undefined) {
        applyMissionArchiveReviewRuntime({
          timeline: [],
          phase: 'error',
          activeOperationId: null,
          activeArchiveId: null,
          activeSession: null,
          progress: null,
          recoveryRequired: 'none',
          error: 'Archive review is unavailable. Live mission review remains available.',
        })
        return
      }
      let nextArchiveController: Awaited<ReturnType<typeof startMissionArchiveReviewRuntime>>
      try {
        nextArchiveController = await startMissionArchiveReviewRuntime({
          missionStore,
          archiveReview: bridge,
          switchMissionReviewSource,
          applyRuntime: (runtime) => {
            applyMissionArchiveReviewRuntime(runtime)
          },
        })
      } catch {
        if (!cancelled) {
          applyMissionArchiveReviewRuntime({
            timeline: [],
            phase: 'error',
            activeOperationId: null,
            activeArchiveId: null,
            activeSession: null,
            progress: null,
            recoveryRequired: 'none',
            error: 'Archive review timeline is unavailable. Live mission review remains available.',
          })
        }
        return
      }
      if (cancelled) {
        teardownLiveResumeAllowed = true
        try {
          await nextArchiveController.dispose()
          browserArchiveReviewHarness?.dispose()
        } finally {
          teardownLiveResumeAllowed = false
        }
        return
      }
      archiveController = nextArchiveController
      applyMissionArchiveReviewController(nextArchiveController)
    })()

    return () => {
      cancelled = true
      sourceGeneration += 1
      const controllerToDispose = archiveController
      if (controllerToDispose !== null) {
        teardownLiveResumeAllowed = true
        void controllerToDispose.dispose()
          .then(() => {
            archiveController = null
            resetMissionArchiveReviewStore()
            applyMissionReviewController(null)
            browserArchiveReviewHarness?.dispose()
          })
          .catch(() => {
            applyMissionArchiveReviewController(controllerToDispose)
          })
          .finally(() => {
            teardownLiveResumeAllowed = false
          })
      } else {
        browserArchiveReviewHarness?.dispose()
        applyMissionReviewController(null)
      }
    }
  }, [])

  return null
}
