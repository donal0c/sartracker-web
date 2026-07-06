import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec'
import type {
  AddLayerObject,
  GeoJSONSource,
  Map as MapLibreMap,
  SourceSpecification,
} from 'maplibre-gl'

export type MapOverlayFilter = FilterSpecification

type GeoJsonSourceMap = Pick<MapLibreMap, 'getSource' | 'addSource'>
type LayerMap = Pick<MapLibreMap, 'getLayer' | 'addLayer'>

type GeoJsonSourceCacheEntry = {
  readonly source: GeoJSONSource
  readonly data: GeoJSON.GeoJSON
  readonly dataKey: string | null
}

type EnsureGeoJsonSourceOptions = {
  /**
   * Stable identity for the overlay data represented by this GeoJSON payload.
   * When provided, repeated style-sync calls with the same key skip `setData`
   * unless MapLibre has replaced the underlying source object.
   */
  readonly dataKey?: string
}

export type LazyGeoJsonPayload = {
  readonly build: () => GeoJSON.GeoJSON
}

const sourceDataCache = new WeakMap<object, Map<string, GeoJsonSourceCacheEntry>>()
const objectIdentityTokens = new WeakMap<object, number>()
let nextObjectIdentityToken = 1

/**
 * Ensures a GeoJSON source exists for the active style, updating data when it
 * already exists so overlay sync calls remain idempotent.
 */
export function ensureGeoJsonSource(
  map: GeoJsonSourceMap,
  sourceId: string,
  data: GeoJSON.GeoJSON | LazyGeoJsonPayload,
  options: EnsureGeoJsonSourceOptions = {},
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined
  const dataKey = options.dataKey ?? null
  if (source !== undefined) {
    const cached = getSourceCache(map).get(sourceId)
    if (
      cached !== undefined &&
      cached.source === source &&
      (dataKey === null ? cached.data === data : cached.dataKey === dataKey)
    ) {
      return
    }

    const nextData = resolveGeoJsonPayload(data)
    source.setData(nextData)
    getSourceCache(map).set(sourceId, { source, data: nextData, dataKey })
    return
  }

  const initialData = resolveGeoJsonPayload(data)
  map.addSource(sourceId, {
    type: 'geojson',
    data: initialData,
  } satisfies SourceSpecification)
  const nextSource = map.getSource(sourceId) as GeoJSONSource | undefined
  if (nextSource !== undefined) {
    getSourceCache(map).set(sourceId, { source: nextSource, data: initialData, dataKey })
  }
}

/**
 * Adds a style layer only when the active style does not already contain it.
 */
export function ensureLayer(map: LayerMap, layer: AddLayerObject): void {
  if (map.getLayer(layer.id) !== undefined) {
    return
  }

  map.addLayer(layer)
}

/**
 * Combines a required geometry/kind filter with an optional visibility filter.
 */
export function combineMapFilters(
  baseFilter: MapOverlayFilter,
  visibilityFilter: MapOverlayFilter | null,
): MapOverlayFilter {
  if (visibilityFilter === null) {
    return baseFilter
  }

  return ['all', baseFilter, visibilityFilter] as MapOverlayFilter
}

/**
 * Builds a stable key from immutable store object identities and primitive
 * options so overlay sync can distinguish unchanged data from style rebuilds.
 */
export function createMapOverlayDataKey(parts: readonly unknown[]): string {
  return parts.map((part) => {
    if (part === null) {
      return 'null'
    }

    switch (typeof part) {
      case 'object':
      case 'function':
        return `ref:${getObjectIdentityToken(part)}`
      case 'string':
        return `str:${part}`
      case 'number':
      case 'boolean':
      case 'bigint':
      case 'symbol':
      case 'undefined':
        return `${typeof part}:${String(part)}`
    }
  }).join('|')
}

function getSourceCache(map: GeoJsonSourceMap): Map<string, GeoJsonSourceCacheEntry> {
  const mapObject = map as object
  const existing = sourceDataCache.get(mapObject)
  if (existing !== undefined) {
    return existing
  }

  const nextCache = new Map<string, GeoJsonSourceCacheEntry>()
  sourceDataCache.set(mapObject, nextCache)
  return nextCache
}

function getObjectIdentityToken(value: object): number {
  const existing = objectIdentityTokens.get(value)
  if (existing !== undefined) {
    return existing
  }

  const nextToken = nextObjectIdentityToken
  nextObjectIdentityToken += 1
  objectIdentityTokens.set(value, nextToken)
  return nextToken
}

function resolveGeoJsonPayload(data: GeoJSON.GeoJSON | LazyGeoJsonPayload): GeoJSON.GeoJSON {
  return isLazyGeoJsonPayload(data) ? data.build() : data
}

function isLazyGeoJsonPayload(data: GeoJSON.GeoJSON | LazyGeoJsonPayload): data is LazyGeoJsonPayload {
  return typeof (data as LazyGeoJsonPayload).build === 'function'
}

/**
 * Converts an inline SVG into ImageData so MapLibre can use it as an icon.
 */
export async function loadSvgIcon(svg: string, label: string): Promise<ImageData> {
  const image = await loadHtmlImage(svg, label)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error(`${label} icon canvas context was unavailable.`)
  }

  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function loadHtmlImage(svg: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`${label} icon failed to load.`))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
