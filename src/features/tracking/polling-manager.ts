import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import { accumulateBreadcrumbPositions } from './breadcrumb-accumulator'
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
  const logger = options.logger ?? DEFAULT_LOGGER

  let authenticated = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let consecutiveFailures = 0
  let lastGoodSnapshot: TrackingSnapshot | null = null
  let lastSuccessAt: string | null = null
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
        scheduleNextPoll(options.intervalMs)
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
        scheduleNextPoll(options.intervalMs)
        return
      }

      await seedInitialBreadcrumbs()

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

      const breadcrumbs = await fetchIncrementalBreadcrumbs(devices)
      const breadcrumbResult = accumulateBreadcrumbPositions(breadcrumbPositions, breadcrumbs)
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata

      const rawSnapshot = { devices, positions, breadcrumbs: breadcrumbPositions, breadcrumbMetadata }
      const latestPollingMode = options.getPollingMode?.() ?? 'active'
      if (latestPollingMode !== 'active') {
        publishInactiveMissionSnapshot(latestPollingMode)
        scheduleNextPoll(options.intervalMs)
        return
      }

      lastGoodSnapshot = rawSnapshot

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

      scheduleNextPoll(options.intervalMs)
    } catch {
      consecutiveFailures += 1

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
        warning: 'OFFLINE MODE — showing last known positions.',
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
  ): Promise<readonly NormalizedTrackingPosition[]> {
    const fetchUntil = now()
    await seedInitialBreadcrumbs()
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
            : new Date(Date.parse(lastTimestamp) + 1_000)

        const breadcrumbs = await client.getBreadcrumbs(device.device_id, fetchFrom, fetchUntil)
        const newestTimestamp = breadcrumbs.at(-1)?.timestamp
        if (newestTimestamp !== undefined) {
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

  async function seedInitialBreadcrumbs(): Promise<void> {
    if (
      initialBreadcrumbsLoaded ||
      options.getInitialBreadcrumbs === undefined
    ) {
      return
    }

    try {
      const persistedBreadcrumbs = await options.getInitialBreadcrumbs()
      const breadcrumbResult = accumulateBreadcrumbPositions(breadcrumbPositions, persistedBreadcrumbs)
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata
      seedLatestBreadcrumbTimestamps(persistedBreadcrumbs)
      initialBreadcrumbsLoaded = true
    } catch (error) {
      logger.warn('Tracking breadcrumb cursor load failed.', {
        error: error instanceof Error ? error.message : String(error),
      })
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
