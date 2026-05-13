import type {
  DrawingType,
  HelicopterSlotKey,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerGroupVisibility } from './layer-visibility-store'

const HIDDEN_MARKER_TYPES: Record<MarkerType, boolean> = {
  ipp_lkp: false,
  clue: false,
  hazard: false,
  casualty: false,
}

const HIDDEN_DRAWING_TYPES: Record<DrawingType, boolean> = {
  line: false,
  search_area: false,
  range_ring: false,
  bearing_line: false,
  search_sector: false,
  text_label: false,
}

const HIDDEN_HELICOPTER_SLOTS: Record<HelicopterSlotKey, boolean> = {
  slot_1: false,
  slot_2: false,
  slot_3: false,
  slot_4: false,
}

/**
 * Returns the effective marker-type visibility after group-level visibility is applied.
 */
export function getEffectiveMarkerTypeVisibility(
  groupVisibility: LayerGroupVisibility,
  markerTypeVisibility: Record<MarkerType, boolean>,
): Record<MarkerType, boolean> {
  return groupVisibility.mapTools ? markerTypeVisibility : HIDDEN_MARKER_TYPES
}

/**
 * Returns the effective drawing-type visibility after group-level visibility is applied.
 */
export function getEffectiveDrawingTypeVisibility(
  groupVisibility: LayerGroupVisibility,
  drawingTypeVisibility: Record<DrawingType, boolean>,
): Record<DrawingType, boolean> {
  return groupVisibility.mapTools ? drawingTypeVisibility : HIDDEN_DRAWING_TYPES
}

/**
 * Returns whether measurements should be rendered after group-level visibility is applied.
 */
export function getEffectiveMeasurementsVisible(
  groupVisibility: LayerGroupVisibility,
  measurementsVisible: boolean,
): boolean {
  return groupVisibility.mapTools && measurementsVisible
}

/**
 * Returns whether the tracking overlay should render at all.
 */
export function getEffectiveTrackingVisible(
  groupVisibility: LayerGroupVisibility,
): boolean {
  return groupVisibility.tracking
}

/**
 * Returns the effective helicopter-slot visibility after group-level visibility is applied.
 */
export function getEffectiveHelicopterSlotVisibility(
  groupVisibility: LayerGroupVisibility,
  helicopterSlotVisibility: Record<HelicopterSlotKey, boolean>,
): Record<HelicopterSlotKey, boolean> {
  return groupVisibility.helicopters ? helicopterSlotVisibility : HIDDEN_HELICOPTER_SLOTS
}

/**
 * Returns whether GPX overlays should render after group-level visibility is applied.
 */
export function getEffectiveGpxTracksVisible(
  groupVisibility: LayerGroupVisibility,
): boolean {
  return groupVisibility.gpxTracks
}
