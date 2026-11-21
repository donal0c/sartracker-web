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
// Each anti-entropy tick retries at most this many recorded gaps per device.
const DEFAULT_GAP_RETRIES_PER_DEVICE_PER_TICK = 3
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
  readonly gapRetriesPerDevicePerTick?: number
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
  /** Where the next retry slice starts; rotates through the gap. */
  retryCursorMs: number
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
  /** Current re-check request width; halves on an oversized or slow reply. */
  sweepWindowMs: number
  sweepSuccessCount: number
  /**
   * Planned re-check ranges not yet re-read, merged and sorted. The pass
   * cursor moves when a range is planned; the range leaves the backlog only
   * when it commits or is recorded as a gap.
   */
  backlog: TimeRange[]
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
  const gapRetriesPerDevicePerTick = normalizePositiveInteger(
    options.gapRetriesPerDevicePerTick,
    DEFAULT_GAP_RETRIES_PER_DEVICE_PER_TICK,
  )
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
  // One admission lock per device for all re-check work (backlog windows and
  // gap slices), tagged by generation so a new mission never waits on an old
  // one's work.
  const deviceWorkInFlight = new Map<string, number>()
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
            device.antiEntropyCursorMs <= device.missionStartMs && device.backlog.length === 0,
        ).length
    const noGaps = gapsByDeviceId.size === 0
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
      recheckBacklog: publishRecheckBacklog(completedDevices),
      // DON-338 review: a gapped history is never reported complete.
      complete:
        noGaps &&
        (phase === 'initial'
          ? pendingJobs.length === 0
          : completedDeviceCount === totalDeviceCount),
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
      sweepWindowMs: chunkMs,
      sweepSuccessCount: 0,
      backlog: [],
    })
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
    gap: Omit<HistoryGapRecord, 'attempts' | 'lastAttemptAtMs' | 'lastError' | 'retryCursorMs'>,
    attempts: number,
    error: unknown,
  ): void => {
    const lastError = describeError(error)
    const nowMs = Date.now()
    const gaps = gapsByDeviceId.get(gap.deviceId) ?? []
    const touching = gaps.filter((record) => record.fromMs <= gap.toMs && record.toMs >= gap.fromMs)
    const merged: HistoryGapRecord = touching[0] ?? { ...gap, attempts: 0, lastError, lastAttemptAtMs: nowMs, retryCursorMs: gap.fromMs }
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
      positions = await options.fetchBreadcrumbs(
        job.deviceId,
        new Date(fromMs),
        new Date(toMs),
      )
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
      const positions = await options.fetchBreadcrumbs(
        job.deviceId,
        new Date(fromMs),
        new Date(toMs),
      )
      if (!isCurrentJob(job, drainGeneration)) {
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
        if (deviceWorkInFlight.get(deviceId) === generation) {
          // A re-check of this device is still running (its history range just
          // grew); its task restarts the drain when it releases the device.
          deviceQueue.push(deviceId)
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
      (completedDevicesById.size === 0 && gapsByDeviceId.size === 0) ||
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

  const isCurrentCompletedDevice = (
    device: CompletedDeviceReconciliation,
    batchGeneration: number,
  ): boolean =>
    batchGeneration === generation &&
    options.shouldContinue() &&
    completedDevicesById.get(device.deviceId) === device

  /** Backlog ranges inside [fromMs, toMs), clipped to it. */
  const backlogWithin = (
    device: CompletedDeviceReconciliation,
    fromMs: number,
    toMs: number,
  ): TimeRange[] =>
    device.backlog
      .filter((range) => range.toMs > fromMs && range.fromMs < toMs)
      .map((range) => ({ fromMs: Math.max(range.fromMs, fromMs), toMs: Math.min(range.toMs, toMs) }))

  /**
   * Plans one device's tick. The recent window is planned every tick, because
   * that is where late uploads land. The next older chunks of the pass are
   * planned only once the older backlog is empty, so unfinished older work is
   * never overtaken by a new pass. Returns the recent window's floor.
   */
  const planAntiEntropyTick = (device: CompletedDeviceReconciliation): number => {
    const recentTopMs = device.latestAvailableTargetMs
    const recentFloorMs = Math.max(
      device.missionStartMs,
      recentTopMs - antiEntropyRecentWindowMs,
    )
    if (recentTopMs > recentFloorMs) {
      device.backlog = addTimeRange(device.backlog, { fromMs: recentFloorMs, toMs: recentTopMs })
    }
    if (backlogWithin(device, device.missionStartMs, recentFloorMs).length > 0) {
      return recentFloorMs
    }
    if (device.antiEntropyCursorMs <= device.missionStartMs) {
      device.antiEntropyTargetMs = device.latestAvailableTargetMs
      device.antiEntropyCursorMs = device.antiEntropyTargetMs
    }
    const olderTopMs = Math.min(device.antiEntropyCursorMs, recentFloorMs)
    const olderFloorMs = Math.max(
      device.missionStartMs,
      olderTopMs - antiEntropyOlderChunksPerTick * chunkMs,
    )
    if (olderTopMs > olderFloorMs) {
      device.backlog = addTimeRange(device.backlog, { fromMs: olderFloorMs, toMs: olderTopMs })
    }
    device.antiEntropyCursorMs = Math.min(device.antiEntropyCursorMs, olderFloorMs)
    return recentFloorMs
  }

  /** Requests one device may make in one tick: twice its normal plan at its current width, with a floor. */
  const antiEntropyRequestBudget = (device: CompletedDeviceReconciliation): number =>
    Math.max(
      MIN_ANTI_ENTROPY_REQUESTS_PER_DEVICE_PER_TICK,
      2 * Math.ceil(
        (antiEntropyRecentWindowMs + antiEntropyOlderChunksPerTick * chunkMs) / device.sweepWindowMs,
      ),
    )

  /** The outcome of one re-check request for the device's work loop. */
  type SweepRequestOutcome = 'done' | 'narrowed' | 'stop'

  /**
   * Fetches and commits one backlog window. An oversized or slow reply
   * halves the device's window; at the smallest width the window is recorded
   * as a gap and leaves the backlog. Any other failure, including a
   * persistence failure, names the device as failed and stops its tick.
   */
  const sweepBacklogWindow = async (
    device: CompletedDeviceReconciliation,
    window: TimeRange,
    batchGeneration: number,
  ): Promise<SweepRequestOutcome> => {
    let positions: readonly NormalizedTrackingPosition[]
    try {
      positions = await options.fetchBreadcrumbs(
        device.deviceId,
        new Date(window.fromMs),
        new Date(window.toMs),
      )
    } catch (error) {
      if (!isCurrentCompletedDevice(device, batchGeneration)) return 'stop'
      const reason = classifyHistoryWindowFailure(error)
      if (reason === null) {
        markAntiEntropyFailed(device, error)
        return 'stop'
      }
      device.sweepSuccessCount = 0
      const widthMs = window.toMs - window.fromMs
      if (widthMs > minWindowMs) {
        device.sweepWindowMs = Math.max(minWindowMs, Math.floor(widthMs / 2))
        return 'narrowed'
      }
      recordHistoryGap({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        historyFromMs: device.missionStartMs,
        fromMs: window.fromMs,
        toMs: window.toMs,
        phase: 'anti_entropy',
        reason,
      }, 1, error)
      device.backlog = removeTimeRange(device.backlog, window)
      return 'done'
    }
    if (!isCurrentCompletedDevice(device, batchGeneration)) return 'stop'
    try {
      await options.onChunk({
        phase: 'anti_entropy',
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        historyFrom: new Date(device.missionStartMs),
        from: new Date(window.fromMs),
        to: new Date(window.toMs),
        positions,
      })
    } catch (error) {
      if (isCurrentCompletedDevice(device, batchGeneration)) markAntiEntropyFailed(device, error)
      return 'stop'
    }
    if (!isCurrentCompletedDevice(device, batchGeneration)) return 'stop'
    device.backlog = removeTimeRange(device.backlog, window)
    clearHistoryGapsCoveredBy(device.deviceId, window.fromMs, window.toMs)
    device.sweepSuccessCount += 1
    if (
      device.sweepWindowMs < chunkMs &&
      device.sweepSuccessCount >= WINDOW_GROWTH_SUCCESS_COUNT
    ) {
      device.sweepWindowMs = Math.min(chunkMs, device.sweepWindowMs * 2)
      device.sweepSuccessCount = 0
    }
    return 'done'
  }

  /**
   * One device's work for one tick, run under its single admission lock so
   * the device never has more than one request in flight. All of it counts
   * against one request budget and one time budget, in this order:
   *
   * 1. The recent window, newest first, using at most half of each budget.
   * 2. The oldest outstanding backlog, oldest first. It always gets at least
   *    one request, even when the time budget is spent.
   * 3. Gap slices in rotation, up to the per-tick retry limit. They also get
   *    at least one request when a gap is open.
   *
   * Fairness bound: let c be the older history this device re-reads per tick
   * (at least one window), and P = olderChunksPerTick x chunk the span one
   * pass plans at a time. A new span is planned only when the older backlog
   * is empty, so a pass over H hours of older history takes at most
   * ceil(H / P) x ceil(P / c) ticks, and every range is re-checked within two
   * passes. Gap slices rotate, so each slice of a gap of S slices is retried
   * within ceil(S / retriesPerTick) ticks. Stage 2 and 3 minimums may run a
   * device past its time budget by at most two requests.
   */
  const runDeviceTick = async (
    device: CompletedDeviceReconciliation,
    batchGeneration: number,
  ): Promise<void> => {
    const recentFloorMs = planAntiEntropyTick(device)
    const startedAtMs = Date.now()
    let requestBudget = antiEntropyRequestBudget(device)
    let requestCount = 0
    const elapsedMs = (): number => Date.now() - startedAtMs
    const withinBudget = (): boolean =>
      requestCount < requestBudget && elapsedMs() < antiEntropyDeviceTimeBudgetMs
    let stopped = false
    const sweep = async (window: TimeRange): Promise<void> => {
      requestCount += 1
      const outcome = await sweepBacklogWindow(device, window, batchGeneration)
      if (outcome === 'stop') stopped = true
      if (outcome === 'narrowed') {
        // Narrower windows need more requests to cover the same plan; the time budget still bounds a slow device.
        requestBudget = Math.max(requestBudget, antiEntropyRequestBudget(device))
      }
    }

    // 1. Recent window, newest first, within half of each budget.
    while (!stopped) {
      const newest = backlogWithin(device, recentFloorMs, Number.POSITIVE_INFINITY).at(-1)
      if (
        newest === undefined ||
        requestCount >= Math.ceil(requestBudget / 2) ||
        elapsedMs() >= antiEntropyDeviceTimeBudgetMs / 2
      ) break
      await sweep({ fromMs: Math.max(newest.fromMs, newest.toMs - device.sweepWindowMs), toMs: newest.toMs })
    }

    // 2. Oldest outstanding backlog first; at least one request every tick.
    const gapsOpen = (): boolean => (gapsByDeviceId.get(device.deviceId)?.length ?? 0) > 0
    let olderRequests = 0
    while (!stopped) {
      const oldest = device.backlog[0]
      if (oldest === undefined) break
      const reserveForGaps = gapsOpen() ? 1 : 0
      if (olderRequests > 0 && (!withinBudget() || requestCount + reserveForGaps >= requestBudget)) break
      olderRequests += 1
      await sweep({ fromMs: oldest.fromMs, toMs: Math.min(oldest.toMs, oldest.fromMs + device.sweepWindowMs) })
    }

    // 3. Gap slices in rotation; at least one when a gap is open.
    let gapRequests = 0
    while (!stopped && gapRequests < gapRetriesPerDevicePerTick && isCurrentCompletedDevice(device, batchGeneration)) {
      const gap = [...(gapsByDeviceId.get(device.deviceId) ?? [])]
        .sort((left, right) => left.lastAttemptAtMs - right.lastAttemptAtMs || left.fromMs - right.fromMs)[0]
      if (gap === undefined) break
      if (gapRequests > 0 && !withinBudget()) break
      gapRequests += 1
      requestCount += 1
      await retryHistoryGapSlice(gap, batchGeneration)
    }

    if (!isCurrentCompletedDevice(device, batchGeneration)) return
    if (device.backlog.length > 0) {
      options.logger.warn('Tracking breadcrumb re-check budget used up for device; resuming next tick.', {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        requestCount,
        elapsedMs: elapsedMs(),
        backlogFrom: new Date(device.backlog[0]!.fromMs).toISOString(),
        backlogTo: new Date(device.backlog.at(-1)!.toMs).toISOString(),
      })
    }
    if (!stopped && device.backlog.length === 0) antiEntropyFailedDeviceIds.delete(device.deviceId)
  }

  /** Names a device whose re-check failed for a reason a smaller window cannot fix. */
  const markAntiEntropyFailed = (
    device: CompletedDeviceReconciliation,
    error: unknown,
  ): void => {
    options.logger.warn('Tracking breadcrumb anti-entropy check failed for device.', {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      retryDelayMs: antiEntropyIntervalMs,
      error: describeError(error),
    })
    antiEntropyFailedDeviceIds.add(device.deviceId)
  }

  /** True while this gap is still recorded and the batch belongs to the current mission. */
  const isCurrentGap = (gap: HistoryGapRecord, batchGeneration: number): boolean =>
    batchGeneration === generation &&
    options.shouldContinue() &&
    (gapsByDeviceId.get(gap.deviceId)?.includes(gap) ?? false)

  /**
   * Retries the gap's next smallest-width slice at its rotating cursor, so a
   * still-failing slice never blocks the rest of the gap. Success fills that
   * slice; failure keeps the whole gap reported and moves the cursor on.
   */
  const retryHistoryGapSlice = async (
    gap: HistoryGapRecord,
    batchGeneration: number,
  ): Promise<void> => {
    if (!isCurrentGap(gap, batchGeneration)) {
      return
    }
    const fromMs = gap.retryCursorMs >= gap.fromMs && gap.retryCursorMs < gap.toMs
      ? gap.retryCursorMs
      : gap.fromMs
    const toMs = Math.min(gap.toMs, fromMs + minWindowMs)
    gap.retryCursorMs = toMs >= gap.toMs ? gap.fromMs : toMs
    const { deviceId, deviceName, historyFromMs } = gap
    gap.lastAttemptAtMs = Date.now()
    const isCurrent = (): boolean => batchGeneration === generation && options.shouldContinue()
    try {
      const positions = await options.fetchBreadcrumbs(deviceId, new Date(fromMs), new Date(toMs))
      if (!isCurrent()) {
        return
      }
      await options.onChunk({
        phase: 'anti_entropy',
        deviceId,
        deviceName,
        historyFrom: new Date(historyFromMs),
        from: new Date(fromMs),
        to: new Date(toMs),
        positions,
      })
      if (!isCurrent()) {
        return
      }
      clearHistoryGapsCoveredBy(deviceId, fromMs, toMs)
    } catch (error) {
      if (!isCurrentGap(gap, batchGeneration)) {
        return
      }
      gap.attempts += 1
      gap.lastError = describeError(error)
      gap.reason = classifyHistoryWindowFailure(error) ?? gap.reason
      options.logger.warn('Tracking breadcrumb history gap is still unfetchable.', {
        deviceId,
        deviceName,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        attempts: gap.attempts,
        retryDelayMs: antiEntropyIntervalMs,
        error: gap.lastError,
      })
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
   * starts, so a slow device never delays the others. Each device's work for
   * the tick is one task under its admission lock; a device whose previous
   * task is still queued or running is skipped [DON-338 ING-1 and review].
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

    const devices = [...completedDevicesById.values()]
      .sort((left, right) => compareStringsByCodeUnit(left.deviceId, right.deviceId))
      .filter((device) => deviceWorkInFlight.get(device.deviceId) !== batchGeneration)
    await Promise.all(devices.map((device) => {
      deviceWorkInFlight.set(device.deviceId, batchGeneration)
      return enqueueAntiEntropyTask(async () => {
        try {
          if (isCurrentCompletedDevice(device, batchGeneration)) {
            await runDeviceTick(device, batchGeneration)
          }
        } finally {
          if (deviceWorkInFlight.get(device.deviceId) === batchGeneration) {
            deviceWorkInFlight.delete(device.deviceId)
          }
          if (batchGeneration === generation) {
            publishWithheldInitialCompletion()
            if (jobsByDeviceId.has(device.deviceId)) startDrain()
          }
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
            sweepWindowMs: chunkMs,
            sweepSuccessCount: 0,
            backlog: [],
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

/** Publishes each device's re-check backlog as ISO ranges, ordered by device then time. */
function publishRecheckBacklog(
  devices: readonly CompletedDeviceReconciliation[],
): readonly BreadcrumbHistoryRecheckBacklog[] {
  return [...devices]
    .sort((left, right) => compareStringsByCodeUnit(left.deviceId, right.deviceId))
    .flatMap((device) => device.backlog.map((range) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      from: new Date(range.fromMs).toISOString(),
      to: new Date(range.toMs).toISOString(),
    })))
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
