import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  CanvasSourceSpecification,
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl'
import { createCoverageTileUrl } from './coverage-tile-protocol'
import { TRACKING_BREADCRUMB_CASING_LAYER_ID } from './sync-tracking-overlay'
import { buildCoverageLayerFilter } from '../layers/map-layer-filters'

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
  readonly setFilter: (id: string, filter: ExpressionSpecification | null) => void
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
  filters: {
    readonly omittedDeviceIds: readonly string[]
    readonly omittedPeriodKeys: readonly string[]
  } = { omittedDeviceIds: [], omittedPeriodKeys: [] },
): { readonly periods: CoverageTileCatalog['periods'] } {
  const overlays = overlaysByMap.get(map) ?? new Map<string, PeriodOverlay>()
  overlaysByMap.set(map, overlays)
  const browserHarnessGeoJson = catalog?.browserHarnessGeoJson
  const desiredPeriods = browserHarnessGeoJson === undefined
    ? (catalog?.periods ?? [])
    : [{
        periodKey: 'browser-harness',
        revisionDigest: (catalog?.periods ?? [])
          .map((period) => period.revisionDigest).join('-') || 'empty',
      }]
  const desired = new Map(desiredPeriods.map((period) => [period.periodKey, period]))

  for (const [periodKey, overlay] of [...overlays.entries()]) {
    const next = desired.get(periodKey)
    const sourceSurvivedStyle = map.getSource(overlay.sourceId) !== undefined
    if (next?.revisionDigest === overlay.revisionDigest && sourceSurvivedStyle) {
      applyCoverageFilters(map, overlay, filters)
      continue
    }
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
    map.addSource(sourceId, browserHarnessGeoJson === undefined
      ? {
          type: 'vector',
          tiles: [createCoverageTileUrl(period.periodKey, period.revisionDigest)],
          minzoom: 0,
          maxzoom: 16,
        }
      : { type: 'geojson', data: browserHarnessGeoJson as never })
    map.addLayer({
      id: lineLayerId,
      source: sourceId,
      ...(browserHarnessGeoJson === undefined ? { 'source-layer': 'coverage' } : {}),
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
      ...(browserHarnessGeoJson === undefined ? { 'source-layer': 'coverage' } : {}),
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
    applyCoverageFilters(map, overlays.get(period.periodKey)!, filters)
  }
  for (const period of desired.values()) {
    const overlay = overlays.get(period.periodKey)
    if (
      overlay === undefined ||
      map.getSource(overlay.sourceId) === undefined ||
      overlay.layerIds.some((layerId) => map.getLayer(layerId) === undefined)
    ) {
      throw new Error('Coverage overlay activation failed after source installation.')
    }
  }
  return { periods: catalog?.periods ?? [] }
}

function applyCoverageFilters(
  map: CoverageOverlayMap,
  overlay: PeriodOverlay,
  filters: {
    readonly omittedDeviceIds: readonly string[]
    readonly omittedPeriodKeys: readonly string[]
  },
): void {
  const omissionFilter = buildCoverageLayerFilter(
    filters.omittedDeviceIds,
    filters.omittedPeriodKeys,
  )
  const geometryKinds = ['LineString', 'Point'] as const
  for (const [index, layerId] of overlay.layerIds.entries()) {
    if (map.getLayer(layerId) === undefined) continue
    const geometryFilter: ExpressionSpecification = [
      '==', ['geometry-type'], geometryKinds[index]!,
    ]
    map.setFilter(layerId, omissionFilter === null
      ? geometryFilter
      : ['all', geometryFilter, omissionFilter])
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
