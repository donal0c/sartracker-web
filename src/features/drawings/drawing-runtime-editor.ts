import { isEditableDrawingType, type DrawingDraft, type DrawingTool } from './drawing-types'
import {
  createBearingLineDraft,
  createDraftFromDrawing,
  createLineDraft,
  createRangeRingDraft,
  createSearchAreaDraft,
  createSearchSectorDraft,
  createTextLabelDraft,
} from './drawing-builders'
import {
  createDrawingRuntimeMutableState,
  snapshotDrawingRuntimeState,
  type DrawingRuntimeMutableState,
} from './drawing-runtime-state'
import { assertValidWgs84Coordinate } from './drawing-math'
export { createDrawingRuntimeMutableState, snapshotDrawingRuntimeState }

/**
 * Switches the active drawing tool and clears any in-progress editor state.
 */
export function setActiveDrawingTool(
  state: DrawingRuntimeMutableState,
  tool: DrawingTool,
): void {
  state.activeTool = tool
  state.sketch = null
  state.dialog = null
  if (tool !== 'select') {
    state.selectedDrawingId = null
  }
  state.error = null
}

/**
 * Cancels any active drawing interaction and returns the editor to select mode.
 */
export function cancelActiveDrawingTool(state: DrawingRuntimeMutableState): void {
  state.activeTool = 'select'
  state.sketch = null
  state.dialog = null
  state.error = null
}

/**
 * Appends a map click to the active line or search-area sketch.
 */
export function appendDrawingSketchPoint(
  state: DrawingRuntimeMutableState,
  lon: number,
  lat: number,
): void {
  if (state.activeTool !== 'line' && state.activeTool !== 'search_area') {
    return
  }

  try {
    assertValidWgs84Coordinate(lon, lat, 'drawing sketch')
  } catch (runtimeError) {
    state.error = toErrorMessage(runtimeError)
    return
  }

  if (state.sketch === null || state.sketch.tool !== state.activeTool) {
    state.sketch = {
      tool: state.activeTool,
      points: [[lon, lat]],
    }
  } else {
    state.sketch = {
      ...state.sketch,
      points: [...state.sketch.points, [lon, lat]],
    }
  }

  state.error = null
}

/**
 * Finalizes the active sketch into a create dialog when the geometry is complete.
 */
export function completeDrawingSketch(state: DrawingRuntimeMutableState): void {
  if (state.sketch === null) {
    return
  }

  if (state.sketch.tool === 'line') {
    if (state.sketch.points.length < 2) {
      state.error = 'Lines require at least two points.'
      return
    }

    state.dialog = {
      mode: 'create',
      draft: createLineDraft(state.sketch.points),
    }
  }

  if (state.sketch.tool === 'search_area') {
    if (state.sketch.points.length < 3) {
      state.error = 'Search areas require at least three points.'
      return
    }

    state.dialog = {
      mode: 'create',
      draft: createSearchAreaDraft(state.sketch.points),
    }
  }

  state.sketch = null
  state.error = null
}

/**
 * Starts a point-based drawing dialog from a clicked map coordinate.
 */
export function beginDrawingDialogAtPoint(
  state: DrawingRuntimeMutableState,
  tool: Extract<DrawingTool, 'range_ring' | 'bearing_line' | 'search_sector' | 'text_label'>,
  lon: number,
  lat: number,
): void {
  try {
    assertValidWgs84Coordinate(lon, lat, 'drawing dialog')
  } catch (runtimeError) {
    state.error = toErrorMessage(runtimeError)
    return
  }

  state.activeTool = tool
  state.error = null
  state.sketch = null
  state.dialog = {
    mode: 'create',
    draft:
      tool === 'range_ring'
        ? createRangeRingDraft([lon, lat])
        : tool === 'bearing_line'
          ? createBearingLineDraft([lon, lat])
          : tool === 'search_sector'
            ? createSearchSectorDraft([lon, lat])
            : createTextLabelDraft([lon, lat]),
  }
}

/**
 * Starts editing an existing drawing by id.
 */
export function beginDrawingEdit(
  state: DrawingRuntimeMutableState,
  drawingId: string,
): void {
  const drawing = state.drawings.find((candidate) => candidate.id === drawingId)
  if (drawing === undefined) {
    state.error = `Drawing not found: ${drawingId}`
    return
  }
  if (!isEditableDrawingType(drawing.type)) {
    state.error = `Drawing type is not editable: ${drawing.type}`
    return
  }

  state.selectedDrawingId = drawing.id
  try {
    state.dialog = {
      mode: 'edit',
      draft: createDraftFromDrawing(drawing),
    }
    state.error = null
  } catch (runtimeError) {
    state.selectedDrawingId = null
    state.dialog = null
    state.error = toErrorMessage(runtimeError)
  }
}

/**
 * Replaces the active drawing dialog draft.
 */
export function updateDrawingDraft(
  state: DrawingRuntimeMutableState,
  draft: DrawingDraft | ((current: DrawingDraft) => DrawingDraft),
): void {
  if (state.dialog === null) {
    return
  }

  const nextDraft = typeof draft === 'function' ? draft(state.dialog.draft) : draft

  state.dialog = {
    ...state.dialog,
    draft: nextDraft,
  }
}

/** Converts a drawing-input failure into an operator-visible message. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return 'Drawing point was rejected.'
}

/**
 * Closes the active dialog and returns non-select tools to select mode.
 */
export function closeDrawingDialog(state: DrawingRuntimeMutableState): void {
  state.dialog = null
  state.error = null
  if (state.activeTool !== 'select') {
    state.activeTool = 'select'
  }
}

/**
 * Updates the current drawing selection without opening a dialog.
 */
export function selectDrawing(
  state: DrawingRuntimeMutableState,
  drawingId: string | null,
): void {
  state.selectedDrawingId = drawingId
}
