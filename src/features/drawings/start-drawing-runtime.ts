import type { Drawing, MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { buildDrawingInput } from './drawing-builders'
import {
  appendDrawingSketchPoint,
  beginDrawingDialogAtPoint,
  beginDrawingEdit,
  cancelActiveDrawingTool,
  closeDrawingDialog,
  createDrawingRuntimeMutableState,
  completeDrawingSketch,
  selectDrawing,
  setActiveDrawingTool,
  snapshotDrawingRuntimeState,
  updateDrawingDraft,
} from './drawing-runtime-editor'
import {
  applyDrawingDeleteSuccess,
  applyDrawingMissionRefreshFailure,
  applyDrawingMissionRefreshSuccess,
  applyDrawingSaveFailure,
  applyDrawingSaveSuccess,
  beginDrawingMissionRefresh,
  beginDrawingSave,
  getNextDrawingDisplayOrder,
} from './drawing-runtime-session'
import type { DrawingRuntimeState } from './drawing-store'
import type { DrawingDraft, DrawingTool } from './drawing-types'

type DrawingStoreBoundary = Pick<
  MissionStore,
  'listDrawings' | 'upsertDrawing' | 'deleteDrawing'
>

type StartDrawingRuntimeDependencies = {
  readonly drawingStore: DrawingStoreBoundary
  readonly applyRuntime: (runtime: DrawingRuntimeState) => void
}

export type DrawingRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly setActiveTool: (tool: DrawingTool) => void
  readonly cancelActiveTool: () => void
  readonly appendSketchPoint: (lon: number, lat: number) => void
  readonly completeSketch: () => void
  readonly beginDialogAtPoint: (
    tool: Extract<DrawingTool, 'range_ring' | 'bearing_line' | 'search_sector'>,
    lon: number,
    lat: number,
  ) => void
  readonly beginEdit: (drawingId: string) => void
  readonly updateDraft: (draft: DrawingDraft) => void
  readonly closeDialog: () => void
  readonly saveDialog: () => Promise<Drawing | null>
  readonly deleteSelectedDrawing: () => Promise<boolean>
  readonly selectDrawing: (drawingId: string | null) => void
}

/**
 * Starts the drawing runtime controller used by the map, dialog, and mission bridges.
 */
export async function startDrawingRuntime(
  dependencies: StartDrawingRuntimeDependencies,
): Promise<DrawingRuntimeController> {
  const state = createDrawingRuntimeMutableState()

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      beginDrawingMissionRefresh(state, missionId)
      publishRuntime()

      if (missionId === null) {
        return
      }

      try {
        applyDrawingMissionRefreshSuccess(
          state,
          await dependencies.drawingStore.listDrawings(missionId),
        )
        publishRuntime()
      } catch (runtimeError) {
        applyDrawingMissionRefreshFailure(state, toErrorMessage(runtimeError))
        publishRuntime()
        throw runtimeError
      }
    },
    setActiveTool: (tool) => {
      setActiveDrawingTool(state, tool)
      publishRuntime()
    },
    cancelActiveTool: () => {
      cancelActiveDrawingTool(state)
      publishRuntime()
    },
    appendSketchPoint: (lon, lat) => {
      appendDrawingSketchPoint(state, lon, lat)
      publishRuntime()
    },
    completeSketch: () => {
      completeDrawingSketch(state)
      publishRuntime()
    },
    beginDialogAtPoint: (tool, lon, lat) => {
      beginDrawingDialogAtPoint(state, tool, lon, lat)
      publishRuntime()
    },
    beginEdit: (drawingId) => {
      beginDrawingEdit(state, drawingId)
      publishRuntime()
    },
    updateDraft: (draft) => {
      updateDrawingDraft(state, draft)
      publishRuntime()
    },
    closeDialog: () => {
      closeDrawingDialog(state)
      publishRuntime()
    },
    saveDialog: async () => {
      if (state.activeMissionId === null || state.dialog === null) {
        return null
      }

      beginDrawingSave(state)
      publishRuntime()

      try {
        const drawing = await dependencies.drawingStore.upsertDrawing(
          buildDrawingInput({
            missionId: state.activeMissionId,
            displayOrder: getNextDrawingDisplayOrder(state, state.dialog.draft.id),
            draft: state.dialog.draft,
          }),
        )

        applyDrawingSaveSuccess(state, drawing)
        publishRuntime()
        return drawing
      } catch (runtimeError) {
        applyDrawingSaveFailure(state, toErrorMessage(runtimeError))
        publishRuntime()
        throw runtimeError
      }
    },
    deleteSelectedDrawing: async () => {
      if (state.selectedDrawingId === null) {
        return false
      }

      const didDelete = await dependencies.drawingStore.deleteDrawing(
        state.selectedDrawingId,
      )
      if (!didDelete) {
        return false
      }

      applyDrawingDeleteSuccess(state)
      publishRuntime()
      return true
    },
    selectDrawing: (drawingId) => {
      selectDrawing(state, drawingId)
      publishRuntime()
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(snapshotDrawingRuntimeState(state))
  }
}

/**
 * Converts an unknown runtime error into an operator-visible message.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return 'Drawing operation failed.'
}
