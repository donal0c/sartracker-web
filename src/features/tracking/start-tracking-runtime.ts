import { createDeviceColor } from './tracking-color'
import { parseTrackingCachePayload, serializeTrackingCachePayload } from './tracking-cache-payload'
import {
  annotateTrackingSnapshotHealth,
  calculateCacheAgeMs,
  DEFAULT_DEVICE_STALE_THRESHOLD_MS,
  isTrackingCacheUsable,
} from './tracking-snapshot-health'
import type {
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import {
  createTrackingPositionCoordinateKey,
  createTrackingPositionIdentityKey,
} from './tracking-position-identity'
import type { DiagnosticEventInput } from '../diagnostics/diagnostic-event-log'

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
    readonly getInitialBreadcrumbs: () => Promise<readonly NormalizedTrackingPosition[]>
  },
) => TrackingRuntimePoller

type TrackingRuntimeCache = {
  readonly read: () => Promise<string | null>
  readonly write: (contents: string) => Promise<string>
}

type TrackingRuntimeLogger = {
  readonly warn: (message: string, error: unknown) => void
}

type PersistedPositionKeyCache = {
  readonly missionId: string
  readonly keys: Set<string>
}

export type TrackingRuntimeMissionStore = {
  readonly getActiveMission: () => Promise<{ readonly id: string } | null>
  readonly listPositions: (missionId: string) => Promise<readonly {
    readonly id?: string
    readonly device_id: string
    readonly lat?: number
    readonly lon?: number
    readonly altitude?: number | null
    readonly speed?: number | null
    readonly battery?: number | null
    readonly accuracy?: number | null
    readonly source?: string | null
    readonly timestamp: string
    readonly data_origin?: 'live' | 'cache'
  }[]>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: 'online' | 'offline' | 'unknown'
    readonly last_seen?: string | null
  }) => Promise<unknown>
  readonly upsertDevicesBulk?: (input: {
    readonly mission_id: string
    readonly devices: readonly {
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: 'online' | 'offline' | 'unknown'
      readonly last_seen?: string | null
    }[]
  }) => Promise<unknown>
  readonly addPosition: (input: {
    readonly id?: string
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
  readonly addPositionsBulk?: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly id?: string
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
    }[]
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
  readonly recordDiagnosticEvent?: (event: DiagnosticEventInput) => void | Promise<void>
  readonly now?: () => Date
}

const DEFAULT_TRACKING_RUNTIME_LOGGER: TrackingRuntimeLogger = {
  warn: (message, error) => {
    console.warn(message, error)
  },
}

const trackingCacheIdentityTokens = new WeakMap<object, number>()
let nextTrackingCacheIdentityToken = 1

/**
 * Starts the tracking runtime behind an explicit orchestration boundary.
 */
export async function startTrackingRuntime(
  dependencies: StartTrackingRuntimeDependencies,
): Promise<() => void> {
  const now = dependencies.now ?? (() => new Date())
  const logger = dependencies.logger ?? DEFAULT_TRACKING_RUNTIME_LOGGER
  const writeCache = dependencies.writeCache ?? true
  let persistedPositionKeyCache: PersistedPositionKeyCache | null = null
  let missionPersistenceQueue: Promise<void> = Promise.resolve()
  let lastTrackingCacheDataKey: string | null = null

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
    getInitialBreadcrumbs: () => getInitialPersistedBreadcrumbs(dependencies.missionStore),
    onSnapshot: async (snapshot) => {
      dependencies.applySnapshot(snapshot)
      void dependencies.recordDiagnosticEvent?.({
        level: 'info',
        category: 'tracking',
        event: 'tracking_snapshot_applied',
        fields: buildTrackingSnapshotDiagnosticFields(snapshot),
      })
      const sideEffects: Promise<unknown>[] = [
        enqueueMissionPersistence(
          limitSnapshotForMissionPersistence(
            snapshot,
            dependencies.maxPersistedPositionsPerSnapshot,
          ),
        ),
      ]

      if (writeCache) {
        const trackingCacheDataKey = createTrackingCacheDataKey(snapshot)
        if (trackingCacheDataKey !== lastTrackingCacheDataKey) {
          lastTrackingCacheDataKey = trackingCacheDataKey
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
        } else {
          sideEffects.unshift(Promise.resolve(null))
        }
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
      void dependencies.recordDiagnosticEvent?.({
        level: status.mode === 'online' ? 'info' : 'warn',
        category: 'tracking',
        event: 'tracking_status_changed',
        fields: {
          mode: status.mode,
          consecutiveFailures: status.consecutiveFailures,
          recovered: status.recovered,
          hasWarning: status.warning !== null,
        },
      })
    },
  })

  poller.start()
  return () => {
    poller.stop()
  }

  function enqueueMissionPersistence(snapshot: TrackingSnapshot): Promise<void> {
    const operation = missionPersistenceQueue.then(async () => {
      persistedPositionKeyCache = await persistTrackingSnapshot(
        snapshot,
        dependencies.missionStore,
        persistedPositionKeyCache,
      )
    })
    missionPersistenceQueue = operation.catch(() => undefined)
    return operation
  }
}

function createTrackingCacheDataKey(snapshot: TrackingSnapshot): string {
  return [
    getTrackingCacheIdentityToken(snapshot.devices),
    getTrackingCacheIdentityToken(snapshot.positions),
    getTrackingCacheIdentityToken(snapshot.breadcrumbs),
  ].join(':')
}

function getTrackingCacheIdentityToken(value: object): number {
  const existing = trackingCacheIdentityTokens.get(value)
  if (existing !== undefined) {
    return existing
  }

  const nextToken = nextTrackingCacheIdentityToken
  nextTrackingCacheIdentityToken += 1
  trackingCacheIdentityTokens.set(value, nextToken)
  return nextToken
}

function buildTrackingSnapshotDiagnosticFields(
  snapshot: TrackingSnapshot,
): Record<string, number> {
  const budgets = snapshot.breadcrumbMetadata?.deviceBudgets ?? []
  return {
    deviceCount: snapshot.devices.length,
    currentPositionCount: snapshot.positions.length,
    breadcrumbCount: snapshot.breadcrumbs.length,
    retainedBreadcrumbCount: snapshot.breadcrumbMetadata?.totalRetained ?? snapshot.breadcrumbs.length,
    observedBreadcrumbCount: snapshot.breadcrumbMetadata?.totalObserved ?? snapshot.breadcrumbs.length,
    truncatedDeviceCount: budgets.filter((budget) => budget.truncated).length,
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
  const persistenceBreadcrumbs = getBreadcrumbsForMissionPersistence(snapshot)
  if (persistenceBreadcrumbs.length <= maxBreadcrumbs) {
    return snapshot
  }

  const limitedPersistenceBreadcrumbs = [...persistenceBreadcrumbs]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-maxBreadcrumbs)

  if (snapshot.rawBreadcrumbsForPersistence !== undefined) {
    return {
      ...snapshot,
      rawBreadcrumbsForPersistence: limitedPersistenceBreadcrumbs,
    }
  }

  return {
    ...snapshot,
    // This cap is currently used only by browser validation storage limits.
    // Do not enable a real desktop persistence cap with this global slice: a
    // future operational cap must be per-device fair, matching the live
    // breadcrumb render budget, so one noisy tracker cannot evict another
    // rescuer's stored mission trail.
    breadcrumbs: limitedPersistenceBreadcrumbs,
  }
}

async function persistTrackingSnapshot(
  snapshot: TrackingSnapshot,
  missionStore: TrackingRuntimeMissionStore,
  persistedPositionKeyCache: PersistedPositionKeyCache | null,
): Promise<PersistedPositionKeyCache | null> {
  const activeMission = await missionStore.getActiveMission()
  if (activeMission === null) {
    return null
  }

  const nextPositionKeyCache =
    persistedPositionKeyCache?.missionId === activeMission.id
      ? persistedPositionKeyCache
      : {
          missionId: activeMission.id,
          keys: new Set(
            (
              await missionStore.listPositions(activeMission.id)
            ).flatMap((position) => createPersistedPositionKeys(position)),
          ),
        }

  // Persist all devices in ONE batched write when the store supports it. A per-device loop is
  // one commit — and at synchronous=FULL one fsync — per device, so a 32-device mission blocked
  // the main-process event loop for tens of seconds every poll on a slow field disk (DON-240).
  if (snapshot.devices.length > 0) {
    if (missionStore.upsertDevicesBulk !== undefined) {
      await missionStore.upsertDevicesBulk({
        mission_id: activeMission.id,
        devices: snapshot.devices.map((device) => ({
          device_id: device.device_id,
          name: device.name,
          color: createDeviceColor(device.device_id),
          status: device.status,
          last_seen: device.last_seen,
        })),
      })
    } else {
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
    }
  }

  const newPositions: {
    readonly id?: string
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
  }[] = []
  const newPositionKeys: string[] = []
  const stagedPositionKeys = new Set<string>()

  for (const position of [...getBreadcrumbsForMissionPersistence(snapshot), ...snapshot.positions]) {
    const positionKeys = createIncomingPositionKeys(position)
    const cacheLookupKeys = createIncomingPositionCacheLookupKeys(position)
    if (
      cacheLookupKeys.some((positionKey) =>
        nextPositionKeyCache.keys.has(positionKey) || stagedPositionKeys.has(positionKey)
      )
    ) {
      continue
    }

    for (const positionKey of positionKeys) {
      stagedPositionKeys.add(positionKey)
    }
    newPositions.push({
      id: position.id,
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
    newPositionKeys.push(...positionKeys)
  }

  if (newPositions.length === 0) {
    return nextPositionKeyCache
  }

  if (missionStore.addPositionsBulk !== undefined) {
    await missionStore.addPositionsBulk({
      mission_id: activeMission.id,
      positions: newPositions,
    })
  } else {
    for (const position of newPositions) {
      await missionStore.addPosition({
        mission_id: activeMission.id,
        ...position,
      })
    }
  }

  for (const positionKey of newPositionKeys) {
    nextPositionKeyCache.keys.add(positionKey)
  }

  return nextPositionKeyCache
}

/**
 * Returns the un-decimated breadcrumb payload for mission storage when present.
 */
function getBreadcrumbsForMissionPersistence(
  snapshot: TrackingSnapshot,
): readonly NormalizedTrackingPosition[] {
  return snapshot.rawBreadcrumbsForPersistence ?? snapshot.breadcrumbs
}

function createIncomingPositionKeys(position: NormalizedTrackingPosition): readonly string[] {
  return [
    createTrackingPositionIdentityKey(position),
    createTrackingPositionCoordinateKey(position),
  ]
}

function createIncomingPositionCacheLookupKeys(
  position: NormalizedTrackingPosition,
): readonly string[] {
  return [
    ...createIncomingPositionKeys(position),
    `${position.device_id}:time:${position.timestamp}`,
  ]
}

function createPersistedPositionKeys(position: {
  readonly id?: string
  readonly device_id: string
  readonly lat?: number
  readonly lon?: number
  readonly timestamp: string
}): readonly string[] {
  const keys: string[] = []
  const persistedId = position.id?.trim()
  if (persistedId) {
    keys.push(`${position.device_id}:id:${persistedId}`)
  }

  const lat = Number(position.lat)
  const lon = Number(position.lon)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    keys.push(createTrackingPositionCoordinateKey({
      device_id: position.device_id,
      lat,
      lon,
      timestamp: position.timestamp,
    }))
  }

  if (keys.length === 0) {
    keys.push(`${position.device_id}:time:${position.timestamp}`)
  }

  return keys
}

/**
 * Returns valid persisted active-mission positions for initial breadcrumb rendering.
 */
async function getInitialPersistedBreadcrumbs(
  missionStore: TrackingRuntimeMissionStore,
): Promise<readonly NormalizedTrackingPosition[]> {
  const activeMission = await missionStore.getActiveMission()
  if (activeMission === null) {
    return []
  }

  const positions = await missionStore.listPositions(activeMission.id)
  return positions.flatMap((position) => {
    const lat = Number(position.lat)
    const lon = Number(position.lon)
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      Number.isNaN(Date.parse(position.timestamp))
    ) {
      return []
    }

    return [{
      id: position.id ?? `${position.device_id}:time:${position.timestamp}`,
      device_id: position.device_id,
      lat,
      lon,
      altitude: position.altitude ?? null,
      speed: position.speed ?? null,
      battery: position.battery ?? null,
      accuracy: position.accuracy ?? null,
      source: position.source ?? null,
      timestamp: position.timestamp,
      data_origin: position.data_origin ?? 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    } satisfies NormalizedTrackingPosition]
  })
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
