import { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'

import {
  getBasemapById,
  getOfficialMapById,
  isOfficialMapId,
  type RenderableMapId,
} from '../../lib/map-config'
import { buildOfficialMapTileTemplate } from './official-map-export'

export const IRELAND_MAX_BOUNDS: LngLatBoundsLike = [
  [-10.85, 51.25],
  [-5.25, 55.55],
]

/**
 * Builds the raster-only MapLibre style used by the v1 basemap shell.
 */
export function createRasterStyle(mapId: RenderableMapId): StyleSpecification {
  const mapSource = isOfficialMapId(mapId)
    ? {
        ...getOfficialMapById(mapId),
        tiles: [buildOfficialMapTileTemplate(mapId)] as const,
      }
    : getBasemapById(mapId)

  return {
    version: 8,
    sources: {
      [mapSource.id]: {
        type: 'raster',
        tiles: [...mapSource.tiles],
        tileSize: mapSource.tileSize,
        attribution: mapSource.attribution,
        maxzoom: mapSource.maxZoom,
      },
    },
    layers: [
      {
        id: `${mapSource.id}-layer`,
        type: 'raster',
        source: mapSource.id,
      },
    ],
  }
}
