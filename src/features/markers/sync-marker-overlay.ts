import type maplibregl from 'maplibre-gl'
import type { GeoJsonProperties, Point } from 'geojson'

import { buildMarkerLayerFilter } from '../layers/map-layer-filters'
import type { Marker, MarkerType } from '../../infrastructure/mission-store/tauri-mission-store'
import { createMarkerFeatureCollection } from './marker-geojson'

export const MARKER_SOURCE_ID = 'mission-markers'
export const MARKER_HITBOX_LAYER_ID = 'mission-markers-hitbox'
export const MARKER_TYPES: readonly MarkerType[] = ['ipp_lkp', 'clue', 'hazard', 'casualty']

/**
 * Synchronizes persisted mission markers into the current map style and applies
 * per-type visibility filters.
 */
export async function syncMarkerOverlay(
  map: maplibregl.Map,
  markers: readonly Marker[],
  markerTypeVisibility: Record<MarkerType, boolean>,
  hiddenMarkerIds: readonly string[],
): Promise<void> {
  await ensureMarkerImages(map)
  ensureMarkerSource(map, createMarkerFeatureCollection(markers))

  if (!map.getLayer(MARKER_HITBOX_LAYER_ID)) {
    map.addLayer({
      id: MARKER_HITBOX_LAYER_ID,
      type: 'circle',
      source: MARKER_SOURCE_ID,
      paint: {
        'circle-radius': 16,
        'circle-color': '#000000',
        'circle-opacity': 0,
        'circle-stroke-width': 0,
      },
    })
  }

  for (const markerType of MARKER_TYPES) {
    const symbolLayerId = getMarkerSymbolLayerId(markerType)
    const labelLayerId = getMarkerLabelLayerId(markerType)

    if (!map.getLayer(symbolLayerId)) {
      map.addLayer({
        id: symbolLayerId,
        type: 'symbol',
        source: MARKER_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'iconId'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }

    if (!map.getLayer(labelLayerId)) {
      map.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: MARKER_SOURCE_ID,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': ['get', 'labelColor'],
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.4,
        },
      })
    }

    const typeFilter = buildMarkerLayerFilter(
      markerType,
      markerTypeVisibility[markerType],
      hiddenMarkerIds,
    )
    map.setFilter(symbolLayerId, typeFilter)
    map.setFilter(labelLayerId, typeFilter)
  }

  const visibleTypeFilters = MARKER_TYPES.filter((type) => markerTypeVisibility[type]).map((type) =>
    buildMarkerLayerFilter(type, true, hiddenMarkerIds),
  )
  map.setFilter(
    MARKER_HITBOX_LAYER_ID,
    visibleTypeFilters.length === 0
      ? ['==', ['get', 'markerId'], '__hidden__']
      : ['any', ...visibleTypeFilters],
  )
}

export function getMarkerSymbolLayerId(markerType: MarkerType): string {
  return `mission-markers-symbol-${markerType}`
}

export function getMarkerLabelLayerId(markerType: MarkerType): string {
  return `mission-markers-label-${markerType}`
}

function ensureMarkerSource(
  map: maplibregl.Map,
  data: GeoJSON.FeatureCollection<Point, GeoJsonProperties>,
): void {
  const source = map.getSource(MARKER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(MARKER_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

async function ensureMarkerImages(map: maplibregl.Map): Promise<void> {
  for (const [imageId, svg] of Object.entries(MARKER_IMAGE_SVGS)) {
    if (map.hasImage(imageId)) {
      continue
    }

    const image = await loadSvgImage(svg)
    map.addImage(imageId, image)
  }
}

async function loadSvgImage(svg: string): Promise<ImageData> {
  const image = await loadHtmlImage(svg)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('Marker icon canvas context was unavailable.')
  }

  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function loadHtmlImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Marker icon failed to load.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

const MARKER_IMAGE_SVGS: Record<string, string> = {
  'marker-ipp_lkp': `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <polygon points="17,2 20.8,12 31.5,12 22.7,18.5 26,30 17,23 8,30 11.3,18.5 2.5,12 13.2,12"
        fill="#0066FF" stroke="#FFFFFF" stroke-width="2" />
    </svg>
  `,
  'marker-clue': `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="11" fill="#FFFFFF" stroke="#111827" stroke-width="2.5" />
    </svg>
  `,
  'marker-hazard': `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <polygon points="17,30 31,7 3,7" fill="#FF0000" stroke="#FFFFFF" stroke-width="2" />
    </svg>
  `,
  'marker-casualty': `
    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
      <ellipse cx="21" cy="32" rx="11" ry="4" fill="#111827" opacity="0.35" />
      <polygon points="21,3 25.5,14.5 38,14.5 27.8,22.2 31.8,35.5 21,27.1 10.2,35.5 14.2,22.2 4,14.5 16.5,14.5"
        fill="#FF0000" stroke="#FFFFFF" stroke-width="2.4" />
    </svg>
  `,
}
