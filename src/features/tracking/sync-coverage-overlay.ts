import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  CanvasSourceSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl'
import { createCoverageTileUrl } from './coverage-tile-protocol'
import { TRACKING_BREADCRUMB_CASING_LAYER_ID } from './sync-tracking-overlay'

export type CoverageOverlayMap = {
  readonly addSource: (
    id: string,
    source: SourceSpecification | CanvasSourceSpecification,
  ) => unknown
  readonly getSource: (id: string) => unknown
  readonly removeSource: (id: string) => void
  readonly addLayer: (layer: LayerSpecification, beforeId?: string) => unknown
  readonly getLayer: (id: string) => unknown
  readonly removeLayer: (id: string) => void
}

type PeriodOverlay = {
  readonly revisionDigest: string
  readonly sourceId: string
  readonly layerIds: readonly string[]
}

const overlaysByMap = new WeakMap<object, Map<string, PeriodOverlay>>()

/**
 * Synchronizes Candidate-B period sources independently. An unrelated chunk
 * revision therefore cannot remove or reload a retained period source.
 */
export function syncCoverageOverlay(
  map: CoverageOverlayMap,
  catalog: CoverageTileCatalog | null,
): void {
  const overlays = overlaysByMap.get(map) ?? new Map<string, PeriodOverlay>()
  overlaysByMap.set(map, overlays)
  const desired = new Map((catalog?.periods ?? []).map((period) => [
    period.periodKey,
    period,
  ]))

  for (const [periodKey, overlay] of [...overlays.entries()]) {
    const next = desired.get(periodKey)
    const sourceSurvivedStyle = map.getSource(overlay.sourceId) !== undefined
    if (next?.revisionDigest === overlay.revisionDigest && sourceSurvivedStyle) continue
    removePeriodOverlay(map, overlay)
    overlays.delete(periodKey)
  }

  for (const period of desired.values()) {
    if (overlays.has(period.periodKey)) continue
    const sourceId = `coverage-${encodeIdentity(period.periodKey)}`
    const lineLayerId = `${sourceId}-line`
    const pointLayerId = `${sourceId}-point`
    const beforeTrackingLayer = map.getLayer(TRACKING_BREADCRUMB_CASING_LAYER_ID) === undefined
      ? undefined
      : TRACKING_BREADCRUMB_CASING_LAYER_ID
    map.addSource(sourceId, {
      type: 'vector',
      tiles: [createCoverageTileUrl(period.periodKey, period.revisionDigest)],
      minzoom: 0,
      maxzoom: 16,
    })
    map.addLayer({
      id: lineLayerId,
      source: sourceId,
      'source-layer': 'coverage',
      type: 'line',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#7c3aed',
        'line-width': 2,
        'line-opacity': 0.78,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    }, beforeTrackingLayer)
    map.addLayer({
      id: pointLayerId,
      source: sourceId,
      'source-layer': 'coverage',
      type: 'circle',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': '#7c3aed',
        'circle-radius': 3,
        'circle-opacity': 0.78,
      },
    }, beforeTrackingLayer)
    overlays.set(period.periodKey, {
      revisionDigest: period.revisionDigest,
      sourceId,
      layerIds: [lineLayerId, pointLayerId],
    })
  }
}

function removePeriodOverlay(map: CoverageOverlayMap, overlay: PeriodOverlay): void {
  for (const layerId of overlay.layerIds) {
    if (map.getLayer(layerId) !== undefined) map.removeLayer(layerId)
  }
  if (map.getSource(overlay.sourceId) !== undefined) map.removeSource(overlay.sourceId)
}

function encodeIdentity(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}
