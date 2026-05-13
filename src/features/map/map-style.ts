import { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'

import { getBasemapById, type BasemapId } from '../../lib/map-config'

export const IRELAND_MAX_BOUNDS: LngLatBoundsLike = [
  [-10.85, 51.25],
  [-5.25, 55.55],
]

/**
 * Builds the raster-only MapLibre style used by the v1 basemap shell.
 */
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
