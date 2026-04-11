import type maplibregl from 'maplibre-gl'

import type {
  Helicopter,
  HelicopterSlotKey,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { buildHelicopterLayerFilter } from '../layers/map-layer-filters'
import { createHelicopterFeatureCollection } from './helicopter-geojson'

export const HELICOPTER_SOURCE_ID = 'mission-helicopters'
export const HELICOPTER_SYMBOL_LAYER_ID = 'mission-helicopters-symbol'
export const HELICOPTER_LABEL_LAYER_ID = 'mission-helicopters-label'

export async function syncHelicopterOverlay(
  map: maplibregl.Map,
  helicopters: readonly Helicopter[],
  slotVisibility: Record<HelicopterSlotKey, boolean>,
  hiddenHelicopterIds: readonly string[],
): Promise<void> {
  await ensureHelicopterImages(map)
  ensureHelicopterSource(map, createHelicopterFeatureCollection(helicopters))

  if (!map.getLayer(HELICOPTER_SYMBOL_LAYER_ID)) {
    map.addLayer({
      id: HELICOPTER_SYMBOL_LAYER_ID,
      type: 'symbol',
      source: HELICOPTER_SOURCE_ID,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-size': 1,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }

  if (!map.getLayer(HELICOPTER_LABEL_LAYER_ID)) {
    map.addLayer({
      id: HELICOPTER_LABEL_LAYER_ID,
      type: 'symbol',
      source: HELICOPTER_SOURCE_ID,
      layout: {
        'text-field': ['get', 'callSign'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#020617',
        'text-halo-width': 1.4,
      },
    })
  }

  const filter = buildHelicopterLayerFilter(slotVisibility, hiddenHelicopterIds)
  map.setFilter(HELICOPTER_SYMBOL_LAYER_ID, filter)
  map.setFilter(HELICOPTER_LABEL_LAYER_ID, filter)
}

function ensureHelicopterSource(map: maplibregl.Map, data: GeoJSON.FeatureCollection): void {
  const source = map.getSource(HELICOPTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(HELICOPTER_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

async function ensureHelicopterImages(map: maplibregl.Map): Promise<void> {
  const icons: Record<HelicopterSlotKey, string> = {
    slot_1: svgForColor('#f43f5e'),
    slot_2: svgForColor('#34d399'),
    slot_3: svgForColor('#38bdf8'),
    slot_4: svgForColor('#d946ef'),
  }

  for (const [slotKey, svg] of Object.entries(icons) as [HelicopterSlotKey, string][]) {
    const imageId = `helicopter-${slotKey}`
    if (map.hasImage(imageId)) {
      continue
    }

    const image = await loadSvgImage(svg)
    map.addImage(imageId, image)
  }
}

function svgForColor(color: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <path d="M22 4 L36 34 L22 28 L8 34 Z" fill="${color}" stroke="#FFFFFF" stroke-width="2.5" />
      <circle cx="22" cy="18" r="3" fill="#FFFFFF" />
    </svg>
  `
}

async function loadSvgImage(svg: string): Promise<ImageData> {
  const image = await loadHtmlImage(svg)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('Helicopter icon canvas context was unavailable.')
  }

  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function loadHtmlImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Helicopter icon failed to load.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
