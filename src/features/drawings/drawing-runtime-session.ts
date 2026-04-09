import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import {
  createDrawingRuntimeMutableState,
  snapshotDrawingRuntimeState,
  type DrawingRuntimeMutableState,
} from './drawing-runtime-state'

export { createDrawingRuntimeMutableState, snapshotDrawingRuntimeState }

/**
 * Resets editor state and enters mission-loading mode for the provided mission id.
 */
export function beginDrawingMissionRefresh(
  state: DrawingRuntimeMutableState,
  missionId: string | null,
): void {
  state.activeMissionId = missionId
  state.error = null
  state.dialog = null
  state.sketch = null
  state.selectedDrawingId = null

  if (missionId === null) {
    state.drawings = []
    state.loading = false
    return
  }

  state.loading = true
}

/**
 * Applies freshly loaded drawings for the active mission.
 */
export function applyDrawingMissionRefreshSuccess(
  state: DrawingRuntimeMutableState,
  drawings: readonly Drawing[],
): void {
  state.drawings = drawings
  state.loading = false
  state.error = null
}

/**
 * Applies a mission refresh failure and clears stale drawing state.
 */
export function applyDrawingMissionRefreshFailure(
  state: DrawingRuntimeMutableState,
  error: string,
): void {
  state.drawings = []
  state.loading = false
  state.error = error
}

/**
 * Returns the next display order for a drawing save operation.
 */
export function getNextDrawingDisplayOrder(
  state: DrawingRuntimeMutableState,
  editingDrawingId: string | null,
): number {
  if (editingDrawingId !== null) {
    const existing = state.drawings.find((drawing) => drawing.id === editingDrawingId)
    if (existing !== undefined) {
      return existing.display_order
    }
  }

  const maxDisplayOrder = state.drawings.reduce(
    (maximum, drawing) => Math.max(maximum, drawing.display_order),
    0,
  )

  return maxDisplayOrder + 1
}

/**
 * Marks the runtime as saving before the drawing store upsert runs.
 */
export function beginDrawingSave(state: DrawingRuntimeMutableState): void {
  state.saving = true
  state.error = null
}

/**
 * Applies a successful save and restores the editor to select mode.
 */
export function applyDrawingSaveSuccess(
  state: DrawingRuntimeMutableState,
  drawing: Drawing,
): void {
  state.drawings = upsertDrawing(state.drawings, drawing)
  state.selectedDrawingId = drawing.id
  state.dialog = null
  state.activeTool = 'select'
  state.saving = false
}

/**
 * Applies a save failure and clears the saving flag.
 */
export function applyDrawingSaveFailure(
  state: DrawingRuntimeMutableState,
  error: string,
): void {
  state.saving = false
  state.error = error
}

/**
 * Applies a successful delete for the currently selected drawing.
 */
export function applyDrawingDeleteSuccess(state: DrawingRuntimeMutableState): void {
  if (state.selectedDrawingId === null) {
    return
  }

  state.drawings = state.drawings.filter((drawing) => drawing.id !== state.selectedDrawingId)
  state.selectedDrawingId = null
  state.dialog = null
  state.activeTool = 'select'
  state.error = null
}

function upsertDrawing(
  drawings: readonly Drawing[],
  drawing: Drawing,
): readonly Drawing[] {
  const existingIndex = drawings.findIndex((candidate) => candidate.id === drawing.id)
  if (existingIndex === -1) {
    return [...drawings, drawing]
  }

  return drawings.map((candidate) => (candidate.id === drawing.id ? drawing : candidate))
}
