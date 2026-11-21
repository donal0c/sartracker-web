import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBreadcrumbHistoryReconciler,
  type BreadcrumbHistoryChunk,
  type BreadcrumbHistoryProgress,
  type BreadcrumbHistoryReconcilerOptions,
} from '../../src/features/tracking/breadcrumb-history-reconciler'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// DON-338 piece 2 review: the real reconciler writing into the real mission
// store, so completion claims and durable checkpoints are checked where they
// live, not in a test Set.

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const POLL_MS = 30 * SECOND_MS
const TICK_MS = 5 * MINUTE_MS
const MISSION_START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const NOW_MS = MISSION_START_MS + 12 * HOUR_MS
const TOO_LARGE_MESSAGE =
  "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar response is too large."
const TIMED_OUT_MESSAGE =
  "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar request timed out after 10000 ms."

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<unknown>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
  readonly listTrackingHistoryCheckpoints: (missionId: string) => Promise<readonly {
    readonly device_id: string
    readonly history_from: string
    readonly reconciled_until: string
  }[]>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

type ServerFix = { readonly id: string; readonly fixMs: number; readonly serverMs: number }
type FakeRequest = {
  readonly deviceId: string
  readonly startedAtMs: number
  readonly fromMs: number
  readonly toMs: number
  readonly failed: boolean
}
type RequestRule = (request: { readonly deviceId: string; readonly fromMs: number; readonly toMs: number }) =>
  { readonly error: Error | null; readonly delayMs?: number }

let userDataPath: string | undefined
let store: RealStore | undefined

function createDevice(index: number): NormalizedTrackingDevice {
  return {
    device_id: String(index),
    name: `Tracker ${index}`,
    status: 'online',
    last_seen: null,
    unique_id: `tracker-${index}`,
    category: null,
  }
}

function lowerBound(fixes: readonly ServerFix[], targetMs: number): number {
  let low = 0
  let high = fixes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (fixes[middle]!.fixMs < targetMs) low = middle + 1
    else high = middle
  }
  return low
}

/** The real reconciler persisting every chunk into a real mission store, like the polling manager does. */
async function createRealStoreHarness(options: {
  readonly deviceCount: number
  readonly intervalMs: number
  readonly rule: RequestRule
  readonly missionStartMs?: number
  readonly reconcilerOptions?: Partial<BreadcrumbHistoryReconcilerOptions>
}) {
  const missionStartMs = options.missionStartMs ?? MISSION_START_MS
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-reconciler-real-store-'))
  const realStore = createElectronMissionStore({ userDataPath })
  store = realStore
  const mission = await realStore.createMission({
    name: 'Reconciler Real Store',
    start_time: new Date(missionStartMs).toISOString(),
  })
  const devices = Array.from({ length: options.deviceCount }, (_, index) => createDevice(index + 1))
  const fixesByDevice = new Map<string, ServerFix[]>()
  for (const device of devices) {
    await realStore.upsertDevice({
      mission_id: mission.id,
      device_id: device.device_id,
      name: device.name,
      color: '#ff0000',
      status: 'online',
    })
    const fixes: ServerFix[] = []
    for (let fixMs = missionStartMs; fixMs <= NOW_MS; fixMs += options.intervalMs) {
      fixes.push({ id: `${device.device_id}-${fixMs}`, fixMs, serverMs: fixMs })
    }
    fixesByDevice.set(device.device_id, fixes)
  }
  const requests: FakeRequest[] = []
  const progressCalls: BreadcrumbHistoryProgress[] = []
  const inFlightByDevice = new Map<string, number>()
  const maxInFlightByDevice = new Map<string, number>()
  const fetchBreadcrumbs = async (deviceId: string, from: Date, to: Date): Promise<readonly NormalizedTrackingPosition[]> => {
    const fromMs = from.getTime()
    const toMs = to.getTime()
    const startedAtMs = Date.now()
    const inFlight = (inFlightByDevice.get(deviceId) ?? 0) + 1
    inFlightByDevice.set(deviceId, inFlight)
    maxInFlightByDevice.set(deviceId, Math.max(maxInFlightByDevice.get(deviceId) ?? 0, inFlight))
    const { error, delayMs = 0 } = options.rule({ deviceId, fromMs, toMs })
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    } finally {
      inFlightByDevice.set(deviceId, (inFlightByDevice.get(deviceId) ?? 1) - 1)
    }
    requests.push({ deviceId, startedAtMs, fromMs, toMs, failed: error !== null })
    if (error !== null) throw error
    const fixes = fixesByDevice.get(deviceId) ?? []
    return fixes
      .slice(lowerBound(fixes, fromMs), lowerBound(fixes, toMs + 1))
      .filter((fix) => fix.serverMs <= Date.now())
      .map((fix) => ({
        id: fix.id,
        device_id: deviceId,
        lat: 52 + (fix.fixMs - missionStartMs) / HOUR_MS * 1e-3,
        lon: -9,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        timestamp: new Date(fix.fixMs).toISOString(),
        timestamp_source: 'fix' as const,
        source: 'traccar' as const,
        data_origin: 'live' as const,
        cache_age_seconds: null,
        device_cache_stale: false,
      }))
  }
  const persist = async (chunk: BreadcrumbHistoryChunk): Promise<void> => {
    await realStore.persistTrackingPositionsBulk({
      mission_id: mission.id,
      positions: chunk.positions.map((position) => ({
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
      checkpoints: [{
        device_id: chunk.deviceId,
        history_from: chunk.historyFrom.toISOString(),
        reconciled_from: chunk.from.toISOString(),
        reconciled_until: chunk.to.toISOString(),
      }],
    })
  }
  const reconciler = createBreadcrumbHistoryReconciler({
    fetchBreadcrumbs,
    onChunk: persist,
    onProgress: (progress) => { progressCalls.push(progress) },
    shouldContinue: () => true,
    logger: { warn: vi.fn() },
    ...options.reconcilerOptions,
  })
  const runFor = async (durationMs: number): Promise<void> => {
    const endMs = Date.now() + durationMs
    while (Date.now() < endMs) {
      reconciler.reconcile({ devices, from: new Date(missionStartMs), until: new Date(Date.now()) })
      await vi.advanceTimersByTimeAsync(Math.min(POLL_MS, endMs - Date.now()))
    }
  }
  const uploadLateBurst = (deviceId: string, fromMs: number, toMs: number, stepMs: number): number => {
    const fixes = fixesByDevice.get(deviceId)!
    let count = 0
    for (let fixMs = fromMs; fixMs <= toMs; fixMs += stepMs) {
      fixes.push({ id: `${deviceId}-late-${fixMs}`, fixMs: fixMs + 1, serverMs: Date.now() })
      count += 1
    }
    fixes.sort((left, right) => left.fixMs - right.fixMs)
    return count
  }
  const serverFixCount = (deviceId: string): number => fixesByDevice.get(deviceId)!.length
  const checkpointOf = async (deviceId: string) =>
    (await realStore.listTrackingHistoryCheckpoints(mission.id)).find((checkpoint) => checkpoint.device_id === deviceId)
  const storedCount = (deviceId: string): Promise<number> => realStore.countPositions(mission.id, deviceId)
  return {
    reconciler, requests, progressCalls, runFor, uploadLateBurst, serverFixCount, checkpointOf, storedCount,
    maxInFlightByDevice,
  }
}

describe('history catch-up against the real mission store [DON-338 review]', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
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

  it('never reports catch-up complete while a history gap is unfilled (finding 1)', async () => {
    const badFromMs = MISSION_START_MS + 2 * HOUR_MS + MINUTE_MS
    const badToMs = badFromMs + MINUTE_MS
    const server = { broken: true }
    const harness = await createRealStoreHarness({
      deviceCount: 1,
      intervalMs: 10 * SECOND_MS,
      rule: ({ fromMs, toMs }) => ({
        error: server.broken && fromMs <= badToMs && toMs >= badFromMs ? new Error(TOO_LARGE_MESSAGE) : null,
      }),
    })

    await harness.runFor(15 * MINUTE_MS)

    const progress = harness.reconciler.getProgress()
    expect(progress.historyGaps.length).toBeGreaterThan(0)
    expect(progress.complete).toBe(false)
    // No published progress, in either phase, claims completion with a gap open.
    expect(harness.progressCalls.filter((call) => call.complete && call.historyGaps.length > 0)).toEqual([])
    expect(harness.progressCalls.some((call) => call.phase === 'initial' && call.complete)).toBe(false)
    // The durable checkpoint stops before the unfetchable minute: nothing past it is claimed
    // reconciled. (A reported gap may start a little earlier than the bad minute, because it
    // records whole failed windows.)
    const gapStartMs = Math.min(...progress.historyGaps.map((gap) => Date.parse(gap.from)))
    expect(gapStartMs).toBeLessThanOrEqual(badFromMs)
    const checkpoint = await harness.checkpointOf('1')
    expect(Date.parse(checkpoint!.reconciled_until)).toBeLessThanOrEqual(badFromMs)
    expect(await harness.storedCount('1')).toBeLessThan(harness.serverFixCount('1'))

    server.broken = false
    await harness.runFor(TICK_MS + POLL_MS)

    expect(harness.reconciler.getProgress().historyGaps).toEqual([])
    expect(harness.reconciler.getProgress().complete).toBe(true)
    // Filling the last gap publishes the initial completion the polling manager waits for.
    expect(harness.progressCalls.at(-1)?.complete).toBe(true)
    expect(harness.progressCalls.some((call) => call.phase === 'initial' && call.complete)).toBe(true)
    expect(await harness.storedCount('1')).toBe(harness.serverFixCount('1'))
  })

  it('does not report the re-check complete while a re-check gap is unfilled (finding 1)', async () => {
    const server = { broken: false }
    const badFromMs = NOW_MS - 3 * HOUR_MS
    const harness = await createRealStoreHarness({
      deviceCount: 1,
      intervalMs: 10 * SECOND_MS,
      rule: ({ fromMs, toMs }) => ({
        error: server.broken && fromMs <= badFromMs + MINUTE_MS && toMs >= badFromMs ? new Error(TOO_LARGE_MESSAGE) : null,
      }),
    })
    await harness.runFor(5 * MINUTE_MS)
    server.broken = true

    await harness.runFor(2 * TICK_MS)

    const antiEntropyCalls = harness.progressCalls.filter((call) => call.phase === 'anti_entropy')
    expect(antiEntropyCalls.at(-1)?.historyGaps.length).toBeGreaterThan(0)
    expect(antiEntropyCalls.filter((call) => call.complete && call.historyGaps.length > 0)).toEqual([])
    expect(harness.reconciler.getProgress().complete).toBe(false)
  })

  it('keeps healthy devices on the 5-minute re-check while one device times out at every size (finding 2)', async () => {
    const server = { aSlow: false }
    const harness = await createRealStoreHarness({
      deviceCount: 2,
      intervalMs: 10 * SECOND_MS,
      // Like the Traccar client: four 10 s attempts with backoff before it gives up.
      rule: ({ deviceId }) => server.aSlow && deviceId === '1'
        ? { error: new Error(TIMED_OUT_MESSAGE), delayMs: 47 * SECOND_MS }
        : { error: null },
    })
    await harness.runFor(5 * MINUTE_MS)
    expect(harness.reconciler.getProgress().complete).toBe(true)
    server.aSlow = true
    await harness.runFor(TICK_MS)
    const storedBefore = await harness.storedCount('2')
    const burst = harness.uploadLateBurst('2', Date.now() - 4 * HOUR_MS, Date.now() - HOUR_MS, MINUTE_MS)
    const uploadedAtMs = Date.now()

    await harness.runFor(TICK_MS + 2 * POLL_MS)

    expect(await harness.storedCount('2')).toBe(storedBefore + burst)
    // Device 1's work in any one tick is bounded, and what it could not reach is published, not claimed.
    const aRequests = harness.requests.filter((request) => request.deviceId === '1' && request.startedAtMs >= uploadedAtMs - TICK_MS)
    const perTick = new Map<number, number>()
    for (const request of aRequests) {
      const tick = Math.floor((request.startedAtMs - NOW_MS) / TICK_MS)
      perTick.set(tick, (perTick.get(tick) ?? 0) + 1)
    }
    expect(Math.max(...perTick.values())).toBeLessThanOrEqual(12)
    const progress = harness.reconciler.getProgress()
    expect(progress.complete).toBe(false)
    expect(progress.failedDeviceNames).toContain('Tracker 1')
    expect(progress.recheckBacklog.some((range) => range.deviceId === '1')).toBe(true)
  })

  it('re-checks the oldest range of a long mission within a bounded number of ticks (round 3, item 1)', async () => {
    // 36 h of history; each request takes 30 s and a device may spend 150 s per
    // tick, so a tick re-reads 10 h: the 6 h recent window plus 4 h of older history.
    const missionStartMs = NOW_MS - 36 * HOUR_MS
    const server = { slow: false }
    const harness = await createRealStoreHarness({
      deviceCount: 1,
      intervalMs: MINUTE_MS,
      missionStartMs,
      reconcilerOptions: { antiEntropyDeviceTimeBudgetMs: 150 * SECOND_MS },
      rule: () => ({ error: null, delayMs: server.slow ? 30 * SECOND_MS : 0 }),
    })
    await harness.runFor(POLL_MS)
    expect(harness.reconciler.getProgress().complete).toBe(true)
    server.slow = true
    // A phone uploads one fix from the first hour of the mission.
    harness.uploadLateBurst('1', missionStartMs + 30 * MINUTE_MS, missionStartMs + 30 * MINUTE_MS, MINUTE_MS)

    // The reconciler's bound: 30 h of older history in 6 h passes chunks, 4 h
    // re-read per tick, is ceil(30 / 6) x ceil(6 / 4) = 10 ticks per pass, and
    // any range is reached within two passes.
    const boundTicks = 20
    let deliveredAfterTicks: number | null = null
    for (let tick = 1; tick <= boundTicks && deliveredAfterTicks === null; tick += 1) {
      await harness.runFor(TICK_MS)
      if (await harness.storedCount('1') === harness.serverFixCount('1')) deliveredAfterTicks = tick
    }
    expect(deliveredAfterTicks).not.toBeNull()
    expect(deliveredAfterTicks!).toBeLessThanOrEqual(boundTicks)
  })

  it('retries every slice of a merged gap, not only its still-failing first slice (round 3, items 2 and 3)', async () => {
    // A 36 h mission keeps the older re-check pass away from the gap for
    // several ticks, so only gap retries can fill its recovered part.
    const missionStartMs = NOW_MS - 36 * HOUR_MS
    const badFromMs = missionStartMs + 2 * HOUR_MS
    const server = { brokenFromMs: badFromMs, brokenToMs: badFromMs + 20 * MINUTE_MS, delayMs: 0 }
    const harness = await createRealStoreHarness({
      deviceCount: 1,
      intervalMs: 10 * SECOND_MS,
      missionStartMs,
      rule: ({ fromMs, toMs }) => ({
        error: fromMs < server.brokenToMs && toMs > server.brokenFromMs ? new Error(TOO_LARGE_MESSAGE) : null,
        delayMs: server.delayMs,
      }),
    })
    await harness.runFor(5 * MINUTE_MS)
    const gaps = harness.reconciler.getProgress().historyGaps
    expect(gaps).toHaveLength(1)
    const gapFromMs = Date.parse(gaps[0]!.from)
    const gapToMs = Date.parse(gaps[0]!.to)
    expect(gapToMs - gapFromMs).toBeGreaterThan(10 * MINUTE_MS)

    // The server recovers everywhere except the gap's first minute.
    server.brokenFromMs = gapFromMs
    server.brokenToMs = gapFromMs + MINUTE_MS
    server.delayMs = SECOND_MS
    await harness.runFor(3 * TICK_MS)

    const remaining = harness.reconciler.getProgress().historyGaps
    expect(remaining).toHaveLength(1)
    // The still-failing head stays reported; the recovered remainder is filled.
    expect(Date.parse(remaining[0]!.from)).toBeLessThanOrEqual(gapFromMs + MINUTE_MS)
    expect(Date.parse(remaining[0]!.to)).toBeLessThanOrEqual(gapFromMs + 5 * MINUTE_MS)
    expect(harness.reconciler.getProgress().complete).toBe(false)
    // One request per device at a time, across the sweep and gap retries.
    expect(harness.maxInFlightByDevice.get('1')).toBe(1)
  })
})
