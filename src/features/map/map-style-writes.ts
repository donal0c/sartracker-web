import type { Map as MapLibreMap } from 'maplibre-gl'

type FilterMap = {
  readonly getLayer: (layerId: string) => unknown
  readonly getFilter: MapLibreMap['getFilter']
  readonly setFilter: (id: string, filter: Parameters<MapLibreMap['setFilter']>[1]) => unknown
}
type PaintMap = {
  readonly getLayer: (layerId: string) => unknown
  readonly getPaintProperty: MapLibreMap['getPaintProperty']
  readonly setPaintProperty: MapLibreMap['setPaintProperty']
}

/** Avoids MapLibre's unconditional redraw when the current filter already matches. */
export function setMapFilterIfChanged(
  map: FilterMap,
  layerId: string,
  filter: Parameters<MapLibreMap['setFilter']>[1],
): void {
  if (map.getLayer(layerId) === undefined) {
    return
  }

  let currentFilter: ReturnType<MapLibreMap['getFilter']>
  try {
    currentFilter = map.getFilter(layerId)
  } catch (error) {
    if (map.getLayer(layerId) === undefined) {
      return
    }
    throw error
  }

  if (!mapLibreValuesEqual(currentFilter, filter)) {
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
  if (map.getLayer(layerId) === undefined) {
    return
  }

  let currentValue: unknown
  try {
    currentValue = map.getPaintProperty(layerId, property)
  } catch (error) {
    if (map.getLayer(layerId) === undefined) {
      return
    }
    throw error
  }

  if (!mapLibreValuesEqual(currentValue, value)) {
    map.setPaintProperty(layerId, property, value)
  }
}

/** Treats null and undefined as the same top-level unset style value. */
function mapLibreValuesEqual(current: unknown, next: unknown): boolean {
  const currentUnset = current === null || current === undefined
  const nextUnset = next === null || next === undefined
  if (currentUnset && nextUnset) {
    return true
  }

  return mapLibreDeepEqual(current, next)
}

/** Mirrors MapLibre's structural comparison for style filters and properties. */
export function mapLibreDeepEqual(current: unknown, next: unknown): boolean {
  if (Array.isArray(current)) {
    if (!Array.isArray(next) || current.length !== next.length) {
      return false
    }

    for (let index = 0; index < current.length; index += 1) {
      if (!mapLibreDeepEqual(current[index], next[index])) {
        return false
      }
    }
    return true
  }

  if (typeof current === 'object' && current !== null && next !== null) {
    if (typeof next !== 'object') {
      return false
    }

    const currentObject = current as Record<string, unknown>
    const nextObject = next as Record<string, unknown>
    const currentKeys = Object.keys(currentObject)
    if (currentKeys.length !== Object.keys(nextObject).length) {
      return false
    }

    for (const key in currentObject) {
      if (!mapLibreDeepEqual(currentObject[key], nextObject[key])) {
        return false
      }
    }
    return true
  }

  return current === next
}
