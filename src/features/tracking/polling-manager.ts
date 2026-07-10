import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import { createBreadcrumbAccumulator } from './breadcrumb-accumulator'
import { annotateTrackingSnapshotHealth } from './tracking-snapshot-health'

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

      await authenticateIfNeeded()

      const [devices, positions] = await Promise.all([
        client.getDevices(),
        client.getCurrentPositions(),
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

      const breadcrumbs = await fetchIncrementalBreadcrumbs(devices, seedState)
      const previousBreadcrumbPositions = breadcrumbPositions
      const breadcrumbResult = breadcrumbAccumulator.append(breadcrumbs)
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata

      const rawSnapshot = {
        devices,
        positions,
        breadcrumbs: breadcrumbPositions,
        rawBreadcrumbsForPersistence: breadcrumbs,
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

      scheduleNextPoll(pollIntervalMs)
    } catch (error) {
      consecutiveFailures += 1
      if (isAuthenticationFailure(error)) {
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
        warning: isAuthenticationFailure(error)
          ? 'TRACKING AUTHENTICATION FAILED — check Traccar credentials.'
          : 'OFFLINE MODE — showing last known positions.',
      })

      const unboundedDelay = (options.retryBaseMs ?? 1_000) * 2 ** (consecutiveFailures - 1)
      const backoffDelay = Math.min(unboundedDelay, maxBackoffMs)
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
  ): Promise<readonly NormalizedTrackingPosition[]> {
    if (seedState === 'failed') {
      return []
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

        return breadcrumbs
      }),
    )

    const aggregated: NormalizedTrackingPosition[] = []
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      if (result === undefined) {
        continue
      }
      if (result.status === 'fulfilled') {
        aggregated.push(...result.value)
        continue
      }

      const failedDevice = breadcrumbDevices[index]
      logger.warn('Tracking breadcrumb fetch failed for device.', {
        deviceId: failedDevice?.device_id ?? null,
        deviceName: failedDevice?.name ?? null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }

    return aggregated
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
