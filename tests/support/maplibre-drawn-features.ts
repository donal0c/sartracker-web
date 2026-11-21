import {
  createPropertyExpression,
  featureFilter,
  latest,
  type FilterSpecification,
  type StylePropertySpecification,
} from '@maplibre/maplibre-gl-style-spec'

import {
  TRACKING_BREADCRUMB_DOTS_LAYER_ID,
  TRACKING_BREADCRUMB_LAYER_ID,
  TRACKING_BREADCRUMB_LONE_FIX_LAYER_ID,
} from '../../src/features/tracking/sync-tracking-overlay'

/**
 * A MapLibre stand-in for unit tests that records sources and layers and can
 * say which features a layer would actually draw [DON-338].
 *
 * Counting features in a GeoJSON source is not enough to prove a trail is on
 * the map: the drawing layer could be missing, hidden, transparent or filtered
 * so that it draws nothing. `readDrawnFeatures` only returns a feature when a
 * layer on its source exists, is visible, is of a type that draws that
 * geometry, has a filter that MapLibre's own style-spec evaluator accepts for
 * the feature's properties, and has a size and opacity that the same
 * evaluator resolves above zero for that feature. A paint value the evaluator
 * cannot parse or evaluate throws instead of counting the feature as drawn.
 */

export type RecordedFeature = {
  readonly id?: string | number
  readonly type?: 'Feature'
  readonly geometry: {
    readonly type: string
    readonly coordinates: unknown
  }
  readonly properties: Readonly<Record<string, unknown>>
}

export type RecordedLayer = {
  readonly id: string
  readonly type: string
  readonly source?: string
  filter?: unknown
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

type SourceDiff = {
  readonly remove?: readonly (string | number)[]
  readonly add?: readonly RecordedFeature[]
  readonly update?: readonly unknown[]
}

/**
 * The layers that draw an operator's trail in the device colour: the line,
 * lone fixes and exact dots. The dark casing is left out on purpose, so hiding
 * the coloured line is caught even though the casing would still draw.
 */
export const TRAIL_DRAWING_LAYER_IDS: readonly string[] = [
  TRACKING_BREADCRUMB_LAYER_ID,
  TRACKING_BREADCRUMB_LONE_FIX_LAYER_ID,
  TRACKING_BREADCRUMB_DOTS_LAYER_ID,
]

/** A feature together with the visible layer that draws it. */
export type DrawnFeature = {
  readonly layerId: string
  readonly sourceId: string
  readonly feature: RecordedFeature
}

/**
 * Creates the recorder. It returns one stable handle per source, as MapLibre
 * does, and applies `updateData` diffs, so the same map can be reused across
 * many overlay syncs.
 */
export function createDrawingRecorderMap() {
  const layers = new Map<string, RecordedLayer>()
  const layerOrder: string[] = []
  const sourceData = new Map<string, RecordedFeature[]>()
  const handles = new Map<string, unknown>()
  let incrementalUpdates = 0

  return {
    layers,
    layerOrder,
    sourceData,
    get incrementalUpdates(): number {
      return incrementalUpdates
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => {
      if (!sourceData.has(id)) return undefined
      const existing = handles.get(id)
      if (existing !== undefined) return existing
      const handle = {
        setData: (data: { readonly features: readonly RecordedFeature[] }) => {
          sourceData.set(id, [...data.features])
        },
        updateData: (diff: SourceDiff) => {
          if (diff.update !== undefined && diff.update.length > 0) {
            throw new Error('Property-only source updates are not recorded by this stand-in.')
          }
          incrementalUpdates += 1
          const removed = new Set(diff.remove ?? [])
          const current = (sourceData.get(id) ?? []).filter(
            (feature) => feature.id === undefined || !removed.has(feature.id),
          )
          for (const feature of diff.add ?? []) {
            if (current.some((candidate) => candidate.id === feature.id)) {
              throw new Error(`Duplicate feature id added: ${String(feature.id)}`)
            }
            current.push(feature)
          }
          sourceData.set(id, current)
        },
      }
      handles.set(id, handle)
      return handle
    },
    addLayer: (spec: RecordedLayer, beforeId?: string) => {
      layers.set(spec.id, { ...spec })
      const index = beforeId === undefined ? -1 : layerOrder.indexOf(beforeId)
      if (index < 0) layerOrder.push(spec.id)
      else layerOrder.splice(index, 0, spec.id)
    },
    addSource: (id: string, config: { readonly data: { readonly features: readonly RecordedFeature[] } }) => {
      sourceData.set(id, [...config.data.features])
    },
    getFilter: (id: string) => layers.get(id)?.filter,
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.filter = filter
    },
    getPaintProperty: (id: string, property: string) => layers.get(id)?.paint?.[property],
    setPaintProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.paint = { ...(layer.paint ?? {}), [property]: value }
    },
    getLayoutProperty: (id: string, property: string) => layers.get(id)?.layout?.[property],
    setLayoutProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.layout = { ...(layer.layout ?? {}), [property]: value }
    },
  }
}

export type DrawingRecorderMap = ReturnType<typeof createDrawingRecorderMap>

/** Geometry types each drawing layer type renders; other layer types are ignored. */
const DRAWABLE_GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  line: ['LineString', 'MultiLineString'],
  circle: ['Point', 'MultiPoint'],
}

/** Paint properties that, when zero or less, make a layer of that type draw nothing. */
const ZERO_MEANS_INVISIBLE: Readonly<Record<string, readonly string[]>> = {
  line: ['line-width', 'line-opacity'],
  circle: ['circle-radius', 'circle-opacity'],
}

/** The zoom the trail regressions evaluate filters and paint at. */
const EVALUATION_ZOOM = 14

/** MapLibre's style-spec definitions for each layer type's paint properties. */
const PAINT_SPECS: Readonly<Record<string, Readonly<Record<string, StylePropertySpecification>>>> = {
  line: latest.paint_line as Record<string, StylePropertySpecification>,
  circle: latest.paint_circle as Record<string, StylePropertySpecification>,
}

type PaintEvaluator = (feature: { readonly type: 1 | 2 | 3; readonly properties: Record<string, unknown>; readonly id?: string | number }) => unknown

/**
 * Compiles one paint property with MapLibre's own expression parser. An unset
 * property uses the style-spec default. Anything that does not parse, or that
 * depends on feature state the stand-in does not hold, throws.
 */
function compilePaintProperty(layer: RecordedLayer, property: string): PaintEvaluator {
  const spec = PAINT_SPECS[layer.type]?.[property]
  if (spec === undefined) {
    throw new Error(`No style-spec definition for ${layer.type} paint property ${property}.`)
  }
  const value = layer.paint?.[property] ?? (spec as { readonly default?: unknown }).default
  const compiled = createPropertyExpression(value, spec)
  if (compiled.result === 'error') {
    throw new Error(
      `Cannot evaluate ${property} on layer ${layer.id}: ${compiled.value.map((error) => error.message).join('; ')}`,
    )
  }
  if (compiled.value.isStateDependent) {
    throw new Error(`Cannot evaluate ${property} on layer ${layer.id}: it depends on feature state.`)
  }
  const expression = compiled.value
  return (feature) => {
    try {
      return expression.evaluateWithoutErrorHandling({ zoom: EVALUATION_ZOOM }, feature as never)
    } catch (error) {
      throw new Error(
        `Cannot evaluate ${property} on layer ${layer.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** MapLibre's vector-tile geometry codes, which `['geometry-type']` filters read. */
const GEOMETRY_TYPE_CODE: Readonly<Record<string, 1 | 2 | 3>> = {
  Point: 1,
  MultiPoint: 1,
  LineString: 2,
  MultiLineString: 2,
  Polygon: 3,
  MultiPolygon: 3,
}

/**
 * Returns every (layer, feature) pair the map would draw. A zero-length line
 * (all points at one place) draws nothing in MapLibre, so it is left out.
 */
export function readDrawnFeatures(
  map: DrawingRecorderMap,
  options: { readonly layerIds?: readonly string[] } = {},
): readonly DrawnFeature[] {
  const drawn: DrawnFeature[] = []
  for (const layerId of map.layerOrder) {
    if (options.layerIds !== undefined && !options.layerIds.includes(layerId)) continue
    const layer = map.layers.get(layerId)
    if (layer === undefined || layer.source === undefined) continue
    const geometryTypes = DRAWABLE_GEOMETRY[layer.type]
    if (geometryTypes === undefined) continue
    if (layer.layout?.visibility === 'none') continue
    const paintEvaluators = (ZERO_MEANS_INVISIBLE[layer.type] ?? []).map(
      (property) => [property, compilePaintProperty(layer, property)] as const,
    )
    const features = map.sourceData.get(layer.source) ?? []
    const filter = layer.filter === undefined
      ? null
      : featureFilter(layer.filter as FilterSpecification)
    for (const feature of features) {
      if (!geometryTypes.includes(feature.geometry.type)) continue
      if (feature.geometry.type === 'LineString' && !hasTwoDistinctPoints(feature.geometry.coordinates)) {
        continue
      }
      const evaluated = {
        type: GEOMETRY_TYPE_CODE[feature.geometry.type] ?? 1,
        properties: { ...feature.properties },
        ...(feature.id === undefined ? {} : { id: feature.id }),
      }
      if (filter !== null && !filter.filter({ zoom: EVALUATION_ZOOM }, evaluated as never)) {
        continue
      }
      if (!paintEvaluators.every(([property, evaluate]) => isPositivePaintValue(layer, property, evaluate(evaluated)))) {
        continue
      }
      drawn.push({ layerId, sourceId: layer.source, feature })
    }
  }
  return drawn
}

/** Negative-control helper: hides a layer the way an operator toggle or a bad filter would. */
export function hideLayerForControl(
  map: DrawingRecorderMap,
  layerId: string,
  how: 'visibility' | 'filter',
): void {
  if (map.layers.get(layerId) === undefined) {
    throw new Error(`Cannot hide missing layer ${layerId}.`)
  }
  if (how === 'visibility') map.setLayoutProperty(layerId, 'visibility', 'none')
  else map.setFilter(layerId, ['==', ['get', 'deviceId'], '__no_device__'])
}

/** True when a size or opacity value draws something; a non-number throws. */
function isPositivePaintValue(layer: RecordedLayer, property: string, value: unknown): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${property} on layer ${layer.id} evaluated to ${String(value)}, not a number.`)
  }
  return value > 0
}

function hasTwoDistinctPoints(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates)) return false
  const first = coordinates[0] as unknown
  if (!Array.isArray(first)) return false
  return coordinates.some(
    (coordinate) => Array.isArray(coordinate) &&
      (coordinate[0] !== first[0] || coordinate[1] !== first[1]),
  )
}
