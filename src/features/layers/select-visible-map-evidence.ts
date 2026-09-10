import type { Drawing, Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import { getEffectiveDrawingTypeVisibility, getEffectiveMarkerTypeVisibility } from './effective-overlay-visibility'
import { isDrawingVisible, isMarkerVisible, type LayerVisibilityState } from './layer-visibility-store'

/** Uses the renderer's effective type rules for marker interaction candidates. */
export function selectVisibleMarkers(markers: readonly Marker[], visibility: LayerVisibilityState): readonly Marker[] {
  const types = getEffectiveMarkerTypeVisibility(visibility.groupVisibility, visibility.markerTypeVisibility)
  return markers.filter((marker) => isMarkerVisible(types, visibility.hiddenMarkerIds, marker))
}

/** Shares drawing visibility between click selection and label dragging. */
export function selectVisibleDrawings(drawings: readonly Drawing[], visibility: LayerVisibilityState): readonly Drawing[] {
  const types = getEffectiveDrawingTypeVisibility(visibility.groupVisibility, visibility.drawingTypeVisibility)
  return drawings.filter((drawing) => isDrawingVisible(types, visibility.hiddenDrawingIds, drawing))
}
