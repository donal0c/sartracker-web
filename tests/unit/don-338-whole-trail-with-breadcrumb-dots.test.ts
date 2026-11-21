import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import { useExactBreadcrumbDotStore } from '../../src/features/tracking/exact-breadcrumb-dot-store'
import {
  startExactBreadcrumbDotRuntime,
  type ExactBreadcrumbDotMissionStore,
} from '../../src/features/tracking/start-exact-breadcrumb-dot-runtime'
import { syncTrackingOverlay } from '../../src/features/tracking/sync-tracking-overlay'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

/**
 * DON-338 regression (team field report, Dublin test, November 2026).
 *
 * Report: one phone tracked all day; at 10,000 points the trail "started a
 * new segment", and afterwards the operator could show the part before the
 * split or the part after it, never the whole trail.
 *
 * Safety property: whatever trail display the operator has chosen, every
 * stretch of ground a searcher covered must be drawn on the map at the same
 * time. A trail that can only be shown in parts makes searched ground look
 * unsearched.
 *
 * This test drives the real code path end to end: the real SQLite mission
 * store, the real exact-dot query worker, the real exact-dot runtime and
 * controller, and the real tracking map-overlay sync. Only MapLibre itself
 * is replaced, by a recorder of the GeoJSON it is given.
 */

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: {
    readonly userDataPath: string
  }) => RealMissionStore
}

type RealMissionStore = ExactBreadcrumbDotMissionStore & {
  readonly createMission: (input: {
    readonly name: string
    readonly start_time: string
  }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp: string
      readonly timestamp_source: 'fix'
    }[]
  }) => Promise<unknown>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

type RecordedFeature = {
  readonly geometry: {
    readonly type: 'Point' | 'LineString'
    readonly coordinates: readonly number[] | readonly (readonly number[])[]
  }
  readonly properties: { readonly featureKind?: string; readonly deviceId?: string }
}

const DEVICE_ID = 'searcher-phone'
const FIX_COUNT = 12_000
const FIX_INTERVAL_MS = 3_000
const MISSION_START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const START_LAT = 53.2
const LON = -6.3
/** About 1.1 m of northward travel per fix, so every fix has its own latitude. */
const LAT_STEP = 0.00001
const LAT_TOLERANCE = LAT_STEP / 4

let userDataPath: string | undefined
let store: RealMissionStore | undefined
let stopRuntime: (() => void) | undefined

afterEach(async () => {
  stopRuntime?.()
  stopRuntime = undefined
  if (store !== undefined) {
    await store.prepareClose().catch(() => undefined)
    store.close()
    store = undefined
  }
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
  useMissionStore.setState(useMissionStore.getInitialState())
  useExactBreadcrumbDotStore.setState(useExactBreadcrumbDotStore.getInitialState())
  useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
})

describe('[DON-338] whole trail stays on the map with Breadcrumb dots selected', () => {
  it(
    'draws every stretch of a 12,000-fix trail at once, on the newest page and after pressing Earlier',
    async () => {
      const fixes = createContinuousTrail()
      const missionId = await seedRealMissionStore(fixes)
      const liveSnapshot = createLiveTrailSnapshot(fixes)

      // Control: the default "Solid line" display draws the trail start to finish.
      const lineMap = createRecordingMap()
      syncTrackingOverlay(lineMap as never, liveSnapshot, [], [], true, {
        deviceColors: {},
        breadcrumbSize: 8,
        breadcrumbTrailMode: 'line',
      })
      expect(
        countFixesNotDrawn(fixes, readTrailFeatures(lineMap)),
        'fixes not drawn in the default Solid line display',
      ).toBe(0)

      // The operator chooses "Breadcrumb dots" (Devices workspace toggle, or
      // "Inspect exact fixes" on the coverage panel).
      useMissionStore.setState({
        phase: 'active',
        currentMission: {
          id: missionId,
          name: 'DON-338 regression mission',
          status: 'active',
          start_time: new Date(MISSION_START_MS).toISOString(),
          pause_time: null,
          finish_time: null,
          paused_seconds: 0,
          notes: null,
          schema_version: 1,
        },
      })
      useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
      stopRuntime = startExactBreadcrumbDotRuntime(store!)
      await waitForReadyDotPage()

      const newestPageMap = createRecordingMap()
      syncTrackingOverlay(
        newestPageMap as never,
        liveSnapshot,
        [],
        [],
        true,
        { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'dots' },
        useExactBreadcrumbDotStore.getState().state,
      )
      const notDrawnOnNewestPage = countFixesNotDrawn(fixes, readTrailFeatures(newestPageMap))

      // The operator presses "Earlier" to look for the rest of the trail.
      useExactBreadcrumbDotStore.getState().controller?.showEarlier()
      await waitForReadyDotPage({ hasLater: true })

      const earlierPageMap = createRecordingMap()
      syncTrackingOverlay(
        earlierPageMap as never,
        liveSnapshot,
        [],
        [],
        true,
        { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'dots' },
        useExactBreadcrumbDotStore.getState().state,
      )
      const notDrawnOnEarlierPage = countFixesNotDrawn(fixes, readTrailFeatures(earlierPageMap))

      expect.soft(
        notDrawnOnNewestPage,
        `fixes of the ${FIX_COUNT}-fix trail missing from the map with Breadcrumb dots selected`,
      ).toBe(0)
      expect.soft(
        notDrawnOnEarlierPage,
        `fixes of the ${FIX_COUNT}-fix trail missing from the map after pressing Earlier`,
      ).toBe(0)
    },
    120_000,
  )
})

/** One searcher walking north with a fix every 3 s for 10 h: no gap, no stop. */
function createContinuousTrail(): readonly NormalizedTrackingPosition[] {
  return Array.from({ length: FIX_COUNT }, (_, index) => ({
    id: `fix-${String(index).padStart(6, '0')}`,
    device_id: DEVICE_ID,
    lat: START_LAT + index * LAT_STEP,
    lon: LON,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(MISSION_START_MS + (index + 1) * FIX_INTERVAL_MS).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }))
}

/** Stores the trail through the production Electron mission store. */
async function seedRealMissionStore(
  fixes: readonly NormalizedTrackingPosition[],
): Promise<string> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-don-338-'))
  store = createElectronMissionStore({ userDataPath })
  const mission = await store.createMission({
    name: 'DON-338 regression mission',
    start_time: new Date(MISSION_START_MS).toISOString(),
  })
  await store.upsertDevice({
    mission_id: mission.id,
    device_id: DEVICE_ID,
    name: 'Searcher phone',
    color: '#f97316',
    status: 'online',
  })
  for (let offset = 0; offset < fixes.length; offset += 256) {
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: fixes.slice(offset, offset + 256).map((fix) => ({
        source_position_id: fix.id,
        device_id: fix.device_id,
        lat: fix.lat,
        lon: fix.lon,
        timestamp: fix.timestamp,
        timestamp_source: 'fix',
      })),
    })
  }
  return mission.id
}

/** The live trail exactly as the production accumulator publishes it. */
function createLiveTrailSnapshot(
  fixes: readonly NormalizedTrackingPosition[],
): TrackingSnapshot {
  const accumulator = createBreadcrumbAccumulator()
  accumulator.ingest(fixes)
  const trail = accumulator.compact()
  return {
    devices: [],
    positions: [fixes[fixes.length - 1]!],
    breadcrumbs: trail.positions,
    breadcrumbMetadata: trail.metadata,
  }
}

async function waitForReadyDotPage(
  expected: { readonly hasLater?: boolean } = {},
): Promise<void> {
  await vi.waitFor(
    () => {
      const state = useExactBreadcrumbDotStore.getState().state
      expect(state.status).toBe('ready')
      if (state.status === 'ready' && expected.hasLater !== undefined) {
        expect(state.hasLater).toBe(expected.hasLater)
      }
    },
    { timeout: 60_000, interval: 50 },
  )
}

/** Records the GeoJSON handed to MapLibre sources; draws nothing. */
function createRecordingMap() {
  const layers = new Map<string, { id: string; filter?: unknown; paint?: Record<string, unknown> }>()
  const sourceData = new Map<string, { features: RecordedFeature[] }>()
  return {
    sourceData,
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) =>
      sourceData.has(id)
        ? {
            setData: (data: { features: RecordedFeature[] }) => {
              sourceData.set(id, data)
            },
            updateData: () => {
              throw new Error('Incremental source updates are not expected on a fresh map.')
            },
          }
        : undefined,
    addLayer: (spec: { id: string; filter?: unknown; paint?: Record<string, unknown> }) => {
      layers.set(spec.id, spec)
    },
    addSource: (id: string, config: { data: { features: RecordedFeature[] } }) => {
      sourceData.set(id, config.data)
    },
    getFilter: (id: string) => layers.get(id)?.filter,
    getPaintProperty: (id: string, property: string) => layers.get(id)?.paint?.[property],
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.filter = filter
    },
    setPaintProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.paint = { ...(layer.paint ?? {}), [property]: value }
    },
  }
}

/** Every trail feature the tracking overlay put on the map: lines and dots. */
function readTrailFeatures(map: ReturnType<typeof createRecordingMap>): readonly RecordedFeature[] {
  const features: RecordedFeature[] = []
  for (const data of map.sourceData.values()) {
    for (const feature of data.features) {
      const kind = feature.properties.featureKind
      if (
        feature.properties.deviceId === DEVICE_ID &&
        (kind === 'breadcrumb' || kind === 'breadcrumbLine')
      ) {
        features.push(feature)
      }
    }
  }
  return features
}

/**
 * Counts stored fixes that no drawn trail geometry passes through. The trail
 * runs due north, so a fix is drawn when a dot sits on its latitude or a
 * line spans it.
 */
function countFixesNotDrawn(
  fixes: readonly NormalizedTrackingPosition[],
  features: readonly RecordedFeature[],
): number {
  const dotLatitudes: number[] = []
  const lineSpans: { readonly south: number; readonly north: number }[] = []
  for (const feature of features) {
    if (feature.geometry.type === 'Point') {
      dotLatitudes.push((feature.geometry.coordinates as readonly number[])[1]!)
      continue
    }
    const latitudes = (feature.geometry.coordinates as readonly (readonly number[])[]).map(
      (coordinate) => coordinate[1]!,
    )
    lineSpans.push({ south: Math.min(...latitudes), north: Math.max(...latitudes) })
  }
  dotLatitudes.sort((left, right) => left - right)

  let notDrawn = 0
  for (const fix of fixes) {
    const onLine = lineSpans.some(
      (span) => fix.lat >= span.south - LAT_TOLERANCE && fix.lat <= span.north + LAT_TOLERANCE,
    )
    if (!onLine && !hasValueNear(dotLatitudes, fix.lat)) {
      notDrawn += 1
    }
  }
  return notDrawn
}

function hasValueNear(sortedValues: readonly number[], target: number): boolean {
  let low = 0
  let high = sortedValues.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const value = sortedValues[middle]!
    if (Math.abs(value - target) <= LAT_TOLERANCE) return true
    if (value < target) low = middle + 1
    else high = middle - 1
  }
  return false
}
