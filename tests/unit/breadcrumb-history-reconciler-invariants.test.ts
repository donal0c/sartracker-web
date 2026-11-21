import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBreadcrumbHistoryReconciler,
  type BreadcrumbHistoryChunk,
  type BreadcrumbHistoryProgress,
} from '../../src/features/tracking/breadcrumb-history-reconciler'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// DON-338 round 4: the real reconciler under random schedules. Each seed draws
// per-window outcomes (success, HTTP 500 for a while then recovery,
// permanently failing slices, oversized or slow replies that force
// narrowing), a request budget, suspend and resume, a range expansion and late
// fixes uploaded into random slices at random times. The store is in memory
// and applies the real mission store's checkpoint rule. Every step checks:
//   a. never more than one request in flight per device;
//   b. every fetchable late fix is delivered within the stated bound;
//   c. `complete` is never true while a gap (or, in the re-check phase, a
//      re-check backlog) is open;
//   d. the durable checkpoint never passes time that was not stored;
//   e. gaps and backlog are never dropped without being fetched;
//   f. a device's re-check requests per tick never exceed its budget.
// Round 5 adds permanent gap tails that keep extending as time advances (so
// the gap cursor always has new gap ahead of it), recoveries after the tail
// has started, and a saturated many-device queue.

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const STEP_MS = MINUTE_MS
const TICK_MS = 5 * MINUTE_MS
const CHUNK_MS = 2 * HOUR_MS
const FIX_SPACING_MS = 5 * MINUTE_MS
const CHAOS_TICKS = 12
const SEED_COUNT = 300
const BASE_MS = Date.parse('2026-11-07T08:00:00.000Z')
const TOO_LARGE = "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar response is too large."
const TIMED_OUT = "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar request timed out after 10000 ms."
const HTTP_500 = 'Traccar HTTP 500 Internal Server Error'

type Range = { readonly fromMs: number; readonly toMs: number }

/** Mulberry32: a small seeded PRNG so every seed replays exactly. */
function createRandom(seed: number) {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number): boolean => next() < p,
  }
}

const overlaps = (left: Range, right: Range): boolean => left.fromMs < right.toMs && right.fromMs < left.toMs

/** Merges a range into a sorted, merged list; touching ranges join. */
function addRange(ranges: readonly Range[], added: Range): Range[] {
  if (added.toMs <= added.fromMs) return [...ranges]
  const result: Range[] = []
  let current = added
  for (const range of ranges) {
    if (range.toMs < current.fromMs || range.fromMs > current.toMs) result.push(range)
    else current = { fromMs: Math.min(range.fromMs, current.fromMs), toMs: Math.max(range.toMs, current.toMs) }
  }
  result.push(current)
  return result.sort((left, right) => left.fromMs - right.fromMs)
}

/** The parts of `range` not covered by `covered`. */
function subtractAll(range: Range, covered: readonly Range[]): Range[] {
  let pieces: Range[] = [range]
  for (const cut of covered) {
    pieces = pieces.flatMap((piece) => {
      if (!overlaps(piece, cut)) return [piece]
      return [
        { fromMs: piece.fromMs, toMs: cut.fromMs },
        { fromMs: cut.toMs, toMs: piece.toMs },
      ].filter((part) => part.toMs > part.fromMs)
    })
  }
  return pieces
}

type Region = {
  readonly range: Range
  readonly kind: 'dense' | 'temp500' | 'tempSlow' | 'permTooLarge' | 'perm500' | 'permTail'
  /** Widest request the server answers inside a dense region. */
  readonly maxWidthMs?: number
  /** When a temporary failure ends. */
  readonly recoversAtMs?: number
}

type LateFix = {
  readonly id: string
  readonly deviceId: string
  readonly fixMs: number
  readonly uploadedAtMs: number
  readonly fetchable: boolean
}

type Checkpoint = { historyFromMs: number; untilMs: number }

/** Runs one seed; returns a description of the first broken invariant, or null. */
async function runSeed(seed: number): Promise<string | null> {
  const random = createRandom(seed)
  // A saturated queue: many devices, one re-check task at a time, slow replies.
  const saturated = random.chance(0.1)
  const deviceCount = saturated ? random.int(6, 8) : random.int(1, 2)
  const maxConcurrency = saturated ? 2 : 8
  const maxDelaySeconds = saturated ? 5 : 2
  const missionHours = random.int(4, 8)
  // Tail seeds use a 5-minute smallest width and a 15-minute recent window,
  // so the tail grows by about a slice every tick, and mostly one gap
  // request a turn: a gap cursor that never wraps would never catch it.
  const tailSeed = random.chance(0.4)
  const budget = tailSeed && random.chance(0.7) ? random.int(3, 5)
    : random.chance(0.15) ? random.int(1, 2) : random.int(3, 12)
  const MIN_WINDOW_MS = (tailSeed ? 5 : 30) * MINUTE_MS
  const RECENT_WINDOW_MS = tailSeed ? 15 * MINUTE_MS : 2 * HOUR_MS
  const nowAtStartMs = BASE_MS + missionHours * HOUR_MS
  let missionStartMs = BASE_MS
  const earliestMs = BASE_MS - HOUR_MS
  vi.setSystemTime(nowAtStartMs)
  const chaosEndMs = nowAtStartMs + CHAOS_TICKS * TICK_MS

  const devices: NormalizedTrackingDevice[] = Array.from({ length: deviceCount }, (_, index) => ({
    device_id: String(index + 1),
    name: `Tracker ${index + 1}`,
    status: 'online',
    last_seen: null,
    unique_id: `tracker-${index + 1}`,
    category: null,
  }))

  // Server state.
  const fixesByDevice = new Map<string, { id: string; fixMs: number; serverMs: number }[]>()
  const regionsByDevice = new Map<string, Region[]>()
  for (const device of devices) {
    const fixes = []
    for (let fixMs = earliestMs; fixMs <= nowAtStartMs + 6 * HOUR_MS; fixMs += FIX_SPACING_MS) {
      fixes.push({ id: `${device.device_id}-${fixMs}`, fixMs, serverMs: fixMs })
    }
    fixesByDevice.set(device.device_id, fixes)
    const regions: Region[] = []
    const historyRange = (lengthMs: number): Range => {
      const fromMs = random.int(BASE_MS, nowAtStartMs - lengthMs)
      return { fromMs, toMs: fromMs + lengthMs }
    }
    for (let index = random.int(0, 2); index > 0; index -= 1) {
      regions.push({ range: historyRange(random.int(20, 60) * MINUTE_MS), kind: 'dense', maxWidthMs: random.chance(0.5) ? MIN_WINDOW_MS : HOUR_MS })
    }
    for (let index = random.int(0, 2); index > 0; index -= 1) {
      regions.push({ range: historyRange(random.int(5, 30) * MINUTE_MS), kind: 'temp500', recoversAtMs: random.int(nowAtStartMs, chaosEndMs) })
    }
    // A permanent tail: every reply after its start is too large, so each new
    // recent slice becomes a gap that extends it while time advances.
    const tailFromMs = tailSeed && random.chance(0.8) ? chaosEndMs + random.int(10, 50) * MINUTE_MS : null
    if (tailFromMs !== null) {
      regions.push({ range: { fromMs: tailFromMs, toMs: Number.POSITIVE_INFINITY }, kind: 'permTail' })
    }
    if (random.chance(tailFromMs === null ? 0.4 : 0.9)) {
      // With a tail, recovery may come after the gap cursor has moved into it.
      const recoversAtMs = random.int(nowAtStartMs, tailFromMs === null ? chaosEndMs : tailFromMs + 90 * MINUTE_MS)
      regions.push({ range: historyRange(random.int(5, 40) * MINUTE_MS), kind: 'tempSlow', recoversAtMs })
    }
    if (random.chance(0.4)) {
      regions.push({ range: historyRange(10 * MINUTE_MS), kind: 'permTooLarge' })
    }
    if (random.chance(0.3)) {
      // History after every initial target (the last expansion happens during
      // chaos), so only re-checks ever meet it, and they fail forever.
      const fromMs = chaosEndMs + random.int(10, 50) * MINUTE_MS
      regions.push({ range: { fromMs, toMs: fromMs + 10 * MINUTE_MS }, kind: 'perm500' })
    }
    regionsByDevice.set(device.device_id, regions)
  }

  /** A fix the reconciler can never fetch: near a permanent failure. */
  const isUnfetchable = (deviceId: string, fixMs: number): boolean =>
    (regionsByDevice.get(deviceId) ?? []).some((region) => {
      // A 500 is never narrowed, so a request of up to a chunk around it keeps failing;
      // a gap is retried in smallest-width slices around a too-large minute.
      const marginMs = region.kind === 'perm500' ? CHUNK_MS
        : region.kind === 'permTooLarge' || region.kind === 'permTail' ? MIN_WINDOW_MS : -1
      return marginMs >= 0 && fixMs >= region.range.fromMs - marginMs && fixMs <= region.range.toMs + marginMs
    })

  // Observation state.
  let failure: string | null = null
  const fail = (message: string): void => {
    failure ??= `${message} (t+${Math.round((Date.now() - nowAtStartMs) / MINUTE_MS)} min)`
  }
  const inFlight = new Map<string, number>()
  const requestStarts: { deviceId: string; atMs: number }[] = []
  const storedIds = new Set<string>()
  const checkpoints = new Map<string, Checkpoint>()
  const ackedByDevice = new Map<string, Range[]>()
  let ackedSinceCheck = new Map<string, Range[]>()
  let persistenceFailureRate = 0.03
  const progressCalls: BreadcrumbHistoryProgress[] = []
  const tickStarts: number[] = []
  let lastDisruptionMs = nowAtStartMs
  const disruptionTimes: number[] = []

  const fetchBreadcrumbs = async (deviceId: string, from: Date, to: Date): Promise<readonly NormalizedTrackingPosition[]> => {
    const fromMs = from.getTime()
    const toMs = to.getTime()
    const count = (inFlight.get(deviceId) ?? 0) + 1
    inFlight.set(deviceId, count)
    if (count > 1) fail(`a: device ${deviceId} has ${count} requests in flight`)
    requestStarts.push({ deviceId, atMs: Date.now() })
    const delayMs = random.int(0, maxDelaySeconds) * SECOND_MS
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    } finally {
      inFlight.set(deviceId, (inFlight.get(deviceId) ?? 1) - 1)
    }
    const request = { fromMs, toMs }
    const nowMs = Date.now()
    for (const region of regionsByDevice.get(deviceId) ?? []) {
      if (!overlaps(request, region.range)) continue
      if (region.kind === 'dense' && toMs - fromMs > region.maxWidthMs!) throw new Error(random.chance(0.5) ? TOO_LARGE : TIMED_OUT)
      if (region.kind === 'temp500' && nowMs < region.recoversAtMs!) throw new Error(HTTP_500)
      if (region.kind === 'tempSlow' && nowMs < region.recoversAtMs!) throw new Error(TIMED_OUT)
      if (region.kind === 'permTooLarge' || region.kind === 'permTail') throw new Error(TOO_LARGE)
      if (region.kind === 'perm500') throw new Error(HTTP_500)
    }
    return (fixesByDevice.get(deviceId) ?? [])
      .filter((fix) => fix.fixMs >= fromMs && fix.fixMs <= toMs && fix.serverMs <= nowMs)
      .map((fix) => ({
        id: fix.id,
        device_id: deviceId,
        lat: 52,
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

  /** The real mission store's checkpoint rule (electron/mission-store.cjs), in milliseconds. */
  const applyCheckpoint = (deviceId: string, historyFromMs: number, fromMs: number, untilMs: number): void => {
    const existing = checkpoints.get(deviceId)
    if (fromMs > (existing?.untilMs ?? historyFromMs)) return
    if (existing !== undefined && historyFromMs < existing.historyFromMs && fromMs > historyFromMs) return
    const earlierPrefix = existing !== undefined && historyFromMs < existing.historyFromMs
    if (existing !== undefined && historyFromMs > existing.historyFromMs) {
      throw new Error('Tracking history checkpoint start does not match the stored mission-device checkpoint.')
    }
    if (existing !== undefined && existing.historyFromMs === historyFromMs && existing.untilMs >= untilMs) return
    const storedUntil = existing !== undefined && !earlierPrefix && existing.untilMs > untilMs ? existing.untilMs : untilMs
    checkpoints.set(deviceId, { historyFromMs, untilMs: storedUntil })
  }

  const onChunk = async (chunk: BreadcrumbHistoryChunk): Promise<void> => {
    await Promise.resolve()
    if (random.chance(persistenceFailureRate)) throw new Error('SQLITE_BUSY: database is locked')
    applyCheckpoint(chunk.deviceId, chunk.historyFrom.getTime(), chunk.from.getTime(), chunk.to.getTime())
    for (const position of chunk.positions) storedIds.add(position.id)
    const range = { fromMs: chunk.from.getTime(), toMs: chunk.to.getTime() }
    ackedByDevice.set(chunk.deviceId, addRange(ackedByDevice.get(chunk.deviceId) ?? [], range))
    ackedSinceCheck.set(chunk.deviceId, addRange(ackedSinceCheck.get(chunk.deviceId) ?? [], range))
  }

  const reconciler = createBreadcrumbHistoryReconciler({
    fetchBreadcrumbs,
    onChunk,
    onProgress: (progress) => { progressCalls.push(progress) },
    shouldContinue: () => true,
    logger: { warn: () => undefined },
    chunkMs: CHUNK_MS,
    maxConcurrency,
    minWindowMs: MIN_WINDOW_MS,
    antiEntropyRecentWindowMs: RECENT_WINDOW_MS,
    antiEntropyOlderChunksPerTick: 1,
    antiEntropyRequestsPerDevicePerTick: budget,
    setTimeout: ((callback: () => void, delayMs?: number) => setTimeout(() => {
      if (delayMs === TICK_MS) tickStarts.push(Date.now())
      callback()
    }, delayMs)) as typeof globalThis.setTimeout,
  })

  // The stated bound (see runDeviceTurn): each non-empty lane gets at least
  // floor(b / L) requests a turn, or one every L turns when b < L; L <= 3.
  // Positions are counted at the smallest width, doubled because a slice may
  // have just been read when the fix arrived, and scaled by 5/4 for one
  // narrowing retry per four successes.
  const perLanePerTurn = budget >= 3 ? Math.floor(budget / 3) : 1 / 3
  const historySlices = Math.ceil((nowAtStartMs + 4 * HOUR_MS - earliestMs) / MIN_WINDOW_MS)
  const recentSlices = Math.ceil(RECENT_WINDOW_MS / MIN_WINDOW_MS) + 2
  const failingSlices = (deviceId: string): number => (regionsByDevice.get(deviceId) ?? [])
    .filter((region) => region.kind !== 'dense' && region.kind !== 'temp500')
    .reduce((total, region) => total + Math.ceil((region.range.toMs - region.range.fromMs + 2 * CHUNK_MS) / MIN_WINDOW_MS) + 2, 0)
  // Gap slices are retried in cycles: within the running cycle (frozen at no
  // more than today's gap slices) plus the next, so twice the open gap
  // slices, counted when the bound is checked.
  const openGapSlices = (deviceId: string): number => reconciler.getProgress().historyGaps
    .filter((gap) => gap.deviceId === deviceId)
    .reduce((total, gap) => total + Math.ceil((Date.parse(gap.to) - Date.parse(gap.from)) / MIN_WINDOW_MS) + 1, 0)
  // In a saturated queue a turn waits for the other devices' turns: one
  // re-check task at a time, each at most b requests of the slowest reply.
  const antiEntropyConcurrency = Math.max(1, Math.floor(maxConcurrency / 2))
  const ticksPerTurn = 1 + Math.ceil((deviceCount * budget * maxDelaySeconds * SECOND_MS) / (antiEntropyConcurrency * TICK_MS))
  const boundTicks = (deviceId: string): number => {
    const positions = Math.max(2 * historySlices, 2 * recentSlices, historySlices) + failingSlices(deviceId) + 2 * openGapSlices(deviceId)
    // +3: the planning tick, a turn already in flight, and expansion catch-up.
    return ticksPerTurn * (Math.ceil((1.25 * positions) / perLanePerTurn) + 3)
  }
  /** When the last temporary failure near this fix ends. */
  const recoveryOf = (deviceId: string, fixMs: number): number => (regionsByDevice.get(deviceId) ?? [])
    .filter((region) => region.recoversAtMs !== undefined
      && fixMs >= region.range.fromMs - CHUNK_MS && fixMs <= region.range.toMs + CHUNK_MS)
    .reduce((latest, region) => Math.max(latest, region.recoversAtMs!), 0)
  // A fix inside an open gap is fetched by the gap lane. Its cycle bound:
  // the running cycle is frozen at no more than S gap slices (the most ever
  // open), the next cycle at no more than S plus one new slice per request
  // made meanwhile (at most L x S), so (2 + L) x S gap requests in all.
  let maxGapSlicesSeen = new Map<string, number>()
  const gapDeadlines = new Map<string, number>()
  const gapBoundTicks = (deviceId: string): number =>
    ticksPerTurn * (Math.ceil((5 * (maxGapSlicesSeen.get(deviceId) ?? 0)) / perLanePerTurn) + 3)
  const lastRecoveryMs = Math.max(0, ...[...regionsByDevice.values()].flat().map((region) => region.recoversAtMs ?? 0))

  const lateFixes: LateFix[] = []
  const uploadLateFix = (deviceId: string): void => {
    // In tail seeds, half the uploads land in a slow region that recovers
    // later, so they wait in a gap while the tail keeps growing.
    const slow = (regionsByDevice.get(deviceId) ?? []).find((region) => region.kind === 'tempSlow')
    const fixMs = tailSeed && slow !== undefined && random.chance(0.5)
      ? random.int(slow.range.fromMs, slow.range.toMs - 1) + 1
      : random.int(missionStartMs, Date.now() - MINUTE_MS) + 1
    const id = `${deviceId}-late-${fixMs}`
    fixesByDevice.get(deviceId)!.push({ id, fixMs, serverMs: Date.now() })
    lateFixes.push({ id, deviceId, fixMs, uploadedAtMs: Date.now(), fetchable: !isUnfetchable(deviceId, fixMs) })
  }

  /** Ranges the reconciler publishes as still owed: gaps and re-check backlog. */
  const owedRanges = (progress: BreadcrumbHistoryProgress): Map<string, Range[]> => {
    const owed = new Map<string, Range[]>()
    for (const range of [...progress.historyGaps, ...progress.recheckBacklog]) {
      owed.set(range.deviceId, addRange(owed.get(range.deviceId) ?? [], { fromMs: Date.parse(range.from), toMs: Date.parse(range.to) }))
    }
    return owed
  }

  let previousOwed = new Map<string, Range[]>()
  let progressChecked = 0
  const checkInvariants = (): void => {
    const progress = reconciler.getProgress()
    // c. Completion is never claimed with a gap open, nor in the re-check phase with backlog open.
    for (const call of [...progressCalls.slice(progressChecked), progress]) {
      if (call.complete && call.historyGaps.length > 0) fail(`c: ${call.phase} complete with a gap open`)
      if (call.complete && call.phase === 'anti_entropy' && call.recheckBacklog.length > 0) fail('c: re-check complete with backlog open')
    }
    progressChecked = progressCalls.length
    // d. The durable frontier covers only time that was acknowledged as stored.
    for (const [deviceId, checkpoint] of checkpoints) {
      const uncovered = subtractAll({ fromMs: checkpoint.historyFromMs, toMs: checkpoint.untilMs }, ackedByDevice.get(deviceId) ?? [])
      if (uncovered.length > 0) fail(`d: device ${deviceId} checkpoint passes unstored time from ${new Date(uncovered[0]!.fromMs).toISOString()}`)
    }
    // e. Anything owed before is now fetched or still owed.
    const owed = owedRanges(progress)
    for (const [deviceId, ranges] of previousOwed) {
      const covered = [...(ackedSinceCheck.get(deviceId) ?? []), ...(owed.get(deviceId) ?? [])]
      for (const range of ranges) {
        const dropped = subtractAll(range, covered)
        if (dropped.length > 0) fail(`e: device ${deviceId} dropped owed time from ${new Date(dropped[0]!.fromMs).toISOString()} to ${new Date(dropped[0]!.toMs).toISOString()}`)
      }
    }
    previousOwed = owed
    ackedSinceCheck = new Map()
    // b. Every fetchable late fix arrives within its bound, counted from when it became eligible.
    const seen = new Map(maxGapSlicesSeen)
    for (const device of devices) seen.set(device.device_id, Math.max(seen.get(device.device_id) ?? 0, openGapSlices(device.device_id)))
    maxGapSlicesSeen = seen
    for (const fix of lateFixes) {
      if (!fix.fetchable || storedIds.has(fix.id)) continue
      const eligibleMs = Math.max(fix.uploadedAtMs, lastDisruptionMs, recoveryOf(fix.deviceId, fix.fixMs))
      if (Date.now() >= eligibleMs && !gapDeadlines.has(fix.id)) {
        const inGap = progress.historyGaps.some((gap) =>
          gap.deviceId === fix.deviceId && Date.parse(gap.from) <= fix.fixMs && fix.fixMs <= Date.parse(gap.to))
        gapDeadlines.set(fix.id, inGap ? Date.now() + gapBoundTicks(fix.deviceId) * TICK_MS : Number.POSITIVE_INFINITY)
      }
      if (Date.now() > (gapDeadlines.get(fix.id) ?? Number.POSITIVE_INFINITY)) {
        fail(`b: late fix ${fix.id} in a gap not retried within its gap cycle bound (b=${budget})`)
      }
      if (Date.now() - eligibleMs > boundTicks(fix.deviceId) * TICK_MS) {
        fail(`b: late fix ${fix.id} not delivered within ${boundTicks(fix.deviceId)} ticks (b=${budget})`)
      }
    }
  }

  const pendingSteps = new Set<string>()
  let suspendedUntilMs: number | null = null
  let expanded = false
  const reconcileNow = (): void => {
    reconciler.reconcile({ devices, from: new Date(missionStartMs), until: new Date(Date.now()) })
  }
  reconcileNow()
  const endMs = chaosEndMs + 400 * TICK_MS
  while (Date.now() < endMs && failure === null) {
    const nowMs = Date.now()
    const chaos = nowMs < chaosEndMs
    for (const device of devices) {
      if (pendingDeviceNamesHas(reconciler.getProgress(), device.name)) pendingSteps.add(`${device.device_id}:${nowMs}`)
    }
    if (suspendedUntilMs !== null && nowMs >= suspendedUntilMs) {
      suspendedUntilMs = null
      lastDisruptionMs = nowMs
      disruptionTimes.push(nowMs)
    }
    if (suspendedUntilMs === null) {
      if (chaos && random.chance(0.02)) {
        reconciler.suspend()
        suspendedUntilMs = nowMs + random.int(1, 4) * MINUTE_MS
        disruptionTimes.push(nowMs)
      } else if (chaos && !expanded && random.chance(0.01)) {
        expanded = true
        missionStartMs = BASE_MS - random.int(1, 2) * 30 * MINUTE_MS
        reconcileNow()
        lastDisruptionMs = nowMs
        disruptionTimes.push(nowMs)
      } else {
        reconcileNow()
      }
    }
    // Late uploads during chaos and for a few ticks after it.
    if (nowMs < chaosEndMs + 4 * TICK_MS && random.chance(0.05)) {
      uploadLateFix(devices[random.int(0, devices.length - 1)]!.device_id)
    }
    if (!chaos && persistenceFailureRate > 0) {
      persistenceFailureRate = 0
      lastDisruptionMs = Math.max(lastDisruptionMs, nowMs)
    }
    if (!chaos) {
      // Temporary failures have all recovered by the end of chaos.
      lastDisruptionMs = Math.max(lastDisruptionMs, Math.min(nowMs, chaosEndMs))
    }
    await vi.advanceTimersByTimeAsync(STEP_MS)
    checkInvariants()
    const allDelivered = lateFixes.every((fix) => !fix.fetchable || storedIds.has(fix.id))
    if (!chaos && Date.now() > Math.max(chaosEndMs, lastRecoveryMs) + 5 * TICK_MS && allDelivered) break
  }
  const undelivered = lateFixes.find((fix) => fix.fetchable && !storedIds.has(fix.id))
  if (undelivered !== undefined) fail(`b: late fix ${undelivered.id} still not delivered when the run ended`)

  // f. Re-check requests per device per tick stay within the budget. Only
  // windows with no initial catch-up, suspend, resume or expansion count.
  for (let index = 0; index + 1 < tickStarts.length && failure === null; index += 1) {
    const fromMs = tickStarts[index]!
    const toMs = tickStarts[index + 1]!
    if (disruptionTimes.some((atMs) => atMs >= fromMs - STEP_MS && atMs <= toMs)) continue
    for (const device of devices) {
      const busy = [...pendingSteps].some((key) => {
        const [deviceId, atMs] = key.split(':')
        return deviceId === device.device_id && Number(atMs) >= fromMs - STEP_MS && Number(atMs) <= toMs
      })
      if (busy) continue
      const count = requestStarts.filter((request) => request.deviceId === device.device_id && request.atMs >= fromMs && request.atMs < toMs).length
      if (count > budget) fail(`f: device ${device.device_id} made ${count} requests in one tick (b=${budget})`)
    }
  }
  reconciler.reset()
  return failure
}

function pendingDeviceNamesHas(progress: BreadcrumbHistoryProgress, name: string): boolean {
  return progress.pendingDeviceNames.includes(name)
}

describe('history reconciler scheduling invariants under random schedules [DON-338 round 4]', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it(`holds every invariant for ${SEED_COUNT} seeds`, async () => {
    const failures: string[] = []
    // DEBUG_SEED=<n> replays one seed.
    const only = Number(process.env.DEBUG_SEED ?? 0)
    for (let seed = only || 1; seed <= (only || SEED_COUNT); seed += 1) {
      const failure = await runSeed(seed)
      if (failure !== null) {
        failures.push(`seed ${seed}: ${failure}`)
        if (failures.length >= 5) break
      }
    }
    if (failures.length > 0) console.error(failures.join('\n'))
    expect(failures).toEqual([])
  }, 120_000)
})
