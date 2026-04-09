import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import { buildBearingLineDrawingInput, createBearingLineDraftFromDrawing } from './bearing-line-drawing-persistence'
import { buildLineDrawingInput, createLineDraftFromDrawing } from './line-drawing-persistence'
import { buildRangeRingDrawingInput, createRangeRingDraftFromDrawing } from './range-ring-drawing-persistence'
import { buildSearchAreaDrawingInput, createSearchAreaDraftFromDrawing } from './search-area-drawing-persistence'
import { buildSearchSectorDrawingInput, createSearchSectorDraftFromDrawing } from './search-sector-drawing-persistence'
import { type BuildDrawingInputArgs, parsePersistedDrawing } from './shared'

/**
 * Builds a persisted drawing payload from an editable draft.
 */
export function buildDrawingInput({
  missionId,
  displayOrder,
  draft,
}: BuildDrawingInputArgs) {
  switch (draft.type) {
    case 'line':
      return buildLineDrawingInput(missionId, displayOrder, draft)
    case 'search_area':
      return buildSearchAreaDrawingInput(missionId, displayOrder, draft)
    case 'range_ring':
      return buildRangeRingDrawingInput(missionId, displayOrder, draft)
    case 'bearing_line':
      return buildBearingLineDrawingInput(missionId, displayOrder, draft)
    case 'search_sector':
      return buildSearchSectorDrawingInput(missionId, displayOrder, draft)
  }
}

/**
 * Parses the stored geometry and metadata payloads for an editable drawing.
 */
export { parsePersistedDrawing }

/**
 * Creates an editable draft from a persisted drawing record.
 */
export function createDraftFromDrawing(drawing: Drawing) {
  switch (drawing.type) {
    case 'line':
      return createLineDraftFromDrawing(drawing)
    case 'search_area':
      return createSearchAreaDraftFromDrawing(drawing)
    case 'range_ring':
      return createRangeRingDraftFromDrawing(drawing)
    case 'bearing_line':
      return createBearingLineDraftFromDrawing(drawing)
    case 'search_sector':
      return createSearchSectorDraftFromDrawing(drawing)
    default:
      throw new Error(`Unsupported drawing type for editing: ${drawing.type}`)
  }
}
