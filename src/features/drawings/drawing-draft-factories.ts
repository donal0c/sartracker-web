import type {
  BearingLineDrawingDraft,
  DrawingDraft,
  LineDrawingDraft,
  RangeRingDrawingDraft,
  SearchAreaDrawingDraft,
  SearchSectorDrawingDraft,
  TextLabelDrawingDraft,
} from './drawing-types'
import type { LonLat } from './drawing-math'

/**
 * Returns whether a drawing draft has the minimum required fields for save.
 * Range rings require explicit radius (manual) or category selection (LPB).
 */
export function isDrawingDraftSaveable(draft: DrawingDraft): boolean {
  if (draft.type === 'range_ring') {
    if (draft.mode === 'manual') {
      const radius = Number(draft.manualRadiusM)
      return draft.manualRadiusM.trim() !== '' && Number.isFinite(radius) && radius > 0
    }
    return true
  }
  return true
}

/**
 * Creates an empty line draft from captured sketch points.
 */
export function createLineDraft(points: readonly LonLat[]): LineDrawingDraft {
  return {
    id: null,
    type: 'line',
    name: '',
    description: '',
    points,
  }
}

/**
 * Creates an empty search-area draft from captured sketch points.
 */
export function createSearchAreaDraft(points: readonly LonLat[]): SearchAreaDrawingDraft {
  return {
    id: null,
    type: 'search_area',
    name: '',
    description: '',
    points,
    team: '',
    status: 'Planned',
    poaPercent: '',
    labelFontSize: '12',
    fillColor: '#F59E0B',
    terrain: '',
    notes: '',
  }
}

/**
 * Creates an empty range-ring draft from a selected center point.
 * Manual radius starts empty to force the operator to enter an explicit value.
 */
export function createRangeRingDraft(center: LonLat): RangeRingDrawingDraft {
  return {
    id: null,
    type: 'range_ring',
    name: '',
    description: '',
    center,
    mode: 'manual',
    manualRadiusM: '',
    manualRingCount: '3',
    lpbCategory: 'hiker',
  }
}

/**
 * Creates an empty bearing-line draft from a selected origin point.
 */
export function createBearingLineDraft(center: LonLat): BearingLineDrawingDraft {
  return {
    id: null,
    type: 'bearing_line',
    name: '',
    description: '',
    origin: center,
    inputBearingType: 'true',
    inputBearing: '0',
    distanceM: '1000',
  }
}

/**
 * Creates an empty search-sector draft from a selected center point.
 */
export function createSearchSectorDraft(center: LonLat): SearchSectorDrawingDraft {
  return {
    id: null,
    type: 'search_sector',
    name: '',
    description: '',
    center,
    startBearing: '0',
    endBearing: '90',
    radiusM: '1000',
  }
}

/**
 * Creates an empty text-label draft from a selected anchor point.
 */
export function createTextLabelDraft(point: LonLat): TextLabelDrawingDraft {
  return {
    id: null,
    type: 'text_label',
    text: '',
    fontSize: '12',
    color: '#FAFAF9',
    rotation: '0',
    point,
  }
}
