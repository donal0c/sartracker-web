import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import {
  createBreadcrumbAccumulator,
  type BreadcrumbSelectionMetadata,
} from './breadcrumb-accumulator'
import {
  createBreadcrumbHistoryReconciler,
  type BreadcrumbHistoryChunk,
  type BreadcrumbHistoryProgress,
} from './breadcrumb-history-reconciler'
import { annotateTrackingSnapshotHealth } from './tracking-snapshot-health'
import type {
  TrackingBreadcrumbWindowSummary,
  TrackingPollLedgerEntry,
  TrackingPollPhase,
} from '../diagnostics/tracking-poll-ledger'
import { classifyTrackingFailure } from '../diagnostics/tracking-poll-ledger'
import {
  fetchRosterAndCurrentPositions,
} from './current-position-poll'
import type { CurrentPositionRejection } from './ingest-health'
import type {
  CurrentPositionNormalizationResult,
  DeviceRosterNormalizationResult,
} from './traccar-client'

const EMPTY_TRACKING_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
  rawBreadcrumbsForPersistence: [],
}

// Gives a prompt roster response one short turn to prevent placeholder device
// rows becoming durable immediately before their real source metadata arrives.
const CURRENT_POSITION_ROSTER_GRACE_MS = 50

export type TrackingPollerClient = {
  readonly authenticate: () => Promise<void>
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getDevicesWithReport?: () => Promise<DeviceRosterNormalizationResult>
  readonly getCurrentPositions: () => Promise<readonly NormalizedTrackingPosition[]>
  readonly getCurrentPositionsWithReport?: () => Promise<CurrentPositionNormalizationResult>
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
  readonly getInitialBreadcrumbs?: (
    signal?: AbortSignal,
  ) => Promise<readonly NormalizedTrackingPosition[]>
  readonly getInitialBreadcrumbTotals?: (
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, number>>>
  readonly getInitialBreadcrumbSelectionMetadata?: (
    signal?: AbortSignal,
  ) => Promise<
    Readonly<Record<string, BreadcrumbSelectionMetadata>>
  >
  readonly getInitialHistoryCheckpoints?: (signal?: AbortSignal) => Promise<
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
  readonly getBreadcrumbDeviceIds?: () => readonly string[] | null
  /** Selected mission participants. An explicit empty list means fetch no history. */
  readonly getParticipantDeviceIds?: () => readonly string[] | null
  readonly onSnapshot: (
    snapshot: TrackingSnapshot,
    context: TrackingSnapshotContext,
  ) => void
  readonly onStatusChange: (status: TrackingConnectionStatus) => void
  readonly onCurrentPositionRejections?: (
    rejections: readonly CurrentPositionRejection[],
    context: {
      readonly missionId: string | null
      readonly observedAt: string
    },
  ) => void
  readonly onPollDiagnostic?: (entry: TrackingPollLedgerEntry) => void
  readonly logger?: PollingManagerLogger
  readonly now?: () => Date
  readonly setTimeout?: typeof window.setTimeout
  readonly clearTimeout?: typeof window.clearTimeout
}

export type TrackingSnapshotContext = {
  readonly historyResetKey: string | null
  readonly suppressTrackingCache?: boolean
  /** False for idle, unavailable, or partially normalized roster observations. */
  readonly participantRosterAuthoritative?: boolean
}

export type BreadcrumbHistoryCheckpointSeed = {
  readonly historyFrom: string
  readonly reconciledUntil: string
}

export type TrackingHistoryChunkPersistenceInput = {
  readonly phase: 'initial' | 'anti_entropy'
  readonly expectedMissionId: string | null
  readonly deviceId: string
  readonly historyFrom: string
  readonly reconciledUntil: string
  readonly positions: readonly NormalizedTrackingPosition[]
}

export type TrackingHistoryChunkPersistenceResult = {
  readonly changed: boolean
}

export type CanonicalBreadcrumbSeed = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly totalObservedByDevice: Readonly<Record<string, number>>
  readonly selectionMetadataByDevice: Readonly<
    Record<string, BreadcrumbSelectionMetadata>
  >
}

const DEFAULT_MAX_BACKOFF_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 30_000
const MIN_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 3_600_000
const BREADCRUMB_CURSOR_OVERLAP_MS = 5 * 60 * 1000
const BREADCRUMB_RECENT_WINDOW_MAX_MS = 2 * 60 * 60 * 1000
const HISTORY_PUBLISH_DELAY_MS = 100
const HISTORY_PERSISTENCE_BATCH_LIMIT = 5_000

const DEFAULT_LOGGER: PollingManagerLogger = {
  warn: (message, context) => {
    console.warn(message, context)
  },
}

type PollingManager = {
  readonly start: () => void
  readonly stop: () => void
  readonly requestPollNow: () => void
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
  let pollInFlight = false
  let immediatePollRequested = false
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
  let initialSeedAbortController: AbortController | null = null
  let breadcrumbFetchCompleted = false
  let breadcrumbStatusWarning: string | null = null
  const latestBreadcrumbTimestampByDevice = new Map<string, string>()
  let latestDevices: readonly NormalizedTrackingDevice[] = []
  let latestParticipantRosterAuthoritative = false
  let latestCurrentPositions: readonly NormalizedTrackingPosition[] = []
  const pendingHistoryRenderPositions: NormalizedTrackingPosition[] = []
  const pendingHistoryMissionPersistencePositions: NormalizedTrackingPosition[] = []
  let initialHistoryCheckpointsByDevice: Readonly<
    Record<string, BreadcrumbHistoryCheckpointSeed>
  > = {}
  let historyPublishTimer: ReturnType<typeof setTimeout> | null = null
  let canonicalizationRetryTimer: ReturnType<typeof setTimeout> | null = null
  let canonicalizationSequence = 0
  let canonicalizationRefreshPending = false
  let initialReconciliationComplete = false
  let initialReconciliationSelectionKey: string | null = null
  let canonicalizationInFlight: {
    readonly sequence: number
    readonly historyResetKey: string
    readonly abortController: AbortController
    readonly trailingPositions: NormalizedTrackingPosition[]
  } | null = null
  let boundedSourceRetention = false
  let lifecycleGeneration = 0

  const createHistoryPersistenceInput = (
    chunk: BreadcrumbHistoryChunk,
  ): TrackingHistoryChunkPersistenceInput => ({
    phase: chunk.phase,
    expectedMissionId: activeHistoryResetKey,
    deviceId: chunk.deviceId,
    historyFrom: chunk.historyFrom.toISOString(),
    reconciledUntil: chunk.to.toISOString(),
    positions: chunk.positions,
  })

  const acceptPersistedHistoryChunk = (
    chunk: BreadcrumbHistoryChunk,
    persistedDirectly: boolean,
    persistenceResult: TrackingHistoryChunkPersistenceResult | null,
  ): void => {
    if (!isHistoryReconciliationCurrent()) {
      return
    }
    canonicalizationInFlight?.trailingPositions.push(...chunk.positions)
    if (
      chunk.phase === 'anti_entropy' &&
      persistenceResult?.changed === true
    ) {
      requestCanonicalization()
    }
    if (chunk.positions.length === 0) {
      return
    }
    for (const position of chunk.positions) {
      pendingHistoryRenderPositions.push(position)
      if (!persistedDirectly) {
        pendingHistoryMissionPersistencePositions.push(position)
      }
      if (
        pendingHistoryRenderPositions.length ===
        HISTORY_PERSISTENCE_BATCH_LIMIT
      ) {
        flushHistorySnapshot(false)
      }
    }
    if (pendingHistoryRenderPositions.length > 0) {
      if (persistedDirectly) {
        scheduleHistorySnapshotPublish()
      } else {
        // The direct polling-manager fallback has no acknowledgement port.
        // Publish immediately so an accepted chunk is not left behind a
        // mission transition. Production runtimes provide persistence hooks.
        flushHistorySnapshot(false)
      }
    }
  }

  const historyReconciler = createBreadcrumbHistoryReconciler({
    fetchBreadcrumbs: (deviceId, from, to) =>
      client.getBreadcrumbs(deviceId, from, to),
    onChunk: async (chunk) => {
      if (!isHistoryReconciliationCurrent()) {
        return
      }
      const input = createHistoryPersistenceInput(chunk)
      let persistedDirectly = false
      let persistenceResult: TrackingHistoryChunkPersistenceResult | null = null
      if (options.persistHistoryChunk !== undefined) {
        persistenceResult = await options.persistHistoryChunk(input)
        persistedDirectly = true
      } else if (
        chunk.phase === 'initial' &&
        options.persistHistoryChunks !== undefined
      ) {
        await options.persistHistoryChunks([input])
        persistedDirectly = true
      }
      acceptPersistedHistoryChunk(
        chunk,
        persistedDirectly,
        persistenceResult,
      )
    },
    onChunks: async (chunks) => {
      if (!isHistoryReconciliationCurrent()) {
        return
      }
      const inputs = chunks.map(createHistoryPersistenceInput)
      if (options.persistHistoryChunks !== undefined) {
        await options.persistHistoryChunks(inputs)
        if (!isHistoryReconciliationCurrent()) {
          return
        }
        for (const chunk of chunks) {
          acceptPersistedHistoryChunk(chunk, true, null)
        }
        return
      }
      if (options.persistHistoryChunk !== undefined) {
        const results = await Promise.all(
          inputs.map((input) => options.persistHistoryChunk?.(input)),
        )
        if (!isHistoryReconciliationCurrent()) {
          return
        }
        chunks.forEach((chunk, index) => {
          acceptPersistedHistoryChunk(
            chunk,
            true,
            results[index] ?? null,
          )
        })
        return
      }
      for (const chunk of chunks) {
        acceptPersistedHistoryChunk(chunk, false, null)
      }
    },
    onProgress: (progress) => {
      if (!isHistoryReconciliationCurrent()) {
        return
      }
      if (progress.targetFrom !== null && progress.targetTo !== null) {
        options.onPollDiagnostic?.({
          ts: now().toISOString(),
          kind: 'breadcrumb_reconciliation',
          outcome: progress.complete ? 'complete' : 'progress',
          reconciliationPhase: progress.phase,
          targetFrom: progress.targetFrom,
          targetTo: progress.targetTo,
          totalDeviceCount: progress.totalDeviceCount,
          completedDeviceCount: progress.completedDeviceCount,
          totalChunkCount: progress.totalChunkCount,
          completedChunkCount: progress.completedChunkCount,
          pendingDeviceCount: progress.pendingDeviceCount,
          failedDeviceCount: progress.failedDeviceCount,
          elapsedMs: progress.elapsedMs,
        })
      }
      if (progress.phase === 'initial') {
        if (progress.complete && !initialReconciliationComplete) {
          initialReconciliationComplete = true
          flushHistorySnapshot(true, true)
          requestCanonicalization()
        } else if (!progress.complete) {
          initialReconciliationComplete = false
        }
      } else if (progress.complete) {
        flushHistorySnapshot(true, true)
      }
      if (progress.phase === 'anti_entropy') {
        return
      }
      breadcrumbStatusWarning = createHistoryReconciliationWarning(progress)
      if (lastSuccessAt !== null && consecutiveFailures === 0) {
        publishStatus({
          mode: 'online',
          warning: breadcrumbStatusWarning,
        })
      }
    },
    shouldContinue: isHistoryReconciliationCurrent,
    logger,
    setTimeout: scheduleTimeout,
    clearTimeout: clearScheduledTimeout,
  })

  function scheduleHistorySnapshotPublish(): void {
    if (historyPublishTimer !== null) {
      return
    }
    historyPublishTimer = scheduleTimeout(() => {
      historyPublishTimer = null
      flushHistorySnapshot(false)
    }, HISTORY_PUBLISH_DELAY_MS)
  }

  function discardPendingHistorySnapshot(): void {
    if (historyPublishTimer !== null) {
      clearScheduledTimeout(historyPublishTimer)
      historyPublishTimer = null
    }
    pendingHistoryRenderPositions.splice(0, pendingHistoryRenderPositions.length)
    pendingHistoryMissionPersistencePositions.splice(
      0,
      pendingHistoryMissionPersistencePositions.length,
    )
  }

  function requestCanonicalization(): void {
    if (
      options.getCanonicalBreadcrumbs === undefined ||
      activeHistoryResetKey === null ||
      !isHistoryReconciliationCurrent()
    ) {
      return
    }
    if (canonicalizationInFlight !== null) {
      canonicalizationRefreshPending = true
      return
    }
    if (canonicalizationRetryTimer !== null) {
      clearScheduledTimeout(canonicalizationRetryTimer)
      canonicalizationRetryTimer = null
    }
    const sequence = ++canonicalizationSequence
    const historyResetKey = activeHistoryResetKey
    const abortController = new AbortController()
    const state = {
      sequence,
      historyResetKey,
      abortController,
      trailingPositions: [] as NormalizedTrackingPosition[],
    }
    canonicalizationInFlight = state
    let completedSuccessfully = false
    void options.getCanonicalBreadcrumbs(
      historyResetKey,
      abortController.signal,
    ).then((canonical) => {
      if (
        canonicalizationInFlight !== state ||
        sequence !== canonicalizationSequence ||
        activeHistoryResetKey !== historyResetKey ||
        !isHistoryReconciliationCurrent()
      ) {
        return
      }
      let result = breadcrumbAccumulator.reset(
        canonical.positions,
        canonical.totalObservedByDevice,
        canonical.selectionMetadataByDevice,
      )
      if (state.trailingPositions.length > 0) {
        result = breadcrumbAccumulator.append(state.trailingPositions, {
          resolveObservedBaseline: true,
        })
      }
      result = breadcrumbAccumulator.compact()
      boundedSourceRetention = true
      breadcrumbPositions = result.positions
      breadcrumbMetadata = result.metadata
      const snapshot = {
        devices: latestDevices,
        positions: latestCurrentPositions,
        breadcrumbs: breadcrumbPositions,
        rawBreadcrumbsForPersistence: [],
        breadcrumbMetadata,
      }
      lastGoodSnapshot = snapshot
      options.onSnapshot(
        annotateTrackingSnapshotHealth(snapshot, {
          now: now(),
          deviceStaleThresholdMs: options.staleThresholdMs,
        }),
        {
          historyResetKey,
          ...(latestParticipantRosterAuthoritative
            ? {}
            : { participantRosterAuthoritative: false }),
        },
      )
      completedSuccessfully = true
    }).catch((error) => {
      if (isAbortError(error)) {
        return
      }
      logger.warn('Tracking breadcrumb canonicalization failed.', {
        error: error instanceof Error ? error.message : String(error),
      })
      if (
        sequence === canonicalizationSequence &&
        activeHistoryResetKey === historyResetKey &&
        isHistoryReconciliationCurrent()
      ) {
        canonicalizationRetryTimer = scheduleTimeout(() => {
          canonicalizationRetryTimer = null
          requestCanonicalization()
        }, 5_000)
      }
    }).finally(() => {
      if (canonicalizationInFlight === state) {
        canonicalizationInFlight = null
        if (completedSuccessfully && canonicalizationRefreshPending) {
          canonicalizationRefreshPending = false
          requestCanonicalization()
        } else if (!completedSuccessfully) {
          // The existing delayed retry will read the newest durable truth.
          // Do not also spin an immediate dirty refresh after a worker failure.
          canonicalizationRefreshPending = false
        }
      }
    })
  }

  function flushHistorySnapshot(
    writeTrackingCache: boolean,
    force = false,
  ): void {
    if (historyPublishTimer !== null) {
      clearScheduledTimeout(historyPublishTimer)
      historyPublishTimer = null
    }
    if (pendingHistoryRenderPositions.length === 0 && !force) {
      return
    }

    const breadcrumbsForRendering =
      pendingHistoryRenderPositions.splice(
        0,
        pendingHistoryRenderPositions.length,
      )
    const rawBreadcrumbsForPersistence =
      pendingHistoryMissionPersistencePositions.splice(
        0,
        pendingHistoryMissionPersistencePositions.length,
      )
    breadcrumbAccumulator.ingest(breadcrumbsForRendering, {
      resolveObservedBaseline: true,
    })
    // Initial-history rendering is provisional until the SQLite worker replaces
    // it with the exact canonical selection. Compact every published batch so
    // the renderer never retains the complete high-rate source while catch-up
    // is still in progress; durable persistence above remains lossless.
    const breadcrumbResult = breadcrumbAccumulator.compact()
    boundedSourceRetention = true
    breadcrumbPositions = breadcrumbResult.positions
    breadcrumbMetadata = breadcrumbResult.metadata
    const publishedSnapshot = {
      devices: latestDevices,
      positions: latestCurrentPositions,
      breadcrumbs: breadcrumbPositions,
      rawBreadcrumbsForPersistence,
      breadcrumbMetadata,
    }
    lastGoodSnapshot = {
      devices: latestDevices,
      positions: latestCurrentPositions,
      breadcrumbs: breadcrumbPositions,
      rawBreadcrumbsForPersistence: [],
      breadcrumbMetadata,
    }
    options.onSnapshot(
      annotateTrackingSnapshotHealth(publishedSnapshot, {
        now: now(),
        deviceStaleThresholdMs: options.staleThresholdMs,
      }),
      {
        historyResetKey: activeHistoryResetKey,
        suppressTrackingCache: !writeTrackingCache,
        ...(latestParticipantRosterAuthoritative
          ? {}
          : { participantRosterAuthoritative: false }),
      },
    )
  }

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

  /** Reports rejected current rows after position publication and contains UI failures. */
  function publishCurrentPositionRejections(
    rejections: readonly CurrentPositionRejection[],
    missionId: string | null,
  ): true {
    try {
      options.onCurrentPositionRejections?.(rejections, {
        missionId,
        observedAt: now().toISOString(),
      })
    } catch (error) {
      logger.warn('Current-position rejection evidence delivery failed.', {
        failureKind: classifyTrackingFailure(error),
      })
    }
    return true
  }

  const scheduleNextPoll = (delayMs: number) => {
    if (!running) {
      return
    }

    timer = scheduleTimeout(() => {
      timer = null
      void runPoll(lifecycleGeneration)
    }, delayMs)
  }

  const authenticateIfNeeded = async () => {
    if (authenticated) {
      return
    }

    await client.authenticate()
    authenticated = true
  }

  const poll = async (generation: number) => {
    const pollStartedAt = now().toISOString()
    let pollPhase: TrackingPollPhase = 'authentication'
    const pollHistoryResetKey = options.getHistoryResetKey?.() ?? null
    try {
      if (pollHistoryResetKey !== activeHistoryResetKey) {
        const retainedCurrentSnapshot = lastGoodSnapshot === null
          ? null
          : {
              devices: latestDevices,
              positions: latestCurrentPositions,
              breadcrumbs: [],
              rawBreadcrumbsForPersistence: [],
            } satisfies TrackingSnapshot
        initialSeedAbortController?.abort()
        initialSeedAbortController = null
        discardPendingHistorySnapshot()
        activeHistoryResetKey = pollHistoryResetKey
        breadcrumbAccumulator.reset()
        breadcrumbPositions = []
        breadcrumbMetadata = undefined
        initialBreadcrumbsLoaded = false
        initialHistoryCheckpointsByDevice = {}
        boundedSourceRetention = false
        canonicalizationSequence += 1
        canonicalizationRefreshPending = false
        initialReconciliationComplete = false
        initialReconciliationSelectionKey = null
        canonicalizationInFlight?.abortController.abort()
        canonicalizationInFlight = null
        if (canonicalizationRetryTimer !== null) {
          clearScheduledTimeout(canonicalizationRetryTimer)
          canonicalizationRetryTimer = null
        }
        breadcrumbFetchCompleted = false
        breadcrumbStatusWarning = null
        latestBreadcrumbTimestampByDevice.clear()
        historyReconciler.reset()
        lastGoodSnapshot = retainedCurrentSnapshot
      }

      const pollingMode = options.getPollingMode?.() ?? 'active'
      if (pollingMode !== 'active') {
        flushHistorySnapshot(false)
        historyReconciler.suspend()
        if (pollingMode === 'paused' && lastGoodSnapshot !== null) {
          options.onSnapshot(
            annotateTrackingSnapshotHealth(lastGoodSnapshot, {
              now: now(),
              deviceStaleThresholdMs: options.staleThresholdMs,
            }),
            {
              historyResetKey: pollHistoryResetKey,
              ...(latestParticipantRosterAuthoritative
                ? {}
                : { participantRosterAuthoritative: false }),
            },
          )
        } else if (pollingMode === 'idle') {
          options.onSnapshot(EMPTY_TRACKING_SNAPSHOT, {
            historyResetKey: pollHistoryResetKey,
            participantRosterAuthoritative: false,
          })
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
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        return
      }

      pollPhase = 'devices'
      const recoveredBeforeCurrentPositions = consecutiveFailures > 0
      let rejectionEvidencePublishedEarly = false
      let earlyCurrentPositionTimer: ReturnType<typeof setTimeout> | null = null
      const currentPositionResult = await fetchRosterAndCurrentPositions(
        {
          getDevices: () => withPollPhase('devices', client.getDevices()),
          ...(client.getDevicesWithReport === undefined
            ? {}
            : {
                getDevicesWithReport: () => withPollPhase(
                  'devices',
                  client.getDevicesWithReport!(),
                ),
              }),
          getCurrentPositions: async () => {
            const result = await withPollPhase(
              'current_positions',
              client.getCurrentPositionsWithReport?.() ??
              client.getCurrentPositions().then((accepted) => ({
                accepted,
                rejected: [],
              })),
            )
            earlyCurrentPositionTimer = scheduleTimeout(() => {
              earlyCurrentPositionTimer = null
              if (
                discardSupersededPoll(generation, pollHistoryResetKey) ||
                (options.getPollingMode?.() ?? 'active') !== 'active'
              ) {
                return
              }
              const positions = retainLastAcceptedCurrentPositions(
                result.accepted,
                result.rejected,
                latestCurrentPositions,
              )
              const devices = resolveCurrentPositionDevices([], positions, latestDevices)
              consecutiveFailures = 0
              lastSuccessAt = now().toISOString()
              latestDevices = devices
              latestCurrentPositions = positions
              const snapshot = {
                devices,
                positions,
                breadcrumbs: breadcrumbPositions,
                rawBreadcrumbsForPersistence: [],
                breadcrumbMetadata,
              }
              lastGoodSnapshot = snapshot
              options.onSnapshot(
                annotateTrackingSnapshotHealth(snapshot, {
                  now: now(),
                  deviceStaleThresholdMs: options.staleThresholdMs,
                }),
                {
                  historyResetKey: pollHistoryResetKey,
                  participantRosterAuthoritative: false,
                },
              )
              rejectionEvidencePublishedEarly = publishCurrentPositionRejections(
                result.rejected,
                pollHistoryResetKey,
              )
              publishStatus({
                mode: 'online',
                recovered: recoveredBeforeCurrentPositions,
                warning: combineTrackingWarnings(
                  'Current fixes loaded; refreshing device roster.',
                  createRejectedCurrentPositionWarning(result.rejected),
                ),
              })
            }, CURRENT_POSITION_ROSTER_GRACE_MS)
            return result
          },
        },
        latestDevices,
      )
      if (earlyCurrentPositionTimer !== null) {
        clearScheduledTimeout(earlyCurrentPositionTimer)
        earlyCurrentPositionTimer = null
      }
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        return
      }

      const devices = resolveCurrentPositionDevices(
        currentPositionResult.devices,
        currentPositionResult.accepted,
        latestDevices,
      )
      const acceptedPositions = currentPositionResult.accepted
      const positions = retainLastAcceptedCurrentPositions(
        acceptedPositions,
        currentPositionResult.rejected,
        latestCurrentPositions,
      )
      if (currentPositionResult.rosterFailure !== null) {
        logger.warn('Tracking device roster refresh failed; using last-known metadata.', {
          failureKind: classifyTrackingFailure(currentPositionResult.rosterFailure),
        })
      }

      const currentPollingMode = options.getPollingMode?.() ?? 'active'
      if (currentPollingMode !== 'active') {
        flushHistorySnapshot(false)
        historyReconciler.suspend()
        publishInactiveMissionSnapshot(currentPollingMode)
        scheduleNextPoll(pollIntervalMs)
        return
      }

      const recovered = recoveredBeforeCurrentPositions
      consecutiveFailures = 0
      lastSuccessAt = now().toISOString()
      latestDevices = devices
      latestCurrentPositions = positions
      latestParticipantRosterAuthoritative = currentPositionResult.rosterComplete

      const currentSnapshot = {
        devices,
        positions,
        breadcrumbs: breadcrumbPositions,
        rawBreadcrumbsForPersistence: [],
        breadcrumbMetadata,
      }
      lastGoodSnapshot = currentSnapshot
      options.onSnapshot(
        annotateTrackingSnapshotHealth(currentSnapshot, {
          now: now(),
          deviceStaleThresholdMs: options.staleThresholdMs,
        }),
        {
          historyResetKey: pollHistoryResetKey,
          ...(currentPositionResult.rosterComplete
            ? {}
            : { participantRosterAuthoritative: false }),
        },
      )
      if (!rejectionEvidencePublishedEarly) {
        publishCurrentPositionRejections(
          currentPositionResult.rejected,
          pollHistoryResetKey,
        )
      }
      publishStatus({
        mode: 'online',
        recovered,
        warning: combineTrackingWarnings(
          currentPositionResult.rosterWarning,
          createRejectedCurrentPositionWarning(currentPositionResult.rejected),
          !breadcrumbFetchCompleted && breadcrumbPositions.length === 0
            ? 'Current fixes loaded; loading breadcrumb history.'
            : breadcrumbStatusWarning ??
              (recovered ? 'CONNECTION RESTORED' : null),
        ),
      })

      const breadcrumbPositionsBeforeSeed = breadcrumbPositions
      const seedState = await seedInitialBreadcrumbs()
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        return
      }
      const pollingModeAfterSeed = options.getPollingMode?.() ?? 'active'
      if (pollingModeAfterSeed !== 'active') {
        publishInactiveMissionSnapshot(pollingModeAfterSeed)
        scheduleNextPoll(pollIntervalMs)
        return
      }
      if (
        seedState === 'loaded' &&
        breadcrumbPositions !== breadcrumbPositionsBeforeSeed &&
        breadcrumbPositions.length > 0
      ) {
        const seededSnapshot = {
          devices,
          positions,
          breadcrumbs: breadcrumbPositions,
          rawBreadcrumbsForPersistence: [],
          breadcrumbMetadata,
        }
        lastGoodSnapshot = seededSnapshot
        options.onSnapshot(
          annotateTrackingSnapshotHealth(seededSnapshot, {
            now: now(),
            deviceStaleThresholdMs: options.staleThresholdMs,
          }),
          {
            historyResetKey: pollHistoryResetKey,
            ...(currentPositionResult.rosterComplete
              ? {}
              : { participantRosterAuthoritative: false }),
          },
        )
      }

      pollPhase = 'breadcrumbs'
      const breadcrumbDevices = selectBreadcrumbDevices(devices)
      const breadcrumbFetchPromise = fetchIncrementalBreadcrumbs(devices, seedState)
      if (seedState === 'loaded') {
        const initialBreadcrumbFrom = options.getInitialBreadcrumbFrom?.() ?? null
        const selectionKey = JSON.stringify([
          initialBreadcrumbFrom?.toISOString() ?? null,
          breadcrumbDevices.map((device) => device.device_id).sort(),
        ])
        if (selectionKey !== initialReconciliationSelectionKey) {
          initialReconciliationSelectionKey = selectionKey
          initialReconciliationComplete = false
        }
        historyReconciler.reconcile({
          devices: breadcrumbDevices,
          from: initialBreadcrumbFrom,
          until: now(),
          checkpointsByDevice: initialHistoryCheckpointsByDevice,
        })
      }
      const breadcrumbFetch = await breadcrumbFetchPromise
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        return
      }
      const previousBreadcrumbPositions = breadcrumbPositions
      const previousObservedCount = breadcrumbMetadata?.totalObserved ?? 0
      canonicalizationInFlight?.trailingPositions.push(
        ...breadcrumbFetch.recentPositions,
      )
      let breadcrumbResult = breadcrumbAccumulator.append(
        breadcrumbFetch.recentPositions,
      )
      if (boundedSourceRetention) {
        breadcrumbResult = breadcrumbAccumulator.compact()
      }
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
        flushHistorySnapshot(false)
        historyReconciler.suspend()
        publishInactiveMissionSnapshot(latestPollingMode)
        scheduleNextPoll(pollIntervalMs)
        return
      }

      lastGoodSnapshot = {
        ...rawSnapshot,
        rawBreadcrumbsForPersistence: [],
      }

      if (breadcrumbPositions !== previousBreadcrumbPositions) {
        options.onSnapshot(
          annotateTrackingSnapshotHealth(rawSnapshot, {
            now: now(),
            deviceStaleThresholdMs: options.staleThresholdMs,
          }),
          {
            historyResetKey: pollHistoryResetKey,
            ...(currentPositionResult.rosterComplete
              ? {}
              : { participantRosterAuthoritative: false }),
          },
        )
      }
      breadcrumbFetchCompleted = true
      // Retain only durable history health; CONNECTION RESTORED is transient.
      breadcrumbStatusWarning = createBreadcrumbCompletionWarning(
        breadcrumbFetch,
        false,
        seedState,
        historyReconciler.getProgress(),
      )
      publishStatus({
        mode: 'online',
        recovered,
        warning: combineTrackingWarnings(
          currentPositionResult.rosterWarning,
          createBreadcrumbCompletionWarning(
            breadcrumbFetch,
            recovered,
            seedState,
            historyReconciler.getProgress(),
          ),
        ),
      })

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
        currentPositionCount: acceptedPositions.length,
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
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        return
      }
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
          {
            historyResetKey: pollHistoryResetKey,
            ...(latestParticipantRosterAuthoritative
              ? {}
              : { participantRosterAuthoritative: false }),
          },
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

  async function runPoll(generation: number): Promise<void> {
    if (!running || generation !== lifecycleGeneration) {
      return
    }
    if (pollInFlight) {
      immediatePollRequested = true
      return
    }

    pollInFlight = true
    try {
      await poll(generation)
    } finally {
      pollInFlight = false
      if (
        immediatePollRequested &&
        running
      ) {
        immediatePollRequested = false
        if (timer !== null) {
          clearScheduledTimeout(timer)
          timer = null
        }
        void runPoll(lifecycleGeneration)
      }
    }
  }

  function publishInactiveMissionSnapshot(pollingMode: 'paused' | 'idle'): void {
    if (pollingMode === 'paused' && lastGoodSnapshot !== null) {
      options.onSnapshot(
        annotateTrackingSnapshotHealth(lastGoodSnapshot, {
          now: now(),
          deviceStaleThresholdMs: options.staleThresholdMs,
        }),
        {
          historyResetKey: activeHistoryResetKey,
          ...(latestParticipantRosterAuthoritative
            ? {}
            : { participantRosterAuthoritative: false }),
        },
      )
    } else if (pollingMode === 'idle') {
      options.onSnapshot(EMPTY_TRACKING_SNAPSHOT, {
        historyResetKey: activeHistoryResetKey,
        participantRosterAuthoritative: false,
      })
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
      lifecycleGeneration += 1
      void runPoll(lifecycleGeneration)
    },
    stop: () => {
      flushHistorySnapshot(false)
      running = false
      lifecycleGeneration += 1
      immediatePollRequested = false
      historyReconciler.reset()
      canonicalizationSequence += 1
      canonicalizationRefreshPending = false
      initialReconciliationComplete = false
      initialReconciliationSelectionKey = null
      initialSeedAbortController?.abort()
      initialSeedAbortController = null
      canonicalizationInFlight?.abortController.abort()
      canonicalizationInFlight = null
      if (canonicalizationRetryTimer !== null) {
        clearScheduledTimeout(canonicalizationRetryTimer)
        canonicalizationRetryTimer = null
      }
      if (timer !== null) {
        clearScheduledTimeout(timer)
        timer = null
      }
    },
    requestPollNow: () => {
      if (!running) {
        return
      }
      if (
        (options.getHistoryResetKey?.() ?? null) !== activeHistoryResetKey ||
        (options.getPollingMode?.() ?? 'active') !== 'active'
      ) {
        initialSeedAbortController?.abort()
      }
      if (timer !== null) {
        clearScheduledTimeout(timer)
        timer = null
      }
      if (pollInFlight) {
        immediatePollRequested = true
        return
      }
      void runPoll(lifecycleGeneration)
    },
  }

  function discardSupersededPoll(
    generation: number,
    historyResetKey: string | null,
  ): boolean {
    if (!running || generation !== lifecycleGeneration) {
      return true
    }

    const currentHistoryResetKey = options.getHistoryResetKey?.() ?? null
    if (currentHistoryResetKey === historyResetKey) {
      return false
    }

    historyReconciler.suspend()
    scheduleNextPoll(pollIntervalMs)
    return true
  }

  function isHistoryReconciliationCurrent(): boolean {
    return (
      running &&
      (options.getPollingMode?.() ?? 'active') === 'active' &&
      (options.getHistoryResetKey?.() ?? null) === activeHistoryResetKey
    )
  }

  async function fetchIncrementalBreadcrumbs(
    devices: readonly NormalizedTrackingDevice[],
    seedState: InitialBreadcrumbSeedState,
  ): Promise<BreadcrumbFetchResult> {
    if (seedState === 'failed') {
      return {
        positions: [],
        recentPositions: [],
        requestedDeviceCount: 0,
        failedDeviceCount: 0,
        failedDeviceNames: [],
        window: null,
      }
    }

    const fetchUntil = now()
    const breadcrumbDevices = selectBreadcrumbDevices(devices)
    const initialFrom = options.getInitialBreadcrumbFrom?.() ?? null

    const settled = await Promise.allSettled(
      breadcrumbDevices.map(async (device) => {
        const lastTimestamp = latestBreadcrumbTimestampByDevice.get(device.device_id)
        const fetchFrom =
          lastTimestamp === undefined
            ? new Date(
                Math.max(
                  initialFrom?.getTime() ?? Number.NEGATIVE_INFINITY,
                  fetchUntil.getTime() - BREADCRUMB_CURSOR_OVERLAP_MS,
                ),
              )
            : createOverlappedFetchFrom(
                lastTimestamp,
                fetchUntil,
                initialFrom,
              )

        const breadcrumbs = await client.getBreadcrumbs(
          device.device_id,
          fetchFrom,
          fetchUntil,
        )
        const newestTimestamp = getCursorTimestampFromBatch(
          breadcrumbs,
          fetchUntil,
        )
        if (newestTimestamp !== null) {
          latestBreadcrumbTimestampByDevice.set(device.device_id, newestTimestamp)
        }

        return {
          breadcrumbs,
          recentBreadcrumbs: breadcrumbs,
          previousCursor: lastTimestamp ?? null,
          requestedFrom: fetchFrom.toISOString(),
          requestedTo: fetchUntil.toISOString(),
          newestReturned: newestTimestamp,
        }
      }),
    )

    const aggregated: NormalizedTrackingPosition[] = []
    const recentPositions: NormalizedTrackingPosition[] = []
    let failedDeviceCount = 0
    const failedDeviceNames: string[] = []
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      if (result === undefined) {
        continue
      }
      if (result.status === 'fulfilled') {
        aggregated.push(...result.value.breadcrumbs)
        recentPositions.push(...result.value.recentBreadcrumbs)
        continue
      }

      const failedDevice = breadcrumbDevices[index]
      failedDeviceCount += 1
      failedDeviceNames.push(failedDevice?.name ?? failedDevice?.device_id ?? 'Unknown device')
      logger.warn('Tracking breadcrumb fetch failed for device.', {
        deviceId: failedDevice?.device_id ?? null,
        deviceName: failedDevice?.name ?? null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }

    return {
      positions: aggregated,
      recentPositions,
      requestedDeviceCount: breadcrumbDevices.length,
      failedDeviceCount,
      failedDeviceNames,
      window: summarizeBreadcrumbWindows(
        settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      ),
    }
  }

  function selectBreadcrumbDevices(
    devices: readonly NormalizedTrackingDevice[],
  ): readonly NormalizedTrackingDevice[] {
    const participantDeviceIds = options.getParticipantDeviceIds?.() ?? null
    const participantDeviceIdSet = participantDeviceIds === null
      ? null
      : new Set(participantDeviceIds)
    const requestedDeviceIds = options.getBreadcrumbDeviceIds?.() ?? null
    const requestedDeviceIdSet = requestedDeviceIds === null || requestedDeviceIds.length === 0
      ? null
      : new Set(requestedDeviceIds)
    return devices.filter((device) =>
      (participantDeviceIdSet === null || participantDeviceIdSet.has(device.device_id)) &&
      (requestedDeviceIdSet === null || requestedDeviceIdSet.has(device.device_id)))
  }

  async function seedInitialBreadcrumbs(): Promise<InitialBreadcrumbSeedState> {
    if (
      initialBreadcrumbsLoaded ||
      options.getInitialBreadcrumbs === undefined
    ) {
      return 'loaded'
    }

    const abortController = new AbortController()
    initialSeedAbortController = abortController
    try {
      const [
        persistedBreadcrumbs,
        persistedTotals,
        persistedSelectionMetadata,
        persistedHistoryCheckpoints,
      ] = await Promise.all([
        options.getInitialBreadcrumbs(abortController.signal),
        options.getInitialBreadcrumbTotals?.(abortController.signal) ?? Promise.resolve({}),
        options.getInitialBreadcrumbSelectionMetadata?.(abortController.signal) ?? Promise.resolve({}),
        options.getInitialHistoryCheckpoints?.(abortController.signal) ?? Promise.resolve({}),
      ])
      const breadcrumbResult = breadcrumbAccumulator.reset(
        persistedBreadcrumbs,
        persistedTotals,
        persistedSelectionMetadata,
      )
      breadcrumbPositions = breadcrumbResult.positions
      breadcrumbMetadata = breadcrumbResult.metadata
      seedLatestBreadcrumbTimestamps(persistedBreadcrumbs)
      initialHistoryCheckpointsByDevice = persistedHistoryCheckpoints
      initialBreadcrumbsLoaded = true
      return 'loaded'
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        return 'failed'
      }
      logger.warn('Tracking breadcrumb cursor load failed.', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 'failed'
    } finally {
      if (initialSeedAbortController === abortController) {
        initialSeedAbortController = null
      }
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

/**
 * Keeps the last accepted fix visible for a device whose replacement row was
 * rejected, without treating that rejected row as current-position truth.
 */
function retainLastAcceptedCurrentPositions(
  accepted: readonly NormalizedTrackingPosition[],
  rejected: readonly CurrentPositionRejection[],
  previous: readonly NormalizedTrackingPosition[],
): readonly NormalizedTrackingPosition[] {
  if (rejected.length === 0 || previous.length === 0) {
    return accepted
  }

  const acceptedDeviceIds = new Set(accepted.map((position) => position.device_id))
  const rejectedDeviceIds = new Set(
    rejected.flatMap((entry) => entry.deviceId === null ? [] : [entry.deviceId]),
  )
  const rejectionScopeUnknown = rejected.some((entry) => entry.deviceId === null)
  const retainEveryUnreplacedDevice = accepted.length === 0 || rejectionScopeUnknown
  const retained = previous.filter((position) =>
    !acceptedDeviceIds.has(position.device_id) &&
    (retainEveryUnreplacedDevice || rejectedDeviceIds.has(position.device_id)),
  )

  return retained.length === 0 ? accepted : [...accepted, ...retained]
}

/**
 * Uses source roster metadata when available, then last-known metadata, and
 * finally bounded derived rows so a first-poll roster failure cannot hide fixes.
 */
function resolveCurrentPositionDevices(
  roster: readonly NormalizedTrackingDevice[],
  positions: readonly NormalizedTrackingPosition[],
  previous: readonly NormalizedTrackingDevice[],
): readonly NormalizedTrackingDevice[] {
  if (roster.length > 0) return roster
  if (previous.length > 0) return previous
  return [...new Set(positions.map((position) => position.device_id))]
    .sort()
    .map((deviceId) => ({
      device_id: deviceId,
      name: `Device ${deviceId}`,
      status: 'unknown' as const,
      last_seen: null,
      unique_id: null,
      category: null,
    }))
}

/** Creates the operator warning for a poll containing rejected current rows. */
function createRejectedCurrentPositionWarning(
  rejections: readonly CurrentPositionRejection[],
): string | null {
  return rejections.length > 0
    ? 'POSITION DATA REJECTED — showing the last accepted fix where no valid replacement was available.'
    : null
}

/**
 * Combines independent current-position and history warnings without hiding either.
 */
function combineTrackingWarnings(
  ...warnings: readonly (string | null)[]
): string | null {
  const activeWarnings = warnings.filter((warning): warning is string => warning !== null)
  return activeWarnings.length === 0 ? null : activeWarnings.join(' ')
}

type InitialBreadcrumbSeedState = 'loaded' | 'failed'

type BreadcrumbFetchResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly recentPositions: readonly NormalizedTrackingPosition[]
  readonly requestedDeviceCount: number
  readonly failedDeviceCount: number
  readonly failedDeviceNames: readonly string[]
  readonly window: TrackingBreadcrumbWindowSummary | null
}

function createBreadcrumbCompletionWarning(
  result: BreadcrumbFetchResult,
  recovered: boolean,
  seedState: InitialBreadcrumbSeedState,
  historyProgress: BreadcrumbHistoryProgress,
): string | null {
  if (seedState === 'failed') {
    return 'Breadcrumb history could not be loaded from mission storage; current fixes remain live.'
  }
  if (result.failedDeviceCount > 0) {
    return `Breadcrumb history incomplete for ${result.failedDeviceNames.join(
      ', ',
    )}; current fixes remain live.`
  }
  const reconciliationWarning = createHistoryReconciliationWarning(historyProgress)
  if (reconciliationWarning !== null) {
    return reconciliationWarning
  }
  return recovered ? 'CONNECTION RESTORED' : null
}

function createHistoryReconciliationWarning(
  progress: BreadcrumbHistoryProgress,
): string | null {
  if (progress.failedDeviceNames.length > 0) {
    return `Breadcrumb history incomplete for ${progress.failedDeviceNames.join(
      ', ',
    )}; retrying while current fixes remain live.`
  }
  if (progress.pendingDeviceNames.length > 0) {
    return `Breadcrumb history is reconciling for ${progress.pendingDeviceNames.join(
      ', ',
    )}; current fixes remain live.`
  }
  return null
}

type BreadcrumbDeviceWindow = {
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
  const lowerBoundedMs =
    lowerBoundMs === undefined ? overlappedMs : Math.max(lowerBoundMs, overlappedMs)
  const fetchFromMs = Math.max(
    lowerBoundedMs,
    fetchUntilMs - BREADCRUMB_RECENT_WINDOW_MAX_MS,
  )

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
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
