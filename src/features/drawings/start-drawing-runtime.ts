import type { Drawing, MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import type { DrawingRuntimeState } from './drawing-store'

type DrawingStoreBoundary = Pick<MissionStore, 'listDrawings'>

type StartDrawingRuntimeDependencies = {
  readonly drawingStore: DrawingStoreBoundary
  readonly applyRuntime: (runtime: DrawingRuntimeState) => void
}

export type DrawingRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
}

export async function startDrawingRuntime(
  dependencies: StartDrawingRuntimeDependencies,
): Promise<DrawingRuntimeController> {
  let activeMissionId: string | null = null
  let drawings: readonly Drawing[] = []
  let loading = false
  let error: string | null = null

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      activeMissionId = missionId
      error = null

      if (missionId === null) {
        drawings = []
        loading = false
        publishRuntime()
        return
      }

      loading = true
      publishRuntime()

      try {
        drawings = await dependencies.drawingStore.listDrawings(missionId)
        loading = false
        publishRuntime()
      } catch (runtimeError) {
        drawings = []
        loading = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId,
      drawings,
      loading,
      error,
    })
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Drawing load failed.'
}
