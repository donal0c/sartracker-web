import type { DrawingType, MarkerType } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * Human-readable labels for each drawing type.
 */
export const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
  line: 'Lines',
  search_area: 'Search Areas',
  range_ring: 'Range Rings',
  bearing_line: 'Bearing Lines',
  search_sector: 'Sectors',
  text_label: 'Text Labels',
}

/**
 * Human-readable labels for each marker type.
 */
export const MARKER_TYPE_LABELS: Record<MarkerType, string> = {
  ipp_lkp: 'IPP / LKP',
  clue: 'Clues',
  hazard: 'Hazards',
  casualty: 'Casualties',
}
