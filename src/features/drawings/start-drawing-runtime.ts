import type { Drawing, MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import {
  buildDrawingInput,
  createBearingLineDraft,
  createDraftFromDrawing,
  createLineDraft,
  createRangeRingDraft,
  createSearchAreaDraft,
  createSearchSectorDraft,
} from './drawing-builders'
import type { DrawingRuntimeState } from './drawing-store'
import type { DrawingDraft, DrawingSketchState, DrawingTool } from './drawing-types'

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

export async function startDrawingRuntime(
  dependencies: StartDrawingRuntimeDependencies,
): Promise<DrawingRuntimeController> {
  let activeMissionId: string | null = null
  let drawings: readonly Drawing[] = []
  let loading = false
  let saving = false
  let error: string | null = null
  let activeTool: DrawingTool = 'select'
  let sketch: DrawingSketchState = null
  let dialog: DrawingRuntimeState['dialog'] = null
  let selectedDrawingId: string | null = null

  publishRuntime()

  return {
    refreshMission: async (missionId) => {
      activeMissionId = missionId
      error = null
      dialog = null
      sketch = null
      selectedDrawingId = null

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
    setActiveTool: (tool) => {
      activeTool = tool
      sketch = null
      dialog = null
      if (tool !== 'select') {
        selectedDrawingId = null
      }
      error = null
      publishRuntime()
    },
    cancelActiveTool: () => {
      activeTool = 'select'
      sketch = null
      dialog = null
      error = null
      publishRuntime()
    },
    appendSketchPoint: (lon, lat) => {
      if (activeTool !== 'line' && activeTool !== 'search_area') {
        return
      }

      if (sketch === null || sketch.tool !== activeTool) {
        sketch = {
          tool: activeTool,
          points: [[lon, lat]],
        }
      } else {
        sketch = {
          ...sketch,
          points: [...sketch.points, [lon, lat]],
        }
      }

      error = null
      publishRuntime()
    },
    completeSketch: () => {
      if (sketch === null) {
        return
      }

      if (sketch.tool === 'line') {
        if (sketch.points.length < 2) {
          error = 'Lines require at least two points.'
          publishRuntime()
          return
        }

        dialog = {
          mode: 'create',
          draft: createLineDraft(sketch.points),
        }
      }

      if (sketch.tool === 'search_area') {
        if (sketch.points.length < 3) {
          error = 'Search areas require at least three points.'
          publishRuntime()
          return
        }

        dialog = {
          mode: 'create',
          draft: createSearchAreaDraft(sketch.points),
        }
      }

      sketch = null
      error = null
      publishRuntime()
    },
    beginDialogAtPoint: (tool, lon, lat) => {
      activeTool = tool
      error = null
      sketch = null
      dialog = {
        mode: 'create',
        draft:
          tool === 'range_ring'
            ? createRangeRingDraft([lon, lat])
            : tool === 'bearing_line'
              ? createBearingLineDraft([lon, lat])
              : createSearchSectorDraft([lon, lat]),
      }
      publishRuntime()
    },
    beginEdit: (drawingId) => {
      const drawing = drawings.find((candidate) => candidate.id === drawingId)
      if (drawing === undefined) {
        error = `Drawing not found: ${drawingId}`
        publishRuntime()
        return
      }

      selectedDrawingId = drawing.id
      dialog = {
        mode: 'edit',
        draft: createDraftFromDrawing(drawing),
      }
      error = null
      publishRuntime()
    },
    updateDraft: (draft) => {
      if (dialog === null) {
        return
      }

      dialog = {
        ...dialog,
        draft,
      }
      publishRuntime()
    },
    closeDialog: () => {
      dialog = null
      error = null
      if (activeTool !== 'select') {
        activeTool = 'select'
      }
      publishRuntime()
    },
    saveDialog: async () => {
      if (activeMissionId === null || dialog === null) {
        return null
      }

      saving = true
      error = null
      publishRuntime()

      try {
        const drawing = await dependencies.drawingStore.upsertDrawing(
          buildDrawingInput({
            missionId: activeMissionId,
            displayOrder: getDisplayOrder(drawings, dialog.draft.id),
            draft: dialog.draft,
          }),
        )

        drawings = upsertDrawing(drawings, drawing)
        selectedDrawingId = drawing.id
        dialog = null
        activeTool = 'select'
        saving = false
        publishRuntime()
        return drawing
      } catch (runtimeError) {
        saving = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
    deleteSelectedDrawing: async () => {
      if (selectedDrawingId === null) {
        return false
      }

      const didDelete = await dependencies.drawingStore.deleteDrawing(selectedDrawingId)
      if (!didDelete) {
        return false
      }

      drawings = drawings.filter((drawing) => drawing.id !== selectedDrawingId)
      selectedDrawingId = null
      dialog = null
      activeTool = 'select'
      error = null
      publishRuntime()
      return true
    },
    selectDrawing: (drawingId) => {
      selectedDrawingId = drawingId
      publishRuntime()
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId,
      drawings,
      loading,
      saving,
      error,
      activeTool,
      sketch,
      dialog,
      selectedDrawingId,
    })
  }
}

function getDisplayOrder(drawings: readonly Drawing[], drawingId: string | null): number {
  if (drawingId !== null) {
    const existing = drawings.find((drawing) => drawing.id === drawingId)
    if (existing !== undefined) {
      return existing.display_order
    }
  }

  return drawings.reduce((maxOrder, drawing) => Math.max(maxOrder, drawing.display_order), 0) + 1
}

function upsertDrawing(drawings: readonly Drawing[], drawing: Drawing): readonly Drawing[] {
  const existingIndex = drawings.findIndex((candidate) => candidate.id === drawing.id)
  if (existingIndex === -1) {
    return [...drawings, drawing].sort((left, right) => left.display_order - right.display_order)
  }

  return drawings.map((candidate) => (candidate.id === drawing.id ? drawing : candidate))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Drawing action failed.'
}
