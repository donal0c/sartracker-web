import type { Drawing, DrawingType } from '../../infrastructure/mission-store/tauri-mission-store'
import type { LpbCategoryId } from './lpb-data'
import type { LonLat } from './drawing-math'

export type DrawingTool =
  | 'select'
  | 'line'
  | 'search_area'
  | 'range_ring'
  | 'bearing_line'
  | 'search_sector'
  | 'text_label'

export type SearchAreaStatus =
  | 'Planned'
  | 'Assigned'
  | 'In Progress'
  | 'Completed'
  | 'Cleared'

export type RangeRingMode = 'manual' | 'lpb'
export type BearingInputType = 'true' | 'magnetic'

export type LineDrawingDraft = {
  readonly id: string | null
  readonly type: 'line'
  readonly name: string
  readonly description: string
  readonly points: readonly LonLat[]
}

export type SearchAreaDrawingDraft = {
  readonly id: string | null
  readonly type: 'search_area'
  readonly name: string
  readonly description: string
  readonly points: readonly LonLat[]
  readonly team: string
  readonly status: SearchAreaStatus
  readonly poaPercent: string
  readonly labelFontSize: string
  readonly fillColor: string
  readonly terrain: string
  readonly notes: string
}

export type RangeRingDrawingDraft = {
  readonly id: string | null
  readonly type: 'range_ring'
  readonly name: string
  readonly description: string
  readonly center: LonLat
  readonly mode: RangeRingMode
  readonly manualRadiusM: string
  readonly manualRingCount: string
  readonly lpbCategory: LpbCategoryId
}

export type BearingLineDrawingDraft = {
  readonly id: string | null
  readonly type: 'bearing_line'
  readonly name: string
  readonly description: string
  readonly origin: LonLat
  readonly inputBearingType: BearingInputType
  readonly inputBearing: string
  readonly distanceM: string
}

export type SearchSectorDrawingDraft = {
  readonly id: string | null
  readonly type: 'search_sector'
  readonly name: string
  readonly description: string
  readonly center: LonLat
  readonly startBearing: string
  readonly endBearing: string
  readonly radiusM: string
}

export type TextLabelDrawingDraft = {
  readonly id: string | null
  readonly type: 'text_label'
  readonly text: string
  readonly fontSize: string
  readonly color: string
  readonly rotation: string
  readonly point: LonLat
}

export type DrawingDraft =
  | LineDrawingDraft
  | SearchAreaDrawingDraft
  | RangeRingDrawingDraft
  | BearingLineDrawingDraft
  | SearchSectorDrawingDraft
  | TextLabelDrawingDraft

export type DrawingDialogState = {
  readonly mode: 'create' | 'edit'
  readonly draft: DrawingDraft
}

export type DrawingSketchState =
  | {
      readonly tool: 'line' | 'search_area'
      readonly points: readonly LonLat[]
    }
  | null

export type DrawingMetadata =
  | {
      readonly kind: 'line'
      readonly distanceM?: number
      readonly trueBearing?: number
      readonly magneticBearing?: number
    }
  | {
      readonly kind: 'search_area'
      readonly team: string | null
      readonly status: SearchAreaStatus
      readonly poaPercent: number | null
      readonly terrain: string | null
      readonly notes: string | null
      readonly areaSqM: number
      readonly labelFontSize?: number
      readonly fillColor?: string
    }
  | {
      readonly kind: 'range_ring'
      readonly mode: RangeRingMode
      readonly radiiM: readonly number[]
      readonly colors: readonly string[]
      readonly labels: readonly string[]
      readonly center: LonLat
      readonly lpbCategory: LpbCategoryId | null
    }
  | {
      readonly kind: 'bearing_line'
      readonly trueBearing: number
      readonly inputBearingType: BearingInputType
      readonly inputBearing: number
      readonly origin: LonLat
    }
  | {
      readonly kind: 'search_sector'
      readonly center: LonLat
      readonly startBearing: number
      readonly endBearing: number
      readonly radiusM: number
    }
  | {
      readonly kind: 'text_label'
      readonly text: string
      readonly fontSize: number
      readonly color: string
      readonly rotation: number
      readonly point: LonLat
    }

export type PersistedDrawing = Drawing & {
  readonly parsedGeometry: GeoJSON.Geometry
  readonly metadata: DrawingMetadata | null
}

export const SEARCH_AREA_STATUSES: readonly SearchAreaStatus[] = [
  'Planned',
  'Assigned',
  'In Progress',
  'Completed',
  'Cleared',
]

export function isEditableDrawingType(type: DrawingType): type is DrawingDraft['type'] {
  return (
    type === 'line' ||
    type === 'search_area' ||
    type === 'range_ring' ||
    type === 'bearing_line' ||
    type === 'search_sector' ||
    type === 'text_label'
  )
}
