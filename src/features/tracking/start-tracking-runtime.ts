import { createDeviceColor } from './tracking-color'
import { parseTrackingCachePayload, serializeTrackingCachePayload } from './tracking-cache-payload'
import {
  annotateTrackingSnapshotHealth,
  calculateCacheAgeMs,
  DEFAULT_DEVICE_STALE_THRESHOLD_MS,
  isTrackingCacheUsable,
} from './tracking-snapshot-health'
import type {
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'

export type TrackingRuntimeConfig = {
  readonly baseUrl: string
  readonly email?: string
  readonly password?: string
  readonly token?: string
}

type TrackingRuntimeClientFactory = (config: TrackingRuntimeConfig) => unknown

type TrackingRuntimePoller = {
  readonly start: () => void
  readonly stop: () => void
}

type TrackingRuntimePollerFactory = (
  client: unknown,
  hooks: {
    readonly onSnapshot: (snapshot: TrackingSnapshot) => Promise<void>
    readonly onStatusChange: (status: TrackingConnectionStatus) => void
  },
) => TrackingRuntimePoller

type TrackingRuntimeCache = {
  readonly read: () => Promise<string | null>
  readonly write: (contents: string) => Promise<string>
}

type TrackingRuntimeLogger = {
  readonly warn: (message: string, error: unknown) => void
}

export type TrackingRuntimeMissionStore = {
  readonly getActiveMission: () => Promise<{ readonly id: string } | null>
  readonly listPositions: (missionId: string) => Promise<readonly {
    readonly device_id: string
    readonly timestamp: string
  }[]>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: 'online' | 'offline' | 'unknown'
    readonly last_seen?: string | null
  }) => Promise<unknown>
  readonly addPosition: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly lat: number
    readonly lon: number
    readonly altitude?: number | null
    readonly speed?: number | null
    readonly battery?: number | null
    readonly accuracy?: number | null
    readonly source?: string | null
    readonly timestamp?: string | null
    readonly data_origin?: 'live' | 'cache'
  }) => Promise<unknown>
}

type StartTrackingRuntimeDependencies = {
  readonly config: TrackingRuntimeConfig | null
  readonly createClient: TrackingRuntimeClientFactory
  readonly createPoller: TrackingRuntimePollerFactory
  readonly cache: TrackingRuntimeCache
  readonly missionStore: TrackingRuntimeMissionStore
  readonly applySnapshot: (snapshot: TrackingSnapshot) => void
  readonly applyStatus: (status: TrackingConnectionStatus) => void
  readonly idleWarning?: string
  readonly maxPersistedPositionsPerSnapshot?: number
  readonly writeCache?: boolean
  readonly logger?: TrackingRuntimeLogger
  readonly now?: () => Date
}

const DEFAULT_TRACKING_RUNTIME_LOGGER: TrackingRuntimeLogger = {
  warn: (message, error) => {
    console.warn(message, error)
  },
}

/**
 * Starts the tracking runtime behind an explicit orchestration boundary.
 */
export async function startTrackingRuntime(
  dependencies: StartTrackingRuntimeDependencies,
): Promise<() => void> {
  const now = dependencies.now ?? (() => new Date())
  const logger = dependencies.logger ?? DEFAULT_TRACKING_RUNTIME_LOGGER
  const writeCache = dependencies.writeCache ?? true

  if (dependencies.config === null) {
    dependencies.applyStatus({
      mode: 'idle',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: null,
      warning: dependencies.idleWarning ?? 'Tracking is not configured.',
    })

    return () => {}
  }

  const cachedContents = await dependencies.cache.read()
  if (cachedContents !== null) {
    const cachedSnapshot = safelyParseCachedSnapshot(cachedContents)
    if (cachedSnapshot !== null && isTrackingCacheUsable(cachedSnapshot.cached_at, now())) {
      dependencies.applySnapshot(
        annotateTrackingSnapshotHealth(
          {
            devices: cachedSnapshot.devices,
            positions: cachedSnapshot.positions,
            breadcrumbs: cachedSnapshot.breadcrumbs,
          },
          {
            now: now(),
            cacheAgeMs: calculateCacheAgeMs(cachedSnapshot.cached_at, now()),
            deviceStaleThresholdMs: DEFAULT_DEVICE_STALE_THRESHOLD_MS,
          },
        ),
      )
      // Cold-start visibility: until the first live poll succeeds, the operator
      // is looking at last-known cached positions. Surface that explicitly so
      // they cannot mistake cached data for a live feed.
      dependencies.applyStatus({
        mode: 'offline',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: cachedSnapshot.cached_at,
        warning: 'OFFLINE MODE — showing last known positions from cache.',
      })
    }
  }

  const client = dependencies.createClient(dependencies.config)
  const poller = dependencies.createPoller(client, {
    onSnapshot: async (snapshot) => {
      dependencies.applySnapshot(snapshot)
      const sideEffects: Promise<unknown>[] = [
        persistTrackingSnapshot(
          limitSnapshotForMissionPersistence(
            snapshot,
            dependencies.maxPersistedPositionsPerSnapshot,
          ),
          dependencies.missionStore,
        ),
      ]

      if (writeCache) {
        sideEffects.unshift(
          dependencies.cache.write(
          serializeTrackingCachePayload({
            cached_at: now().toISOString(),
            devices: snapshot.devices,
            positions: snapshot.positions,
            breadcrumbs: snapshot.breadcrumbs,
          }),
          ),
        )
      }

      await Promise.allSettled(sideEffects).then((results) => {
        if (writeCache) {
          const cacheWriteResult = results[0]
          if (cacheWriteResult !== undefined && cacheWriteResult.status === 'rejected') {
            logger.warn('Tracking cache update failed.', cacheWriteResult.reason)
          }
        }

        const missionPersistenceResult = results[writeCache ? 1 : 0]
        if (missionPersistenceResult !== undefined && missionPersistenceResult.status === 'rejected') {
          logger.warn('Tracking mission persistence failed.', missionPersistenceResult.reason)
        }
      })
    },
    onStatusChange: (status) => {
      dependencies.applyStatus(status)
    },
  })

  poller.start()
  return () => {
    poller.stop()
  }
}

function limitSnapshotForMissionPersistence(
  snapshot: TrackingSnapshot,
  maxPersistedPositionsPerSnapshot: number | undefined,
): TrackingSnapshot {
  if (maxPersistedPositionsPerSnapshot === undefined) {
    return snapshot
  }

  const maxBreadcrumbs = Math.max(0, maxPersistedPositionsPerSnapshot - snapshot.positions.length)
  if (snapshot.breadcrumbs.length <= maxBreadcrumbs) {
    return snapshot
  }

  return {
    ...snapshot,
    breadcrumbs: [...snapshot.breadcrumbs]
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .slice(-maxBreadcrumbs),
  }
}

async function persistTrackingSnapshot(
  snapshot: TrackingSnapshot,
  missionStore: TrackingRuntimeMissionStore,
): Promise<void> {
  const activeMission = await missionStore.getActiveMission()
  if (activeMission === null) {
    return
  }

  const existingPositionKeys = new Set(
    (
      await missionStore.listPositions(activeMission.id)
    ).map((position) => createPositionKey(position.device_id, position.timestamp)),
  )

  for (const device of snapshot.devices) {
    await missionStore.upsertDevice({
      mission_id: activeMission.id,
      device_id: device.device_id,
      name: device.name,
      color: createDeviceColor(device.device_id),
      status: device.status,
      last_seen: device.last_seen,
    })
  }

  for (const position of [...snapshot.breadcrumbs, ...snapshot.positions]) {
    const positionKey = createPositionKey(position.device_id, position.timestamp)
    if (existingPositionKeys.has(positionKey)) {
      continue
    }

    existingPositionKeys.add(positionKey)
    await missionStore.addPosition({
      mission_id: activeMission.id,
      device_id: position.device_id,
      lat: position.lat,
      lon: position.lon,
      altitude: position.altitude,
      speed: position.speed,
      battery: position.battery,
      accuracy: position.accuracy,
      source: position.source,
      timestamp: position.timestamp,
      data_origin: position.data_origin,
    })
  }
}

function createPositionKey(deviceId: string, timestamp: string): string {
  return `${deviceId}:${timestamp}`
}

function safelyParseCachedSnapshot(
  contents: string,
): ReturnType<typeof parseTrackingCachePayload> | null {
  try {
    return parseTrackingCachePayload(contents)
  } catch {
    return null
  }
}
