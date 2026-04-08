import { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'

import { getBasemapById, type BasemapId } from '../../lib/map-config'

export const KERRY_MAX_BOUNDS: LngLatBoundsLike = [
  [-10.7, 51.55],
  [-9.1, 52.6],
]

export function createRasterStyle(basemapId: BasemapId): StyleSpecification {
  const basemap = getBasemapById(basemapId)

  return {
    version: 8,
    sources: {
      [basemap.id]: {
        type: 'raster',
        tiles: [...basemap.tiles],
        tileSize: basemap.tileSize,
        attribution: basemap.attribution,
        maxzoom: basemap.maxZoom,
      },
    },
    layers: [
      {
        id: `${basemap.id}-layer`,
        type: 'raster',
        source: basemap.id,
      },
    ],
  }
}
