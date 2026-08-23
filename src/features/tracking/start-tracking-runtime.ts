import { createDeviceColor } from './tracking-color'
import { parseTrackingCachePayload, serializeTrackingCachePayload } from './tracking-cache-payload'
import {
  annotateTrackingSnapshotHealth,
  calculateCacheAgeMs,
  DEFAULT_DEVICE_STALE_THRESHOLD_MS,
  isTrackingCacheUsable,
} from './tracking-snapshot-health'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  NormalizedTraccarGroup,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import type { ParticipationScope } from '../participants/participation-scope'
import {
  createTrackingPositionCoordinateKey,
} from './tracking-position-identity'
import { normalizeTrackingIsoTimestamp } from './tracking-timestamp'
import type { DiagnosticEventInput } from '../diagnostics/diagnostic-event-log'
import type { TrackingPollLedgerEntry } from '../diagnostics/tracking-poll-ledger'
import type {
  BreadcrumbHistoryCheckpointSeed,
  CanonicalBreadcrumbSeed,
  TrackingHistoryChunkPersistenceInput,
  TrackingHistoryChunkPersistenceResult,
  TrackingSnapshotContext,
} from './polling-manager'
import type { BreadcrumbSelectionMetadata } from './breadcrumb-accumulator'
import type { DeviceRosterNormalizationResult } from './traccar-client'
import { useMissionStore } from '../mission/mission-store'
import { useActiveMissionDevicesStore } from './active-mission-devices-store'
import type {
  ParticipantBackfillCheckpoint,
  PersistTrackingHistoryBatchInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { runParticipantBackfillPass } from '../participants/participant-backfill-runtime'

export type TrackingRuntimeConfig = {
  readonly baseUrl: string
  readonly email?: string
  readonly password?: string
  readonly token?: string
  readonly recordRequestDiagnostic?: (entry: TrackingPollLedgerEntry) => void
}

type ParticipantRosterClient = {
  readonly authenticate: () => Promise<void>
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getDevicesWithReport?: () => Promise<DeviceRosterNormalizationResult>
  readonly getGroups: () => Promise<readonly NormalizedTraccarGroup[]>
  readonly getCurrentPositions: () => Promise<readonly NormalizedTrackingPosition[]>
}

type TrackingRuntimeClientFactory = (config: TrackingRuntimeConfig) => unknown

type TrackingRuntimePoller = {
  readonly start: () => void
  readonly stop: () => void
  readonly requestPollNow?: () => void
}

type TrackingRuntimePollerFactory = (
  client: unknown,
  hooks: {
    readonly onSnapshot: (
      snapshot: TrackingSnapshot,
      context?: TrackingSnapshotContext,
    ) => Promise<void>
    readonly onStatusChange: (status: TrackingConnectionStatus) => void
    readonly getInitialBreadcrumbs: (
      signal?: AbortSignal,
    ) => Promise<readonly NormalizedTrackingPosition[]>
    readonly getInitialBreadcrumbTotals: (
      signal?: AbortSignal,
    ) => Promise<Readonly<Record<string, number>>>
    readonly getInitialBreadcrumbSelectionMetadata: (
      signal?: AbortSignal,
    ) => Promise<
      Readonly<Record<string, BreadcrumbSelectionMetadata>>
    >
    readonly getInitialHistoryCheckpoints: (signal?: AbortSignal) => Promise<
      Readonly<Record<string, BreadcrumbHistoryCheckpointSeed>>
    >
    readonly getCanonicalBreadcrumbs?: (
      expectedMissionId: string,
      signal?: AbortSignal,
    ) => Promise<CanonicalBreadcrumbSeed>
    readonly persistHistoryChunk?: (
      input: TrackingHistoryChunkPersistenceInput,
    ) => Promise<TrackingHistoryChunkPersistenceResult>
    readonly persistHistoryChunks?: (
      inputs: readonly TrackingHistoryChunkPersistenceInput[],
    ) => Promise<void>
    readonly onPollDiagnostic: (entry: TrackingPollLedgerEntry) => void
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

const MAX_RESTART_BREADCRUMBS_PER_DEVICE = 5_000

export type TrackingRuntimeMissionStore = {
  readonly getActiveMission: () => Promise<{ readonly id: string } | null>
  readonly listPositions: (missionId: string) => Promise<readonly {
    readonly id?: string
    readonly source_position_id?: string | null
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
  readonly listRecentPositions?: (
    missionId: string,
    perDeviceLimit: number,
  ) => Promise<readonly {
    readonly id?: string
    readonly source_position_id?: string | null
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
  readonly listBreadcrumbPositions?: (
    missionId: string,
    perDeviceLimit: number,
    requestId?: string,
  ) => Promise<{
    readonly positions: readonly {
      readonly id?: string
      readonly source_position_id?: string | null
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
    }[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly deviceSelections?: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly targetGeometryErrorSatisfied: boolean
      readonly timeBucketWidthMs?: number | null
      readonly spatialBucketWidthDegrees?: number | null
    }[]
    readonly droppedPositionCount?: number
  }>
  readonly cancelBreadcrumbQuery?: (requestId: string) => Promise<boolean>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: 'online' | 'offline' | 'unknown'
    readonly last_seen?: string | null
    readonly group_id?: string | null
    readonly unique_id?: string | null
    readonly participant_provenance?: 'legacy_auto'
  }) => Promise<unknown>
  readonly upsertDevicesBulk?: (input: {
    readonly mission_id: string
    readonly devices: readonly {
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: 'online' | 'offline' | 'unknown'
      readonly last_seen?: string | null
      readonly group_id?: string | null
      readonly unique_id?: string | null
    }[]
    readonly participant_provenance?: 'legacy_auto'
  }) => Promise<unknown>
  readonly addPosition: (input: {
    readonly source_position_id?: string | null
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
      readonly source_position_id?: string | null
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
  readonly persistTrackingHistoryBatch?: (
    input: PersistTrackingHistoryBatchInput,
  ) => Promise<unknown>
  readonly persistTrackingPositionsBulk?: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id?: string | null
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
    readonly checkpoints: readonly {
      readonly device_id: string
      readonly history_from: string
      readonly reconciled_until: string
    }[]
  }) => Promise<{
    readonly changedPositionCount: number
    readonly insertedPositionCount: number
    readonly skippedAmbiguousLegacyAdoptionCount: number
  }>
  readonly listTrackingHistoryCheckpoints?: (missionId: string) => Promise<readonly {
    readonly mission_id: string
    readonly device_id: string
    readonly history_from: string
    readonly reconciled_until: string
  }[]>
  readonly listParticipantBackfillCheckpoints?: (
    missionId: string,
  ) => Promise<readonly ParticipantBackfillCheckpoint[]>
  readonly upsertParticipantBackfillCheckpoint?: (input: {
    readonly mission_id: string
    readonly traccar_device_id: string
    readonly window_from: string
    readonly window_to: string
    readonly reconciled_until: string
    readonly completed: boolean
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
  readonly recordTrackingPollDiagnostic?: (entry: TrackingPollLedgerEntry) => void
  readonly notifyDurablePositionChange?: (changedPositionCount: number) => void
  readonly missionModelEnabled?: boolean
  readonly readParticipationScope?: () => ParticipationScope
  readonly readParticipationScopeStatus?: () => 'loading' | 'ready' | 'error'
  readonly subscribeParticipationScope?: (listener: () => void) => () => void
  readonly applyParticipantRoster?: (
    devices: readonly TrackingSnapshot['devices'][number][],
    options?: { readonly complete: boolean },
  ) => void | Promise<void>
  readonly applyParticipantGroups?: (
    groups: readonly NormalizedTraccarGroup[],
  ) => void | Promise<void>
  readonly applyParticipantRosterError?: (message: string | null) => void
  readonly now?: () => Date
}

const DEFAULT_TRACKING_RUNTIME_LOGGER: TrackingRuntimeLogger = {
  warn: (message, error) => {
    console.warn(message, error)
  },
}

const trackingCacheIdentityTokens = new WeakMap<object, number>()
const breadcrumbRendererSessionId = createBreadcrumbRendererSessionId()
let nextTrackingCacheIdentityToken = 1
let nextTrackingRuntimeGeneration = 0
let activeTrackingRuntimeGeneration = 0
let trackingPersistenceTail: Promise<void> = Promise.resolve()
let trackingCacheWriteTail: Promise<unknown> = Promise.resolve()
let breadcrumbStorageQueryTail: Promise<void> = Promise.resolve()

/**
 * Starts the tracking runtime behind an explicit orchestration boundary.
 */
export async function startTrackingRuntime(
  dependencies: StartTrackingRuntimeDependencies,
): Promise<() => void> {
  const runtimeGeneration = ++nextTrackingRuntimeGeneration
  activeTrackingRuntimeGeneration = runtimeGeneration
  const now = dependencies.now ?? (() => new Date())
  const logger = dependencies.logger ?? DEFAULT_TRACKING_RUNTIME_LOGGER
  const writeCache = dependencies.writeCache ?? true
  let persistedPositionKeyCache: PersistedPositionKeyCache | null = null
  let lastTrackingCacheDataKey: string | null = null
  let latestQueuedTrackingCacheDataKey: string | null = null
  let latestTrackingCacheRequestSequence = 0
  let latestTrackingStatus: TrackingConnectionStatus | null = null
  let trackingCacheWarningActive = false
  let missionPersistenceWarningActive = false
  let droppedPersistedBreadcrumbCount = 0
  let lastDroppedBreadcrumbDiagnosticKey: string | null = null
  let nextBreadcrumbQueryRequestSequence = 0
  let initialPersistedBreadcrumbs:
    | {
        readonly missionId: string | null
        readonly promise: Promise<
          Awaited<ReturnType<typeof getInitialPersistedBreadcrumbs>>
        >
      }
    | null = null
  let participantBackfillInFlight = false
  let deferredOperationalSnapshot: {
    readonly snapshot: TrackingSnapshot
    readonly historyResetKey: string | null
    readonly persistAfterHydration: boolean
  } | null = null
  const participantBackfillAbortController = new AbortController()

  if (dependencies.config === null) {
    dependencies.applyStatus({
      mode: 'idle',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: null,
      warning: dependencies.idleWarning ?? 'Tracking is not configured.',
    })

    return () => invalidateTrackingRuntimeGeneration(runtimeGeneration)
  }

  const cachedContents = await dependencies.cache.read()
  if (cachedContents !== null) {
    const cachedSnapshot = safelyParseCachedSnapshot(cachedContents, logger)
    if (cachedSnapshot !== null && isTrackingCacheUsable(cachedSnapshot.cached_at, now())) {
      const healthyCachedSnapshot = annotateTrackingSnapshotHealth(
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
        )
      const operationalCachedSnapshot = filterOperationalSnapshot(healthyCachedSnapshot)
      if (operationalCachedSnapshot === null) {
        deferredOperationalSnapshot = {
          snapshot: healthyCachedSnapshot,
          historyResetKey: null,
          persistAfterHydration: false,
        }
      } else {
        dependencies.applySnapshot(operationalCachedSnapshot)
      }
      // Cold-start visibility: until the first live poll succeeds, the operator
      // is looking at last-known cached positions. Surface that explicitly so
      // they cannot mistake cached data for a live feed.
      latestTrackingStatus = {
        mode: 'offline',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: cachedSnapshot.cached_at,
        warning: 'OFFLINE MODE — showing last known positions from cache.',
      }
      dependencies.applyStatus(decorateTrackingStatus(latestTrackingStatus))
    }
  }

  const client = dependencies.createClient({
    ...dependencies.config,
    ...(dependencies.recordTrackingPollDiagnostic === undefined
      ? {}
      : { recordRequestDiagnostic: dependencies.recordTrackingPollDiagnostic }),
  })
  if (dependencies.missionModelEnabled === true) {
    void preloadParticipantDiscovery(
      client,
      dependencies,
      logger,
      () => runtimeGeneration === activeTrackingRuntimeGeneration,
    )
  }
  const poller = dependencies.createPoller(client, {
    getInitialBreadcrumbs: async (signal?: AbortSignal) => {
      const seed = await loadInitialPersistedBreadcrumbs(signal)
      droppedPersistedBreadcrumbCount = seed.droppedPositionCount
      const droppedBreadcrumbDiagnosticKey =
        seed.droppedPositionCount > 0
          ? `${seed.missionId ?? 'no-mission'}:${seed.droppedPositionCount}`
          : null
      if (
        droppedBreadcrumbDiagnosticKey !== null &&
        droppedBreadcrumbDiagnosticKey !== lastDroppedBreadcrumbDiagnosticKey
      ) {
        lastDroppedBreadcrumbDiagnosticKey = droppedBreadcrumbDiagnosticKey
        void dependencies.recordDiagnosticEvent?.({
          level: 'warn',
          category: 'tracking',
          event: 'tracking_breadcrumb_rows_dropped',
          fields: {
            droppedPositionCount: seed.droppedPositionCount,
          },
        })
      }
      refreshTrackingStatus()
      if (seed.missionId !== null) {
        persistedPositionKeyCache = {
          missionId: seed.missionId,
          keys: new Set(
            seed.positions.flatMap((position) =>
              createIncomingPositionCacheKeys(position),
            ),
          ),
        }
      }
      return seed.positions
    },
    getInitialBreadcrumbTotals: async (signal?: AbortSignal) => {
      return (await loadInitialPersistedBreadcrumbs(signal)).totalObservedByDevice
    },
    getInitialBreadcrumbSelectionMetadata: async (signal?: AbortSignal) => {
      return (await loadInitialPersistedBreadcrumbs(signal)).selectionMetadataByDevice
    },
    getInitialHistoryCheckpoints: async (signal?: AbortSignal) => {
      return (await loadInitialPersistedBreadcrumbs(signal)).historyCheckpointsByDevice
    },
    ...(dependencies.missionStore.listBreadcrumbPositions === undefined
      ? {}
      : {
          getCanonicalBreadcrumbs: (
            expectedMissionId: string,
            signal?: AbortSignal,
          ) => enqueueCanonicalBreadcrumbQuery(expectedMissionId, signal),
        }),
    ...(dependencies.missionStore.persistTrackingPositionsBulk === undefined &&
      dependencies.missionStore.persistTrackingHistoryBatch === undefined
      ? {}
      : {
          persistHistoryChunks: async (
            inputs: readonly TrackingHistoryChunkPersistenceInput[],
          ): Promise<void> => {
            let changedPositionCount = 0
            try {
              await enqueueTrackingPersistence(runtimeGeneration, async () => {
                const firstInput = inputs[0]
                if (firstInput === undefined) {
                  return
                }
                if (
                  firstInput.phase !== 'initial' ||
                  firstInput.expectedMissionId === null ||
                  inputs.some(
                    (input) =>
                      input.phase !== 'initial' ||
                      input.expectedMissionId !== firstInput.expectedMissionId,
                  )
                ) {
                  throw new Error(
                    'Tracking history wave must contain initial chunks for one mission.',
                  )
                }
                const activeMission = await dependencies.missionStore.getActiveMission()
                if (activeMission?.id !== firstInput.expectedMissionId) {
                  throw new Error(
                    'Tracking history mission changed before the wave could be persisted.',
                  )
                }
                const positions = inputs.flatMap((input) =>
                  input.positions.map((position) => ({
                    source_position_id: position.id,
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
                  })),
                )
                const checkpoints = inputs.map((input) => ({
                  device_id: input.deviceId,
                  history_from: input.historyFrom,
                  reconciled_until: input.reconciledUntil,
                }))
                if (
                  dependencies.missionStore.persistTrackingPositionsBulk !== undefined
                ) {
                  const persisted = await dependencies.missionStore.persistTrackingPositionsBulk({
                    mission_id: activeMission.id,
                    positions,
                    checkpoints,
                  })
                  changedPositionCount = persisted.changedPositionCount
                  return
                }
                const persisted = await dependencies.missionStore.persistTrackingHistoryBatch?.({
                  mission_id: activeMission.id,
                  positions,
                  checkpoints,
                })
                changedPositionCount = Array.isArray(persisted)
                  ? persisted.length
                  : positions.length
              })
              dependencies.notifyDurablePositionChange?.(changedPositionCount)
              if (
                runtimeGeneration === activeTrackingRuntimeGeneration &&
                missionPersistenceWarningActive
              ) {
                missionPersistenceWarningActive = false
                refreshTrackingStatus()
              }
            } catch (error) {
              logger.warn('Tracking history wave persistence failed.', error)
              if (runtimeGeneration === activeTrackingRuntimeGeneration) {
                missionPersistenceWarningActive = true
                refreshTrackingStatus()
              }
              throw error
            }
          },
        }),
    persistHistoryChunk: async (
      input: TrackingHistoryChunkPersistenceInput,
    ): Promise<TrackingHistoryChunkPersistenceResult> => {
      let changedPositionCount = 0
      try {
        await enqueueTrackingPersistence(runtimeGeneration, async () => {
          const activeMission = await dependencies.missionStore.getActiveMission()
          if (
            input.expectedMissionId === null ||
            activeMission?.id !== input.expectedMissionId
          ) {
            throw new Error(
              'Tracking history mission changed before the chunk could be persisted.',
            )
          }
          const positions = input.positions.map((position) => ({
            source_position_id: position.id,
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
          }))
          if (
            input.phase === 'initial' &&
            dependencies.missionStore.persistTrackingPositionsBulk !== undefined
          ) {
            const persisted = await dependencies.missionStore.persistTrackingPositionsBulk({
              mission_id: activeMission.id,
              positions,
              checkpoints: [{
                device_id: input.deviceId,
                history_from: input.historyFrom,
                reconciled_until: input.reconciledUntil,
              }],
            })
            changedPositionCount = persisted.changedPositionCount
            return
          }
          if (
            input.phase === 'initial' &&
            dependencies.missionStore.persistTrackingHistoryBatch !== undefined
          ) {
            const persisted = await dependencies.missionStore.persistTrackingHistoryBatch({
              mission_id: activeMission.id,
              positions,
              checkpoints: [{
                device_id: input.deviceId,
                history_from: input.historyFrom,
                reconciled_until: input.reconciledUntil,
              }],
            })
            changedPositionCount = Array.isArray(persisted) ? persisted.length : 0
            return
          }
          if (positions.length === 0) {
            return
          }
          if (dependencies.missionStore.persistTrackingPositionsBulk !== undefined) {
            const persisted = await dependencies.missionStore.persistTrackingPositionsBulk({
              mission_id: activeMission.id,
              positions,
              checkpoints: [],
            })
            changedPositionCount = persisted.changedPositionCount
            return
          } else if (dependencies.missionStore.addPositionsBulk !== undefined) {
            const persisted = await dependencies.missionStore.addPositionsBulk({
              mission_id: activeMission.id,
              positions,
            })
            changedPositionCount = Array.isArray(persisted)
              ? persisted.length
              : positions.length
            return
          }
          for (const position of positions) {
            await dependencies.missionStore.addPosition({
              mission_id: activeMission.id,
              ...position,
            })
            changedPositionCount += 1
          }
        })
        if (
          runtimeGeneration === activeTrackingRuntimeGeneration &&
          missionPersistenceWarningActive
        ) {
          missionPersistenceWarningActive = false
          refreshTrackingStatus()
        }
        dependencies.notifyDurablePositionChange?.(changedPositionCount)
        return { changed: changedPositionCount > 0 }
      } catch (error) {
        logger.warn('Tracking history chunk persistence failed.', error)
        if (runtimeGeneration === activeTrackingRuntimeGeneration) {
          missionPersistenceWarningActive = true
          refreshTrackingStatus()
        }
        throw error
      }
    },
    onSnapshot: async (snapshot, context) => {
      applyParticipantRosterWithoutBlocking(snapshot.devices, context)
      const operationalSnapshot = filterOperationalSnapshot(snapshot)
      const sideEffects: Promise<unknown>[] = []
      let missionPersistenceResultIndex: number | null = null
      if (operationalSnapshot === null) {
        deferredOperationalSnapshot = {
          snapshot,
          historyResetKey: context?.historyResetKey ?? null,
          persistAfterHydration: true,
        }
        refreshTrackingStatus()
      } else {
        deferredOperationalSnapshot = null
        dependencies.applySnapshot(operationalSnapshot)
        scheduleParticipantBackfill()
        void dependencies.recordDiagnosticEvent?.({
          level: 'info',
          category: 'tracking',
          event: 'tracking_snapshot_applied',
          fields: buildTrackingSnapshotDiagnosticFields(operationalSnapshot),
        })
        const missionEvidenceSnapshot = filterMissionEvidenceSnapshot(snapshot)
        missionPersistenceResultIndex = sideEffects.length
        sideEffects.push(enqueueMissionPersistence(
          limitSnapshotForMissionPersistence(
            missionEvidenceSnapshot,
            dependencies.maxPersistedPositionsPerSnapshot,
          ),
          context?.historyResetKey ?? null,
        ))
      }
      let trackingCacheDataKey: string | null = null
      let trackingCacheRequestSequence: number | null = null
      let trackingCacheResultIndex: number | null = null
      const shouldWriteTrackingCache =
        writeCache && context?.suppressTrackingCache !== true

      if (shouldWriteTrackingCache) {
        trackingCacheDataKey = createTrackingCacheDataKey(snapshot)
        trackingCacheResultIndex = sideEffects.length
        if (trackingCacheDataKey !== latestQueuedTrackingCacheDataKey) {
          latestTrackingCacheRequestSequence += 1
          trackingCacheRequestSequence = latestTrackingCacheRequestSequence
          latestQueuedTrackingCacheDataKey = trackingCacheDataKey
          sideEffects.push(
            enqueueTrackingCacheWrite(
              runtimeGeneration,
              dependencies.cache,
              serializeTrackingCachePayload({
                cached_at: now().toISOString(),
                devices: snapshot.devices,
                positions: snapshot.positions,
                breadcrumbs: snapshot.breadcrumbs,
              }),
            ),
          )
        } else {
          sideEffects.push(Promise.resolve(null))
        }
      }

      await Promise.allSettled(sideEffects).then((results) => {
        if (trackingCacheResultIndex !== null) {
          const cacheWriteResult = results[trackingCacheResultIndex]
          if (cacheWriteResult !== undefined && cacheWriteResult.status === 'rejected') {
            logger.warn('Tracking cache update failed.', cacheWriteResult.reason)
            if (
              runtimeGeneration === activeTrackingRuntimeGeneration &&
              trackingCacheRequestSequence === latestTrackingCacheRequestSequence
            ) {
              latestQueuedTrackingCacheDataKey = lastTrackingCacheDataKey
            }
            if (
              runtimeGeneration === activeTrackingRuntimeGeneration &&
              !trackingCacheWarningActive
            ) {
              trackingCacheWarningActive = true
              refreshTrackingStatus()
              void dependencies.recordDiagnosticEvent?.({
                level: 'warn',
                category: 'tracking',
                event: 'tracking_cache_write_failed',
                fields: {},
              })
            }
          } else if (
            runtimeGeneration === activeTrackingRuntimeGeneration &&
            trackingCacheDataKey !== null &&
            (trackingCacheRequestSequence !== null ||
              trackingCacheDataKey === lastTrackingCacheDataKey)
          ) {
            if (trackingCacheRequestSequence !== null) {
              lastTrackingCacheDataKey = trackingCacheDataKey
            }
            if (trackingCacheWarningActive) {
              trackingCacheWarningActive = false
              refreshTrackingStatus()
              void dependencies.recordDiagnosticEvent?.({
                level: 'info',
                category: 'tracking',
                event: 'tracking_cache_write_recovered',
                fields: {},
              })
            }
          }
        }

        const missionPersistenceResult = missionPersistenceResultIndex === null
          ? undefined
          : results[missionPersistenceResultIndex]
        applyMissionPersistenceResult(missionPersistenceResult)
      })
    },
    onStatusChange: (status) => {
      latestTrackingStatus = status
      dependencies.applyStatus(decorateTrackingStatus(status))
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
    onPollDiagnostic: (entry) => {
      dependencies.recordTrackingPollDiagnostic?.(entry)
    },
  })

  const unsubscribeMissionWake = useMissionStore.subscribe((state, previousState) => {
    const missionId = state.currentMission?.id ?? null
    const previousMissionId = previousState.currentMission?.id ?? null
    if (state.phase !== previousState.phase || missionId !== previousMissionId) {
      poller.requestPollNow?.()
    }
  })
  const unsubscribeDeviceSelectionWake = useActiveMissionDevicesStore.subscribe(
    (state, previousState) => {
      const missionId = useMissionStore.getState().currentMission?.id ?? null
      if (
        missionId !== null &&
        state.activeDeviceIdsByMission[missionId] !==
          previousState.activeDeviceIdsByMission[missionId]
      ) {
        poller.requestPollNow?.()
      }
    },
  )
  const unsubscribeParticipationScope = dependencies.subscribeParticipationScope?.(() => {
    if (runtimeGeneration !== activeTrackingRuntimeGeneration) return
    if (readParticipationScopeStatus() === 'ready') {
      const pendingSnapshot = deferredOperationalSnapshot
      if (pendingSnapshot !== null) {
        const operationalSnapshot = filterOperationalSnapshot(pendingSnapshot.snapshot)
        if (operationalSnapshot !== null) {
          deferredOperationalSnapshot = null
          dependencies.applySnapshot(operationalSnapshot)
          scheduleParticipantBackfill()
          void dependencies.recordDiagnosticEvent?.({
            level: 'info',
            category: 'tracking',
            event: 'tracking_snapshot_applied_after_participant_hydration',
            fields: buildTrackingSnapshotDiagnosticFields(operationalSnapshot),
          })
          if (pendingSnapshot.persistAfterHydration) {
            const missionEvidenceSnapshot = filterMissionEvidenceSnapshot(
              pendingSnapshot.snapshot,
            )
            void enqueueMissionPersistence(
              limitSnapshotForMissionPersistence(
                missionEvidenceSnapshot,
                dependencies.maxPersistedPositionsPerSnapshot,
              ),
              pendingSnapshot.historyResetKey,
            ).then(
              () => applyMissionPersistenceResult({ status: 'fulfilled', value: undefined }),
              (reason: unknown) => applyMissionPersistenceResult({ status: 'rejected', reason }),
            )
          }
        }
      }
      poller.requestPollNow?.()
    }
    refreshTrackingStatus()
  }) ?? (() => undefined)
  poller.start()
  return () => {
    unsubscribeMissionWake()
    unsubscribeDeviceSelectionWake()
    unsubscribeParticipationScope()
    poller.stop()
    participantBackfillAbortController.abort()
    invalidateTrackingRuntimeGeneration(runtimeGeneration)
  }

  function scheduleParticipantBackfill(): void {
    if (
      dependencies.missionModelEnabled !== true ||
      participantBackfillInFlight ||
      dependencies.missionStore.listParticipantBackfillCheckpoints === undefined ||
      dependencies.missionStore.upsertParticipantBackfillCheckpoint === undefined ||
      dependencies.missionStore.persistTrackingHistoryBatch === undefined ||
      !hasBreadcrumbClient(client)
    ) return

    participantBackfillInFlight = true
    void runNextParticipantBackfillPass().catch((error) => {
      if (!participantBackfillAbortController.signal.aborted) {
        logger.warn('Participant history backfill pass failed; it will retry.', error)
      }
    }).finally(() => {
      participantBackfillInFlight = false
    })
  }

  async function runNextParticipantBackfillPass(): Promise<void> {
    if (!hasBreadcrumbClient(client)) return
    const activeMission = await dependencies.missionStore.getActiveMission()
    if (activeMission === null) return
    const checkpoints = await dependencies.missionStore.listParticipantBackfillCheckpoints?.(
      activeMission.id,
    ) ?? []
    const checkpoint = checkpoints.find((candidate) => candidate.completed !== 1)
    if (checkpoint === undefined) return
    await runParticipantBackfillPass({
      checkpoint,
      getBreadcrumbs: client.getBreadcrumbs,
      persistChunk: dependencies.missionStore.persistTrackingHistoryBatch!,
      updateCheckpoint: dependencies.missionStore.upsertParticipantBackfillCheckpoint!,
      signal: participantBackfillAbortController.signal,
    })
  }

  function enqueueMissionPersistence(
    snapshot: TrackingSnapshot,
    expectedMissionId: string | null,
  ): Promise<void> {
    return enqueueTrackingPersistence(runtimeGeneration, async () => {
      persistedPositionKeyCache = await persistTrackingSnapshot(
        snapshot,
        dependencies.missionStore,
        persistedPositionKeyCache,
        expectedMissionId,
        dependencies.notifyDurablePositionChange,
        dependencies.missionModelEnabled !== true,
      )
    })
  }

  function enqueueCanonicalBreadcrumbQuery(
    expectedMissionId: string,
    signal?: AbortSignal,
  ): Promise<CanonicalBreadcrumbSeed> {
    return enqueueBreadcrumbStorageQuery(expectedMissionId, signal).then(
      (canonical) => ({
        positions: canonical.positions,
        totalObservedByDevice: canonical.totalObservedByDevice,
        selectionMetadataByDevice: canonical.selectionMetadataByDevice,
      }),
    )
  }

  function enqueueBreadcrumbStorageQuery(
    expectedMissionId: string,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof getInitialPersistedBreadcrumbs>>> {
    const run = breadcrumbStorageQueryTail.then(() =>
      loadBreadcrumbStorageQuery(expectedMissionId, signal),
    )
    breadcrumbStorageQueryTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function loadBreadcrumbStorageQuery(
    expectedMissionId: string,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof getInitialPersistedBreadcrumbs>>> {
    throwIfBreadcrumbQueryAborted(signal)
    const activeMission = await dependencies.missionStore.getActiveMission()
    throwIfBreadcrumbQueryAborted(signal)
    if (activeMission?.id !== expectedMissionId) {
      throw new Error(
        'Tracking history mission changed before breadcrumbs could be loaded.',
      )
    }

    const requestId =
      `tracking-breadcrumb-${breadcrumbRendererSessionId}-${runtimeGeneration}-${++nextBreadcrumbQueryRequestSequence}`
    const cancelActiveQuery = () => {
      void dependencies.missionStore.cancelBreadcrumbQuery?.(requestId).catch(
        () => undefined,
      )
    }
    signal?.addEventListener('abort', cancelActiveQuery, { once: true })
    try {
      throwIfBreadcrumbQueryAborted(signal)
      let canonical: Awaited<ReturnType<typeof getInitialPersistedBreadcrumbs>>
      try {
        canonical = await getInitialPersistedBreadcrumbs(
          dependencies.missionStore,
          expectedMissionId,
          requestId,
        )
      } catch (error) {
        if (signal?.aborted === true) {
          throwIfBreadcrumbQueryAborted(signal)
        }
        throw error
      }
      throwIfBreadcrumbQueryAborted(signal)
      const currentMission = await dependencies.missionStore.getActiveMission()
      throwIfBreadcrumbQueryAborted(signal)
      if (currentMission?.id !== expectedMissionId) {
        throw new Error(
          'Tracking history mission changed while breadcrumbs were loading.',
        )
      }
      return canonical
    } finally {
      signal?.removeEventListener('abort', cancelActiveQuery)
    }
  }

  async function loadInitialPersistedBreadcrumbs(signal?: AbortSignal): Promise<
    Awaited<ReturnType<typeof getInitialPersistedBreadcrumbs>>
  > {
    throwIfBreadcrumbQueryAborted(signal)
    const activeMission = await dependencies.missionStore.getActiveMission()
    throwIfBreadcrumbQueryAborted(signal)
    const missionId = activeMission?.id ?? null
    if (
      initialPersistedBreadcrumbs === null ||
      initialPersistedBreadcrumbs.missionId !== missionId
    ) {
      initialPersistedBreadcrumbs = {
        missionId,
        promise: missionId === null
          ? getInitialPersistedBreadcrumbs(dependencies.missionStore, null)
          : enqueueBreadcrumbStorageQuery(missionId, signal),
      }
    }
    const pendingLoad = initialPersistedBreadcrumbs
    try {
      const seed = await pendingLoad.promise
      throwIfBreadcrumbQueryAborted(signal)
      return seed
    } catch (error) {
      // A worker timeout or transient read failure must remain visible for this
      // poll, but it must not poison the mission for the rest of the runtime.
      // Only clear the promise we awaited so a newer mission load cannot be
      // invalidated by an older request settling late.
      if (initialPersistedBreadcrumbs === pendingLoad) {
        initialPersistedBreadcrumbs = null
      }
      if (signal?.aborted === true) {
        throwIfBreadcrumbQueryAborted(signal)
      }
      throw error
    }
  }

  function decorateTrackingStatus(
    status: TrackingConnectionStatus,
  ): TrackingConnectionStatus {
    const warnings = [
      status.warning,
      droppedPersistedBreadcrumbCount > 0
        ? formatDroppedPersistedBreadcrumbWarning(
            droppedPersistedBreadcrumbCount,
          )
        : null,
      trackingCacheWarningActive
        ? 'TRACKING FALLBACK CACHE UPDATE FAILED — live fixes remain visible, but the last-known tracking view may be unavailable after restart while Traccar is offline.'
        : null,
      missionPersistenceWarningActive
        ? 'MISSION BREADCRUMB STORAGE FAILED — current fixes remain visible, but new trail history may not survive restart.'
        : null,
      participantScopeWarning(),
    ].filter((warning): warning is string => warning !== null)
    return {
      ...status,
      warning: warnings.length === 0 ? null : warnings.join(' '),
    }
  }

  function refreshTrackingStatus(): void {
    if (latestTrackingStatus !== null) {
      dependencies.applyStatus(decorateTrackingStatus(latestTrackingStatus))
    }
  }

  /** Publishes failure and recovery only when a mission persistence attempt settled. */
  function applyMissionPersistenceResult(
    result: PromiseSettledResult<unknown> | undefined,
  ): void {
    if (result === undefined) return
    if (result.status === 'rejected') {
      logger.warn('Tracking mission persistence failed.', result.reason)
      if (
        runtimeGeneration === activeTrackingRuntimeGeneration &&
        !missionPersistenceWarningActive
      ) {
        missionPersistenceWarningActive = true
        refreshTrackingStatus()
        void dependencies.recordDiagnosticEvent?.({
          level: 'warn',
          category: 'tracking',
          event: 'tracking_mission_persistence_failed',
          fields: {},
        })
      }
      return
    }
    if (
      runtimeGeneration === activeTrackingRuntimeGeneration &&
      missionPersistenceWarningActive
    ) {
      missionPersistenceWarningActive = false
      refreshTrackingStatus()
      void dependencies.recordDiagnosticEvent?.({
        level: 'info',
        category: 'tracking',
        event: 'tracking_mission_persistence_recovered',
        fields: {},
      })
    }
  }

  /** Applies current visibility only after the mission participant scope is trustworthy. */
  function filterOperationalSnapshot(snapshot: TrackingSnapshot): TrackingSnapshot | null {
    if (dependencies.missionModelEnabled !== true) return snapshot
    if (readParticipationScopeStatus() !== 'ready') return null
    const scope = dependencies.readParticipationScope?.()
    return scope?.filterSnapshot(snapshot, now().toISOString()) ?? null
  }

  /** Applies evidence windows independently from immediate current-position visibility. */
  function filterMissionEvidenceSnapshot(snapshot: TrackingSnapshot): TrackingSnapshot {
    if (dependencies.missionModelEnabled !== true) return snapshot
    const scope = dependencies.readParticipationScope?.()
    return scope?.filterEvidenceSnapshot(snapshot, now().toISOString()) ?? {
      ...snapshot,
      devices: [],
      positions: [],
      breadcrumbs: [],
      rawBreadcrumbsForPersistence: [],
    }
  }

  /** Treats a missing scope as unavailable while retaining legacy test/runtime compatibility. */
  function readParticipationScopeStatus(): 'loading' | 'ready' | 'error' {
    if (dependencies.missionModelEnabled !== true) return 'ready'
    return dependencies.readParticipationScopeStatus?.()
      ?? (dependencies.readParticipationScope === undefined ? 'error' : 'ready')
  }

  /** Keeps a scope failure operator-visible without presenting an empty map as cached truth. */
  function participantScopeWarning(): string | null {
    const status = readParticipationScopeStatus()
    if (status === 'ready') return null
    return status === 'loading'
      ? 'PARTICIPANT SELECTION LOADING — last-known positions will appear as soon as mission participation is ready.'
      : 'PARTICIPANT SELECTION UNAVAILABLE — live and cached positions are being preserved but cannot be shown until mission participation reloads.'
  }

  /** Keeps current-position publication independent of participant SQLite writes. */
  function applyParticipantRosterWithoutBlocking(
    devices: readonly NormalizedTrackingDevice[],
    context: TrackingSnapshotContext | undefined,
  ): void {
    // Polling emits an application-owned empty idle snapshot before a mission.
    // It is not a roster observation and must not erase GET-only discovery.
    if (context?.participantRosterAuthoritative === false && devices.length === 0) return
    try {
      const update = context?.participantRosterAuthoritative === false
        ? dependencies.applyParticipantRoster?.(devices, { complete: false })
        : dependencies.applyParticipantRoster?.(devices)
      void Promise.resolve(update).catch((error) => {
        logger.warn('Participant roster reconciliation failed.', error)
      })
    } catch (error) {
      logger.warn('Participant roster reconciliation failed.', error)
    }
  }
}

async function preloadParticipantDiscovery(
  client: unknown,
  dependencies: Pick<
    StartTrackingRuntimeDependencies,
    'applyParticipantGroups' | 'applyParticipantRoster' | 'applyParticipantRosterError'
  >,
  logger: TrackingRuntimeLogger,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isParticipantRosterClient(client)) {
    if (isCurrent()) {
      dependencies.applyParticipantRosterError?.(
        'Participant selection is unavailable because the tracking client cannot read the Traccar roster.',
      )
    }
    return
  }
  try {
    await client.authenticate()
    const [roster, groups] = await Promise.all([
      client.getDevicesWithReport?.() ?? client.getDevices().then((accepted) => ({
        accepted,
        complete: true,
      })),
      client.getGroups(),
      // Current fixes stay on the same bulk GET path. They are intentionally
      // not published to the operational map until participation is known.
      client.getCurrentPositions(),
    ])
    if (!isCurrent()) return
    await Promise.all([
      roster.complete
        ? dependencies.applyParticipantRoster?.(roster.accepted)
        : dependencies.applyParticipantRoster?.(roster.accepted, { complete: false }),
      dependencies.applyParticipantGroups?.(groups),
    ])
    if (isCurrent()) dependencies.applyParticipantRosterError?.(null)
  } catch (error) {
    logger.warn('Participant roster preload failed.', error)
    if (isCurrent()) {
      dependencies.applyParticipantRosterError?.(
        `Participant roster could not be loaded. Device-level fallback remains available after tracking reconnects: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function isParticipantRosterClient(client: unknown): client is ParticipantRosterClient {
  if (typeof client !== 'object' || client === null) return false
  const candidate = client as Partial<ParticipantRosterClient>
  return (
    typeof candidate.authenticate === 'function' &&
    typeof candidate.getDevices === 'function' &&
    typeof candidate.getGroups === 'function' &&
    typeof candidate.getCurrentPositions === 'function'
  )
}

function hasBreadcrumbClient(client: unknown): client is Pick<ParticipantRosterClient, never> & {
  readonly getBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
} {
  return typeof client === 'object' && client !== null &&
    typeof (client as { readonly getBreadcrumbs?: unknown }).getBreadcrumbs === 'function'
}

function createBreadcrumbRendererSessionId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function throwIfBreadcrumbQueryAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) {
    return
  }
  const error = new Error('Canonical breadcrumb query was cancelled.')
  error.name = 'AbortError'
  throw error
}

function invalidateTrackingRuntimeGeneration(runtimeGeneration: number): void {
  if (activeTrackingRuntimeGeneration === runtimeGeneration) {
    activeTrackingRuntimeGeneration = ++nextTrackingRuntimeGeneration
  }
}

function enqueueTrackingPersistence(
  runtimeGeneration: number,
  operation: () => Promise<void>,
): Promise<void> {
  const run = trackingPersistenceTail.then(async () => {
    if (runtimeGeneration !== activeTrackingRuntimeGeneration) {
      return
    }
    await operation()
  })
  trackingPersistenceTail = run.catch(() => undefined)
  return run
}

function enqueueTrackingCacheWrite(
  runtimeGeneration: number,
  cache: TrackingRuntimeCache,
  contents: string,
): Promise<unknown> {
  const run = trackingCacheWriteTail.then(() =>
    runtimeGeneration === activeTrackingRuntimeGeneration
      ? cache.write(contents)
      : null,
  )
  trackingCacheWriteTail = run.catch(() => undefined)
  return run
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
  const finiteGeometryBounds = budgets.flatMap((budget) =>
    typeof budget.geometryErrorBoundMetres === 'number' &&
    Number.isFinite(budget.geometryErrorBoundMetres)
      ? [budget.geometryErrorBoundMetres]
      : [],
  )
  return {
    deviceCount: snapshot.devices.length,
    currentPositionCount: snapshot.positions.length,
    breadcrumbCount: snapshot.breadcrumbs.length,
    retainedBreadcrumbCount: snapshot.breadcrumbMetadata?.totalRetained ?? snapshot.breadcrumbs.length,
    observedBreadcrumbCount: snapshot.breadcrumbMetadata?.totalObserved ?? snapshot.breadcrumbs.length,
    truncatedDeviceCount: budgets.filter((budget) => budget.truncated).length,
    degradedGeometryDeviceCount: budgets.filter(
      (budget) => budget.truncated && budget.targetGeometryErrorSatisfied === false,
    ).length,
    maximumGeometryErrorBoundMetres:
      finiteGeometryBounds.length === 0 ? 0 : Math.max(...finiteGeometryBounds),
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
    .slice(maxBreadcrumbs === 0 ? persistenceBreadcrumbs.length : -maxBreadcrumbs)

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
  expectedMissionId: string | null,
  notifyDurablePositionChange?: (changedPositionCount: number) => void,
  legacyAutoParticipants = true,
): Promise<PersistedPositionKeyCache | null> {
  const activeMission = await missionStore.getActiveMission()
  if (
    activeMission === null ||
    (expectedMissionId !== null && activeMission.id !== expectedMissionId)
  ) {
    return null
  }

  const nextPositionKeyCache =
    persistedPositionKeyCache?.missionId === activeMission.id
      ? persistedPositionKeyCache
      : {
          missionId: activeMission.id,
          keys: new Set(
            (
              missionStore.listRecentPositions === undefined
                ? await missionStore.listPositions(activeMission.id)
                : await missionStore.listRecentPositions(
                    activeMission.id,
                    MAX_RESTART_BREADCRUMBS_PER_DEVICE,
                  )
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
          group_id: device.group_id ?? null,
          unique_id: device.unique_id,
        })),
        ...(legacyAutoParticipants ? { participant_provenance: 'legacy_auto' as const } : {}),
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
          group_id: device.group_id ?? null,
          unique_id: device.unique_id,
          ...(legacyAutoParticipants ? { participant_provenance: 'legacy_auto' as const } : {}),
        })
      }
    }
  }

  const newPositions: {
    readonly source_position_id?: string | null
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
    const positionKeys = createIncomingPositionCacheKeys(position)
    const cacheLookupKeys = positionKeys
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
      source_position_id: position.id,
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

  if (missionStore.persistTrackingPositionsBulk !== undefined) {
    const persisted = await missionStore.persistTrackingPositionsBulk({
      mission_id: activeMission.id,
      positions: newPositions,
      checkpoints: [],
    })
    notifyDurablePositionChange?.(persisted.changedPositionCount)
  } else if (missionStore.addPositionsBulk !== undefined) {
    const persisted = await missionStore.addPositionsBulk({
      mission_id: activeMission.id,
      positions: newPositions,
    })
    notifyDurablePositionChange?.(
      Array.isArray(persisted) ? persisted.length : newPositions.length,
    )
  } else {
    for (const position of newPositions) {
      await missionStore.addPosition({
        mission_id: activeMission.id,
        ...position,
      })
    }
    notifyDurablePositionChange?.(newPositions.length)
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

/**
 * Returns only safe in-memory suppression keys for an incoming tracking fix.
 */
export function createIncomingPositionCacheKeys(
  position: NormalizedTrackingPosition,
): readonly string[] {
  // Source identities are stable keys, not immutable payloads. Traccar can
  // correct coordinates or timestamps for an existing position id, so every
  // sourced fix must reach the mission store's idempotent correction check.
  // Only legacy coordinate/time identities are safe to suppress in memory.
  return position.id.trim() === ''
    ? [createTrackingPositionCoordinateKey(position)]
    : []
}

function createPersistedPositionKeys(position: {
  readonly id?: string
  readonly source_position_id?: string | null
  readonly device_id: string
  readonly lat?: number
  readonly lon?: number
  readonly timestamp: string
}): readonly string[] {
  const keys: string[] = []
  const persistedId = position.source_position_id?.trim()
  if (persistedId) {
    return keys
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
  missionId: string | null,
  breadcrumbQueryRequestId?: string,
): Promise<{
  readonly missionId: string | null
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly totalObservedByDevice: Readonly<Record<string, number>>
  readonly selectionMetadataByDevice: Readonly<Record<string, {
    readonly geometryErrorBoundMetres: number | null
    readonly targetGeometryErrorSatisfied: boolean
  }>>
  readonly historyCheckpointsByDevice: Readonly<
    Record<string, BreadcrumbHistoryCheckpointSeed>
  >
  readonly droppedPositionCount: number
}> {
  if (missionId === null) {
    return {
      missionId: null,
      positions: [],
      totalObservedByDevice: {},
      selectionMetadataByDevice: {},
      historyCheckpointsByDevice: {},
      droppedPositionCount: 0,
    }
  }

  const [selected, historyCheckpoints] = await Promise.all([
    missionStore.listBreadcrumbPositions === undefined
      ? Promise.resolve(null)
      : breadcrumbQueryRequestId === undefined
        ? missionStore.listBreadcrumbPositions(
            missionId,
            MAX_RESTART_BREADCRUMBS_PER_DEVICE,
          )
        : missionStore.listBreadcrumbPositions(
            missionId,
            MAX_RESTART_BREADCRUMBS_PER_DEVICE,
            breadcrumbQueryRequestId,
          ),
    missionStore.listTrackingHistoryCheckpoints === undefined
      ? Promise.resolve([])
      : missionStore.listTrackingHistoryCheckpoints(missionId),
  ])
  const positions = selected?.positions ?? await (
    missionStore.listRecentPositions === undefined
      ? missionStore.listPositions(missionId)
      : missionStore.listRecentPositions(
          missionId,
          MAX_RESTART_BREADCRUMBS_PER_DEVICE,
        )
  )
  const totalObservedByDevice =
    selected === null
      ? Object.fromEntries(
          [...new Set(positions.map((position) => position.device_id))].map(
            (deviceId) => [
              deviceId,
              positions.filter((position) => position.device_id === deviceId).length,
            ],
          ),
        )
      : Object.fromEntries(
          selected.deviceTotals.map((entry) => [entry.device_id, entry.total]),
        )
  const selectionMetadataByDevice = Object.fromEntries(
    (selected?.deviceSelections ?? []).map((entry) => [
      entry.device_id,
      {
        geometryErrorBoundMetres: entry.geometryErrorBoundMetres,
        targetGeometryErrorSatisfied: entry.targetGeometryErrorSatisfied,
        ...(entry.timeBucketWidthMs === undefined
          ? {}
          : { timeBucketWidthMs: entry.timeBucketWidthMs }),
        ...(entry.spatialBucketWidthDegrees === undefined
          ? {}
          : { spatialBucketWidthDegrees: entry.spatialBucketWidthDegrees }),
      },
    ]),
  )
  const historyCheckpointsByDevice = Object.fromEntries(
    historyCheckpoints.map((checkpoint) => [
      checkpoint.device_id,
      {
        historyFrom: checkpoint.history_from,
        reconciledUntil: checkpoint.reconciled_until,
      },
    ]),
  )
  let droppedPositionCount = selected?.droppedPositionCount ?? 0
  const normalizedPositions = positions.flatMap((position) => {
      const lat = Number(position.lat)
      const lon = Number(position.lon)
      const timestamp = safelyNormalizePersistedTrackingTimestamp(position.timestamp)
      if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lon) ||
        lon < -180 ||
        lon > 180 ||
        timestamp === null
      ) {
        droppedPositionCount += 1
        return []
      }

      return [{
        // Legacy rows predate preservation of Traccar's source position id.
        // Leave the normalized id empty so the accumulator uses its exact
        // coordinate/time fallback identity instead of mistaking our local
        // SQLite UUID for an upstream identity.
        id: position.source_position_id ?? '',
        device_id: position.device_id,
        lat,
        lon,
        altitude: position.altitude ?? null,
        speed: position.speed ?? null,
        battery: position.battery ?? null,
        accuracy: position.accuracy ?? null,
        source: position.source ?? null,
        timestamp,
        data_origin: position.data_origin ?? 'live',
        cache_age_seconds: null,
        device_cache_stale: false,
      } satisfies NormalizedTrackingPosition]
    })
  return {
    missionId,
    totalObservedByDevice,
    selectionMetadataByDevice,
    historyCheckpointsByDevice,
    positions: normalizedPositions,
    droppedPositionCount,
  }
}

function formatDroppedPersistedBreadcrumbWarning(count: number): string {
  const noun = count === 1 ? 'fix was' : 'fixes were'
  return `${count} unreadable stored breadcrumb ${noun} ignored; valid history and current fixes remain visible.`
}

/**
 * Applies the same explicit ISO and calendar validation to persisted positions
 * regardless of which desktop mission-store adapter supplied them.
 */
function safelyNormalizePersistedTrackingTimestamp(value: unknown): string | null {
  try {
    return normalizeTrackingIsoTimestamp(value, 'Persisted breadcrumb timestamp')
  } catch {
    return null
  }
}

function safelyParseCachedSnapshot(
  contents: string,
  logger: TrackingRuntimeLogger,
): ReturnType<typeof parseTrackingCachePayload> | null {
  try {
    return parseTrackingCachePayload(contents, {
      onDroppedEntries: (summary) => {
        logger.warn('Dropped malformed tracking cache entries.', summary)
      },
    })
  } catch (error) {
    logger.warn('Tracking cache payload was ignored.', error)
    return null
  }
}
