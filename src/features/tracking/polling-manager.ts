import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import { appendBreadcrumbPositions } from './breadcrumb-accumulator'
import { annotateTrackingSnapshotHealth } from './tracking-snapshot-health'

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

type PollingManagerOptions = {
  readonly intervalMs: number
  readonly staleThresholdMs: number
  readonly retryBaseMs?: number
  readonly onSnapshot: (snapshot: TrackingSnapshot) => void
  readonly onStatusChange: (status: TrackingConnectionStatus) => void
  readonly now?: () => Date
  readonly setTimeout?: typeof window.setTimeout
  readonly clearTimeout?: typeof window.clearTimeout
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

  let authenticated = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let consecutiveFailures = 0
  let lastGoodSnapshot: TrackingSnapshot | null = null
  let lastSuccessAt: string | null = null
  let breadcrumbPositions: readonly NormalizedTrackingPosition[] = []
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
      await authenticateIfNeeded()

      const [devices, positions] = await Promise.all([
        client.getDevices(),
        client.getCurrentPositions(),
      ])

      const breadcrumbs = await fetchIncrementalBreadcrumbs(devices)
      breadcrumbPositions = appendBreadcrumbPositions(breadcrumbPositions, breadcrumbs)

      const rawSnapshot = { devices, positions, breadcrumbs: breadcrumbPositions }
      lastGoodSnapshot = rawSnapshot
      const recovered = consecutiveFailures > 0
      consecutiveFailures = 0
      lastSuccessAt = now().toISOString()

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

      const backoffDelay = (options.retryBaseMs ?? 1_000) * 2 ** (consecutiveFailures - 1)
      scheduleNextPoll(backoffDelay)
    }
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
    const results = await Promise.all(
      devices.map(async (device) => {
        const lastTimestamp = latestBreadcrumbTimestampByDevice.get(device.device_id)
        const fetchFrom =
          lastTimestamp === undefined
            ? new Date(fetchUntil.getTime() - 3 * 60 * 60 * 1000)
            : new Date(Date.parse(lastTimestamp) + 1_000)

        const breadcrumbs = await client.getBreadcrumbs(device.device_id, fetchFrom, fetchUntil)
        const newestTimestamp = breadcrumbs.at(-1)?.timestamp
        if (newestTimestamp !== undefined) {
          latestBreadcrumbTimestampByDevice.set(device.device_id, newestTimestamp)
        }

        return breadcrumbs
      }),
    )

    return results.flat()
  }
}
