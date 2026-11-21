import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from './tracking-types'
import { compareStringsByCodeUnit } from '../../lib/deterministic-string-order'

const DEFAULT_CHUNK_MS = 2 * 60 * 60 * 1000
const DEFAULT_MAX_CONCURRENCY = 8
const DEFAULT_RETRY_BASE_MS = 1_000
const DEFAULT_MAX_RETRY_MS = 30_000
const DEFAULT_ANTI_ENTROPY_INTERVAL_MS = 5 * 60 * 1000
// DON-305: a phone that regains signal uploads its buffered hours with old
// fixTimes, which the fixTime-filtered live poll never requests again. Every
// tick re-reads this trailing window for every device, newest first.
const DEFAULT_ANTI_ENTROPY_RECENT_WINDOW_MS = 6 * 60 * 60 * 1000
// Older history is swept newest first in this many chunks per device per tick.
const DEFAULT_ANTI_ENTROPY_OLDER_CHUNKS_PER_TICK = 3
// DON-338 (ING-2): a window the proxy rejects as too large or too slow is
// split, never retried unchanged. Windows at or below this width are not split.
const DEFAULT_MIN_WINDOW_MS = 5 * 60 * 1000
// Attempts at the smallest window before it is recorded as a visible gap and
// catch-up moves on to the rest of that device's history.
const DEFAULT_MIN_WINDOW_ATTEMPTS = 3
// A split window grows back (doubles) after this many consecutive successes.
const WINDOW_GROWTH_SUCCESS_COUNT = 4
// DON-338 review: one device's re-check work per tick is bounded so a slow
// device cannot hold the sweep. Requests: twice what the normal plan needs at
// the device's current window width, and never fewer than this floor.
const MIN_ANTI_ENTROPY_REQUESTS_PER_DEVICE_PER_TICK = 12

type BreadcrumbHistoryReconcilerLogger = {
  readonly warn: (message: string, context: Record<string, unknown>) => void
}

/** A void result acknowledges the whole wave; indexed results acknowledge individual chunks. */
export type BreadcrumbHistoryChunkAcknowledgement =
  | void
  | readonly PromiseSettledResult<void>[]

export type BreadcrumbHistoryReconcilerOptions = {
  readonly fetchBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
  readonly onChunk: (chunk: BreadcrumbHistoryChunk) => void | Promise<void>
  readonly onChunks?: (
    chunks: readonly BreadcrumbHistoryChunk[],
  ) => BreadcrumbHistoryChunkAcknowledgement | Promise<BreadcrumbHistoryChunkAcknowledgement>
  readonly onProgress: (progress: BreadcrumbHistoryProgress) => void
  readonly shouldContinue: () => boolean
  readonly logger: BreadcrumbHistoryReconcilerLogger
  readonly chunkMs?: number
  readonly maxConcurrency?: number
  readonly retryBaseMs?: number
  readonly maxRetryMs?: number
  readonly antiEntropyIntervalMs?: number
  readonly antiEntropyRecentWindowMs?: number
  readonly antiEntropyOlderChunksPerTick?: number
  readonly minWindowMs?: number
  readonly minWindowAttempts?: number
  /** Fixed re-check requests per device per tick; by default twice the plan at the current width, at least 12. */
  readonly antiEntropyRequestsPerDevicePerTick?: number
  /** Wall-clock budget for one device's re-check work in one tick; defaults to the tick interval. */
  readonly antiEntropyDeviceTimeBudgetMs?: number
  readonly setTimeout?: typeof globalThis.setTimeout
  readonly clearTimeout?: typeof globalThis.clearTimeout
}

export type BreadcrumbHistoryChunk = {
  readonly phase: 'initial' | 'anti_entropy'
  readonly deviceId: string
  readonly deviceName: string
  readonly historyFrom: Date
  readonly from: Date
  readonly to: Date
  readonly positions: readonly NormalizedTrackingPosition[]
}

/** Why a history window could not be fetched: the reply was over the size limit, or too slow. */
export type BreadcrumbHistoryGapReason = 'oversized' | 'slow'

/**
 * A device time range whose history could not be fetched at any window size.
 * Its fixes are neither invented nor claimed as stored; the range is retried
 * on every anti-entropy tick until a fetch covering it succeeds [DON-338].
 */
export type BreadcrumbHistoryGap = {
  readonly deviceId: string
  readonly deviceName: string
  readonly from: string
  readonly to: string
  readonly reason: BreadcrumbHistoryGapReason
  readonly phase: 'initial' | 'anti_entropy'
  readonly attempts: number
  readonly lastError: string
}

/**
 * A device time range the 5-minute re-check has planned but not yet re-read,
 * because that device's per-tick budget ran out. It is resumed next tick and
 * is neither claimed as checked nor forgotten [DON-338].
 */
export type BreadcrumbHistoryRecheckBacklog = {
  readonly deviceId: string
  readonly deviceName: string
  readonly from: string
  readonly to: string
}

export type BreadcrumbHistoryProgress = {
  readonly phase: 'initial' | 'anti_entropy'
  readonly targetFrom: string | null
  readonly targetTo: string | null
  readonly totalDeviceCount: number
  readonly completedDeviceCount: number
  readonly totalChunkCount: number
  readonly completedChunkCount: number
  readonly pendingDeviceCount: number
  readonly failedDeviceCount: number
  readonly elapsedMs: number
  readonly pendingDeviceNames: readonly string[]
  /** Includes every device with an unfilled history gap. */
  readonly failedDeviceNames: readonly string[]
  /** Unfetchable ranges, merged per device and ordered by device then time. */
  readonly historyGaps: readonly BreadcrumbHistoryGap[]
  /** Re-check ranges still to be re-read, merged per device. */
  readonly recheckBacklog: readonly BreadcrumbHistoryRecheckBacklog[]
  /** Never true while any history gap is unfilled, in either phase. */
  readonly complete: boolean
}

export type BreadcrumbHistoryReconciliationRequest = {
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly from: Date | null
  readonly until: Date
  readonly checkpointsByDevice?: Readonly<Record<string, {
    readonly historyFrom: string
    readonly reconciledUntil: string
  }>>
}

type BreadcrumbHistoryReconciler = {
  readonly reconcile: (request: BreadcrumbHistoryReconciliationRequest) => void
  readonly getProgress: () => BreadcrumbHistoryProgress
  readonly suspend: () => void
  readonly reset: () => void
}

type DeviceReconciliationJob = {
  readonly deviceId: string
  readonly deviceName: string
  readonly targetMs: number
  readonly missionStartMs: number
  readonly initialTargetMs: number
  readonly latestAvailableTargetMs: number
  cursorMs: number
  failureCount: number
  retryAtMs: number
  /** Current request width; halves on an oversized or slow reply. */
  windowMs: number
  consecutiveSuccessCount: number
  minWindowFailureCount: number
}

type HistoryGapRecord = {
  readonly deviceId: string
  readonly deviceName: string
  readonly historyFromMs: number
  fromMs: number
  toMs: number
  phase: 'initial' | 'anti_entropy'
  reason: BreadcrumbHistoryGapReason
  attempts: number
  lastError: string
  lastAttemptAtMs: number
}

/** A queued re-check range; `failedInTurn` marks a range that failed in that turn and waits at the back. */
type LaneSlice = {
  readonly fromMs: number
  readonly toMs: number
  readonly failedInTurn: number
}

/** The re-check lanes a device's turn rotates through. The initial lane is the catch-up drain. */
const RECHECK_LANES = ['recent', 'older', 'gap'] as const

/**
 * One device's queued re-check work. Kept by device id, so it survives
 * suspend, resume and range expansion until it is fetched or the device or
 * mission goes away.
 */
type DeviceLanes = {
  readonly deviceId: string
  deviceName: string
  recent: LaneSlice[]
  older: LaneSlice[]
  /** The lane the next turn starts from: the one after the lane served last. */
  nextLaneIndex: number
  /** Current re-check request width; halves on an oversized or slow reply. */
  windowMs: number
  successCount: number
  /** Where the next gap slice starts; rotates through the device's gaps in time order. */
  gapCursorMs: number
  /** Counts this device's turns; marks which turn a slice failed in. */
  turn: number
}

type CompletedDeviceReconciliation = {
  readonly deviceId: string
  readonly deviceName: string
  readonly missionStartMs: number
  readonly initialTargetMs: number
  /**
   * The current anti-entropy pass covers [missionStartMs, antiEntropyTargetMs].
   * The cursor walks down from the target; everything at or above it has been
   * swept in this pass. The pass is complete once it reaches missionStartMs.
   */
  antiEntropyCursorMs: number
  antiEntropyTargetMs: number
  latestAvailableTargetMs: number
}

type TimeRange = {
  readonly fromMs: number
  readonly toMs: number
}

/**
 * Drains bounded mission-history windows independently of the live polling
 * interval. Each device has at most one request in flight and the scheduler
 * round-robins devices so a large team cannot starve behind one long trail.
 */
export function createBreadcrumbHistoryReconciler(
  options: BreadcrumbHistoryReconcilerOptions,
): BreadcrumbHistoryReconciler {
  const chunkMs = normalizePositiveInteger(options.chunkMs, DEFAULT_CHUNK_MS)
  const maxConcurrency = normalizePositiveInteger(
    options.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
  )
  const retryBaseMs = normalizePositiveInteger(
    options.retryBaseMs,
    DEFAULT_RETRY_BASE_MS,
  )
  const maxRetryMs = normalizePositiveInteger(
    options.maxRetryMs,
    DEFAULT_MAX_RETRY_MS,
  )
  const antiEntropyIntervalMs = normalizePositiveInteger(
    options.antiEntropyIntervalMs,
    DEFAULT_ANTI_ENTROPY_INTERVAL_MS,
  )
  const antiEntropyRecentWindowMs = normalizePositiveInteger(
    options.antiEntropyRecentWindowMs,
    DEFAULT_ANTI_ENTROPY_RECENT_WINDOW_MS,
  )
  // The sweep shares the polling manager's history transport budget with
  // live breadcrumb polling; it takes at most half so live trails never
  // queue behind a whole team's sweep [DON-305].
  const antiEntropyMaxConcurrency = Math.max(1, Math.floor(maxConcurrency / 2))
  const antiEntropyOlderChunksPerTick = normalizePositiveInteger(
    options.antiEntropyOlderChunksPerTick,
    DEFAULT_ANTI_ENTROPY_OLDER_CHUNKS_PER_TICK,
  )
  const minWindowMs = Math.min(
    chunkMs,
    normalizePositiveInteger(options.minWindowMs, DEFAULT_MIN_WINDOW_MS),
  )
  const minWindowAttempts = normalizePositiveInteger(
    options.minWindowAttempts,
    DEFAULT_MIN_WINDOW_ATTEMPTS,
  )
  const antiEntropyDeviceTimeBudgetMs = normalizePositiveInteger(
    options.antiEntropyDeviceTimeBudgetMs,
    antiEntropyIntervalMs,
  )
  const fixedRequestBudget = options.antiEntropyRequestsPerDevicePerTick === undefined
    ? null
    : normalizePositiveInteger(options.antiEntropyRequestsPerDevicePerTick, 1)
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  const clearScheduledTimeout =
    options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)

  const jobsByDeviceId = new Map<string, DeviceReconciliationJob>()
  const completedDevicesById = new Map<string, CompletedDeviceReconciliation>()
  const failedDeviceIds = new Set<string>()
  const antiEntropyFailedDeviceIds = new Set<string>()
  const gapsByDeviceId = new Map<string, HistoryGapRecord[]>()
  const activeInitialJobs = new Set<DeviceReconciliationJob>()
  const deviceQueue: string[] = []
  let generation = 0
  let draining = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let antiEntropyTimer: ReturnType<typeof setTimeout> | null = null
  const lanesByDeviceId = new Map<string, DeviceLanes>()
  // One FIFO admission lock per device id for every request: initial
  // catch-up, recent and older re-check and gap retries. It is not tied to a
  // job object or a generation, so it holds across suspend, resume and range
  // expansion until the in-flight request settles. Only a reset (a new
  // mission) starts fresh locks, so a new mission never waits on an old one.
  const deviceLocks = new Map<string, { readonly epoch: number; held: boolean; readonly waiters: (() => void)[] }>()
  let missionEpoch = 0
  // A device's re-check turn queued or running, by generation; a tick skips it.
  const turnsInFlight = new Map<string, number>()
  const antiEntropyTaskQueue: (() => Promise<void>)[] = []
  let antiEntropyActiveTaskCount = 0
  // Set when every initial job finished but a gap withheld completion.
  let initialCompletionWithheld = false
  let initialStartedAtMs: number | null = null
  let antiEntropyStartedAtMs: number | null = null

  const buildProgress = (
    phase: BreadcrumbHistoryProgress['phase'],
  ): BreadcrumbHistoryProgress => {
    const pendingJobs = [...jobsByDeviceId.values()].sort((left, right) =>
      compareStringsByCodeUnit(left.deviceId, right.deviceId),
    )
    const completedDevices = [...completedDevicesById.values()]
    const targetStarts = [
      ...pendingJobs.map((job) => job.missionStartMs),
      ...completedDevices.map((device) => device.missionStartMs),
    ]
    const targetEnds = phase === 'initial'
      ? [
          ...pendingJobs.map((job) => job.initialTargetMs),
          ...completedDevices.map((device) => device.initialTargetMs),
        ]
      : completedDevices.map((device) => device.antiEntropyTargetMs)
    const initialTotalChunkCount = [
      ...pendingJobs.map((job) =>
        countChunks(job.missionStartMs, job.initialTargetMs, chunkMs),
      ),
      ...completedDevices.map((device) =>
        countChunks(device.missionStartMs, device.initialTargetMs, chunkMs),
      ),
    ].reduce((total, count) => total + count, 0)
    const initialCompletedChunkCount = [
      ...pendingJobs.map((job) => countChunks(job.missionStartMs, job.cursorMs, chunkMs)),
      ...completedDevices.map((device) =>
        countChunks(device.missionStartMs, device.initialTargetMs, chunkMs),
      ),
    ].reduce((total, count) => total + count, 0)
    const antiEntropyTotalChunkCount = completedDevices.reduce(
      (total, device) =>
        total + countChunks(device.missionStartMs, device.antiEntropyTargetMs, chunkMs),
      0,
    )
    const antiEntropyCompletedChunkCount = completedDevices.reduce(
      (total, device) =>
        total + countChunks(
          Math.max(device.missionStartMs, device.antiEntropyCursorMs),
          device.antiEntropyTargetMs,
          chunkMs,
        ),
      0,
    )
    const failedIds = phase === 'initial' ? failedDeviceIds : antiEntropyFailedDeviceIds
    const failedNamesById = new Map<string, string>()
    if (phase === 'initial') {
      for (const job of pendingJobs) {
        if (failedIds.has(job.deviceId)) failedNamesById.set(job.deviceId, job.deviceName)
      }
    } else {
      for (const device of completedDevices) {
        if (failedIds.has(device.deviceId)) failedNamesById.set(device.deviceId, device.deviceName)
      }
    }
    // A device with an unfilled gap stays named in both phases [DON-338].
    for (const [deviceId, gaps] of gapsByDeviceId) {
      const name = gaps[0]?.deviceName
      if (name !== undefined && !failedNamesById.has(deviceId)) failedNamesById.set(deviceId, name)
    }
    const failedNames = [...failedNamesById.entries()]
      .sort(([left], [right]) => compareStringsByCodeUnit(left, right))
      .map(([, name]) => name)
    const totalDeviceCount = pendingJobs.length + completedDevices.length
    const completedDeviceCount = phase === 'initial'
      ? completedDevices.length
      : completedDevices.filter(
          (device) =>
            device.antiEntropyCursorMs <= device.missionStartMs && !hasBacklog(device.deviceId),
        ).length
    const noGaps = gapsByDeviceId.size === 0
    const noBacklog = [...lanesByDeviceId.keys()].every((deviceId) => !hasBacklog(deviceId))
    const startedAtMs = phase === 'initial' ? initialStartedAtMs : antiEntropyStartedAtMs
    return {
      phase,
      targetFrom:
        targetStarts.length === 0
          ? null
          : new Date(Math.min(...targetStarts)).toISOString(),
      targetTo:
        targetEnds.length === 0
          ? null
          : new Date(Math.max(...targetEnds)).toISOString(),
      totalDeviceCount,
      completedDeviceCount,
      totalChunkCount:
        phase === 'initial' ? initialTotalChunkCount : antiEntropyTotalChunkCount,
      completedChunkCount:
        phase === 'initial'
          ? initialCompletedChunkCount
          : antiEntropyCompletedChunkCount,
      pendingDeviceCount: Math.max(0, totalDeviceCount - completedDeviceCount),
      failedDeviceCount: failedNames.length,
      elapsedMs: startedAtMs === null ? 0 : Math.max(0, Date.now() - startedAtMs),
      pendingDeviceNames: pendingJobs.map((job) => job.deviceName),
      failedDeviceNames: failedNames,
      historyGaps: publishHistoryGaps(gapsByDeviceId),
      recheckBacklog: publishRecheckBacklog(lanesByDeviceId),
      // DON-338 review: a gapped history is never reported complete. The
      // initial phase claims only that every initial window was fetched or is
      // a reported gap; re-check backlog re-reads history already fetched, so
      // it keeps the re-check phase incomplete (and is published as
      // recheckBacklog) without withholding the initial claim.
      complete:
        noGaps &&
        (phase === 'initial'
          ? pendingJobs.length === 0
          : noBacklog && completedDeviceCount === totalDeviceCount),
    }
  }

  // While any device is still catching up, report the initial phase so its
  // failure stays visible even though healthy devices are being swept.
  const getProgress = (): BreadcrumbHistoryProgress =>
    buildProgress(
      jobsByDeviceId.size > 0 || antiEntropyStartedAtMs === null ? 'initial' : 'anti_entropy',
    )

  const publishProgress = (
    phase: BreadcrumbHistoryProgress['phase'] = 'initial',
  ): void => {
    if (options.shouldContinue()) {
      const progress = buildProgress(phase)
      if (phase === 'initial') {
        initialCompletionWithheld =
          jobsByDeviceId.size === 0 && !progress.complete && gapsByDeviceId.size > 0
      }
      options.onProgress(progress)
    }
  }

  /**
   * Publishes the initial completion that a gap withheld, once the last gap
   * is filled, so consumers waiting on it (canonical trail reload) run.
   */
  const publishWithheldInitialCompletion = (): void => {
    if (initialCompletionWithheld && jobsByDeviceId.size === 0 && gapsByDeviceId.size === 0) {
      publishProgress('initial')
    }
  }

  const completeInitialJob = (job: DeviceReconciliationJob): void => {
    jobsByDeviceId.delete(job.deviceId)
    failedDeviceIds.delete(job.deviceId)
    completedDevicesById.set(job.deviceId, {
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      missionStartMs: job.missionStartMs,
      initialTargetMs: job.initialTargetMs,
      antiEntropyCursorMs: job.latestAvailableTargetMs,
      antiEntropyTargetMs: job.latestAvailableTargetMs,
      latestAvailableTargetMs: job.latestAvailableTargetMs,
    })
  }

  /** True while the device has re-check ranges queued in its recent or older lane. */
  function hasBacklog(deviceId: string): boolean {
    const lanes = lanesByDeviceId.get(deviceId)
    return lanes !== undefined && (lanes.recent.length > 0 || lanes.older.length > 0)
  }

  /**
   * Takes the device's admission lock. Returns its release at once when the
   * device is free; otherwise a promise of it, resolved once every earlier
   * request for the device has settled. Waiters are served in order.
   */
  const acquireDevice = (deviceId: string): (() => void) | Promise<() => void> => {
    let lock = deviceLocks.get(deviceId)
    if (lock === undefined || lock.epoch !== missionEpoch) {
      lock = { epoch: missionEpoch, held: false, waiters: [] }
      deviceLocks.set(deviceId, lock)
    }
    const current = lock
    const makeRelease = (): (() => void) => {
      let released = false
      return () => {
        if (released) return
        released = true
        const next = current.waiters.shift()
        if (next !== undefined) {
          next()
          return
        }
        current.held = false
        if (deviceLocks.get(deviceId) === current) deviceLocks.delete(deviceId)
      }
    }
    if (!current.held) {
      current.held = true
      return makeRelease()
    }
    return new Promise((resolve) => {
      current.waiters.push(() => resolve(makeRelease()))
    })
  }

  /** Fetches one window under the device's admission lock. */
  const fetchUnderLock = async (
    deviceId: string,
    fromMs: number,
    toMs: number,
    stillWanted: () => boolean,
  ): Promise<readonly NormalizedTrackingPosition[] | null> => {
    // A free device is fetched synchronously, as before the lock existed.
    const acquired = acquireDevice(deviceId)
    const release = typeof acquired === 'function' ? acquired : await acquired
    try {
      if (!stillWanted()) return null
      return await options.fetchBreadcrumbs(deviceId, new Date(fromMs), new Date(toMs))
    } finally {
      release()
    }
  }

  const scheduleDrain = (delayMs: number): void => {
    if (retryTimer !== null || !options.shouldContinue()) {
      return
    }
    const scheduledGeneration = generation
    retryTimer = scheduleTimeout(() => {
      retryTimer = null
      if (scheduledGeneration === generation) {
        startDrain()
      }
    }, delayMs)
  }

  /**
   * Records an unfetchable range so it is visible and retried, never silently
   * skipped. Overlapping or touching ranges of one device merge into one
   * record, keeping the initial phase if either was initial.
   */
  const recordHistoryGap = (
    gap: Omit<HistoryGapRecord, 'attempts' | 'lastAttemptAtMs' | 'lastError'>,
    attempts: number,
    error: unknown,
  ): void => {
    const lastError = describeError(error)
    const nowMs = Date.now()
    const gaps = gapsByDeviceId.get(gap.deviceId) ?? []
    const touching = gaps.filter((record) => record.fromMs <= gap.toMs && record.toMs >= gap.fromMs)
    const merged: HistoryGapRecord = touching[0] ?? { ...gap, attempts: 0, lastError, lastAttemptAtMs: nowMs }
    for (const record of touching.slice(1)) {
      merged.fromMs = Math.min(merged.fromMs, record.fromMs)
      merged.toMs = Math.max(merged.toMs, record.toMs)
      merged.attempts += record.attempts
      if (record.phase === 'initial') merged.phase = 'initial'
    }
    merged.fromMs = Math.min(merged.fromMs, gap.fromMs)
    merged.toMs = Math.max(merged.toMs, gap.toMs)
    merged.attempts += attempts
    merged.lastError = lastError
    merged.reason = gap.reason
    merged.lastAttemptAtMs = nowMs
    if (gap.phase === 'initial') merged.phase = 'initial'
    const remaining = gaps.filter((record) => !touching.includes(record))
    remaining.push(merged)
    remaining.sort((left, right) => left.fromMs - right.fromMs)
    gapsByDeviceId.set(gap.deviceId, remaining)
    options.logger.warn(
      'Tracking breadcrumb history window could not be fetched at any size; recorded as a gap.',
      {
        deviceId: gap.deviceId,
        deviceName: gap.deviceName,
        from: new Date(gap.fromMs).toISOString(),
        to: new Date(gap.toMs).toISOString(),
        reason: gap.reason,
        phase: gap.phase,
        error: lastError,
      },
    )
  }

  /**
   * A committed fetch of [fromMs, toMs] fills exactly that part of the
   * device's gaps: covered records go, partly covered ones are trimmed or split.
   */
  const clearHistoryGapsCoveredBy = (
    deviceId: string,
    fromMs: number,
    toMs: number,
  ): void => {
    const gaps = gapsByDeviceId.get(deviceId)
    if (gaps === undefined) return
    const remaining: HistoryGapRecord[] = []
    for (const gap of gaps) {
      if (gap.toMs <= fromMs || gap.fromMs >= toMs) {
        remaining.push(gap)
        continue
      }
      if (gap.fromMs < fromMs && gap.toMs > toMs) {
        remaining.push({ ...gap, toMs: fromMs }, { ...gap, fromMs: toMs })
      } else if (gap.fromMs < fromMs) {
        gap.toMs = fromMs
        remaining.push(gap)
      } else if (gap.toMs > toMs) {
        gap.fromMs = toMs
        remaining.push(gap)
      }
    }
    if (remaining.length === 0) gapsByDeviceId.delete(deviceId)
    else gapsByDeviceId.set(deviceId, remaining)
  }

  /** Grows a split window back towards the full chunk after steady success. */
  const noteInitialWindowSuccess = (
    job: DeviceReconciliationJob,
    fromMs: number,
    toMs: number,
  ): void => {
    clearHistoryGapsCoveredBy(job.deviceId, fromMs, toMs)
    job.minWindowFailureCount = 0
    job.consecutiveSuccessCount += 1
    if (
      job.windowMs < chunkMs &&
      job.consecutiveSuccessCount >= WINDOW_GROWTH_SUCCESS_COUNT
    ) {
      job.windowMs = Math.min(chunkMs, job.windowMs * 2)
      job.consecutiveSuccessCount = 0
    }
  }

  /**
   * Handles a failed history fetch for an initial window. An oversized or slow
   * reply splits the window; at the smallest width it is retried a bounded
   * number of times, then recorded as a gap so the device's remaining history
   * still catches up. Any other failure keeps the window and backs off.
   */
  const handleInitialFetchFailure = (
    job: DeviceReconciliationJob,
    fromMs: number,
    toMs: number,
    drainGeneration: number,
    error: unknown,
  ): void => {
    if (!isCurrentJob(job, drainGeneration)) {
      return
    }
    const reason = classifyHistoryWindowFailure(error)
    if (reason === null) {
      markJobFailed(job, drainGeneration, error)
      return
    }
    job.consecutiveSuccessCount = 0
    const widthMs = toMs - fromMs
    if (widthMs > minWindowMs) {
      job.windowMs = Math.max(minWindowMs, Math.floor(widthMs / 2))
      job.minWindowFailureCount = 0
      job.retryAtMs = 0
      deviceQueue.push(job.deviceId)
      options.logger.warn('Tracking breadcrumb history window failed; splitting it.', {
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        nextWindowMs: job.windowMs,
        reason,
        error: describeError(error),
      })
      return
    }
    job.minWindowFailureCount += 1
    if (job.minWindowFailureCount < minWindowAttempts) {
      markJobFailed(job, drainGeneration, error)
      return
    }
    recordHistoryGap({
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      historyFromMs: job.missionStartMs,
      fromMs,
      toMs,
      phase: 'initial',
      reason,
    }, job.minWindowFailureCount, error)
    job.cursorMs = toMs
    job.minWindowFailureCount = 0
    job.failureCount = 0
    job.retryAtMs = 0
    failedDeviceIds.delete(job.deviceId)
    if (job.cursorMs >= job.targetMs) {
      completeInitialJob(job)
    } else {
      deviceQueue.push(job.deviceId)
    }
  }

  const processJob = async (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): Promise<void> => {
    const fromMs = job.cursorMs
    const toMs = Math.min(fromMs + job.windowMs, job.targetMs)
    if (toMs <= fromMs) {
      completeInitialJob(job)
      return
    }

    let positions: readonly NormalizedTrackingPosition[]
    try {
      const fetched = await fetchUnderLock(
        job.deviceId,
        fromMs,
        toMs,
        () => isCurrentJob(job, drainGeneration),
      )
      if (fetched === null) return
      positions = fetched
    } catch (error) {
      handleInitialFetchFailure(job, fromMs, toMs, drainGeneration, error)
      return
    }
    try {
      if (
        drainGeneration !== generation ||
        !options.shouldContinue() ||
        jobsByDeviceId.get(job.deviceId) !== job
      ) {
        if (
          jobsByDeviceId.get(job.deviceId) === job &&
          !deviceQueue.includes(job.deviceId)
        ) {
          deviceQueue.push(job.deviceId)
          scheduleDrain(0)
        }
        return
      }

      await options.onChunk({
        phase: 'initial',
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        historyFrom: new Date(job.missionStartMs),
        from: new Date(fromMs),
        to: new Date(toMs),
        positions,
      })
      if (
        drainGeneration !== generation ||
        !options.shouldContinue() ||
        jobsByDeviceId.get(job.deviceId) !== job
      ) {
        return
      }
      job.cursorMs = toMs
      job.failureCount = 0
      job.retryAtMs = 0
      failedDeviceIds.delete(job.deviceId)
      noteInitialWindowSuccess(job, fromMs, toMs)
      if (job.cursorMs >= job.targetMs) {
        completeInitialJob(job)
      } else {
        deviceQueue.push(job.deviceId)
      }
    } catch (error) {
      markJobFailed(job, drainGeneration, error)
    }
  }

  const isCurrentJob = (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): boolean =>
    drainGeneration === generation &&
    options.shouldContinue() &&
    jobsByDeviceId.get(job.deviceId) === job

  const markJobFailed = (
    job: DeviceReconciliationJob,
    drainGeneration: number,
    error: unknown,
  ): void => {
    if (!isCurrentJob(job, drainGeneration)) {
      return
    }
    job.failureCount += 1
    const retryDelayMs = Math.min(
      retryBaseMs * 2 ** (job.failureCount - 1),
      maxRetryMs,
    )
    job.retryAtMs = Date.now() + retryDelayMs
    failedDeviceIds.add(job.deviceId)
    deviceQueue.push(job.deviceId)
    options.logger.warn('Tracking breadcrumb reconciliation failed for device.', {
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      retryDelayMs,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const createInitialChunk = async (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): Promise<BreadcrumbHistoryChunk | null> => {
    const fromMs = job.cursorMs
    const toMs = Math.min(fromMs + job.windowMs, job.targetMs)
    if (toMs <= fromMs) {
      completeInitialJob(job)
      return null
    }
    try {
      const positions = await fetchUnderLock(
        job.deviceId,
        fromMs,
        toMs,
        () => isCurrentJob(job, drainGeneration),
      )
      if (positions === null || !isCurrentJob(job, drainGeneration)) {
        return null
      }
      return {
        phase: 'initial',
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        historyFrom: new Date(job.missionStartMs),
        from: new Date(fromMs),
        to: new Date(toMs),
        positions,
      }
    } catch (error) {
      handleInitialFetchFailure(job, fromMs, toMs, drainGeneration, error)
      return null
    }
  }

  const advanceAcknowledgedChunk = (
    job: DeviceReconciliationJob,
    chunk: BreadcrumbHistoryChunk,
    drainGeneration: number,
  ): void => {
    if (!isCurrentJob(job, drainGeneration)) {
      return
    }
    job.cursorMs = chunk.to.getTime()
    job.failureCount = 0
    job.retryAtMs = 0
    failedDeviceIds.delete(job.deviceId)
    noteInitialWindowSuccess(job, chunk.from.getTime(), chunk.to.getTime())
    if (job.cursorMs >= job.targetMs) {
      completeInitialJob(job)
    } else {
      deviceQueue.push(job.deviceId)
    }
  }

  const processJobBatch = async (
    jobs: readonly DeviceReconciliationJob[],
    drainGeneration: number,
  ): Promise<void> => {
    const fetched = await Promise.all(
      jobs.map(async (job) => ({
        job,
        chunk: await createInitialChunk(job, drainGeneration),
      })),
    )
    const accepted = fetched.filter(
      (entry): entry is {
        readonly job: DeviceReconciliationJob
        readonly chunk: BreadcrumbHistoryChunk
      } => entry.chunk !== null && isCurrentJob(entry.job, drainGeneration),
    )
    if (accepted.length === 0 || options.onChunks === undefined) {
      return
    }
    let acknowledgement: BreadcrumbHistoryChunkAcknowledgement
    try {
      acknowledgement = await options.onChunks(accepted.map((entry) => entry.chunk))
    } catch {
      const currentAccepted = accepted.filter((entry) =>
        isCurrentJob(entry.job, drainGeneration),
      )
      const fallbackResults = await Promise.allSettled(
        currentAccepted.map((entry) => options.onChunk(entry.chunk)),
      )
      for (const [index, entry] of currentAccepted.entries()) {
        const result = fallbackResults[index]
        if (result?.status === 'fulfilled') {
          advanceAcknowledgedChunk(entry.job, entry.chunk, drainGeneration)
        } else {
          markJobFailed(
            entry.job,
            drainGeneration,
            result?.reason ?? new Error('Tracking history chunk persistence failed.'),
          )
        }
      }
      return
    }
    // An invalid result cannot establish which chunks committed. Keep every
    // cursor unchanged and use normal idempotent retries, not immediate fallback.
    if (acknowledgement !== undefined
      && !isValidChunkAcknowledgement(acknowledgement, accepted.length)) {
      const error = new Error('Tracking history acknowledgement must contain one settled result per chunk.')
      for (const entry of accepted) markJobFailed(entry.job, drainGeneration, error)
      return
    }
    for (const [index, entry] of accepted.entries()) {
      const result = acknowledgement?.[index]
      if (result === undefined || result.status === 'fulfilled') {
        advanceAcknowledgedChunk(entry.job, entry.chunk, drainGeneration)
      } else {
        markJobFailed(entry.job, drainGeneration, result.reason)
      }
    }
  }

  const drain = async (drainGeneration: number): Promise<void> => {
    while (
      drainGeneration === generation &&
      options.shouldContinue() &&
      jobsByDeviceId.size > 0
    ) {
      const queuePassLength = deviceQueue.length
      const eligibleJobs: DeviceReconciliationJob[] = []
      const availableConcurrency = Math.max(
        0,
        maxConcurrency - activeInitialJobs.size,
      )
      let earliestRetryAtMs = Number.POSITIVE_INFINITY
      for (
        let index = 0;
        index < queuePassLength && eligibleJobs.length < availableConcurrency;
        index += 1
      ) {
        const deviceId = deviceQueue.shift()
        if (deviceId === undefined) {
          break
        }
        const job = jobsByDeviceId.get(deviceId)
        if (job === undefined) {
          continue
        }
        if (job.retryAtMs > Date.now()) {
          earliestRetryAtMs = Math.min(earliestRetryAtMs, job.retryAtMs)
          deviceQueue.push(deviceId)
          continue
        }
        if (activeInitialJobs.has(job)) {
          continue
        }
        activeInitialJobs.add(job)
        eligibleJobs.push(job)
      }

      if (eligibleJobs.length === 0) {
        if (Number.isFinite(earliestRetryAtMs)) {
          scheduleDrain(Math.max(0, earliestRetryAtMs - Date.now()))
        }
        break
      }

      if (options.onChunks === undefined) {
        await Promise.all(
          eligibleJobs.map((job) => processJob(job, drainGeneration)),
        )
      } else {
        await processJobBatch(eligibleJobs, drainGeneration)
      }
      for (const job of eligibleJobs) {
        activeInitialJobs.delete(job)
      }
      if (drainGeneration !== generation || !options.shouldContinue()) {
        break
      }
      publishProgress()
    }
  }

  function startDrain(): void {
    if (draining || jobsByDeviceId.size === 0 || !options.shouldContinue()) {
      return
    }
    draining = true
    const drainGeneration = generation
    void drain(drainGeneration).finally(() => {
      if (drainGeneration === generation) {
        draining = false
        scheduleAntiEntropy()
      }
    })
  }

  function scheduleAntiEntropy(): void {
    if (
      antiEntropyTimer !== null ||
      (completedDevicesById.size === 0 && gapsByDeviceId.size === 0 && lanesByDeviceId.size === 0) ||
      !options.shouldContinue()
    ) {
      return
    }
    const scheduledGeneration = generation
    antiEntropyTimer = scheduleTimeout(() => {
      antiEntropyTimer = null
      if (scheduledGeneration === generation) {
        void runAntiEntropyTick(scheduledGeneration)
      }
    }, antiEntropyIntervalMs)
  }

  /** The device's re-check lanes, created on first use. */
  const lanesFor = (deviceId: string, deviceName: string): DeviceLanes => {
    let lanes = lanesByDeviceId.get(deviceId)
    if (lanes === undefined) {
      lanes = {
        deviceId,
        deviceName,
        recent: [],
        older: [],
        nextLaneIndex: 0,
        gapCursorMs: Number.NEGATIVE_INFINITY,
        windowMs: chunkMs,
        successCount: 0,
        turn: 0,
      }
      lanesByDeviceId.set(deviceId, lanes)
    }
    lanes.deviceName = deviceName
    return lanes
  }

  /**
   * Appends a range to the tail of a lane, minus anything already queued in
   * either lane or recorded as a gap, so planning never moves or duplicates
   * queued work.
   */
  const enqueueRange = (lanes: DeviceLanes, lane: 'recent' | 'older', range: TimeRange): void => {
    let pieces: TimeRange[] = range.toMs > range.fromMs ? [range] : []
    const covered: readonly TimeRange[] = [
      ...lanes.recent,
      ...lanes.older,
      ...(gapsByDeviceId.get(lanes.deviceId) ?? []),
    ]
    for (const taken of covered) pieces = pieces.flatMap((piece) => removeTimeRange([piece], taken))
    // The recent lane is read newest first, where late uploads land.
    if (lane === 'recent') pieces.sort((left, right) => right.fromMs - left.fromMs)
    lanes[lane].push(...pieces.map((piece) => ({ ...piece, failedInTurn: -1 })))
  }

  /**
   * Plans a completed device's tick. The recent window is queued every tick,
   * because that is where late uploads land; the next older span of the pass
   * is queued only when the older lane is empty.
   */
  const planDevice = (device: CompletedDeviceReconciliation): void => {
    const lanes = lanesFor(device.deviceId, device.deviceName)
    const recentTopMs = device.latestAvailableTargetMs
    const recentFloorMs = Math.max(device.missionStartMs, recentTopMs - antiEntropyRecentWindowMs)
    enqueueRange(lanes, 'recent', { fromMs: recentFloorMs, toMs: recentTopMs })
    if (lanes.older.length > 0) return
    if (device.antiEntropyCursorMs <= device.missionStartMs) {
      device.antiEntropyTargetMs = device.latestAvailableTargetMs
      device.antiEntropyCursorMs = device.antiEntropyTargetMs
    }
    const olderTopMs = Math.min(device.antiEntropyCursorMs, recentFloorMs)
    const olderFloorMs = Math.max(device.missionStartMs, olderTopMs - antiEntropyOlderChunksPerTick * chunkMs)
    enqueueRange(lanes, 'older', { fromMs: olderFloorMs, toMs: olderTopMs })
    device.antiEntropyCursorMs = Math.min(device.antiEntropyCursorMs, olderFloorMs)
  }

  /** Requests one device may make in one turn: fixed, or twice its plan at its current width, at least 12. */
  const requestBudgetFor = (lanes: DeviceLanes): number =>
    fixedRequestBudget ?? Math.max(
      MIN_ANTI_ENTROPY_REQUESTS_PER_DEVICE_PER_TICK,
      2 * Math.ceil((antiEntropyRecentWindowMs + antiEntropyOlderChunksPerTick * chunkMs) / lanes.windowMs),
    )

  /** Names a device whose re-check failed for a reason a smaller window cannot fix. */
  const markAntiEntropyFailed = (lanes: DeviceLanes, error: unknown): void => {
    options.logger.warn('Tracking breadcrumb anti-entropy check failed for device.', {
      deviceId: lanes.deviceId,
      deviceName: lanes.deviceName,
      retryDelayMs: antiEntropyIntervalMs,
      error: describeError(error),
    })
    antiEntropyFailedDeviceIds.add(lanes.deviceId)
  }

  /** The outcome of one re-check request for the device's turn. */
  type TurnRequestOutcome = 'done' | 'narrowed' | 'failed' | 'stop'

  /**
   * Fetches and commits the head of a recent or older lane at the device's
   * width. An oversized or slow reply halves the width and keeps the slice at
   * the head; at the smallest width the slice becomes a gap. Any other fetch
   * failure moves only that slice to the back of its lane. A persistence
   * failure stops the turn.
   */
  const fetchLaneHead = async (
    lanes: DeviceLanes,
    lane: 'recent' | 'older',
    window: TimeRange,
    isCurrent: () => boolean,
  ): Promise<TurnRequestOutcome> => {
    let positions: readonly NormalizedTrackingPosition[]
    try {
      const fetched = await fetchUnderLock(lanes.deviceId, window.fromMs, window.toMs, isCurrent)
      if (fetched === null) return 'stop'
      positions = fetched
    } catch (error) {
      if (!isCurrent()) return 'stop'
      const reason = classifyHistoryWindowFailure(error)
      if (reason === null) {
        markAntiEntropyFailed(lanes, error)
        lanes[lane] = subtractFromLane(lanes[lane], window)
        lanes[lane].push({ ...window, failedInTurn: lanes.turn })
        return 'failed'
      }
      lanes.successCount = 0
      if (window.toMs - window.fromMs > minWindowMs) {
        lanes.windowMs = Math.max(minWindowMs, Math.floor((window.toMs - window.fromMs) / 2))
        return 'narrowed'
      }
      lanes[lane] = subtractFromLane(lanes[lane], window)
      recordHistoryGap({
        deviceId: lanes.deviceId,
        deviceName: lanes.deviceName,
        historyFromMs: historyFromFor(lanes.deviceId, window.fromMs),
        fromMs: window.fromMs,
        toMs: window.toMs,
        phase: 'anti_entropy',
        reason,
      }, 1, error)
      return 'done'
    }
    if (!isCurrent()) return 'stop'
    try {
      await options.onChunk({
        phase: 'anti_entropy',
        deviceId: lanes.deviceId,
        deviceName: lanes.deviceName,
        historyFrom: new Date(historyFromFor(lanes.deviceId, window.fromMs)),
        from: new Date(window.fromMs),
        to: new Date(window.toMs),
        positions,
      })
    } catch (error) {
      if (isCurrent()) markAntiEntropyFailed(lanes, error)
      return 'stop'
    }
    if (!isCurrent()) return 'stop'
    lanes[lane] = subtractFromLane(lanes[lane], window)
    clearHistoryGapsCoveredBy(lanes.deviceId, window.fromMs, window.toMs)
    lanes.successCount += 1
    if (lanes.windowMs < chunkMs && lanes.successCount >= WINDOW_GROWTH_SUCCESS_COUNT) {
      lanes.windowMs = Math.min(chunkMs, lanes.windowMs * 2)
      lanes.successCount = 0
    }
    return 'done'
  }

  /** The history start a device's checkpoint is keyed by; a gap keeps its own. */
  const historyFromFor = (deviceId: string, fallbackMs: number): number =>
    completedDevicesById.get(deviceId)?.missionStartMs
      ?? jobsByDeviceId.get(deviceId)?.missionStartMs
      ?? gapsByDeviceId.get(deviceId)?.[0]?.historyFromMs
      ?? fallbackMs

  /**
   * The next gap slice in time order after the device's gap cursor, wrapping
   * to the earliest gap. One smallest-width slice per request, so a
   * still-failing slice never blocks the rest of a gap.
   */
  const nextGapSlice = (lanes: DeviceLanes): { readonly gap: HistoryGapRecord; readonly window: TimeRange } | null => {
    const gaps = gapsByDeviceId.get(lanes.deviceId) ?? []
    const gap = gaps.find((record) => record.toMs > lanes.gapCursorMs) ?? gaps[0]
    if (gap === undefined) return null
    const fromMs = lanes.gapCursorMs > gap.fromMs && lanes.gapCursorMs < gap.toMs ? lanes.gapCursorMs : gap.fromMs
    return { gap, window: { fromMs, toMs: Math.min(gap.toMs, fromMs + minWindowMs) } }
  }

  /** Retries one gap slice. Success fills that slice; failure keeps the gap reported. Either way the cursor moves on. */
  const fetchGapSlice = async (
    lanes: DeviceLanes,
    gap: HistoryGapRecord,
    window: TimeRange,
    isCurrent: () => boolean,
  ): Promise<TurnRequestOutcome> => {
    lanes.gapCursorMs = window.toMs
    gap.lastAttemptAtMs = Date.now()
    let positions: readonly NormalizedTrackingPosition[]
    try {
      const fetched = await fetchUnderLock(lanes.deviceId, window.fromMs, window.toMs, isCurrent)
      if (fetched === null) return 'stop'
      positions = fetched
    } catch (error) {
      if (!isCurrent()) return 'stop'
      gap.attempts += 1
      gap.lastError = describeError(error)
      gap.reason = classifyHistoryWindowFailure(error) ?? gap.reason
      options.logger.warn('Tracking breadcrumb history gap is still unfetchable.', {
        deviceId: gap.deviceId,
        deviceName: gap.deviceName,
        from: new Date(window.fromMs).toISOString(),
        to: new Date(window.toMs).toISOString(),
        attempts: gap.attempts,
        retryDelayMs: antiEntropyIntervalMs,
        error: gap.lastError,
      })
      return 'failed'
    }
    if (!isCurrent()) return 'stop'
    try {
      await options.onChunk({
        phase: 'anti_entropy',
        deviceId: gap.deviceId,
        deviceName: gap.deviceName,
        // The device's current history start: a range expansion since the gap
        // was recorded moved it, and the store rejects a later one.
        historyFrom: new Date(historyFromFor(gap.deviceId, gap.historyFromMs)),
        from: new Date(window.fromMs),
        to: new Date(window.toMs),
        positions,
      })
    } catch (error) {
      if (isCurrent()) markAntiEntropyFailed(lanes, error)
      return 'stop'
    }
    if (!isCurrent()) return 'stop'
    clearHistoryGapsCoveredBy(gap.deviceId, window.fromMs, window.toMs)
    return 'done'
  }

  /**
   * One device's re-check turn. Every request goes through the device's
   * admission lock, so the device never has two requests in flight. The turn
   * takes one request from each non-empty lane (recent, older, gap) in
   * rotation, starting from the lane after the one served last, until the
   * request budget b or the time budget is spent; the first request is always
   * made. Within a lane, work is strict FIFO; a slice that failed this turn
   * waits at the back and is not retried until the next turn, and a gap slice
   * is tried at most once per turn. A failure in one lane never stops the
   * others: only cancellation, a mission change or a persistence failure ends
   * the turn early. A device still in initial catch-up runs its gap lane
   * here; its initial lane is the catch-up drain, which shares the lock.
   *
   * Bound: let n be the requests a turn makes (n = b unless the time budget
   * ends it first; n >= 1) and L the non-empty lanes. Rotation gives every
   * non-empty lane at least floor(n / L) of them, and when n < L every lane
   * is served at least once every L turns. So a slice at position p of its
   * lane is fetched within ceil(p / floor(n / L)) turns (n >= L) or p x L
   * turns (n < L), provided its own request succeeds. An oversized or slow
   * reply costs one extra request per narrowing, and the width grows back
   * only after four successes. A turn that runs past the next tick makes the
   * device skip that tick, so in ticks the bound is at most twice the turns.
   */
  const runDeviceTurn = async (deviceId: string, batchGeneration: number): Promise<void> => {
    const known = lanesByDeviceId.get(deviceId)
    const deviceName = known?.deviceName
      ?? completedDevicesById.get(deviceId)?.deviceName
      ?? gapsByDeviceId.get(deviceId)?.[0]?.deviceName
    if (deviceName === undefined) return
    const lanes = known ?? lanesFor(deviceId, deviceName)
    const isCurrent = (): boolean =>
      batchGeneration === generation && options.shouldContinue() && lanesByDeviceId.get(deviceId) === lanes
    lanes.turn += 1
    const turn = lanes.turn
    const startedAtMs = Date.now()
    let requestBudget = requestBudgetFor(lanes)
    let requestCount = 0
    let failed = false
    const triedGapSlices = new Set<number>()
    let laneIndex = lanes.nextLaneIndex
    let idleLanes = 0
    while (isCurrent() && idleLanes < RECHECK_LANES.length) {
      if (requestCount > 0 && (requestCount >= requestBudget || Date.now() - startedAtMs >= antiEntropyDeviceTimeBudgetMs)) break
      const lane = RECHECK_LANES[laneIndex]!
      laneIndex = (laneIndex + 1) % RECHECK_LANES.length
      let outcome: TurnRequestOutcome
      if (lane === 'gap') {
        const next = nextGapSlice(lanes)
        if (next === null || triedGapSlices.has(next.window.fromMs)) {
          idleLanes += 1
          continue
        }
        triedGapSlices.add(next.window.fromMs)
        idleLanes = 0
        lanes.nextLaneIndex = laneIndex
        requestCount += 1
        outcome = await fetchGapSlice(lanes, next.gap, next.window, isCurrent)
      } else {
        const head = lanes[lane][0]
        if (head === undefined || head.failedInTurn === turn) {
          idleLanes += 1
          continue
        }
        idleLanes = 0
        lanes.nextLaneIndex = laneIndex
        requestCount += 1
        // Recent slices are read from their newest end, older slices from their oldest.
        outcome = await fetchLaneHead(
          lanes,
          lane,
          lane === 'recent'
            ? { fromMs: Math.max(head.fromMs, head.toMs - lanes.windowMs), toMs: head.toMs }
            : { fromMs: head.fromMs, toMs: Math.min(head.toMs, head.fromMs + lanes.windowMs) },
          isCurrent,
        )
      }
      if (outcome === 'stop') return
      if (outcome === 'failed') failed = true
      // Narrower windows need more requests to cover the same plan; the time budget still bounds a slow device.
      if (outcome === 'narrowed') requestBudget = Math.max(requestBudget, requestBudgetFor(lanes))
    }
    if (!isCurrent()) return
    if (hasBacklog(deviceId)) {
      options.logger.warn('Tracking breadcrumb re-check budget used up for device; resuming next tick.', {
        deviceId,
        deviceName: lanes.deviceName,
        requestCount,
        elapsedMs: Date.now() - startedAtMs,
      })
    } else if (!failed) {
      antiEntropyFailedDeviceIds.delete(deviceId)
    }
  }

  /** Starts queued re-check work while the sweep's share of the transport allows. */
  const pumpAntiEntropyTasks = (): void => {
    while (
      antiEntropyActiveTaskCount < antiEntropyMaxConcurrency &&
      antiEntropyTaskQueue.length > 0
    ) {
      const task = antiEntropyTaskQueue.shift()!
      antiEntropyActiveTaskCount += 1
      void task().finally(() => {
        antiEntropyActiveTaskCount -= 1
        pumpAntiEntropyTasks()
      })
    }
  }

  /** Queues one unit of re-check work; resolves when it has run. */
  const enqueueAntiEntropyTask = (work: () => Promise<void>): Promise<void> =>
    new Promise<void>((resolve) => {
      antiEntropyTaskQueue.push(async () => {
        try {
          await work()
        } catch (error) {
          options.logger.warn('Tracking breadcrumb re-check task failed unexpectedly.', {
            error: describeError(error),
          })
        } finally {
          resolve()
        }
      })
      pumpAntiEntropyTasks()
    })

  /**
   * One 5-minute re-check tick. The next tick is scheduled when this one
   * starts, so a slow device never delays the others. Every device with
   * re-check work or an open gap gets one turn, including a device still in
   * initial catch-up; a device whose previous turn is still queued or running
   * is skipped [DON-338 ING-1 and review].
   */
  async function runAntiEntropyTick(batchGeneration: number): Promise<void> {
    if (
      batchGeneration !== generation ||
      !options.shouldContinue()
    ) {
      scheduleAntiEntropy()
      return
    }
    antiEntropyStartedAtMs ??= Date.now()
    scheduleAntiEntropy()

    const deviceIds = [...new Set([
      ...completedDevicesById.keys(),
      ...lanesByDeviceId.keys(),
      ...gapsByDeviceId.keys(),
    ])]
      .sort(compareStringsByCodeUnit)
      .filter((deviceId) => turnsInFlight.get(deviceId) !== batchGeneration)
    await Promise.all(deviceIds.map((deviceId) => {
      const device = completedDevicesById.get(deviceId)
      if (device !== undefined) planDevice(device)
      turnsInFlight.set(deviceId, batchGeneration)
      return enqueueAntiEntropyTask(async () => {
        try {
          await runDeviceTurn(deviceId, batchGeneration)
        } finally {
          if (turnsInFlight.get(deviceId) === batchGeneration) turnsInFlight.delete(deviceId)
          if (batchGeneration === generation) publishWithheldInitialCompletion()
        }
      })
    }))
    if (batchGeneration === generation) {
      const progress = buildProgress('anti_entropy')
      publishProgress('anti_entropy')
      if (progress.complete) {
        antiEntropyStartedAtMs = null
      }
      scheduleAntiEntropy()
    }
  }

  function suspend(): void {
    generation += 1
    draining = false
    for (const job of jobsByDeviceId.values()) {
      if (!deviceQueue.includes(job.deviceId)) {
        deviceQueue.push(job.deviceId)
      }
    }
    if (retryTimer !== null) {
      clearScheduledTimeout(retryTimer)
      retryTimer = null
    }
    if (antiEntropyTimer !== null) {
      clearScheduledTimeout(antiEntropyTimer)
      antiEntropyTimer = null
    }
  }

  return {
    reconcile: ({ devices, from, until, checkpointsByDevice = {} }) => {
      if (from === null) {
        return
      }

      const selectedDeviceIds = new Set(devices.map((device) => device.device_id))
      for (const deviceId of jobsByDeviceId.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          jobsByDeviceId.delete(deviceId)
          failedDeviceIds.delete(deviceId)
        }
      }
      for (const deviceId of completedDevicesById.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          completedDevicesById.delete(deviceId)
          antiEntropyFailedDeviceIds.delete(deviceId)
        }
      }
      for (const deviceId of gapsByDeviceId.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          gapsByDeviceId.delete(deviceId)
        }
      }
      for (const deviceId of lanesByDeviceId.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          lanesByDeviceId.delete(deviceId)
        }
      }
      for (let index = deviceQueue.length - 1; index >= 0; index -= 1) {
        const deviceId = deviceQueue[index]
        if (deviceId !== undefined && !selectedDeviceIds.has(deviceId)) {
          deviceQueue.splice(index, 1)
        }
      }

      const missionStartMs = Math.min(from.getTime(), until.getTime())
      const targetMs = until.getTime()
      const orderedDevices = [...devices].sort((left, right) =>
        compareStringsByCodeUnit(left.device_id, right.device_id),
      )
      for (const device of orderedDevices) {
        const initialRange = resolveInitialHistoryRange(
          checkpointsByDevice[device.device_id],
          missionStartMs,
          targetMs,
        )
        const completedDevice = completedDevicesById.get(device.device_id)
        if (completedDevice !== undefined) {
          if (initialRange.historyFromMs < completedDevice.missionStartMs) {
            completedDevicesById.delete(device.device_id)
            initialStartedAtMs ??= Date.now()
            const expansionJob: DeviceReconciliationJob = {
              deviceId: device.device_id,
              deviceName: device.name,
              cursorMs: Math.min(
                initialRange.cursorMs,
                completedDevice.missionStartMs,
              ),
              targetMs: completedDevice.missionStartMs,
              missionStartMs: initialRange.historyFromMs,
              initialTargetMs: Math.max(completedDevice.initialTargetMs, targetMs),
              latestAvailableTargetMs: Math.max(
                completedDevice.latestAvailableTargetMs,
                targetMs,
              ),
              failureCount: 0,
              retryAtMs: 0,
              windowMs: chunkMs,
              consecutiveSuccessCount: 0,
              minWindowFailureCount: 0,
            }
            jobsByDeviceId.set(device.device_id, expansionJob)
            deviceQueue.push(device.device_id)
            continue
          }
          completedDevice.latestAvailableTargetMs = Math.max(
            completedDevice.latestAvailableTargetMs,
            targetMs,
          )
          continue
        }
        const pendingJob = jobsByDeviceId.get(device.device_id)
        if (pendingJob !== undefined) {
          if (initialRange.historyFromMs < pendingJob.missionStartMs) {
            const expansionJob: DeviceReconciliationJob = {
              deviceId: device.device_id,
              deviceName: device.name,
              cursorMs: Math.min(initialRange.cursorMs, pendingJob.missionStartMs),
              targetMs: Math.max(pendingJob.targetMs, targetMs),
              missionStartMs: initialRange.historyFromMs,
              initialTargetMs: Math.max(pendingJob.initialTargetMs, targetMs),
              latestAvailableTargetMs: Math.max(
                pendingJob.latestAvailableTargetMs,
                targetMs,
              ),
              failureCount: 0,
              retryAtMs: 0,
              windowMs: chunkMs,
              consecutiveSuccessCount: 0,
              minWindowFailureCount: 0,
            }
            jobsByDeviceId.set(device.device_id, expansionJob)
            failedDeviceIds.delete(device.device_id)
            if (!deviceQueue.includes(device.device_id)) {
              deviceQueue.push(device.device_id)
            }
          }
          continue
        }
        if (targetMs <= missionStartMs) {
          completedDevicesById.set(device.device_id, {
            deviceId: device.device_id,
            deviceName: device.name,
            missionStartMs,
            initialTargetMs: targetMs,
            antiEntropyCursorMs: missionStartMs,
            antiEntropyTargetMs: targetMs,
            latestAvailableTargetMs: targetMs,
          })
          continue
        }
        initialStartedAtMs ??= Date.now()
        const job: DeviceReconciliationJob = {
          deviceId: device.device_id,
          deviceName: device.name,
          cursorMs: initialRange.cursorMs,
          targetMs,
          missionStartMs: initialRange.historyFromMs,
          initialTargetMs: targetMs,
          latestAvailableTargetMs: targetMs,
          failureCount: 0,
          retryAtMs: 0,
          windowMs: chunkMs,
          consecutiveSuccessCount: 0,
          minWindowFailureCount: 0,
        }
        if (initialRange.cursorMs >= targetMs) {
          completeInitialJob(job)
        } else {
          jobsByDeviceId.set(device.device_id, job)
          deviceQueue.push(device.device_id)
        }
      }
      for (const deviceId of jobsByDeviceId.keys()) {
        const job = jobsByDeviceId.get(deviceId)
        if (
          job !== undefined &&
          !activeInitialJobs.has(job) &&
          !deviceQueue.includes(deviceId)
        ) {
          deviceQueue.push(deviceId)
        }
      }

      publishProgress()
      startDrain()
      scheduleAntiEntropy()
    },
    getProgress,
    suspend,
    reset: () => {
      suspend()
      // A reset is a hard mission boundary. Requests from the previous mission
      // may still be unresolved, but their concurrency slots must not prevent
      // the new mission from starting. `processJob`'s generation check still
      // discards any late result from those requests. Ordinary `suspend()`
      // deliberately retains this set so resuming the same mission cannot
      // duplicate an in-flight history window.
      activeInitialJobs.clear()
      jobsByDeviceId.clear()
      completedDevicesById.clear()
      failedDeviceIds.clear()
      antiEntropyFailedDeviceIds.clear()
      gapsByDeviceId.clear()
      lanesByDeviceId.clear()
      missionEpoch += 1
      initialCompletionWithheld = false
      deviceQueue.length = 0
      initialStartedAtMs = null
      antiEntropyStartedAtMs = null
    },
  }
}

/** Validates the entire acknowledgement before any cursor can move, including sparse arrays. */
function isValidChunkAcknowledgement(
  value: unknown,
  expectedLength: number,
): value is readonly PromiseSettledResult<void>[] {
  if (!Array.isArray(value) || value.length !== expectedLength) return false
  for (let index = 0; index < expectedLength; index += 1) {
    const result: unknown = value[index]
    if (result === null || typeof result !== 'object' || !('status' in result)) return false
    if (result.status === 'fulfilled') {
      if (!('value' in result) || result.value !== undefined) return false
    } else if (result.status === 'rejected') {
      if (!('reason' in result)) return false
    } else {
      return false
    }
  }
  return true
}

/** Readable message for logs and gap records. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Classifies a fetch failure a smaller window can fix: the proxy's size limit
 * or a timeout. Anything else (server error, network down, authentication)
 * returns null and is retried unchanged with backoff. Shared with the
 * participant history backfill.
 */
export function classifyHistoryWindowFailure(error: unknown): BreadcrumbHistoryGapReason | null {
  const message = describeError(error)
  if (/too large/iu.test(message)) {
    return 'oversized'
  }
  if (
    /timed?\s*out|timeout/iu.test(message) ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return 'slow'
  }
  return null
}

/** Adds a range to a sorted, merged range list. */
function addTimeRange(ranges: readonly TimeRange[], added: TimeRange): TimeRange[] {
  const merged: TimeRange[] = []
  let current = added
  for (const range of ranges) {
    if (range.toMs < current.fromMs || range.fromMs > current.toMs) {
      merged.push(range)
    } else {
      current = {
        fromMs: Math.min(range.fromMs, current.fromMs),
        toMs: Math.max(range.toMs, current.toMs),
      }
    }
  }
  merged.push(current)
  return merged.sort((left, right) => left.fromMs - right.fromMs)
}

/** Removes a range from a sorted, merged range list, splitting ranges it cuts. */
function removeTimeRange(ranges: readonly TimeRange[], removed: TimeRange): TimeRange[] {
  const remaining: TimeRange[] = []
  for (const range of ranges) {
    if (range.toMs <= removed.fromMs || range.fromMs >= removed.toMs) {
      remaining.push(range)
      continue
    }
    if (range.fromMs < removed.fromMs) remaining.push({ fromMs: range.fromMs, toMs: removed.fromMs })
    if (range.toMs > removed.toMs) remaining.push({ fromMs: removed.toMs, toMs: range.toMs })
  }
  return remaining
}

/** Publishes each device's queued re-check ranges, merged, as ISO ranges ordered by device then time. */
function publishRecheckBacklog(
  lanesByDeviceId: ReadonlyMap<string, DeviceLanes>,
): readonly BreadcrumbHistoryRecheckBacklog[] {
  return [...lanesByDeviceId.values()]
    .sort((left, right) => compareStringsByCodeUnit(left.deviceId, right.deviceId))
    .flatMap((lanes) => [...lanes.recent, ...lanes.older]
      .reduce<TimeRange[]>((merged, slice) => addTimeRange(merged, slice), [])
      .map((range) => ({
        deviceId: lanes.deviceId,
        deviceName: lanes.deviceName,
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.toMs).toISOString(),
      })))
}

/** The lane without the given range, order kept; a split slice keeps its place. */
function subtractFromLane(slices: readonly LaneSlice[], removed: TimeRange): LaneSlice[] {
  return slices.flatMap((slice) =>
    removeTimeRange([slice], removed).map((piece) => ({ ...piece, failedInTurn: slice.failedInTurn })))
}

/** Publishes gaps merged per device into contiguous ranges, ordered by device then time. */
function publishHistoryGaps(
  gapsByDeviceId: ReadonlyMap<string, readonly HistoryGapRecord[]>,
): readonly BreadcrumbHistoryGap[] {
  const published: BreadcrumbHistoryGap[] = []
  const deviceIds = [...gapsByDeviceId.keys()].sort(compareStringsByCodeUnit)
  for (const deviceId of deviceIds) {
    const records = [...(gapsByDeviceId.get(deviceId) ?? [])]
      .sort((left, right) => left.fromMs - right.fromMs)
    let current: {
      record: HistoryGapRecord
      fromMs: number
      toMs: number
      attempts: number
      lastError: string
      lastAttemptAtMs: number
    } | null = null
    const flush = (): void => {
      if (current === null) return
      published.push({
        deviceId,
        deviceName: current.record.deviceName,
        from: new Date(current.fromMs).toISOString(),
        to: new Date(current.toMs).toISOString(),
        reason: current.record.reason,
        phase: current.record.phase,
        attempts: current.attempts,
        lastError: current.lastError,
      })
    }
    for (const record of records) {
      if (current !== null && record.fromMs <= current.toMs) {
        current.toMs = Math.max(current.toMs, record.toMs)
        current.attempts = Math.max(current.attempts, record.attempts)
        if (record.lastAttemptAtMs >= current.lastAttemptAtMs) {
          current.lastError = record.lastError
          current.lastAttemptAtMs = record.lastAttemptAtMs
        }
        continue
      }
      flush()
      current = {
        record,
        fromMs: record.fromMs,
        toMs: record.toMs,
        attempts: record.attempts,
        lastError: record.lastError,
        lastAttemptAtMs: record.lastAttemptAtMs,
      }
    }
    flush()
  }
  return published
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 1
    ? Math.round(Number(value))
    : fallback
}

function countChunks(fromMs: number, toMs: number, chunkMs: number): number {
  return Math.max(0, Math.ceil(Math.max(0, toMs - fromMs) / chunkMs))
}

function resolveInitialHistoryRange(
  checkpoint: {
    readonly historyFrom: string
    readonly reconciledUntil: string
  } | undefined,
  missionStartMs: number,
  targetMs: number,
): { readonly historyFromMs: number; readonly cursorMs: number } {
  if (checkpoint === undefined) {
    return { historyFromMs: missionStartMs, cursorMs: missionStartMs }
  }
  const checkpointStartMs = Date.parse(checkpoint.historyFrom)
  const checkpointCursorMs = Date.parse(checkpoint.reconciledUntil)
  if (
    !Number.isFinite(checkpointStartMs) ||
    !Number.isFinite(checkpointCursorMs) ||
    checkpointStartMs < missionStartMs ||
    checkpointStartMs > targetMs ||
    checkpointCursorMs < checkpointStartMs ||
    checkpointCursorMs > targetMs
  ) {
    return { historyFromMs: missionStartMs, cursorMs: missionStartMs }
  }
  return { historyFromMs: checkpointStartMs, cursorMs: checkpointCursorMs }
}
