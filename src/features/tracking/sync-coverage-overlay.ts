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
  readonly isSourceLoaded?: (id: string) => boolean
  readonly on?: (
    event: 'sourcedata' | 'error',
    listener: (event: { readonly sourceId?: string }) => void,
  ) => unknown
  readonly off?: (
    event: 'sourcedata' | 'error',
    listener: (event: { readonly sourceId?: string }) => void,
  ) => unknown
}

export type CoverageOverlayActivation = {
  readonly periods: CoverageTileCatalog['periods']
  readonly commit: () => void
  readonly finalize: () => void
  readonly rollback: () => void
}

type PeriodOverlay = {
  readonly missionId: string
  readonly revisionDigest: string
  readonly sourceId: string
  readonly layerIds: readonly string[]
}

const overlaysByMap = new WeakMap<object, Map<string, PeriodOverlay>>()
let nextOverlaySequence = 0

/** Confirms the current mission-scoped catalog still exists in this map style. */
export function isCoverageOverlayAttached(
  map: CoverageOverlayMap,
  catalog: CoverageTileCatalog,
): boolean {
  const overlays = overlaysByMap.get(map)
  if (overlays === undefined) return false
  const desiredPeriods = catalog.browserHarnessGeoJson === undefined
    ? catalog.periods
    : [{
        periodKey: 'browser-harness',
        revisionDigest: catalog.periods.map((period) => period.revisionDigest).join('-') || 'empty',
      }]
  return desiredPeriods.every((period) => {
    const overlay = overlays.get(period.periodKey)
    return overlay?.missionId === catalog.missionId &&
      overlay.revisionDigest === period.revisionDigest &&
      map.getSource(overlay.sourceId) !== undefined &&
      overlay.layerIds.every((layerId) => map.getLayer(layerId) !== undefined)
  })
}

/**
 * Synchronizes Candidate-B period sources independently. An unrelated chunk
 * revision therefore cannot remove or reload a retained period source.
 */
export async function syncCoverageOverlay(
  map: CoverageOverlayMap,
  catalog: CoverageTileCatalog | null,
  filters: {
    readonly omittedDeviceIds: readonly string[]
    readonly omittedPeriodKeys: readonly string[]
  } = { omittedDeviceIds: [], omittedPeriodKeys: [] },
  signal: AbortSignal = new AbortController().signal,
): Promise<CoverageOverlayActivation> {
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

  const staged: {
    readonly periodKey: string
    readonly prior: PeriodOverlay | undefined
    readonly next: PeriodOverlay
  }[] = []
  for (const period of desired.values()) {
    const prior = overlays.get(period.periodKey)
    const sourceSurvivedStyle = prior !== undefined &&
      map.getSource(prior.sourceId) !== undefined
    if (
      prior !== undefined &&
      prior.missionId === catalog?.missionId &&
      prior.revisionDigest === period.revisionDigest &&
      sourceSurvivedStyle
    ) {
      applyCoverageFilters(map, prior, filters)
      continue
    }
    try {
      staged.push({
        periodKey: period.periodKey,
        prior,
        next: installPeriodOverlay(
          map,
          catalog?.missionId ?? 'browser-harness',
          period,
          browserHarnessGeoJson,
          filters,
        ),
      })
    } catch (error) {
      for (const replacement of staged) removePeriodOverlay(map, replacement.next)
      throw error
    }
  }
  try {
    await waitForCoverageSourcesLoaded(map, staged.map((entry) => entry.next), signal)
  } catch (error) {
    for (const replacement of staged) removePeriodOverlay(map, replacement.next)
    throw error
  }
  let committed = false
  let finalized = false
  return {
    periods: catalog?.periods ?? [],
    commit: () => {
      if (committed || finalized) return
      committed = true
      for (const replacement of staged) {
        overlays.set(replacement.periodKey, replacement.next)
      }
    },
    rollback: () => {
      if (finalized) return
      for (const replacement of staged) {
        removePeriodOverlay(map, replacement.next)
        if (replacement.prior === undefined) {
          overlays.delete(replacement.periodKey)
        } else {
          overlays.set(replacement.periodKey, replacement.prior)
        }
      }
      finalized = true
    },
    finalize: () => {
      if (finalized) return
      if (!committed) {
        for (const replacement of staged) {
          overlays.set(replacement.periodKey, replacement.next)
        }
        committed = true
      }
      for (const replacement of staged) {
        if (replacement.prior !== undefined) removePeriodOverlay(map, replacement.prior)
      }
      if (catalog?.retainPriorPeriods !== true) {
        for (const [periodKey, overlay] of [...overlays.entries()]) {
          if (desired.has(periodKey)) continue
          removePeriodOverlay(map, overlay)
          overlays.delete(periodKey)
        }
      }
      finalized = true
    },
  }
}

/** Waits for MapLibre to accept every staged source before retiring predecessors. */
async function waitForCoverageSourcesLoaded(
  map: CoverageOverlayMap,
  overlays: readonly PeriodOverlay[],
  signal: AbortSignal,
): Promise<void> {
  if (overlays.length === 0) return
  if (map.isSourceLoaded === undefined || map.on === undefined || map.off === undefined) return
  const pending = new Set(overlays.map((overlay) => overlay.sourceId))
  const refresh = (): void => {
    for (const sourceId of pending) {
      try {
        if (map.isSourceLoaded?.(sourceId) === true) pending.delete(sourceId)
      } catch {
        // Source structure exists but has not reached MapLibre's loaded state yet.
      }
    }
  }
  refresh()
  if (pending.size === 0) return
  if (signal.aborted) throw createCoverageOverlayAbortError()
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup()
      reject(new Error('Coverage overlay source loading timed out.'))
    }, 15_000)
    const abort = () => {
      cleanup()
      reject(createCoverageOverlayAbortError())
    }
    const onSourceData = () => {
      refresh()
      if (pending.size === 0) {
        cleanup()
        resolve()
      }
    }
    const onError = (event: { readonly sourceId?: string }) => {
      if (event.sourceId === undefined || !pending.has(event.sourceId)) return
      cleanup()
      reject(new Error('Coverage overlay source failed before activation.'))
    }
    const cleanup = () => {
      globalThis.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      map.off?.('sourcedata', onSourceData)
      map.off?.('error', onError)
    }
    signal.addEventListener('abort', abort, { once: true })
    map.on?.('sourcedata', onSourceData)
    map.on?.('error', onError)
    onSourceData()
  })
}

function createCoverageOverlayAbortError(): Error {
  const error = new Error('Coverage overlay activation was cancelled.')
  error.name = 'AbortError'
  return error
}

/** Installs and verifies one digest-specific overlay without removing its predecessor. */
function installPeriodOverlay(
  map: CoverageOverlayMap,
  missionId: string,
  period: { readonly periodKey: string; readonly revisionDigest: string },
  browserHarnessGeoJson: CoverageTileCatalog['browserHarnessGeoJson'],
  filters: {
    readonly omittedDeviceIds: readonly string[]
    readonly omittedPeriodKeys: readonly string[]
  },
): PeriodOverlay {
  const sourceId = `coverage-${encodeIdentity(period.periodKey)}-${++nextOverlaySequence}`
  const lineLayerId = `${sourceId}-line`
  const pointLayerId = `${sourceId}-point`
  const overlay: PeriodOverlay = {
    missionId,
    revisionDigest: period.revisionDigest,
    sourceId,
    layerIds: [lineLayerId, pointLayerId],
  }
  const beforeTrackingLayer = map.getLayer(TRACKING_BREADCRUMB_CASING_LAYER_ID) === undefined
    ? undefined
    : TRACKING_BREADCRUMB_CASING_LAYER_ID
  try {
    map.addSource(sourceId, browserHarnessGeoJson === undefined
      ? {
          type: 'vector',
          tiles: [createCoverageTileUrl(missionId, period.periodKey, period.revisionDigest)],
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
      paint: { 'line-color': '#7c3aed', 'line-width': 2, 'line-opacity': 0.78 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    }, beforeTrackingLayer)
    map.addLayer({
      id: pointLayerId,
      source: sourceId,
      ...(browserHarnessGeoJson === undefined ? { 'source-layer': 'coverage' } : {}),
      type: 'circle',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': '#7c3aed', 'circle-radius': 3, 'circle-opacity': 0.78 },
    }, beforeTrackingLayer)
    if (
      map.getSource(sourceId) === undefined ||
      overlay.layerIds.some((layerId) => map.getLayer(layerId) === undefined)
    ) {
      throw new Error('Coverage overlay activation failed after source installation.')
    }
    applyCoverageFilters(map, overlay, filters)
    return overlay
  } catch (error) {
    removePeriodOverlay(map, overlay)
    throw error
  }
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
