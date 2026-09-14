import type maplibregl from 'maplibre-gl'
import type { OfficialMapId } from '../../lib/map-config'
import { createRasterStyle } from './map-style'
import { buildOfficialMapTileTemplate } from './official-map-export'

/** Retains reconstruction intent across a partially completed raster mutation. */
export type OfficialMapRasterRecovery = { pending: boolean; beforeId?: string | undefined }

/** Discards cached GPU/source tiles after package mutation while preserving camera and overlays. */
export function refreshOfficialMapRaster(map: maplibregl.Map, mapId: OfficialMapId, revision: number,
  recovery: OfficialMapRasterRecovery = { pending: false }): boolean {
  // MapLibre exposes a serialized style only after its structure is initialized.
  // isStyleLoaded() also waits for every source's tiles, which must not delay
  // eviction of a removed/replaced package's resident raster.
  const currentStyle = map.getStyle()
  if (currentStyle === undefined) return false
  const layerId = `${mapId}-layer`
  const layers = currentStyle.layers
  const position = layers.findIndex(layer => layer.id === layerId)
  const hasSource = map.getSource(mapId) !== undefined
  if (position < 0 && !hasSource && !recovery.pending) return true
  const beforeId = recovery.pending && recovery.beforeId !== undefined && map.getLayer(recovery.beforeId) !== undefined
    ? recovery.beforeId : position < 0 ? layers[0]?.id : layers[position + 1]?.id
  const style = createRasterStyle(mapId)
  const source = style.sources[mapId]
  const layer = style.layers[0]
  if (source?.type !== 'raster' || layer === undefined) return false
  recovery.pending = true
  recovery.beforeId = beforeId
  if (position >= 0) {
    map.removeLayer(layerId)
    if (map.getLayer(layerId) !== undefined) throw new Error('Offline map layer could not be removed. Switch maps before relying on it.')
  }
  if (hasSource) {
    map.removeSource(mapId)
    if (map.getSource(mapId) !== undefined) throw new Error('Offline map source could not be removed. Switch maps before relying on it.')
  }
  map.addSource(mapId, {...source, tiles: [`${buildOfficialMapTileTemplate(mapId)}?revision=${revision}`]})
  if (map.getSource(mapId) === undefined) throw new Error('Offline map source could not be refreshed. Switch maps before relying on it.')
  map.addLayer(layer, beforeId)
  if (map.getLayer(layerId) === undefined) throw new Error('Offline map layer could not be refreshed. Switch maps before relying on it.')
  recovery.pending = false
  return true
}
