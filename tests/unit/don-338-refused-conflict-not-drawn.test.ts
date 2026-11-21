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
  type CanonicalBreadcrumbSeed,
  type TrackingHistoryChunkPersistenceInput,
  type TrackingHistoryChunkPersistenceResult,
  type TrackingPollerClient,
} from '../../src/features/tracking/polling-manager'
import { readRefusedSourcePositions } from '../../src/features/tracking/store-refused-positions'
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
//
// Round 9: the store's acknowledgement names the rows it refused, and the
// poller feeds the live line only with observations the store did not refuse.
// The real-store tests therefore persist through the poller's history
// persistence port, as the production runtime does, instead of after the
// snapshot is published: that fallback path has no store answer to obey and
// production never uses it while a mission is active.

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
    readonly changedPositionCount: number
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
function fix(id: string, timestamp: string, lat: number, lon = -9.7, deviceId = '1'): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
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

const DEVICE_2: NormalizedTrackingDevice = { ...DEVICE, device_id: '2', name: 'Unit two', unique_id: 'synthetic-2' }

/** Opens a real SQLite mission store with one mission and the test devices. */
async function openRealStore(
  devices: readonly NormalizedTrackingDevice[] = [DEVICE],
): Promise<{ readonly realStore: RealStore; readonly missionId: string }> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-refused-conflict-'))
  const realStore = createElectronMissionStore({ userDataPath })
  store = realStore
  const mission = await realStore.createMission({ name: 'Refused conflict' })
  for (const device of devices) {
    await realStore.upsertDevice({
      mission_id: mission.id,
      device_id: device.device_id,
      name: device.name,
      color: '#336699',
      status: device.status,
      last_seen: device.last_seen,
      group_id: null,
      unique_id: device.unique_id,
    })
  }
  return { realStore, missionId: mission.id }
}

/**
 * The poller's history persistence port as the production runtime implements
 * it: keep fix-time evidence inside the participation scope, write through
 * the real store, and read which observations the store refused from its
 * acknowledgement. `lostAcknowledgements` drops that many answers after the
 * commit, as a lost IPC reply would.
 */
function persistHistoryLikeRuntime(
  realStore: RealStore,
  missionId: string,
  options: {
    readonly participationFromMs?: number | (() => number)
    readonly lostAcknowledgements?: number
    /** Drops the refused-row list from the first answer whose write matches, after the commit. */
    readonly dropRefusalListOnce?: (sent: readonly NormalizedTrackingPosition[]) => boolean
    /**
     * Runs after each commit, before the answer is returned: may hold the
     * answer (a slow IPC reply) and decide it arrives malformed (no refused-row
     * list) [DON-338 round 11].
     */
    readonly afterCommit?: (sent: readonly NormalizedTrackingPosition[]) => Promise<'answer' | 'malformed'>
  } = {},
) {
  let conflicts = 0
  let lost = options.lostAcknowledgements ?? 0
  let listDropped = false
  const sentIds: string[] = []
  const writes: Promise<unknown>[] = []
  const participationFromMs = (): number => typeof options.participationFromMs === 'function'
    ? options.participationFromMs()
    : options.participationFromMs ?? Number.NEGATIVE_INFINITY
  const persistHistoryChunk = async (
    input: TrackingHistoryChunkPersistenceInput,
  ): Promise<TrackingHistoryChunkPersistenceResult> => {
    const scoped = input.positions.filter((position) =>
      position.timestamp_source === 'fix' && position.fix_time_unverified !== true &&
      Date.parse(position.timestamp) >= participationFromMs())
    sentIds.push(...scoped.map((position) => `${position.id}@${position.lat}`))
    const write = realStore.persistTrackingPositionsBulk({
      mission_id: missionId,
      positions: scoped.map((position) => ({
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
    writes.push(write)
    const acknowledgement = await write
    conflicts += acknowledgement.sourceIdentityConflictCount
    if (lost > 0) {
      lost -= 1
      throw new Error('acknowledgement lost')
    }
    let answer: unknown = acknowledgement
    const malformed = (await options.afterCommit?.(scoped)) === 'malformed'
    if (malformed || (!listDropped && options.dropRefusalListOnce?.(scoped) === true)) {
      if (!malformed) listDropped = true
      answer = Object.fromEntries(Object.entries(acknowledgement)
        .filter(([key]) => key !== 'refusedSourceIdentityConflicts'))
    }
    const refused = readRefusedSourcePositions(answer, scoped)
    return {
      changed: acknowledgement.changedPositionCount > 0,
      keptPositions: scoped.filter((position) => !refused.includes(position)),
    }
  }
  return {
    persistHistoryChunk,
    /** Every observation sent to the store, as `id@lat`. */
    sentIds: () => [...sentIds],
    conflicts: async () => {
      await Promise.allSettled(writes)
      return conflicts
    },
  }
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
  readonly respond?: (deviceId: string) => readonly NormalizedTrackingPosition[]
}

/** Starts the real poller against a scripted Traccar provider and records every published snapshot. */
function startPoller(
  schedule: ProviderSchedule,
  options: {
    readonly onSnapshot?: (snapshot: TrackingSnapshot) => void | Promise<void>
    readonly getInitialBreadcrumbs?: () => Promise<readonly NormalizedTrackingPosition[]>
    readonly getCanonicalBreadcrumbs?: (historyResetKey: string) => Promise<CanonicalBreadcrumbSeed>
    readonly getPollingMode?: () => 'active' | 'paused' | 'idle'
    readonly persistHistoryChunk?: (
      input: TrackingHistoryChunkPersistenceInput,
    ) => Promise<TrackingHistoryChunkPersistenceResult>
    readonly missionKey?: () => string
    readonly devices?: readonly NormalizedTrackingDevice[]
    readonly historyAntiEntropyIntervalMs?: number
    readonly onTrailStoreAgreementChange?: (awaiting: boolean) => void
  } = {},
) {
  let request = 0
  const snapshots: TrackingSnapshot[] = []
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(options.devices ?? [DEVICE]),
    getCurrentPositions: vi.fn().mockResolvedValue([]),
    getBreadcrumbs: vi.fn(async (deviceId: string, from: Date, to: Date) => {
      const response = schedule.respond?.(deviceId)
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
    ...(options.getCanonicalBreadcrumbs === undefined
      ? {}
      : { getCanonicalBreadcrumbs: options.getCanonicalBreadcrumbs }),
    ...(options.persistHistoryChunk === undefined
      ? {}
      : { persistHistoryChunk: options.persistHistoryChunk }),
    ...(options.historyAntiEntropyIntervalMs === undefined
      ? {}
      : { historyAntiEntropyIntervalMs: options.historyAntiEntropyIntervalMs }),
    ...(options.getPollingMode === undefined ? {} : { getPollingMode: options.getPollingMode }),
    ...(options.onTrailStoreAgreementChange === undefined
      ? {}
      : { onTrailStoreAgreementChange: options.onTrailStoreAgreementChange }),
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

describe('[DON-338] a source-id conflict the store refused is never drawn', () => {
  it('keeps the store\'s first row when the conflict arrives in a later poll (real poller, real store, both renderers)', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 3)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('keeps the store\'s first row when the original and the conflict arrive in the same response', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18, CONFLICT_17]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 2)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(started.snapshots.at(-1)!)
  })

  it('keeps the stored original seeded from the store when the conflict arrives live', async () => {
    const { realStore, missionId } = await openRealStore()
    await persistLikeRuntime(realStore, missionId, [ORIGINAL_17, FIX_18])
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[CONFLICT_17, FIX_18]] },
      {
        persistHistoryChunk: persistence.persistHistoryChunk,
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
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 3)
    const cached = await roundTripCache(started.snapshots[0]!)
    const merged = mergeDeferredTrackingCache(cached, started.snapshots.at(-1)!)

    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectStoreKeptLineInEveryRenderer(merged)
  })

  it('never writes the refused conflict into the restart cache', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 3)

    for (const snapshot of started.snapshots) {
      const restored = await roundTripCache(snapshot)
      expect(restored.breadcrumbs.filter((position) => position.lat === 52.2)).toEqual([])
    }
    expectStoreKeptLineInEveryRenderer(await roundTripCache(started.snapshots.at(-1)!))
  })

  it('fails closed: a lost acknowledgement draws nothing from that write, and the retry obeys the store', async () => {
    const { realStore, missionId } = await openRealStore()
    // Adapted in round 9: the line now waits for the store's answer, so a
    // lost answer keeps that write's fixes off the line until a retry is
    // answered, instead of the line guessing the store's rule.
    const persistence = persistHistoryLikeRuntime(realStore, missionId, { lostAcknowledgements: 1 })
    const started = startPoller(
      { responses: [[ORIGINAL_17, FIX_18], [CONFLICT_17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 4)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    for (const snapshot of started.snapshots) {
      expect(snapshot.breadcrumbs.filter((position) => position.lat === 52.2)).toEqual([])
    }
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

  describe('the accumulator merges what the store accepted (round 9: no store rule of its own)', () => {
    // Round 9 removed the accumulator's copy of the store's first-kept rule:
    // the store's answer now decides. Removed tests, with reasons:
    // - "keeps a saved fix when a later observation has no verified fix time":
    //   Traccar history without a verified fix time is refused at
    //   normalization, so it cannot reach the line from history at all.
    // - "does not redraw a conflict for an id compaction already dropped":
    //   now driven through the real poller and store as case a below, and the
    //   accumulator again reconsiders a dropped id (case f after compaction).

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
  })
})

const FIX_16 = fix('16', new Date(NOW_MS - 90_000).toISOString(), 52.099)

/** Asserts no published snapshot ever carried a 52.2 (refused) breadcrumb. */
function expectRefusedNeverPublished(snapshots: readonly TrackingSnapshot[]): void {
  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) {
    expect(snapshot.breadcrumbs.filter((position) => position.lat === 52.2)).toEqual([])
  }
}

/** Asserts both renderers in both trail modes draw exactly `expected` for device 1. */
function expectLineInEveryRenderer(
  snapshot: TrackingSnapshot,
  expected: readonly (readonly [number, number])[],
): void {
  for (const mode of ['line', 'dots'] as const) {
    expect(drawnWebGlLine(snapshot, mode), `WebGL map, ${mode} mode`).toEqual(expected)
    // Compared as vertex sets: the WebGL reader returns them sorted by latitude.
    expect([...drawnLeafletLine(snapshot, mode)].sort((left, right) => left[0] - right[0]),
      `Leaflet fallback, ${mode} mode`).toEqual(expected)
  }
}

describe('[DON-338] round 9: the live line obeys the store\'s named refusals, not a renderer mirror', () => {
  it('case a: a conflict for an original the canonical selection thinned away is not drawn, before or after a canonical reload', async () => {
    const { realStore, missionId } = await openRealStore()
    await persistLikeRuntime(realStore, missionId, [FIX_16, ORIGINAL_17, FIX_18])
    // The canonical selection kept 16 and 18 and omitted the stored 17.
    const thinned = [FIX_16, FIX_18]
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    let canonicalReloads = 0
    const started = startPoller(
      { responses: [[CONFLICT_17, FIX_18]] },
      {
        persistHistoryChunk: persistence.persistHistoryChunk,
        getInitialBreadcrumbs: async () => thinned,
        getCanonicalBreadcrumbs: async () => {
          canonicalReloads += 1
          return { positions: thinned, totalObservedByDevice: { '1': 3 }, selectionMetadataByDevice: {} }
        },
      },
    )
    await pollUntil(started, 4)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    expect(canonicalReloads).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual([[52.099, -9.7], [52.1, -9.7], [52.101, -9.7]])
    expectRefusedNeverPublished(started.snapshots)
    expectLineInEveryRenderer(started.snapshots.at(-1)!, [[52.099, -9.7], [52.101, -9.7]])
  })

  it('case d: an id reused on another device is not drawn for that device, and the observed count matches the store', async () => {
    const { realStore, missionId } = await openRealStore([DEVICE, DEVICE_2])
    await persistLikeRuntime(realStore, missionId, [ORIGINAL_17, FIX_18])
    const reusedOnDevice2 = fix('17', FIX_17_TIME, 52.2, -9.7, '2')
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [], respond: (deviceId) => deviceId === '2' ? [reusedOnDevice2] : [ORIGINAL_17, FIX_18] },
      { persistHistoryChunk: persistence.persistHistoryChunk, devices: [DEVICE, DEVICE_2] },
    )
    await pollUntil(started, 4)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    expect((await realStore.listPositions(missionId)).filter((row) => row.device_id === '2')).toEqual([])
    expectRefusedNeverPublished(started.snapshots)
    const latest = started.snapshots.at(-1)!
    expect(latest.breadcrumbs.filter((position) => position.device_id === '2')).toEqual([])
    expect(latest.breadcrumbMetadata?.totalObserved).toBe((await realStore.listPositions(missionId)).length)
    expectStoreKeptLineInEveryRenderer(latest)
  })

  it('case e: a breadcrumb that conflicts with a fix first saved by the current-position poll is not drawn', async () => {
    const { realStore, missionId } = await openRealStore()
    // The current-position poll saved fix 17 at 52.1; current positions never
    // enter the live line, so the poller does not hold it.
    await persistLikeRuntime(realStore, missionId, [ORIGINAL_17])
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const started = startPoller(
      { responses: [[CONFLICT_17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 3)

    expect(await persistence.conflicts()).toBeGreaterThan(0)
    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual(STORE_KEPT_LINE)
    expectRefusedNeverPublished(started.snapshots)
    expect(started.snapshots.at(-1)!.breadcrumbs).toContainEqual(FIX_18)
  })

  it('case f: a later version the store accepted replaces an earlier version outside the participation scope', async () => {
    const { realStore, missionId } = await openRealStore()
    const participationFromMs = NOW_MS - 90_000
    const outOfScope17 = fix('17', new Date(NOW_MS - 120_000).toISOString(), 52.1)
    const accepted17 = fix('17', FIX_17_TIME, 52.15)
    const persistence = persistHistoryLikeRuntime(realStore, missionId, { participationFromMs })
    const started = startPoller(
      { responses: [[outOfScope17, FIX_18], [accepted17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await pollUntil(started, 3)

    await expect(storeKeptLine(realStore, missionId)).resolves.toEqual([[52.15, -9.7], [52.101, -9.7]])
    const latest = started.snapshots.at(-1)!
    expect(latest.breadcrumbs.filter((position) => position.device_id === '1')).toEqual([accepted17, FIX_18])
    expectLineInEveryRenderer(latest, [[52.101, -9.7], [52.15, -9.7]])
  })

  it('case f after compaction: a corrected version of an id compaction dropped is drawn and not counted twice', () => {
    // A straight, steady walk: compaction keeps few of these fixes.
    const walk = Array.from({ length: 6_000 }, (_, index) =>
      fix(`w-${index}`, new Date(NOW_MS - 6_000_000 + index * 1_000).toISOString(), 52 + index * 1e-6))
    const accumulator = createBreadcrumbAccumulator()
    accumulator.ingest(walk)
    const compacted = accumulator.compact()
    const keptIds = new Set(compacted.positions.map((position) => position.id))
    const dropped = walk.find((position, index) => index > 0 && index < walk.length - 1 && !keptIds.has(position.id))
    expect(dropped).toBeDefined()

    const corrected = { ...dropped!, timestamp: new Date(Date.parse(dropped!.timestamp) + 500).toISOString(), lat: dropped!.lat + 5e-7 }
    const after = accumulator.append([corrected])

    expect(after.positions).toContain(corrected)
    expect(after.metadata.totalObserved).toBe(compacted.metadata.totalObserved)
  })
})

/** The store's rows for every device, as the canonical reload reads them. */
function canonicalFromStore(realStore: RealStore, missionId: string): () => Promise<CanonicalBreadcrumbSeed> {
  return async () => {
    const rows = await realStore.listPositions(missionId)
    const positions = rows
      .map((row) => fix(row.source_position_id ?? '', row.timestamp, row.lat, row.lon, row.device_id))
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    const totalObservedByDevice: Record<string, number> = {}
    for (const position of positions) {
      totalObservedByDevice[position.device_id] = (totalObservedByDevice[position.device_id] ?? 0) + 1
    }
    return { positions, totalObservedByDevice, selectionMetadataByDevice: {} }
  }
}

describe('[DON-338] round 10: the live line agrees with the store after an unconfirmed write, and holds only what was sent and kept', () => {
  it('MAJOR 1: a late fix committed under a lost refusal list is drawn once a later sweep finds it duplicate, and agreement is awaited until it is', async () => {
    const { realStore, missionId } = await openRealStore()
    // A late upload: Traccar serves this fix only after initial catch-up, and
    // it is older than the live window, so only the re-check sweep fetches it.
    const late = fix('late', new Date(NOW_MS - 40 * 60_000 + 45_000).toISOString(), 52.05)
    const provider = { uploaded: false }
    const persistence = persistHistoryLikeRuntime(realStore, missionId, {
      dropRefusalListOnce: (sent) => sent.some((position) => position.id === 'late'),
    })
    const agreement: { readonly awaiting: boolean; readonly lateDrawn: boolean }[] = []
    const started: ReturnType<typeof startPoller> = startPoller(
      { responses: [], respond: () => provider.uploaded ? [late, FIX_18] : [FIX_18] },
      {
        persistHistoryChunk: persistence.persistHistoryChunk,
        getCanonicalBreadcrumbs: canonicalFromStore(realStore, missionId),
        historyAntiEntropyIntervalMs: 60_000,
        onTrailStoreAgreementChange: (awaiting) => {
          // Read when the poller reports, after startPoller has returned.
          const latest = started.snapshots.at(-1)
          agreement.push({ awaiting, lateDrawn: latest?.breadcrumbs.some((position) => position.id === 'late') ?? false })
        },
      },
    )
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(started.historyRequests()).toBeGreaterThanOrEqual(2)
    })
    provider.uploaded = true
    // The sweep that commits the late fix loses the refused-row list; three
    // more sweeps then find it a duplicate (changed: false).
    for (let sweep = 0; sweep < 4; sweep += 1) await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await started.poller.stop()

    expect((await realStore.listPositions(missionId)).map((row) => row.source_position_id)).toContain('late')
    expect(started.snapshots.at(-1)!.breadcrumbs.map((position) => position.id)).toContain('late')
    expect(agreement.at(0)).toEqual({ awaiting: true, lateDrawn: false })
    expect(agreement.at(-1)).toEqual({ awaiting: false, lateDrawn: true })
  })

  it('MAJOR 2: an observation withheld from the write by the participation scope is never held for the line or the restart cache, even after the scope widens', async () => {
    const { realStore, missionId } = await openRealStore()
    const participationStart = { ms: NOW_MS - 30 * 60_000 }
    // The current-position poll saved id 17 at 52.2 inside the scope.
    const savedCurrent17 = fix('17', new Date(participationStart.ms + 30_000).toISOString(), 52.2)
    await persistLikeRuntime(realStore, missionId, [savedCurrent17])
    // History returns id 17 at 52.1, before participation began.
    const outOfScope17 = fix('17', new Date(participationStart.ms - 30_000).toISOString(), 52.1)
    const persistence = persistHistoryLikeRuntime(realStore, missionId, {
      participationFromMs: () => participationStart.ms,
    })
    const started = startPoller(
      { responses: [[outOfScope17, FIX_18]] },
      { persistHistoryChunk: persistence.persistHistoryChunk },
    )
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(started.historyRequests()).toBeGreaterThanOrEqual(2)
    })
    expect(persistence.sentIds()).not.toContain('17@52.1')
    // The participant is re-added with history from mission start.
    participationStart.ms = NOW_MS - 60 * 60_000
    await pollUntil(started, started.historyRequests() + 2)

    for (const snapshot of started.snapshots) {
      expect(snapshot.breadcrumbs.filter((position) => position.lat === 52.1)).toEqual([])
      const restored = await roundTripCache(snapshot)
      expect(restored.breadcrumbs.filter((position) => position.lat === 52.1)).toEqual([])
    }
    // The store kept its first row for id 17.
    expect((await realStore.listPositions(missionId)).filter((row) => row.source_position_id === '17')
      .map((row) => row.lat)).toEqual([52.2])
    expect(started.snapshots.at(-1)!.breadcrumbs).toContainEqual(FIX_18)
  })
})

const LATE_19 = fix('19', new Date(NOW_MS - 40 * 60_000 + 45_000).toISOString(), 52.05)
const LATE_20 = fix('20', new Date(NOW_MS - 40 * 60_000 + 50_000).toISOString(), 52.051)
const EMPTY_SEED: CanonicalBreadcrumbSeed = { positions: [], totalObservedByDevice: {}, selectionMetadataByDevice: {} }

/**
 * The canonical reload over the real store. Each read takes the store's rows
 * when it begins; a read the test holds delivers them only when released.
 * Another mission's key reads an empty store.
 */
function canonicalReadsFromStore(realStore: RealStore, missionId: string) {
  const read = canonicalFromStore(realStore, missionId)
  const held: (() => void)[] = []
  let holdNext = 0
  let heldTotal = 0
  let begun = 0
  return {
    getCanonicalBreadcrumbs: async (historyResetKey: string): Promise<CanonicalBreadcrumbSeed> => {
      begun += 1
      const seed = historyResetKey === MISSION_KEY ? await read() : EMPTY_SEED
      if (holdNext > 0) {
        holdNext -= 1
        heldTotal += 1
        await new Promise<void>((resolve) => { held.push(resolve) })
      }
      return seed
    },
    holdNextRead: (): void => { holdNext += 1 },
    heldReads: (): number => held.length,
    heldTotal: (): number => heldTotal,
    releaseOldest: (): void => { held.shift()?.() },
    begun: (): number => begun,
  }
}

/** Store answers scripted per fix id: the first write carrying the id may be held and may arrive malformed. */
function scriptedAnswers() {
  const plans = new Map<string, { readonly hold: boolean }>()
  const held: (() => void)[] = []
  const malformed: string[] = []
  return {
    malformedFor: (id: string, plan: { readonly hold: boolean }): void => { plans.set(id, plan) },
    afterCommit: async (sent: readonly NormalizedTrackingPosition[]): Promise<'answer' | 'malformed'> => {
      const id = sent.map((position) => position.id).find((candidate) => plans.has(candidate))
      if (id === undefined) return 'answer'
      const plan = plans.get(id)!
      plans.delete(id)
      if (plan.hold) await new Promise<void>((resolve) => { held.push(resolve) })
      malformed.push(id)
      return 'malformed'
    },
    heldAnswers: (): number => held.length,
    releaseAnswers: (): void => { held.splice(0).forEach((release) => release()) },
    malformed: (): readonly string[] => [...malformed],
  }
}

/** Advances fake time in steps until the condition holds. */
async function advanceUntil(condition: () => boolean, stepMs = 1_000, maxSteps = 400): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (condition()) return
    await vi.advanceTimersByTimeAsync(stepMs)
  }
  throw new Error('Condition not reached in fake time.')
}

type AgreementEntry = { readonly awaiting: boolean; readonly lineIds: readonly string[] }

/** The ids on device 1's latest published line. */
function latestLineIds(started: ReturnType<typeof startPoller>): readonly string[] {
  return started.snapshots.at(-1)?.breadcrumbs.map((position) => position.id) ?? []
}

/** Starts the real poller over the real store with scripted answers, a controllable mode and mission key. */
async function startAgreementScenario(options: {
  readonly answers: ReturnType<typeof scriptedAnswers>
  readonly serving?: () => boolean
}) {
  const { realStore, missionId } = await openRealStore()
  const uploaded: NormalizedTrackingPosition[] = []
  const mode: { current: 'active' | 'paused' } = { current: 'active' }
  const missionKey = { current: MISSION_KEY }
  const persistence = persistHistoryLikeRuntime(realStore, missionId, { afterCommit: options.answers.afterCommit })
  const canonical = canonicalReadsFromStore(realStore, missionId)
  const agreement: AgreementEntry[] = []
  const started: ReturnType<typeof startPoller> = startPoller(
    {
      responses: [],
      respond: () => (options.serving?.() ?? true) ? [...uploaded, FIX_18] : [],
    },
    {
      persistHistoryChunk: persistence.persistHistoryChunk,
      getCanonicalBreadcrumbs: canonical.getCanonicalBreadcrumbs,
      getPollingMode: () => mode.current,
      missionKey: () => missionKey.current,
      historyAntiEntropyIntervalMs: 60_000,
      onTrailStoreAgreementChange: (awaiting) => {
        agreement.push({ awaiting, lineIds: latestLineIds(started) })
      },
    },
  )
  await advanceUntil(() => started.historyRequests() >= 2, 5_000)
  const storedIds = async (): Promise<readonly (string | null)[]> =>
    (await realStore.listPositions(missionId)).map((row) => row.source_position_id)
  return { started, uploaded, mode, missionKey, persistence, canonical, agreement, storedIds }
}

describe('[DON-338] round 11: every unconfirmed trail write is owed a store reload that began after it', () => {
  it('schedule 1: a malformed answer delivered while paused still owes a reload; after resume the stored fix is drawn and only then does agreement clear', async () => {
    const answers = scriptedAnswers()
    answers.malformedFor('19', { hold: true })
    const scenario = await startAgreementScenario({ answers })
    scenario.uploaded.push(LATE_19)
    // An anti-entropy write commits fix 19; its answer is held.
    await advanceUntil(() => answers.heldAnswers() === 1)
    expect(await scenario.storedIds()).toContain('19')
    scenario.mode.current = 'paused'
    await vi.advanceTimersByTimeAsync(5_000)
    answers.releaseAnswers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(answers.malformed()).toEqual(['19'])
    // The mark is recorded in pause; the warning is up.
    expect(scenario.agreement).toEqual([{ awaiting: true, lineIds: expect.not.arrayContaining(['19']) }])
    scenario.mode.current = 'active'
    // Resume: the retry finds 19 unchanged and publishes nothing.
    for (let sweep = 0; sweep < 3; sweep += 1) await vi.advanceTimersByTimeAsync(60_000)
    await scenario.started.poller.stop()

    expect(latestLineIds(scenario.started)).toContain('19')
    expect(scenario.agreement.at(-1)).toEqual({ awaiting: false, lineIds: expect.arrayContaining(['19']) })
  })

  it('schedule 2: a second failure while reload A runs is not cleared by A, and a follow-up discarded in pause is re-requested on resume', async () => {
    const answers = scriptedAnswers()
    answers.malformedFor('19', { hold: false })
    answers.malformedFor('20', { hold: false })
    const scenario = await startAgreementScenario({ answers })
    scenario.canonical.holdNextRead()
    scenario.uploaded.push(LATE_19)
    // Fix 19 commits unconfirmed and reload A begins; A's result is held.
    await advanceUntil(() => scenario.canonical.heldReads() === 1)
    expect(answers.malformed()).toEqual(['19'])
    scenario.canonical.holdNextRead()
    scenario.uploaded.push(LATE_20)
    // Fix 20 commits under another rejected answer while A is held.
    await advanceUntil(() => answers.malformed().includes('20'))
    expect(await scenario.storedIds()).toContain('20')
    scenario.canonical.releaseOldest()
    // A applies (19 only); the follow-up reload begins and is held.
    await advanceUntil(() => scenario.canonical.heldTotal() === 2 && scenario.canonical.heldReads() === 1)
    expect(latestLineIds(scenario.started)).toContain('19')
    expect(latestLineIds(scenario.started)).not.toContain('20')
    scenario.mode.current = 'paused'
    await vi.advanceTimersByTimeAsync(5_000)
    scenario.canonical.releaseOldest()
    await vi.advanceTimersByTimeAsync(10_000)
    scenario.mode.current = 'active'
    // Resume; the confirmed retry of 20 is a duplicate and publishes nothing.
    for (let sweep = 0; sweep < 3; sweep += 1) await vi.advanceTimersByTimeAsync(60_000)
    await scenario.started.poller.stop()

    expect(latestLineIds(scenario.started)).toEqual(expect.arrayContaining(['19', '20']))
    // Agreement never clears while the line lacks a stored, unconfirmed fix.
    for (const entry of scenario.agreement.filter((candidate) => !candidate.awaiting)) {
      expect(entry.lineIds).toEqual(expect.arrayContaining(['19', '20']))
    }
    expect(scenario.agreement.at(-1)?.awaiting).toBe(false)
  })

  it('a mark set while paused is reloaded on resume even when no further write happens', async () => {
    const answers = scriptedAnswers()
    answers.malformedFor('19', { hold: true })
    const provider = { serving: true }
    const scenario = await startAgreementScenario({ answers, serving: () => provider.serving })
    scenario.uploaded.push(LATE_19)
    await advanceUntil(() => answers.heldAnswers() === 1)
    scenario.mode.current = 'paused'
    await vi.advanceTimersByTimeAsync(5_000)
    answers.releaseAnswers()
    await vi.advanceTimersByTimeAsync(10_000)
    // Traccar serves nothing more, so nothing more is written.
    provider.serving = false
    const sentBeforeResume = scenario.persistence.sentIds().length
    const readsBeforeResume = scenario.canonical.begun()
    scenario.mode.current = 'active'
    await vi.advanceTimersByTimeAsync(15_000)
    await scenario.started.poller.stop()

    expect(scenario.persistence.sentIds()).toHaveLength(sentBeforeResume)
    expect(scenario.canonical.begun()).toBeGreaterThan(readsBeforeResume)
    expect(latestLineIds(scenario.started)).toContain('19')
    expect(scenario.agreement.map((entry) => entry.awaiting)).toEqual([true, false])
  })

  it('two failures with reload A in flight: A does not clear the mark; the follow-up that saw both does', async () => {
    const answers = scriptedAnswers()
    answers.malformedFor('19', { hold: false })
    answers.malformedFor('20', { hold: false })
    const scenario = await startAgreementScenario({ answers })
    scenario.canonical.holdNextRead()
    scenario.uploaded.push(LATE_19)
    await advanceUntil(() => scenario.canonical.heldReads() === 1)
    scenario.canonical.holdNextRead()
    scenario.uploaded.push(LATE_20)
    await advanceUntil(() => answers.malformed().includes('20'))
    scenario.canonical.releaseOldest()
    await advanceUntil(() => scenario.canonical.heldTotal() === 2 && scenario.canonical.heldReads() === 1)
    // A applied with 19 only: still awaiting agreement.
    expect(scenario.agreement.map((entry) => entry.awaiting)).toEqual([true])
    scenario.canonical.releaseOldest()
    await vi.advanceTimersByTimeAsync(1_000)
    await scenario.started.poller.stop()

    expect(latestLineIds(scenario.started)).toEqual(expect.arrayContaining(['19', '20']))
    expect(scenario.agreement).toEqual([
      { awaiting: true, lineIds: expect.not.arrayContaining(['19']) },
      { awaiting: false, lineIds: expect.arrayContaining(['19', '20']) },
    ])
  })

  it('a mission switch drops the mark; the old mission\'s late answer and reload never reach the new mission', async () => {
    const answers = scriptedAnswers()
    answers.malformedFor('19', { hold: false })
    answers.malformedFor('20', { hold: true })
    const scenario = await startAgreementScenario({ answers })
    scenario.canonical.holdNextRead()
    scenario.uploaded.push(LATE_19)
    await advanceUntil(() => scenario.canonical.heldReads() === 1)
    expect(scenario.agreement.map((entry) => entry.awaiting)).toEqual([true])
    scenario.uploaded.push(LATE_20)
    // Mission A's write of 20 commits; its answer is held across the switch.
    await advanceUntil(() => answers.heldAnswers() === 1)
    scenario.missionKey.current = 'mission-b'
    scenario.uploaded.length = 0
    await advanceUntil(() => scenario.agreement.length === 2)
    expect(scenario.agreement[1]?.awaiting).toBe(false)
    // Mission A's malformed answer and its reload result arrive after the switch.
    answers.releaseAnswers()
    scenario.canonical.releaseOldest()
    for (let sweep = 0; sweep < 2; sweep += 1) await vi.advanceTimersByTimeAsync(60_000)
    await scenario.started.poller.stop()

    expect(answers.malformed()).toEqual(['19', '20'])
    expect(scenario.agreement.map((entry) => entry.awaiting)).toEqual([true, false])
    expect(latestLineIds(scenario.started)).not.toContain('19')
    expect(latestLineIds(scenario.started)).not.toContain('20')
  })
})

describe('[DON-349] P-6: a lasting store fault does not reload the whole trail on every poll', () => {
  it('spaces the reloads owed by repeated failed writes, keeps awaiting agreement while the fault lasts, and reloads within a minute once writes succeed again', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const fault = { on: false }
    const canonical = canonicalReadsFromStore(realStore, missionId)
    const agreement: boolean[] = []
    const started = startPoller(
      { responses: [], respond: () => [FIX_18] },
      {
        // A fault that repeats on every write and commits nothing, like a full disk.
        persistHistoryChunk: async (input) => {
          if (fault.on) throw new Error('database or disk is full')
          return persistence.persistHistoryChunk(input)
        },
        getCanonicalBreadcrumbs: canonical.getCanonicalBreadcrumbs,
        historyAntiEntropyIntervalMs: 60_000,
        onTrailStoreAgreementChange: (awaiting) => { agreement.push(awaiting) },
      },
    )
    await advanceUntil(() => started.historyRequests() >= 2, 5_000)
    fault.on = true
    const readsBeforeFault = canonical.begun()

    // Ten minutes of 5-second polls, every write failing.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const reloadsDuringFault = canonical.begun() - readsBeforeFault

    // Bounded: well under one reload per poll (120 polls), but never given up.
    expect(reloadsDuringFault).toBeGreaterThanOrEqual(2)
    expect(reloadsDuringFault).toBeLessThanOrEqual(15)
    // The line still awaits agreement with the store while writes keep failing.
    expect(agreement.at(-1)).toBe(true)

    fault.on = false
    const readsAfterFault = canonical.begun()
    // At most one capped cooldown (60 s) plus a poll before the owed reload.
    await vi.advanceTimersByTimeAsync(65_000)

    // Asserted before stop, because stop forgets the awaited agreement itself.
    expect(canonical.begun()).toBeGreaterThan(readsAfterFault)
    expect(agreement.at(-1)).toBe(false)
    expect(latestLineIds(started)).toContain('18')
    await started.poller.stop()
  })

  it('spaces owed reloads the same way when the store read fails too', async () => {
    const { realStore, missionId } = await openRealStore()
    const persistence = persistHistoryLikeRuntime(realStore, missionId)
    const fault = { on: false }
    const canonical = canonicalReadsFromStore(realStore, missionId)
    let failedReads = 0
    const agreement: boolean[] = []
    const started = startPoller(
      { responses: [], respond: () => [FIX_18] },
      {
        persistHistoryChunk: async (input) => {
          if (fault.on) throw new Error('database or disk is full')
          return persistence.persistHistoryChunk(input)
        },
        // The same fault fails every reload from the store.
        getCanonicalBreadcrumbs: async (...args) => {
          if (fault.on) {
            failedReads += 1
            throw new Error('database or disk is full')
          }
          return canonical.getCanonicalBreadcrumbs(...args)
        },
        historyAntiEntropyIntervalMs: 60_000,
        onTrailStoreAgreementChange: (awaiting) => { agreement.push(awaiting) },
      },
    )
    await advanceUntil(() => started.historyRequests() >= 2, 5_000)
    fault.on = true

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    // A 5-second retry would make 120 attempts; spaced reloads stay bounded but continue.
    expect(failedReads).toBeGreaterThanOrEqual(2)
    expect(failedReads).toBeLessThanOrEqual(15)
    expect(agreement.at(-1)).toBe(true)

    fault.on = false
    await vi.advanceTimersByTimeAsync(65_000)
    expect(agreement.at(-1)).toBe(false)
    expect(latestLineIds(started)).toContain('18')
    await started.poller.stop()
  })
})
