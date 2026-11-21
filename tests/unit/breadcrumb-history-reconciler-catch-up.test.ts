import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBreadcrumbHistoryReconciler } from '../../src/features/tracking/breadcrumb-history-reconciler'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// DON-338 piece 2 (ING-1, ING-2, ING-3): late-upload catch-up must not stall.
// Every test drives the real reconciler against a fake Traccar that filters by
// fixTime, only serves fixes it has received, and fails the way the Electron
// proxy does (size limit, timeout). Time is faked deterministically.

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const POLL_MS = 30 * SECOND_MS
const TICK_MS = 5 * MINUTE_MS
const MISSION_START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const NOW_MS = MISSION_START_MS + 12 * HOUR_MS
// What the renderer sees when the Electron proxy rejects a reply.
const TOO_LARGE_MESSAGE =
  "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar response is too large."
const TIMED_OUT_MESSAGE =
  "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar request timed out after 10000 ms."

type ServerFix = {
  readonly id: string
  readonly fixMs: number
  readonly serverMs: number
}

type FakeRequest = {
  readonly deviceId: string
  readonly atMs: number
  readonly fromMs: number
  readonly toMs: number
  readonly rows: number
  readonly failed: boolean
}

type HarnessOptions = {
  readonly deviceCount: number
  readonly intervalMs: number
  /** Production initial catch-up persists in acknowledged waves (`onChunks`). */
  readonly batched?: boolean
  /** A reply with more rows than this fails like the proxy's 5 MiB limit. */
  readonly maxRowsPerResponse?: number
  readonly oversizedMessage?: string
  /** Extra failure rule, checked before the size rule. */
  readonly fail?: (request: { readonly deviceId: string; readonly fromMs: number; readonly toMs: number }) => Error | null
}

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

function toPosition(deviceId: string, fix: ServerFix): NormalizedTrackingPosition {
  return {
    id: fix.id,
    device_id: deviceId,
    lat: 52,
    lon: -9,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(fix.fixMs).toISOString(),
    timestamp_source: 'fix',
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

/** First index whose fixMs is >= target, in a fixMs-sorted array. */
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

function createHarness(options: HarnessOptions) {
  const devices = Array.from({ length: options.deviceCount }, (_, index) => createDevice(index + 1))
  const fixesByDevice = new Map<string, ServerFix[]>()
  for (const device of devices) {
    const fixes: ServerFix[] = []
    for (let fixMs = MISSION_START_MS; fixMs <= NOW_MS; fixMs += options.intervalMs) {
      fixes.push({ id: `${device.device_id}-${fixMs}`, fixMs, serverMs: fixMs })
    }
    fixesByDevice.set(device.device_id, fixes)
  }
  const stored = new Set<string>()
  const requests: FakeRequest[] = []
  const warn = vi.fn()
  const fetchBreadcrumbs = async (deviceId: string, from: Date, to: Date) => {
    const fromMs = from.getTime()
    const toMs = to.getTime()
    const fixes = fixesByDevice.get(deviceId) ?? []
    const rows = fixes
      .slice(lowerBound(fixes, fromMs), lowerBound(fixes, toMs + 1))
      .filter((fix) => fix.serverMs <= Date.now())
    const ruleError = options.fail?.({ deviceId, fromMs, toMs }) ?? null
    const oversized = options.maxRowsPerResponse !== undefined && rows.length > options.maxRowsPerResponse
    const failed = ruleError !== null || oversized
    requests.push({ deviceId, atMs: Date.now(), fromMs, toMs, rows: failed ? 0 : rows.length, failed })
    if (ruleError !== null) throw ruleError
    if (oversized) throw new Error(options.oversizedMessage ?? TOO_LARGE_MESSAGE)
    return rows.map((fix) => toPosition(deviceId, fix))
  }
  const remember = (chunk: { readonly positions: readonly NormalizedTrackingPosition[] }): void => {
    for (const position of chunk.positions) stored.add(position.id)
  }
  const reconciler = createBreadcrumbHistoryReconciler({
    fetchBreadcrumbs,
    onChunk: remember,
    ...(options.batched === true
      ? {
          onChunks: (chunks: readonly { readonly positions: readonly NormalizedTrackingPosition[] }[]) => {
            for (const chunk of chunks) remember(chunk)
          },
        }
      : {}),
    onProgress: vi.fn(),
    shouldContinue: () => true,
    logger: { warn },
  })
  const poll = (): void => {
    reconciler.reconcile({ devices, from: new Date(MISSION_START_MS), until: new Date(Date.now()) })
  }
  /** Advances in live-poll steps, re-authorizing the reconciler like the polling manager does. */
  const runFor = async (durationMs: number): Promise<void> => {
    const endMs = Date.now() + durationMs
    while (Date.now() < endMs) {
      poll()
      await vi.advanceTimersByTimeAsync(Math.min(POLL_MS, endMs - Date.now()))
    }
  }
  /** A phone buffered fixes at `stepMs` from `fromMs` to `toMs` and uploads them all now. */
  const uploadLateBurst = (deviceId: string, fromMs: number, toMs: number, stepMs: number): readonly string[] => {
    const fixes = fixesByDevice.get(deviceId)!
    const ids: string[] = []
    for (let fixMs = fromMs; fixMs <= toMs; fixMs += stepMs) {
      const id = `${deviceId}-late-${fixMs}`
      fixes.push({ id, fixMs: fixMs + 1, serverMs: Date.now() })
      ids.push(id)
    }
    fixes.sort((left, right) => left.fixMs - right.fixMs)
    return ids
  }
  const missingIds = (ids: readonly string[]): readonly string[] => ids.filter((id) => !stored.has(id))
  /** Every original (on-time) fix of a device inside [fromMs, toMs]. */
  const onTimeIds = (deviceId: string, fromMs = MISSION_START_MS, toMs = NOW_MS): readonly string[] =>
    (fixesByDevice.get(deviceId) ?? [])
      .filter((fix) => !fix.id.includes('-late-') && fix.fixMs >= fromMs && fix.fixMs <= toMs)
      .map((fix) => fix.id)
  return { devices, reconciler, requests, warn, runFor, uploadLateBurst, missingIds, onTimeIds }
}

describe('breadcrumb history catch-up does not stall [DON-338]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ING-1: one stuck device never blocks the others', () => {
    it.each([false, true])(
      'keeps re-checking healthy devices for late uploads while one device cannot catch up (batched %s)',
      async (batched) => {
        const harness = createHarness({
          deviceCount: 2,
          intervalMs: 10 * SECOND_MS,
          batched,
          // Tracker 1's 10:00-12:00 window keeps failing (server error, not size).
          fail: ({ deviceId, fromMs, toMs }) =>
            deviceId === '1' && fromMs < MISSION_START_MS + 4 * HOUR_MS && toMs > MISSION_START_MS + 2 * HOUR_MS
              ? new Error('Traccar HTTP 500 Internal Server Error')
              : null,
        })
        await harness.runFor(10 * MINUTE_MS)
        const uploadedAtMs = Date.now()
        const burst = harness.uploadLateBurst('2', uploadedAtMs - 4 * HOUR_MS, uploadedAtMs - HOUR_MS, MINUTE_MS)

        await harness.runFor(TICK_MS + POLL_MS)

        expect(harness.missingIds(burst)).toEqual([])
        // The stuck device stays named; the healthy sweep must not mask it.
        const progress = harness.reconciler.getProgress()
        expect(progress.failedDeviceNames).toEqual(['Tracker 1'])
        expect(progress.complete).toBe(false)
      },
    )
  })

  describe('ING-2: an oversized or slow window makes progress', () => {
    it.each([
      { label: 'too large', message: TOO_LARGE_MESSAGE, batched: false },
      { label: 'too large', message: TOO_LARGE_MESSAGE, batched: true },
      { label: 'timed out', message: TIMED_OUT_MESSAGE, batched: false },
      { label: 'timed out', message: TIMED_OUT_MESSAGE, batched: true },
    ])('splits a 2 h window the server answers "$label" and stores every fix (batched $batched)', async ({ message, batched }) => {
      // 5 s fixes: a 2 h window holds 1,440 rows; the server fails above 400.
      const harness = createHarness({
        deviceCount: 2,
        intervalMs: 5 * SECOND_MS,
        batched,
        maxRowsPerResponse: 400,
        oversizedMessage: message,
      })

      await harness.runFor(15 * MINUTE_MS)

      for (const device of harness.devices) {
        expect(harness.missingIds(harness.onTimeIds(device.device_id))).toEqual([])
      }
      const progress = harness.reconciler.getProgress()
      expect(progress.failedDeviceNames).toEqual([])
      expect(progress.historyGaps).toEqual([])
      expect(harness.requests.every((request) => request.toMs - request.fromMs <= 2 * HOUR_MS)).toBe(true)
    })

    it('does not split a window for an error that a smaller window cannot fix', async () => {
      const harness = createHarness({
        deviceCount: 1,
        intervalMs: 10 * SECOND_MS,
        fail: ({ fromMs }) => fromMs >= MISSION_START_MS + 2 * HOUR_MS ? new Error('Traccar HTTP 500 Internal Server Error') : null,
      })

      await harness.runFor(5 * MINUTE_MS)

      const failedWindows = harness.requests.filter((request) => request.failed)
      expect(failedWindows.length).toBeGreaterThan(1)
      expect(failedWindows.every((request) => request.toMs - request.fromMs === 2 * HOUR_MS)).toBe(true)
      expect(harness.reconciler.getProgress().failedDeviceNames).toEqual(['Tracker 1'])
      expect(harness.reconciler.getProgress().historyGaps).toEqual([])
    })

    it('records a window that cannot be fetched at any size as a visible gap, moves on, and fills it later', async () => {
      const badFromMs = MISSION_START_MS + 2 * HOUR_MS + MINUTE_MS
      const badToMs = badFromMs + MINUTE_MS
      const server = { broken: true }
      const harness = createHarness({
        deviceCount: 2,
        intervalMs: 10 * SECOND_MS,
        fail: ({ deviceId, fromMs, toMs }) =>
          server.broken && deviceId === '1' && fromMs <= badToMs && toMs >= badFromMs
            ? new Error(TOO_LARGE_MESSAGE)
            : null,
      })

      await harness.runFor(15 * MINUTE_MS)

      const progress = harness.reconciler.getProgress()
      expect(progress.failedDeviceNames).toEqual(['Tracker 1'])
      expect(progress.historyGaps.length).toBeGreaterThan(0)
      for (const gap of progress.historyGaps) {
        expect(gap).toEqual(expect.objectContaining({ deviceId: '1', deviceName: 'Tracker 1', reason: 'oversized' }))
        // Narrowed to the smallest windows around the bad minute, not the whole 2 h window.
        expect(Date.parse(gap.to) - Date.parse(gap.from)).toBeLessThanOrEqual(10 * MINUTE_MS)
      }
      const gapStartMs = Math.min(...progress.historyGaps.map((gap) => Date.parse(gap.from)))
      const gapEndMs = Math.max(...progress.historyGaps.map((gap) => Date.parse(gap.to)))
      expect(gapStartMs).toBeLessThanOrEqual(badFromMs)
      expect(gapEndMs).toBeGreaterThanOrEqual(badToMs)
      // Everything outside the gap is stored, for both devices: the device moved on.
      expect(harness.missingIds(harness.onTimeIds('1', MISSION_START_MS, gapStartMs - 1))).toEqual([])
      expect(harness.missingIds(harness.onTimeIds('1', gapEndMs + 1, NOW_MS))).toEqual([])
      expect(harness.missingIds(harness.onTimeIds('2'))).toEqual([])
      // Nothing is invented: the gap's own fixes are not claimed as stored.
      expect(harness.missingIds(harness.onTimeIds('1', badFromMs, badToMs)).length).toBeGreaterThan(0)
      expect(harness.warn).toHaveBeenCalledWith(
        'Tracking breadcrumb history window could not be fetched at any size; recorded as a gap.',
        expect.objectContaining({ deviceName: 'Tracker 1', reason: 'oversized' }),
      )

      server.broken = false
      await harness.runFor(TICK_MS + POLL_MS)

      expect(harness.missingIds(harness.onTimeIds('1'))).toEqual([])
      expect(harness.reconciler.getProgress().historyGaps).toEqual([])
      expect(harness.reconciler.getProgress().failedDeviceNames).toEqual([])
    })

    it('splits an oversized late-upload re-check instead of failing it every tick', async () => {
      const harness = createHarness({ deviceCount: 2, intervalMs: 5 * SECOND_MS, maxRowsPerResponse: 2_000 })
      await harness.runFor(10 * MINUTE_MS)
      expect(harness.reconciler.getProgress().failedDeviceNames).toEqual([])
      const uploadedAtMs = Date.now()
      // A phone uploads two buffered hours of 1 s fixes: its recent 2 h windows now exceed the limit.
      const burst = harness.uploadLateBurst('1', uploadedAtMs - 3 * HOUR_MS, uploadedAtMs - HOUR_MS, SECOND_MS)

      await harness.runFor(TICK_MS + POLL_MS)

      expect(harness.missingIds(burst)).toEqual([])
      expect(harness.reconciler.getProgress().failedDeviceNames).toEqual([])
      expect(harness.reconciler.getProgress().historyGaps).toEqual([])
    })
  })

  describe('ING-3: re-check cost at 34 devices x 12 h', () => {
    it('re-reads a bounded window per device per tick', async () => {
      // 34 phones reporting every 5 s for 12 h: 8,641 fixes each.
      const harness = createHarness({ deviceCount: 34, intervalMs: 5 * SECOND_MS, batched: true })
      await harness.runFor(10 * MINUTE_MS)
      const initialRequests = harness.requests.filter((request) => request.atMs === NOW_MS)
      const tickStartMs = Date.now()

      await harness.runFor(TICK_MS)

      const tick = harness.requests.filter((request) => request.atMs > tickStartMs)
      const rows = tick.reduce((total, request) => total + request.rows, 0)
      // Measured cost of one anti-entropy tick (recorded in the DON-338 report):
      // 34 x (3 recent + 3 older) 2 h windows = 204 requests and ~294,000 rows
      // re-read, normalised and re-offered to the store every 5 minutes.
      expect(initialRequests.length).toBe(34 * 6)
      expect(tick.length).toBe(34 * 6)
      expect(rows).toBeLessThanOrEqual(34 * (12 * HOUR_MS / (5 * SECOND_MS) + 6))
      expect(rows).toBeGreaterThan(34 * 8_000)
    })
  })
})
