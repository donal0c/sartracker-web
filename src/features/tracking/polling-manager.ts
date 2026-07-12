import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import { createBreadcrumbAccumulator } from './breadcrumb-accumulator'
import { annotateTrackingSnapshotHealth } from './tracking-snapshot-health'
import type {
  TrackingBreadcrumbWindowSummary,
  TrackingPollLedgerEntry,
  TrackingPollPhase,
} from '../diagnostics/tracking-poll-ledger'
import { classifyTrackingFailure } from '../diagnostics/tracking-poll-ledger'

const EMPTY_TRACKING_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
}

export type TrackingPollerClient = {
  readonly authenticate: () => Promise<void>
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getCurrentPositions: () => Promise<readonly NormalizedTrackingPosition[]>
  readonly getBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
}

type PollingManagerLogger = {
  readonly warn: (message: string, context: Record<string, unknown>) => void
}

type PollingManagerOptions = {
  readonly intervalMs: number
  readonly minimumIntervalMs?: number
  readonly staleThresholdMs: number
  readonly retryBaseMs?: number
  readonly maxBackoffMs?: number
  readonly getPollingMode?: () => 'active' | 'paused' | 'idle'
  readonly getHistoryResetKey?: () => string | null
  readonly getInitialBreadcrumbFrom?: () => Date | null
  readonly getInitialBreadcrumbs?: () => Promise<readonly NormalizedTrackingPosition[]>
  readonly getBreadcrumbDeviceIds?: () => readonly string[] | null
  readonly onSnapshot: (snapshot: TrackingSnapshot) => void
  readonly onStatusChange: (status: TrackingConnectionStatus) => void
  readonly onPollDiagnostic?: (entry: TrackingPollLedgerEntry) => void
  readonly logger?: PollingManagerLogger
  readonly now?: () => Date
  readonly setTimeout?: typeof window.setTimeout
  readonly clearTimeout?: typeof window.clearTimeout
}

const DEFAULT_MAX_BACKOFF_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 30_000
const MIN_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 3_600_000
const BREADCRUMB_CURSOR_OVERLAP_MS = 5 * 60 * 1000

const DEFAULT_LOGGER: PollingManagerLogger = {
  warn: (message, context) => {
    console.warn(message, context)
  },
}

type PollingManager = {
  readonly start: () => void
  readonly stop: () => void
}

/**
 * Creates the tracking polling manager with retry and last-good snapshot support.
 */
export function createPollingManager(
  client: TrackingPollerClient,
  options: PollingManagerOptions,
): PollingManager {
  const now = options.now ?? (() => new Date())
  const scheduleTimeout = options.setTimeout ?? window.setTimeout.bind(window)
  const clearScheduledTimeout = options.clearTimeout ?? window.clearTimeout.bind(window)
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  const pollIntervalMs = normalizePollingIntervalMs(
    options.intervalMs,
    options.minimumIntervalMs,
  )
  const logger = options.logger ?? DEFAULT_LOGGER

  let authenticated = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let consecutiveFailures = 0
  let lastGoodSnapshot: TrackingSnapshot | null = null
  let lastSuccessAt: string | null = null
  let firstFailureAt: string | null = null
  const breadcrumbAccumulator = createBreadcrumbAccumulator()
  let breadcrumbPositions: readonly NormalizedTrackingPosition[] = []
  let breadcrumbMetadata: TrackingSnapshot['breadcrumbMetadata'] | undefined = undefined
  let activeHistoryResetKey: string | null = null
  let initialBreadcrumbsLoaded = false
  const latestBreadcrumbTimestampByDevice = new Map<string, string>()

  const publishStatus = (overrides: Partial<TrackingConnectionStatus> = {}) => {
    options.onStatusChange({
      mode: 'idle',
      consecutiveFailures,
      recovered: false,
      lastSuccessAt,
      warning: null,
      ...overrides,
    })
  }

  const scheduleNextPoll = (delayMs: number) => {
    if (!running) {
      return
    }

    timer = scheduleTimeout(() => {
      void poll()
    }, delayMs)
  }

  const authenticateIfNeeded = async () => {
    if (authenticated) {
      return
    }

    await client.authenticate()
    authenticated = true
  }

  const poll = async () => {
    const pollStartedAt = now().toISOString()
    let pollPhase: TrackingPollPhase = 'authentication'
    try {
      const nextHistoryResetKey = options.getHistoryResetKey?.() ?? null
      if (nextHistoryResetKey !== activeHistoryResetKey) {
        activeHistoryResetKey = nextHistoryResetKey
        breadcrumbAccumulator.reset()
        breadcrumbPositions = []
        breadcrumbMetadata = undefined
        initialBreadcrumbsLoaded = false
        latestBreadcrumbTimestampByDevice.clear()
        lastGoodSnapshot = null
      }

      const pollingMode = options.getPollingMode?.() ?? 'active'
      if (pollingMode !== 'active') {
        if (pollingMode === 'paused' && lastGoodSnapshot !== null) {
          options.onSnapshot(
            annotateTrackingSnapshotHealth(lastGoodSnapshot, {
              now: now(),
              deviceStaleThresholdMs: options.staleThresholdMs,
            }),
          )
        } else if (pollingMode === 'idle') {
          options.onSnapshot(EMPTY_TRACKING_SNAPSHOT)
        }

        publishStatus({
          mode: 'idle',
          warning:
            pollingMode === 'paused'
              ? 'Live refresh suspended while mission is paused.'
              : 'Waiting for an active mission.',
        })
        scheduleNextPoll(pollIntervalMs)
        return
      }

      await withPollPhase('authentication', authenticateIfNeeded())

      pollPhase = 'devices'
      const [devices, positions] = await Promise.all([
        withPollPhase('devices', client.getDevices()),
        withPollPhase('current_positions', client.getCurrentPositions()),
      ])

      const currentPollingMode = options.getPollingMode?.() ?? 'active'
      if (currentPollingMode !== 'active') {
        publishInactiveMissionSnapshot(currentPollingMode)
        scheduleNextPoll(pollIntervalMs)
        return
      }

      const seedState = await seedInitialBreadcrumbs()

      const recovered = consecutiveFailures > 0
      consecutiveFailures = 0
      lastSuccessAt = now().toISOString()

      const currentSnapshot = {
        devices,
        positions,
        breadcrumbs: breadcrumbPositions,
        breadcrumbMetadata,
      }
      lastGoodSnapshot = currentSnapshot
      options.onSnapshot(
        annotateTrackingSnapshotHealth(currentSnapshot, {
          now: now(),
          deviceStaleThresholdMs: options.staleThresholdMs,
        }),
      )
      publishStatus({
        mode: 'online',
        recovered,
        warning:
          breadcrumbPositions.length === 0
            ? 'Current fixes loaded; loading breadcrumb history.'
            : recovered
              ? 'CONNECTION RESTORED'
              : null,
      })

      pollPhase = 'breadcrumbs'
      const breadcrumbFetch = await fetchIncrementalBreadcrumbs(devices, seedState)
      const previousBreadcrumbPositions = breadcrumbPositions
      const previousObservedCount = breadcrumbMetadata?.totalObserved ?? 0
      const breadcrumbResult = breadcrumbAccumulator.append(breadcrumbFetch.positions)
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata
      const acceptedBreadcrumbCount = Math.max(
        0,
        breadcrumbResult.metadata.totalObserved - previousObservedCount,
      )

      const rawSnapshot = {
        devices,
        positions,
        breadcrumbs: breadcrumbPositions,
        rawBreadcrumbsForPersistence: breadcrumbFetch.positions,
        breadcrumbMetadata,
      }
      const latestPollingMode = options.getPollingMode?.() ?? 'active'
      if (latestPollingMode !== 'active') {
        publishInactiveMissionSnapshot(latestPollingMode)
        scheduleNextPoll(pollIntervalMs)
        return
      }

      lastGoodSnapshot = rawSnapshot

      if (breadcrumbPositions !== previousBreadcrumbPositions) {
        options.onSnapshot(
          annotateTrackingSnapshotHealth(rawSnapshot, {
            now: now(),
            deviceStaleThresholdMs: options.staleThresholdMs,
          }),
        )
        publishStatus({
          mode: 'online',
          recovered,
          warning: recovered ? 'CONNECTION RESTORED' : null,
        })
      }

      const completedAt = now().toISOString()
      options.onPollDiagnostic?.({
        ts: completedAt,
        kind: 'poll_cycle',
        outcome: recovered ? 'recovered' : 'success',
        phase: 'breadcrumbs',
        durationMs: calculateDurationMs(pollStartedAt, completedAt),
        consecutiveFailures: 0,
        retryDelayMs: pollIntervalMs,
        ...(recovered && firstFailureAt !== null
          ? { outageDurationMs: calculateDurationMs(firstFailureAt, completedAt) }
          : {}),
        deviceCount: devices.length,
        currentPositionCount: positions.length,
        breadcrumbRequestedDeviceCount: breadcrumbFetch.requestedDeviceCount,
        breadcrumbReturnedCount: breadcrumbFetch.positions.length,
        breadcrumbAcceptedCount: acceptedBreadcrumbCount,
        breadcrumbDuplicateCount: Math.max(
          0,
          breadcrumbFetch.positions.length - acceptedBreadcrumbCount,
        ),
        breadcrumbFailedDeviceCount: breadcrumbFetch.failedDeviceCount,
        ...(breadcrumbFetch.window === null
          ? {}
          : { breadcrumbWindow: breadcrumbFetch.window }),
      })
      firstFailureAt = null

      scheduleNextPoll(pollIntervalMs)
    } catch (error) {
      consecutiveFailures += 1
      const completedAt = now().toISOString()
      const failure = unwrapPollPhaseError(error, pollPhase)
      if (firstFailureAt === null) {
        firstFailureAt = pollStartedAt
      }
      if (isAuthenticationFailure(failure.cause)) {
        authenticated = false
      }

      if (lastGoodSnapshot !== null) {
        options.onSnapshot(
          annotateTrackingSnapshotHealth(lastGoodSnapshot, {
            now: now(),
            deviceStaleThresholdMs: options.staleThresholdMs,
          }),
        )
      }

      publishStatus({
        mode: 'offline',
        warning: isAuthenticationFailure(failure.cause)
          ? 'TRACKING AUTHENTICATION FAILED — check Traccar credentials.'
          : 'OFFLINE MODE — showing last known positions.',
      })

      const unboundedDelay = (options.retryBaseMs ?? 1_000) * 2 ** (consecutiveFailures - 1)
      const backoffDelay = Math.min(unboundedDelay, maxBackoffMs)
      options.onPollDiagnostic?.({
        ts: completedAt,
        kind: 'poll_cycle',
        outcome: 'failure',
        phase: failure.phase,
        durationMs: calculateDurationMs(pollStartedAt, completedAt),
        consecutiveFailures,
        retryDelayMs: backoffDelay,
        failureKind: classifyTrackingFailure(failure.cause),
      })
      scheduleNextPoll(backoffDelay)
    }
  }

  function publishInactiveMissionSnapshot(pollingMode: 'paused' | 'idle'): void {
    if (pollingMode === 'paused' && lastGoodSnapshot !== null) {
      options.onSnapshot(
        annotateTrackingSnapshotHealth(lastGoodSnapshot, {
          now: now(),
          deviceStaleThresholdMs: options.staleThresholdMs,
        }),
      )
    } else if (pollingMode === 'idle') {
      options.onSnapshot(EMPTY_TRACKING_SNAPSHOT)
    }

    publishStatus({
      mode: 'idle',
      warning:
        pollingMode === 'paused'
          ? 'Live refresh suspended while mission is paused.'
          : 'Waiting for an active mission.',
    })
  }

  return {
    start: () => {
      if (running) {
        return
      }

      running = true
      void poll()
    },
    stop: () => {
      running = false
      if (timer !== null) {
        clearScheduledTimeout(timer)
        timer = null
      }
    },
  }

  async function fetchIncrementalBreadcrumbs(
    devices: readonly NormalizedTrackingDevice[],
    seedState: InitialBreadcrumbSeedState,
  ): Promise<BreadcrumbFetchResult> {
    if (seedState === 'failed') {
      return { positions: [], requestedDeviceCount: 0, failedDeviceCount: 0, window: null }
    }

    const fetchUntil = now()
    const requestedDeviceIds = options.getBreadcrumbDeviceIds?.() ?? null
    const requestedDeviceIdSet =
      requestedDeviceIds === null || requestedDeviceIds.length === 0
        ? null
        : new Set(requestedDeviceIds)
    const breadcrumbDevices =
      requestedDeviceIdSet === null
        ? devices
        : devices.filter((device) => requestedDeviceIdSet.has(device.device_id))

    const settled = await Promise.allSettled(
      breadcrumbDevices.map(async (device) => {
        const lastTimestamp = latestBreadcrumbTimestampByDevice.get(device.device_id)
        const fetchFrom =
          lastTimestamp === undefined
            ? (options.getInitialBreadcrumbFrom?.() ??
              new Date(fetchUntil.getTime() - 3 * 60 * 60 * 1000))
            : createOverlappedFetchFrom(
                lastTimestamp,
                fetchUntil,
                options.getInitialBreadcrumbFrom?.() ?? null,
              )

        const breadcrumbs = await client.getBreadcrumbs(device.device_id, fetchFrom, fetchUntil)
        const newestTimestamp = getCursorTimestampFromBatch(breadcrumbs, fetchUntil)
        if (newestTimestamp !== null) {
          latestBreadcrumbTimestampByDevice.set(device.device_id, newestTimestamp)
        }

        return {
          breadcrumbs,
          previousCursor: lastTimestamp ?? null,
          requestedFrom: fetchFrom.toISOString(),
          requestedTo: fetchUntil.toISOString(),
          newestReturned: newestTimestamp,
        }
      }),
    )

    const aggregated: NormalizedTrackingPosition[] = []
    let failedDeviceCount = 0
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      if (result === undefined) {
        continue
      }
      if (result.status === 'fulfilled') {
        aggregated.push(...result.value.breadcrumbs)
        continue
      }

      const failedDevice = breadcrumbDevices[index]
      failedDeviceCount += 1
      logger.warn('Tracking breadcrumb fetch failed for device.', {
        deviceId: failedDevice?.device_id ?? null,
        deviceName: failedDevice?.name ?? null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }

    return {
      positions: aggregated,
      requestedDeviceCount: breadcrumbDevices.length,
      failedDeviceCount,
      window: summarizeBreadcrumbWindows(
        settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      ),
    }
  }

  async function seedInitialBreadcrumbs(): Promise<InitialBreadcrumbSeedState> {
    if (
      initialBreadcrumbsLoaded ||
      options.getInitialBreadcrumbs === undefined
    ) {
      return 'loaded'
    }

    try {
      const persistedBreadcrumbs = await options.getInitialBreadcrumbs()
      const breadcrumbResult = breadcrumbAccumulator.append(persistedBreadcrumbs)
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata
      seedLatestBreadcrumbTimestamps(persistedBreadcrumbs)
      initialBreadcrumbsLoaded = true
      return 'loaded'
    } catch (error) {
      logger.warn('Tracking breadcrumb cursor load failed.', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 'failed'
    }
  }

  function seedLatestBreadcrumbTimestamps(
    breadcrumbs: readonly NormalizedTrackingPosition[],
  ): void {
    for (const breadcrumb of breadcrumbs) {
      const timestampMs = Date.parse(breadcrumb.timestamp)
      if (Number.isNaN(timestampMs)) {
        continue
      }

      const existingTimestamp = latestBreadcrumbTimestampByDevice.get(breadcrumb.device_id)
      if (existingTimestamp === undefined || timestampMs > Date.parse(existingTimestamp)) {
        latestBreadcrumbTimestampByDevice.set(breadcrumb.device_id, breadcrumb.timestamp)
      }
    }
  }
}

type InitialBreadcrumbSeedState = 'loaded' | 'failed'

type BreadcrumbFetchResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly requestedDeviceCount: number
  readonly failedDeviceCount: number
  readonly window: TrackingBreadcrumbWindowSummary | null
}

type BreadcrumbDeviceWindow = {
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
  readonly previousCursor: string | null
  readonly requestedFrom: string
  readonly requestedTo: string
  readonly newestReturned: string | null
}

function summarizeBreadcrumbWindows(
  windows: readonly BreadcrumbDeviceWindow[],
): TrackingBreadcrumbWindowSummary | null {
  if (windows.length === 0) {
    return null
  }
  const previousCursors = windows.flatMap((window) =>
    window.previousCursor === null ? [] : [window.previousCursor],
  )
  const newestReturned = windows.flatMap((window) =>
    window.newestReturned === null ? [] : [window.newestReturned],
  )
  return {
    requestedFromEarliest: findTimestampBoundary(windows.map((window) => window.requestedFrom), 'min'),
    requestedFromLatest: findTimestampBoundary(windows.map((window) => window.requestedFrom), 'max'),
    requestedTo: findTimestampBoundary(windows.map((window) => window.requestedTo), 'max'),
    ...(previousCursors.length === 0
      ? {}
      : {
          previousCursorEarliest: findTimestampBoundary(previousCursors, 'min'),
          previousCursorLatest: findTimestampBoundary(previousCursors, 'max'),
        }),
    ...(newestReturned.length === 0
      ? {}
      : {
          newestReturnedEarliest: findTimestampBoundary(newestReturned, 'min'),
          newestReturnedLatest: findTimestampBoundary(newestReturned, 'max'),
        }),
  }
}

function findTimestampBoundary(
  timestamps: readonly string[],
  boundary: 'min' | 'max',
): string {
  return timestamps.reduce((selected, timestamp) =>
    boundary === 'min'
      ? (Date.parse(timestamp) < Date.parse(selected) ? timestamp : selected)
      : (Date.parse(timestamp) > Date.parse(selected) ? timestamp : selected),
  )
}

class PollPhaseError extends Error {
  readonly phase: TrackingPollPhase
  override readonly cause: unknown

  constructor(phase: TrackingPollPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Tracking poll phase failed.')
    this.name = cause instanceof Error ? cause.name : 'PollPhaseError'
    this.phase = phase
    this.cause = cause
  }
}

async function withPollPhase<T>(phase: TrackingPollPhase, operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } catch (error) {
    throw new PollPhaseError(phase, error)
  }
}

function unwrapPollPhaseError(
  error: unknown,
  fallbackPhase: TrackingPollPhase,
): { readonly phase: TrackingPollPhase; readonly cause: unknown } {
  return error instanceof PollPhaseError
    ? { phase: error.phase, cause: error.cause }
    : { phase: fallbackPhase, cause: error }
}

function calculateDurationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
}

function createOverlappedFetchFrom(
  lastTimestamp: string,
  fetchUntil: Date,
  lowerBound: Date | null,
): Date {
  const lastTimestampMs = Date.parse(lastTimestamp)
  const fetchUntilMs = fetchUntil.getTime()
  const boundedCursorMs = Number.isNaN(lastTimestampMs)
    ? fetchUntilMs
    : Math.min(lastTimestampMs, fetchUntilMs)
  const overlappedMs = boundedCursorMs - BREADCRUMB_CURSOR_OVERLAP_MS
  const lowerBoundMs = lowerBound?.getTime()
  const fetchFromMs =
    lowerBoundMs === undefined ? overlappedMs : Math.max(lowerBoundMs, overlappedMs)

  return new Date(Math.min(fetchFromMs, fetchUntilMs))
}

function getCursorTimestampFromBatch(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  fetchUntil: Date,
): string | null {
  let newestTimestampMs: number | null = null
  const fetchUntilMs = fetchUntil.getTime()

  for (const breadcrumb of breadcrumbs) {
    const timestampMs = Date.parse(breadcrumb.timestamp)
    if (Number.isNaN(timestampMs)) {
      continue
    }

    const boundedTimestampMs = Math.min(timestampMs, fetchUntilMs)
    if (newestTimestampMs === null || boundedTimestampMs > newestTimestampMs) {
      newestTimestampMs = boundedTimestampMs
    }
  }

  return newestTimestampMs === null ? null : new Date(newestTimestampMs).toISOString()
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (
      error.name === 'TraccarAuthenticationError' ||
      /Authentication failed|HTTP 401|HTTP 403/i.test(error.message)
    )
  )
}

/**
 * Clamps persisted/runtime polling intervals before they reach browser timers.
 */
function normalizePollingIntervalMs(input: number, minimumInput?: number): number {
  if (!Number.isFinite(input)) {
    return DEFAULT_POLL_INTERVAL_MS
  }

  const minimumIntervalMs =
    Number.isFinite(minimumInput) && Number(minimumInput) >= 1
      ? Math.min(MIN_POLL_INTERVAL_MS, Math.round(Number(minimumInput)))
      : MIN_POLL_INTERVAL_MS
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(minimumIntervalMs, input))
}
