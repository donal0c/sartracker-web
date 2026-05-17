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

/**
 * Ensures a GeoJSON source exists for the active style, updating data when it
 * already exists so overlay sync calls remain idempotent.
 */
export function ensureGeoJsonSource(
  map: GeoJsonSourceMap,
  sourceId: string,
  data: GeoJSON.GeoJSON,
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(sourceId, {
    type: 'geojson',
    data,
  } satisfies SourceSpecification)
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
