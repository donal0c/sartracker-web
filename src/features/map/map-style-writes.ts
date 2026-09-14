import type { Map as MapLibreMap } from 'maplibre-gl'

type FilterMap = {
  readonly getFilter: MapLibreMap['getFilter']
  readonly setFilter: (id: string, filter: Parameters<MapLibreMap['setFilter']>[1]) => unknown
}
type PaintMap = Pick<MapLibreMap, 'getPaintProperty' | 'setPaintProperty'>

/** Avoids MapLibre's unconditional redraw when the current filter already matches. */
export function setMapFilterIfChanged(
  map: FilterMap,
  layerId: string,
  filter: Parameters<MapLibreMap['setFilter']>[1],
): void {
  if (JSON.stringify(map.getFilter(layerId) ?? null) !== JSON.stringify(filter ?? null)) {
    map.setFilter(layerId, filter)
  }
}

/** Reads the current style so replacement layers and external edits remain repairable. */
export function setMapPaintPropertyIfChanged(
  map: PaintMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (JSON.stringify(map.getPaintProperty(layerId, property)) !== JSON.stringify(value)) {
    map.setPaintProperty(layerId, property, value)
  }
}
