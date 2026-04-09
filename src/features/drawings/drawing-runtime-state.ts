import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import type { DrawingRuntimeState } from './drawing-store'
import type {
  DrawingDialogState,
  DrawingSketchState,
  DrawingTool,
} from './drawing-types'

export type DrawingRuntimeMutableState = {
  activeMissionId: string | null
  drawings: readonly Drawing[]
  loading: boolean
  saving: boolean
  error: string | null
  activeTool: DrawingTool
  sketch: DrawingSketchState
  dialog: DrawingDialogState | null
  selectedDrawingId: string | null
}

type CreateDrawingRuntimeMutableStateArgs = Partial<DrawingRuntimeMutableState>

/**
 * Creates the mutable runtime state container used internally by the drawing runtime.
 */
export function createDrawingRuntimeMutableState(
  overrides: CreateDrawingRuntimeMutableStateArgs = {},
): DrawingRuntimeMutableState {
  return {
    activeMissionId: null,
    drawings: [],
    loading: false,
    saving: false,
    error: null,
    activeTool: 'select',
    sketch: null,
    dialog: null,
    selectedDrawingId: null,
    ...overrides,
  }
}

/**
 * Returns an immutable runtime snapshot for the drawing Zustand store boundary.
 */
export function snapshotDrawingRuntimeState(
  state: DrawingRuntimeMutableState,
): DrawingRuntimeState {
  return {
    activeMissionId: state.activeMissionId,
    drawings: state.drawings,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    activeTool: state.activeTool,
    sketch: state.sketch,
    dialog: state.dialog,
    selectedDrawingId: state.selectedDrawingId,
  }
}
