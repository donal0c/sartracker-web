import type maplibregl from 'maplibre-gl'
import type { OfficialMapId } from '../../lib/map-config'
import { createRasterStyle } from './map-style'
import { buildOfficialMapTileTemplate } from './official-map-export'

/** Discards cached GPU/source tiles after package mutation while preserving camera and overlays. */
export function refreshOfficialMapRaster(map: maplibregl.Map, mapId: OfficialMapId, revision: number): boolean {
  if (!map.isStyleLoaded()) return false
  const layerId = `${mapId}-layer`
  const layers = map.getStyle().layers
  const position = layers.findIndex(layer => layer.id === layerId)
  const hasSource = map.getSource(mapId) !== undefined
  if (position < 0 && !hasSource) return true
  const beforeId = position < 0 ? layers[0]?.id : layers[position + 1]?.id
  const style = createRasterStyle(mapId)
  const source = style.sources[mapId]
  const layer = style.layers[0]
  if (source?.type !== 'raster' || layer === undefined) return false
  if (position >= 0) map.removeLayer(layerId)
  if (hasSource) map.removeSource(mapId)
  map.addSource(mapId, {...source, tiles: [`${buildOfficialMapTileTemplate(mapId)}?revision=${revision}`]})
  map.addLayer(layer, beforeId)
  return true
}
