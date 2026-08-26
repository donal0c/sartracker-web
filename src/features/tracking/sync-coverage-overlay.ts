import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  CanvasSourceSpecification,
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl'
import {
  createCoverageTileUrl,
  type CoverageRendererFailureSource,
} from './coverage-tile-protocol'
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
  readonly failureSources: readonly CoverageRendererFailureSource[]
  readonly commit: () => void
  readonly finalize: () => void
  readonly rollback: () => void
}

type PeriodOverlay = {
  readonly missionId: string
  readonly activationId?: string
  readonly revisionDigest: string
  readonly sourceId: string
  readonly layerIds: readonly string[]
}

type CoverageOverlayRegistry = {
  nextRequestSequence: number
  latestSuccessfulSequence: number
  latestFilters: CoverageOverlayFilters
  owner: CoverageOverlayOwnership | null
  readonly active: Map<string, PeriodOverlay>
  readonly installed: Set<PeriodOverlay>
}

type CoverageOverlayFilters = {
  readonly omittedDeviceIds: readonly string[]
  readonly omittedPeriodKeys: readonly string[]
}

type CoverageOverlayOwnership = {
  readonly requestSequence: number
  previous: CoverageOverlayOwnership | null
  valid: boolean
  committed: boolean
  finalized: boolean
  commitRequested: boolean
  settlement: 'rollback' | 'finalize' | null
  readonly commitNow: () => void
  readonly rollbackNow: () => void
  readonly finalizeNow: () => void
}

const overlaysByMap = new WeakMap<object, CoverageOverlayRegistry>()
let nextOverlaySequence = 0

/** Confirms the current mission-scoped catalog still exists in this map style. */
export function isCoverageOverlayAttached(
  map: CoverageOverlayMap,
  catalog: CoverageTileCatalog,
): boolean {
  const registry = overlaysByMap.get(map)
  if (registry === undefined) return false
  const desiredPeriods = catalog.browserHarnessGeoJson === undefined
    ? catalog.periods
    : [{
        periodKey: 'browser-harness',
        revisionDigest: catalog.periods.map((period) => period.revisionDigest).join('-') || 'empty',
      }]
  return desiredPeriods.every((period) => {
    const overlay = registry.active.get(period.periodKey)
    return overlay?.missionId === catalog.missionId &&
      (catalog.requiresFreshRendererSources !== true ||
        overlay.activationId === catalog.activationId) &&
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
  filters: CoverageOverlayFilters = { omittedDeviceIds: [], omittedPeriodKeys: [] },
  signal: AbortSignal = new AbortController().signal,
): Promise<CoverageOverlayActivation> {
  const registry = overlaysByMap.get(map) ?? {
    nextRequestSequence: 0,
    latestSuccessfulSequence: 0,
    latestFilters: { omittedDeviceIds: [], omittedPeriodKeys: [] },
    owner: null,
    active: new Map<string, PeriodOverlay>(),
    installed: new Set<PeriodOverlay>(),
  }
  overlaysByMap.set(map, registry)
  const requestSequence = ++registry.nextRequestSequence
  registry.latestFilters = {
    omittedDeviceIds: [...filters.omittedDeviceIds],
    omittedPeriodKeys: [...filters.omittedPeriodKeys],
  }
  if (catalog !== null) {
    applyFiltersToInstalledOverlays(map, registry, registry.latestFilters)
  }
  const overlays = registry.active
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
    const structureSurvivedStyle = prior !== undefined &&
      map.getSource(prior.sourceId) !== undefined &&
      prior.layerIds.every((layerId) => map.getLayer(layerId) !== undefined)
    if (
      prior !== undefined &&
      prior.missionId === catalog?.missionId &&
      (catalog?.requiresFreshRendererSources !== true ||
        prior.activationId === catalog.activationId) &&
      prior.revisionDigest === period.revisionDigest &&
      structureSurvivedStyle
    ) {
      continue
    }
    try {
      const next = installPeriodOverlay(
        map,
        catalog?.missionId ?? 'browser-harness',
        catalog?.activationId,
        period,
        browserHarnessGeoJson,
        filters,
      )
      registry.installed.add(next)
      staged.push({
        periodKey: period.periodKey,
        prior,
        next,
      })
    } catch (error) {
      for (const replacement of staged) {
        removePeriodOverlay(map, replacement.next)
        registry.installed.delete(replacement.next)
      }
      applyFiltersToInstalledOverlays(map, registry, registry.latestFilters)
      throw error
    }
  }
  try {
    await waitForCoverageSourcesLoaded(map, staged.map((entry) => entry.next), signal)
  } catch (error) {
    for (const replacement of staged) {
      removePeriodOverlay(map, replacement.next)
      registry.installed.delete(replacement.next)
    }
    applyFiltersToInstalledOverlays(map, registry, registry.latestFilters)
    throw error
  }
  if (requestSequence < registry.latestSuccessfulSequence) {
    removeStagedOverlays(map, registry, staged)
    applyFiltersToInstalledOverlays(map, registry, registry.latestFilters)
    throw createCoverageOverlayAbortError()
  }
  const stagedByPeriod = new Map(staged.map((entry) => [entry.periodKey, entry.next]))
  const failureSources: CoverageRendererFailureSource[] = []
  for (const period of browserHarnessGeoJson === undefined
    ? desiredPeriods
    : (catalog?.periods ?? [])) {
    const overlay = stagedByPeriod.get(
      browserHarnessGeoJson === undefined ? period.periodKey : 'browser-harness',
    ) ?? overlays.get(
      browserHarnessGeoJson === undefined ? period.periodKey : 'browser-harness',
    )
    if (overlay === undefined) {
      removeStagedOverlays(map, registry, staged)
      applyFiltersToInstalledOverlays(map, registry, registry.latestFilters)
      throw new Error('Coverage renderer source ownership was not recorded.')
    }
    failureSources.push({
      periodKey: period.periodKey,
      revisionDigest: period.revisionDigest,
      ...(overlay.activationId === undefined ? {} : { activationId: overlay.activationId }),
    })
  }
  registry.latestSuccessfulSequence = requestSequence
  const priorOwnership = registry.owner
  const ownership: CoverageOverlayOwnership = {
    requestSequence,
    previous: priorOwnership,
    valid: true,
    committed: false,
    finalized: false,
    commitRequested: false,
    settlement: null,
    commitNow: () => {
      for (const replacement of staged) {
        overlays.set(replacement.periodKey, replacement.next)
      }
      for (const period of desired.values()) {
        const overlay = overlays.get(period.periodKey)
        if (
          overlay === undefined ||
          overlay.missionId !== catalog?.missionId ||
          (catalog?.requiresFreshRendererSources === true &&
            overlay.activationId !== catalog.activationId) ||
          overlay.revisionDigest !== period.revisionDigest ||
          map.getSource(overlay.sourceId) === undefined ||
          overlay.layerIds.some((layerId) => map.getLayer(layerId) === undefined)
        ) {
          throw new Error('Coverage overlay detached before renderer commit.')
        }
      }
    },
    rollbackNow: () => {
      for (const replacement of staged) {
        removePeriodOverlay(map, replacement.next)
        registry.installed.delete(replacement.next)
        if (replacement.prior === undefined) {
          overlays.delete(replacement.periodKey)
        } else {
          overlays.set(replacement.periodKey, replacement.prior)
        }
      }
    },
    finalizeNow: () => {
      if (catalog?.retainPriorPeriods !== true) {
        for (const [periodKey, overlay] of [...overlays.entries()]) {
          if (desired.has(periodKey)) continue
          removePeriodOverlay(map, overlay)
          overlays.delete(periodKey)
        }
      }
      const retained = new Set(overlays.values())
      for (const overlay of [...registry.installed]) {
        if (retained.has(overlay)) continue
        removePeriodOverlay(map, overlay)
        registry.installed.delete(overlay)
      }
    },
  }
  registry.owner = ownership
  return {
    periods: catalog?.periods ?? [],
    failureSources,
    commit: () => {
      if (!ownership.valid || ownership.finalized) return
      ownership.commitRequested = true
      settleCoverageOverlayOwnership(registry, ownership)
    },
    rollback: () => {
      if (!ownership.valid || ownership.finalized) return
      ownership.settlement = 'rollback'
      settleCoverageOverlayOwnership(registry, ownership)
    },
    finalize: () => {
      if (!ownership.valid || ownership.finalized) return
      ownership.commitRequested = true
      ownership.settlement = 'finalize'
      settleCoverageOverlayOwnership(registry, ownership)
    },
  }
}

/** Settles only the newest activation, cascading deferred predecessor rollback/finalize intent. */
function settleCoverageOverlayOwnership(
  registry: CoverageOverlayRegistry,
  ownership: CoverageOverlayOwnership,
): void {
  if (!ownership.valid || ownership.finalized || registry.owner !== ownership) return
  if (ownership.settlement === 'rollback') {
    ownership.rollbackNow()
    ownership.valid = false
    ownership.finalized = true
    registry.owner = nearestValidOwnership(ownership.previous)
    if (registry.owner !== null) settleCoverageOverlayOwnership(registry, registry.owner)
    return
  }
  if (ownership.commitRequested && !ownership.committed) {
    ownership.commitNow()
    ownership.committed = true
  }
  if (ownership.settlement !== 'finalize') return
  ownership.finalizeNow()
  ownership.finalized = true
  for (let predecessor = ownership.previous; predecessor !== null; predecessor = predecessor.previous) {
    predecessor.valid = false
  }
  ownership.previous = null
}

/** Skips superseded activation nodes while restoring the prior live owner. */
function nearestValidOwnership(
  ownership: CoverageOverlayOwnership | null,
): CoverageOverlayOwnership | null {
  let candidate = ownership
  while (candidate !== null && !candidate.valid) candidate = candidate.previous
  return candidate
}

/** Removes source/layer structures that never became an attested activation. */
function removeStagedOverlays(
  map: CoverageOverlayMap,
  registry: CoverageOverlayRegistry,
  staged: readonly { readonly next: PeriodOverlay }[],
): void {
  for (const replacement of staged) {
    removePeriodOverlay(map, replacement.next)
    registry.installed.delete(replacement.next)
  }
}

/** Applies the latest safe filters to every retained source after replacement failure. */
function applyFiltersToInstalledOverlays(
  map: CoverageOverlayMap,
  registry: CoverageOverlayRegistry,
  filters: CoverageOverlayFilters,
): void {
  for (const overlay of registry.installed) {
    if (
      map.getSource(overlay.sourceId) === undefined ||
      !overlay.layerIds.every((layerId) => map.getLayer(layerId) !== undefined)
    ) continue
    applyCoverageFilters(map, overlay, filters)
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
  activationId: string | undefined,
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
    ...(activationId === undefined ? {} : { activationId }),
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
          tiles: [createCoverageTileUrl(
            missionId,
            period.periodKey,
            period.revisionDigest,
            activationId,
          )],
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
