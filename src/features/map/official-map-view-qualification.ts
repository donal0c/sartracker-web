import type maplibregl from 'maplibre-gl'
import type { OfficialMapId } from '../../lib/map-config'

export type OfficialMapViewRequest = {
  readonly mapId: OfficialMapId
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number }
  /** Raster source tile zoom, including MapLibre's 512/256 tile-size adjustment. */
  readonly zoom: number
}

export type OfficialMapViewQualification = OfficialMapViewRequest & {
  readonly status: 'complete' | 'partial' | 'missing' | 'error'
  readonly totalTiles: number
  readonly usableTiles: number
  readonly checkedAt: string
  readonly packageIdentities: readonly { readonly id: string; readonly sha256: string }[]
  readonly message: string
}

/** Captures the exact flat raster viewport being checked; unsupported views fail visibly. */
export function readOfficialMapViewRequest(mapId: OfficialMapId, map: maplibregl.Map): OfficialMapViewRequest {
  if (map.getPitch() !== 0) throw new Error('Return to a flat map view before checking offline coverage.')
  const bounds = map.getBounds()
  return {
    mapId,
    bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
    zoom: Math.min(19, Math.max(0, Math.round(map.getZoom() + 1))),
  }
}

/** Binds an asynchronous qualification to its original map, bounds and tile zoom. */
export function officialMapViewKey(request: OfficialMapViewRequest): string {
  return JSON.stringify([request.mapId, request.zoom, request.bounds.west, request.bounds.south,
    request.bounds.east, request.bounds.north])
}
