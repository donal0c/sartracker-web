import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderLeafletFallbackOverlays } from '../../src/features/map/leaflet-fallback-renderer'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import { mergeDeferredTrackingCache } from '../../src/features/tracking/merge-deferred-tracking-cache'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../../src/features/tracking/polling-manager'
import { syncTrackingOverlay } from '../../src/features/tracking/sync-tracking-overlay'
import {
  createCachedTrackingSnapshot,
  limitTrackingCacheBreadcrumbs,
  parseTrackingCachePayload,
  serializeTrackingCachePayload,
} from '../../src/features/tracking/tracking-cache-payload'
import type { BreadcrumbTrailMode } from '../../src/features/tracking/tracking-style-store'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'
import {
  createDrawingRecorderMap,
  readDrawnFeaturesAtEveryOperatorZoom,
  TRAIL_DRAWING_LAYER_IDS,
} from '../support/maplibre-drawn-features'

// DON-338 round 8: the mission store keeps the first row it saw for a Traccar
// position id and refuses a later row with the same id and different content
// (a source-id conflict). The live trail line must draw what the store kept:
// a refused conflict must never replace, move or add a vertex, in either
// renderer, in either trail mode, or in the restart/offline cache.

type StoredPositionRow = {
  readonly source_position_id: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
}

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<{
    readonly insertedPositionCount: number
    readonly sourceIdentityConflictCount: number
  }>
  readonly listPositions: (missionId: string, deviceId?: string) => Promise<readonly StoredPositionRow[]>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

const NOW_MS = Date.parse('2026-11-07T10:00:00.000Z')
const FIX_17_TIME = new Date(NOW_MS - 60_000).toISOString()
const FIX_18_TIME = new Date(NOW_MS - 30_000).toISOString()
const MISSION_KEY = 'mission-a'
const DEVICE: NormalizedTrackingDevice = {
  device_id: '1',
  name: 'Unit one',
  status: 'online',
  last_seen: new Date(NOW_MS).toISOString(),
  unique_id: 'synthetic-1',
  category: null,
}

/** One Traccar fix as the poller receives it, with a verified fix time. */
function fix(id: string, timestamp: string, lat: number, lon = -9.7): NormalizedTrackingPosition {
  return {
    id,
    device_id: '1',
    lat,
    lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp,
    timestamp_source: 'fix',
    fix_time_unverified: false,
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

const ORIGINAL_17 = fix('17', FIX_17_TIME, 52.1)
const FIX_18 = fix('18', FIX_18_TIME, 52.101)
const CONFLICT_17 = fix('17', FIX_17_TIME, 52.2)
const STORE_KEPT_LINE: readonly (readonly [number, number])[] = [[52.1, -9.7], [52.101, -9.7]]

let userDataPath: string | undefined
let store: RealStore | undefined

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(NOW_MS)
})

afterEach(async () => {
  vi.useRealTimers()
  store?.close()
  store = undefined
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

/** Opens a real SQLite mission store with one mission and the test device. */
async function openRealStore(): Promise<{ readonly realStore: RealStore; readonly missionId: string }> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-refused-conflict-'))
  const realStore = createElectronMissionStore({ userDataPath })
  store = realStore
  const mission = await realStore.createMission({ name: 'Refused conflict' })
  await realStore.upsertDevice({
    mission_id: mission.id,
    device_id: DEVICE.device_id,
    name: DEVICE.name,
    color: '#336699',
    status: DEVICE.status,
    last_seen: DEVICE.last_seen,
    group_id: null,
    unique_id: DEVICE.unique_id,
  })
  return { realStore, missionId: mission.id }
}

/** Persists raw breadcrumbs the way the tracking runtime does (fix-time evidence only). */
async function persistLikeRuntime(
  realStore: RealStore,
  missionId: string,
  positions: readonly NormalizedTrackingPosition[],
): Promise<{ readonly sourceIdentityConflictCount: number }> {
  const evidence = positions.filter((position) =>
    position.timestamp_source === 'fix' && position.fix_time_unverified !== true)
  if (evidence.length === 0) return { sourceIdentityConflictCount: 0 }
  return realStore.persistTrackingPositionsBulk({
    mission_id: missionId,
    positions: evidence.map((position) => ({
      source_position_id: position.id,
      device_id: position.device_id,
      lat: position.lat,
      lon: position.lon,
      altitude: position.altitude,
      speed: position.speed,
      battery: position.battery,
      accuracy: position.accuracy,
      source: position.source,
      timestamp: position.timestamp,
      timestamp_source: 'fix',
      data_origin: position.data_origin,
    })),
    checkpoints: [],
  })
}

type ProviderSchedule = {
  /** What Traccar answers for device 1 on each successive history request; the last repeats. */
  readonly responses: readonly (readonly NormalizedTrackingPosition[])[]
  /** Overrides `responses` with an answer chosen at request time. */
  readonly respond?: () => readonly NormalizedTrackingPosition[]
}

/** Starts the real poller against a scripted Traccar provider and records every published snapshot. */
function startPoller(
  schedule: ProviderSchedule,
  options: {
    readonly onSnapshot?: (snapshot: TrackingSnapshot) => void | Promise<void>
    readonly getInitialBreadcrumbs?: () => Promise<readonly NormalizedTrackingPosition[]>
    readonly missionKey?: () => string
  } = {},
) {
  let request = 0
  const snapshots: TrackingSnapshot[] = []
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue([DEVICE]),
    getCurrentPositions: vi.fn().mockResolvedValue([]),
    getBreadcrumbs: vi.fn(async (_deviceId: string, from: Date, to: Date) => {
      const response = schedule.respond?.()
        ?? schedule.responses[Math.min(request, schedule.responses.length - 1)]
        ?? []
      request += 1
      return response.filter((position) => {
        const timestampMs = Date.parse(position.timestamp)
        return timestampMs >= from.getTime() && timestampMs <= to.getTime()
      })
    }),
  }
  const poller = createPollingManager(client, {
    intervalMs: 5_000,
    staleThresholdMs: 60 * 60 * 1_000,
    getHistoryResetKey: options.missionKey ?? (() => MISSION_KEY),
    getInitialBreadcrumbFrom: () => new Date(NOW_MS - 60 * 60 * 1_000),
    ...(options.getInitialBreadcrumbs === undefined
      ? {}
      : { getInitialBreadcrumbs: options.getInitialBreadcrumbs }),
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot)
      return options.onSnapshot?.(snapshot)
    },
    onStatusChange: vi.fn(),
  })
  poller.start()
  return { poller, snapshots, historyRequests: () => request }
}

/** Device 1's drawn whole-trail line on the WebGL map, as [lat, lon] vertices in drawing order. */
function drawnWebGlLine(snapshot: TrackingSnapshot, mode: BreadcrumbTrailMode): readonly (readonly [number, number])[] {
  const map = createDrawingRecorderMap()
  syncTrackingOverlay(map as never, snapshot, [], [], true, {
    deviceColors: {},
    breadcrumbSize: 8,
    breadcrumbTrailMode: mode,
  })
  const vertices = new Map<string, readonly [number, number]>()
  for (const { feature } of readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: TRAIL_DRAWING_LAYER_IDS })) {
    if (feature.properties.deviceId !== '1') continue
    const points = feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates as readonly (readonly [number, number])[]
      : feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates as readonly [number, number]]
        : []
    for (const [lon, lat] of points) vertices.set(`${lat}:${lon}`, [lat, lon])
  }
  return [...vertices.values()].sort((left, right) => left[0] - right[0])
}

/** Device 1's drawn whole-trail line on the Leaflet fallback, as [lat, lon] vertices. */
function drawnLeafletLine(snapshot: TrackingSnapshot, mode: BreadcrumbTrailMode): readonly (readonly [number, number])[] {
  const group = L.layerGroup()
  renderLeafletFallbackOverlays(group, {
    trackingSnapshot: snapshot,
    trackingVisible: true,
    breadcrumbsVisible: true,
    hiddenDeviceIds: [],
    hiddenBreadcrumbDeviceIds: [],
    trackingStyle: { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: mode },
    markers: [],
    markerTypeVisibility: { ipp_lkp: true, clue: true, hazard: true, casualty: true },
    hiddenMarkerIds: [],
    drawings: [],
    drawingTypeVisibility: {
      line: true,
      search_area: true,
      range_ring: true,
      bearing_line: true,
      search_sector: true,
      text_label: true,
    },
    hiddenDrawingIds: [],
    selectedDrawingId: null,
  })
  return group.getLayers()
    .filter((layer): layer is L.Polyline => layer instanceof L.Polyline && !(layer instanceof L.Polygon))
    .flatMap((line) => (line.getLatLngs() as L.LatLng[]).map((point) => [point.lat, point.lng] as const))
}

/** Asserts both renderers in both trail modes draw exactly the store-kept line for device 1. */
function expectStoreKeptLineInEveryRenderer(snapshot: TrackingSnapshot): void {
  for (const mode of ['line', 'dots'] as const) {
    expect(drawnWebGlLine(snapshot, mode), `WebGL map, ${mode} mode`).toEqual(STORE_KEPT_LINE)
    expect(drawnLeafletLine(snapshot, mode), `Leaflet fallback, ${mode} mode`).toEqual(STORE_KEPT_LINE)
  }
  expect(snapshot.breadcrumbs.filter((position) => position.lat === 52.2)).toEqual([])
}

/** The store's kept rows for device 1, as [lat, lon] in time order. */
async function storeKeptLine(realStore: RealStore, missionId: string): Promise<readonly (readonly [number, number])[]> {
  const rows = await realStore.listPositions(missionId)
  return rows
    .filter((row) => row.device_id === '1')
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .map((row) => [row.lat, row.lon] as const)
}

/** Polls until the scripted provider has answered `count` history requests, then stops the poller. */
async function pollUntil(
  started: ReturnType<typeof startPoller>,
  count: number,
): Promise<void> {
  await vi.waitFor(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
    expect(started.historyRequests()).toBeGreaterThanOrEqual(count)
  })
  await vi.advanceTimersByTimeAsync(0)
  await started.poller.stop()
}

/** Writes, reads and restores the restart cache exactly as the runtime does. */
async function roundTripCache(snapshot: TrackingSnapshot): Promise<TrackingSnapshot> {
  const limited = await limitTrackingCacheBreadcrumbs(snapshot.breadcrumbs, {
    metadata: snapshot.breadcrumbMetadata,
    yieldControl: () => Promise.resolve(),
  })
  return createCachedTrackingSnapshot(parseTrackingCachePayload(serializeTrackingCachePayload({
    mission_id: MISSION_KEY,
    cached_at: new Date(NOW_MS).toISOString(),
    devices: snapshot.devices,
    positions: snapshot.positions,
    breadcrumbs: limited.breadcrumbs,
    ...(limited.metadata === undefined ? {} : { breadcrumb_metadata: limited.metadata }),
  })))
}

/** Persists every published raw batch to the real store, in publication order. */
function persistEverySnapshot(realStore: RealStore, missionId: string) {
  const writes: Promise<{ readonly sourceIdentityConflictCount: number }>[] = []
  let tail: Promise<unknown> = Promise.resolve()
  return {
    writes,
    onSnapshot: (snapshot: TrackingSnapshot) => {
      const raw = snapshot.rawBreadcrumbsForPersistence ?? []
      const write = tail.then(() => persistLikeRuntime(realStore, missionId, raw))
      tail = write
      writes.push(write)
      return write.then(() => undefined)
    },
    conflicts: async () => (await Promise.all(writes))
      .reduce((total, outcome) => total + outcome.sourceIdentityConflictCount, 0),
  }
}

describe('[DON-338] a source-id conflict the store refused is never drawn', () => {
  it('keeps the store\'s first row when the conflict arrives in a later poll (real poller, real store, both renderers)', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistEverySnapshot(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { onSnapshot: persistence.onSnapshot },
    )
    await pollUntil(started, 3)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('keeps the store\'s first row when the original and the conflict arrive in the same response', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistEverySnapshot(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18, CONFLICT_17]] },
      { onSnapshot: persistence.onSnapshot },
    )
    await pollUntil(started, 2)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('keeps the stored original seeded from the store when the conflict arrives live', async () => {
    const { realStore, missionId } = await openRealStore()
    await persistLikeRuntime(realStore, missionId, [ORIGINAL_17, FIX_18])
    const persistence = persistEverySnapshot(realStore, missionId)
    const started = startPoller(
      { responses: [[CONFLICT_17, FIX_18]] },
      {
        onSnapshot: persistence.onSnapshot,
        // The restart seed is the store's own kept rows.
        getInitialBreadcrumbs: async () => (await realStore.listPositions(missionId)).map((row) =>
          fix(row.source_position_id ?? '', row.timestamp, row.lat, row.lon)),
      },
    )
    await pollUntil(started, 2)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('keeps a cached original when a restored cache is merged with a live poll carrying the conflict', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistEverySnapshot(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { onSnapshot: persistence.onSnapshot },
    )
    await pollUntil(started, 3)
    const cached = await roundTripCache(started.snapshots[0]!)
    const merged = mergeDeferredTrackingCache(cached, started.snapshots.at(-1)!)

    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(merged)
  })

  it('never writes the refused conflict into the restart cache', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistEverySnapshot(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { onSnapshot: persistence.onSnapshot },
    )
    await pollUntil(started, 3)

    for (const snapshot of started.snapshots) {
      const restored = await roundTripCache(snapshot)
      expect(restored.breadcrumbs.filter((position) => position.lat === 52.2)).toEqual([])
    }
    expectStoreKeptLineInEveryRenderer(await roundTripCache(started.snapshots.at(-1)!))
  })

  it('does not depend on the store acknowledgement: a late or lost acknowledgement still draws the first row', async () => {
    const { realStore, missionId } = await openRealStore()
    const committed: Promise<unknown>[] = []
    let releaseAcknowledgements: () => void = () => undefined
    const acknowledgementsReleased = new Promise<void>((resolve) => { releaseAcknowledgements = resolve })
    let publication = 0
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      {
        onSnapshot: (snapshot) => {
          if ((snapshot.rawBreadcrumbsForPersistence ?? []).length === 0) return undefined
          publication += 1
          const write = persistLikeRuntime(realStore, missionId, snapshot.rawBreadcrumbsForPersistence ?? [])
          committed.push(write)
          // The first acknowledgement is lost after the commit; the rest arrive late.
          return publication === 1
            ? write.then(() => Promise.reject(new Error('acknowledgement lost')))
            : write.then(() => acknowledgementsReleased)
        },
      },
    )
    await pollUntil(started, 3)
    releaseAcknowledgements()
    await Promise.all(committed)

    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('treats an identical re-send as a no-op', async () => {
    const started = startPoller({ responses: [[ORIGINAL_17, FIX_18], [ORIGINAL_17, FIX_18]] })
    await pollUntil(started, 3)

    const latest = started.snapshots.at(-1)!
    expectStoreKeptLineInEveryRenderer(latest)
    expect(latest.breadcrumbs.filter((position) => position.device_id === '1')).toEqual([ORIGINAL_17, FIX_18])
    expect(latest.breadcrumbMetadata?.totalObserved).toBe(2)
  })

  it('starts afresh on a mission switch: the next mission\'s first row for the id is its own', async () => {
    const state = { mission: MISSION_KEY }
    const started = startPoller(
      {
        responses: [],
        respond: () => state.mission === MISSION_KEY ? [ORIGINAL_17, FIX_18] : [CONFLICT_17, FIX_18],
      },
      { missionKey: () => state.mission },
    )
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(started.historyRequests()).toBeGreaterThanOrEqual(2)
    })
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
    state.mission = 'mission-b'
    started.poller.requestPollNow?.()
    await pollUntil(started, 4)

    const missionB = started.snapshots.at(-1)!
    expect(missionB.breadcrumbs.filter((position) => position.device_id === '1')).toEqual([CONFLICT_17, FIX_18])
    for (const mode of ['line', 'dots'] as const) {
      expect(drawnWebGlLine(missionB, mode)).toEqual([[52.101, -9.7], [52.2, -9.7]])
    }
  })

  describe('the accumulator applies the store\'s rule, not a newer-wins rule', () => {
    it('keeps a saved fix when a later observation of the id has no verified fix time', () => {
      const accumulator = createBreadcrumbAccumulator([ORIGINAL_17, FIX_18])
      const unverified = { ...CONFLICT_17, fix_time_unverified: true }

      expect(accumulator.append([unverified]).positions).toEqual([ORIGINAL_17, FIX_18])
    })

    it('still takes receipt metadata of the same stored fix (the store calls it a duplicate)', () => {
      const cachedOriginal = { ...ORIGINAL_17, data_origin: 'cache' as const, cache_age_seconds: 40 }
      const accumulator = createBreadcrumbAccumulator([cachedOriginal, FIX_18])

      expect(accumulator.append([ORIGINAL_17]).positions).toEqual([ORIGINAL_17, FIX_18])
    })

    it('treats the same instant written another way as the same stored fix', () => {
      const accumulator = createBreadcrumbAccumulator([ORIGINAL_17, FIX_18])
      const sameInstant = { ...ORIGINAL_17, timestamp: FIX_17_TIME.replace('Z', '+00:00'), data_origin: 'cache' as const }

      expect(accumulator.append([sameInstant]).positions[0]).toBe(sameInstant)
    })

    it('still lets a fix the store never saved be replaced by a later observation', () => {
      const unsaved = { ...ORIGINAL_17, timestamp_source: 'server' as const }
      const accumulator = createBreadcrumbAccumulator([unsaved, FIX_18])

      expect(accumulator.append([CONFLICT_17]).positions).toEqual([FIX_18, CONFLICT_17]
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)))
    })

    it('does not redraw a conflict for an id compaction already dropped from the line', () => {
      // A straight, steady walk: compaction keeps few of these fixes.
      const walk = Array.from({ length: 6_000 }, (_, index) =>
        fix(`w-${index}`, new Date(NOW_MS - 6_000_000 + index * 1_000).toISOString(), 52 + index * 1e-6))
      const accumulator = createBreadcrumbAccumulator()
      accumulator.ingest(walk)
      const compacted = accumulator.compact()
      const keptIds = new Set(compacted.positions.map((position) => position.id))
      const dropped = walk.find((position, index) => index > 0 && index < walk.length - 1 && !keptIds.has(position.id))
      expect(dropped).toBeDefined()

      const conflict = { ...dropped!, lat: 53.5 }
      const after = accumulator.append([conflict])

      expect(after.positions.filter((position) => position.lat === 53.5)).toEqual([])
      expect(after.metadata.totalObserved).toBe(compacted.metadata.totalObserved)
    })
  })
})
