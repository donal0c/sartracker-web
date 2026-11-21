import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'
import {
  combineTrackingWarnings,
  type TrackingWarning,
  type TrackingWarningFields,
} from './tracking-warnings'
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
import { persistHistoryChunkGroups } from './persist-history-chunk-groups'
import { persistHistoryChunkInPieces } from './split-history-chunk'
import type {
  TrackingBreadcrumbWindowSummary,
  TrackingPollLedgerEntry,
  TrackingPollPhase,
} from '../diagnostics/tracking-poll-ledger'
import { classifyTrackingFailure } from '../diagnostics/tracking-poll-ledger'
import {
  describeHistoryGapsForOperator,
  describeRecheckBacklogForOperator,
  historyRetryClause,
  type HistoryRetryState,
  listNamesBounded,
} from './history-gap-warning'
import {
  createIncompleteRosterWarning,
  fetchRosterAndCurrentPositions,
} from './current-position-poll'
import type { CurrentPositionRejection } from './ingest-health'
import { onlyKeptPositions, readKeptPositions } from './store-refused-positions'
import type {
  BreadcrumbNormalizationResult,
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
    signal?: AbortSignal,
  ) => Promise<readonly NormalizedTrackingPosition[]>
  readonly getBreadcrumbsWithReport?: (
    deviceId: string,
    from: Date,
    to: Date,
    signal?: AbortSignal,
  ) => Promise<BreadcrumbNormalizationResult>
}

type PollingManagerLogger = {
  readonly warn: (message: string, context: Record<string, unknown>) => void
}

export type TrackingMissionEvidenceObservation = {
  readonly missionId: string | null
  readonly complete: () => void
}

export type TrackingMissionEvidenceTransfer = TrackingMissionEvidenceObservation & {
  /** Transfers completion authority away from the polling transport exactly once. */
  readonly claim: () => void
}

type PollingManagerOptions = {
  readonly intervalMs: number
  readonly minimumIntervalMs?: number
  readonly historyAntiEntropyIntervalMs?: number
  readonly staleThresholdMs: number
  readonly retryBaseMs?: number
  readonly maxBackoffMs?: number
  readonly getPollingMode?: () => 'active' | 'paused' | 'idle'
  readonly getInactiveWarning?: (pollingMode: 'paused' | 'idle') => TrackingWarning | null
  readonly getHistoryResetKey?: () => string | null
  readonly beginMissionEvidenceObservation?: (missionId: string | null) => {
    readonly missionId: string | null
    readonly complete: () => void
  }
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
  readonly getParticipantHistoryStarts?: (
    deviceIds: readonly string[],
    from: Date,
    until: Date,
  ) => Readonly<Record<string, string>>
  readonly getCanonicalBreadcrumbs?: (
    expectedMissionId: string,
    signal?: AbortSignal,
  ) => Promise<CanonicalBreadcrumbSeed>
  readonly persistHistoryChunk?: (
    input: TrackingHistoryChunkPersistenceInput,
  ) => Promise<TrackingHistoryChunkPersistenceResult>
  readonly persistHistoryRequest?: (input: TrackingHistoryRequestInput) => Promise<void>
  /**
   * Told `true` when a trail write's outcome was not confirmed (it threw, or
   * its answer was lost or malformed, possibly after it committed), and
   * `false` once a canonical reload begun after that write has brought the
   * live line back into agreement with the store. The runtime keeps the
   * storage warning up in between [DON-338 round 10].
   */
  readonly onTrailStoreAgreementChange?: (awaitingAgreement: boolean) => void
  readonly persistHistoryChunks?: (
    inputs: readonly TrackingHistoryChunkPersistenceInput[],
  ) => Promise<TrackingHistoryStoreAnswer>
  readonly getBreadcrumbDeviceIds?: () => readonly string[] | null
  /** Selected mission participants. An explicit empty list means fetch no history. */
  readonly getParticipantDeviceIds?: () => readonly string[] | null
  readonly onSnapshot: (
    snapshot: TrackingSnapshot,
    context: TrackingSnapshotContext,
  ) => void | Promise<void>
  /**
   * Synchronously hands one current poll to the visible publisher and a
   * bounded evidence owner, which must claim the observation before returning.
   */
  readonly onCurrentSnapshot?: (
    snapshot: TrackingSnapshot,
    context: TrackingSnapshotContext,
    observation: TrackingMissionEvidenceTransfer,
  ) => void
  /** Stops further fetching at the evidence owner's memory bound, after visible publication. */
  readonly waitForCurrentEvidenceCapacity?: (signal: AbortSignal) => Promise<void>
  readonly reserveCurrentEvidenceCapacity?: (signal: AbortSignal) => Promise<() => void>
  readonly onStatusChange: (status: TrackingConnectionStatus) => void
  readonly onCurrentPositionRejections?: (
    rejections: readonly CurrentPositionRejection[],
    context: {
      readonly missionId: string | null
      readonly observedAt: string
      readonly suppressOperationalPublication?: boolean
    },
  ) => void
  readonly onBreadcrumbRejections?: (
    rejections: readonly CurrentPositionRejection[],
    context: {
      readonly missionId: string | null
      readonly observedAt: string
    },
  ) => void | Promise<void>
  readonly onPollDiagnostic?: (entry: TrackingPollLedgerEntry) => void
  readonly logger?: PollingManagerLogger
  readonly now?: () => Date
  readonly monotonicNow?: () => number
  readonly setTimeout?: typeof globalThis.setTimeout
  readonly clearTimeout?: typeof globalThis.clearTimeout
}

export type TrackingSnapshotContext = {
  /** Retiring transports may settle evidence, but may not replace current UI. */
  readonly suppressOperationalPublication?: boolean
  readonly historyResetKey: string | null
  /** Explicit mission scope for persistence; null keeps live display outside mission evidence. */
  readonly missionEvidenceId?: string | null
  readonly suppressTrackingCache?: boolean
  /** False for idle, unavailable, or partially normalized roster observations. */
  readonly participantRosterAuthoritative?: boolean
  /**
   * The roster fetch an authoritative snapshot carries. One fetch reaches
   * several snapshots (current positions, history), and a repeat is not a
   * second roster (DON-300 item 8, box run 5a).
   */
  readonly rosterObservationId?: string
}

export type BreadcrumbHistoryCheckpointSeed = {
  readonly historyFrom: string
  readonly reconciledUntil: string
}

export type TrackingHistoryChunkPersistenceInput = {
  readonly phase: 'initial' | 'anti_entropy' | 'incremental'
  readonly expectedMissionId: string | null
  readonly deviceId: string
  readonly historyFrom: string
  readonly reconciledUntil: string
  readonly reconciledFrom?: string
  readonly positions: readonly NormalizedTrackingPosition[]
}

export type TrackingHistoryRequestInput = {
  readonly expectedMissionId: string
  readonly deviceId: string
  readonly historyFrom: string
  readonly requestedUntil: string
}

/**
 * The store's confirmed answer to one history write [DON-338 round 10]:
 * the observations it kept, as the same objects the poller passed in the
 * write's input. Only these reach the live trail. An observation the runtime
 * withheld from the write (outside the participation scope, without a
 * verified fix time) or the store refused as a source-id conflict is not
 * listed. The production runtime builds this from the store's
 * acknowledgement and fails the write when that answer is missing or
 * malformed, so an answer without this list draws nothing.
 */
export type TrackingHistoryStoreAnswer = {
  readonly keptPositions: readonly NormalizedTrackingPosition[]
}

export type TrackingHistoryChunkPersistenceResult = TrackingHistoryStoreAnswer & {
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
// The reconciler's default 5-minute re-check interval, used when none is given.
const DEFAULT_HISTORY_RECHECK_INTERVAL_MS = 5 * 60 * 1000
// A re-check backlog that clears within a tick or two is normal after a
// burst. A device is named only once its backlog has been outstanding,
// without emptying, for this many re-check intervals [DON-338].
const RECHECK_BACKLOG_WARNING_INTERVALS = 2
const DEFAULT_POLL_INTERVAL_MS = 30_000
const MIN_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 3_600_000
const BREADCRUMB_CURSOR_OVERLAP_MS = 5 * 60 * 1000
const BREADCRUMB_RECENT_WINDOW_MAX_MS = 2 * 60 * 60 * 1000
const HISTORY_PUBLISH_DELAY_MS = 100
// Spacing between store reloads owed by unconfirmed trail writes: doubles from
// the base (at least two poll intervals) while writes keep failing, never
// beyond the cap (at least four poll intervals) [DON-349 P-6].
const OWED_RELOAD_SPACING_BASE_MS = 5_000
const OWED_RELOAD_SPACING_MAX_MS = 60_000
/**
 * Operator text when the poll loop is parked waiting for room in the mission
 * evidence queue. It names "live refresh suspended" so every view treats it as
 * a critical trust warning [DON-349 M-83].
 */
const EVIDENCE_BACKPRESSURE_WARNING: TrackingWarning = {
  code: 'evidence_backpressure',
  text: 'LIVE REFRESH SUSPENDED — new positions are not being saved to the mission record, so the map is no longer updating. Treat team positions as old until this clears.',
}
const HISTORY_PERSISTENCE_BATCH_LIMIT = 5_000
const HISTORY_TRANSPORT_MAX_CONCURRENCY = 8
// Reconciler history (initial catch-up and sweep together) may hold at most
// this many slots, so live trails always have the rest [DON-311].
const HISTORY_TRANSPORT_BACKGROUND_MAX_CONCURRENCY = 6

/** Live trail polling is admitted ahead of reconciler backfill. */
type HistoryTransportPriority = 'live' | 'background'

const DEFAULT_LOGGER: PollingManagerLogger = {
  warn: (message, context) => {
    console.warn(message, context)
  },
}

type PollingManager = {
  readonly start: () => void
  readonly stop: () => Promise<void>
  readonly requestPollNow: () => void
}

type HistoryRefreshRequest = {
  readonly generation: number
  readonly currentPollSequence: number
  readonly historyResetKey: string | null
}

type HistoryRefreshTask = {
  readonly request: HistoryRefreshRequest
  readonly promise: Promise<void>
}

/**
 * Creates the tracking polling manager with retry and last-good snapshot support.
 */
export function createPollingManager(
  client: TrackingPollerClient,
  options: PollingManagerOptions,
): PollingManager {
  const now = options.now ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  /**
   * Pieces of one chunk need no timer between them: each awaits its own
   * mission-store call, so the main process is free between pieces [DON-313].
   */
  const continueWithNextPiece = async (): Promise<void> => undefined
  const clearScheduledTimeout = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  const pollIntervalMs = normalizePollingIntervalMs(
    options.intervalMs,
    options.minimumIntervalMs,
  )
  const logger = options.logger ?? DEFAULT_LOGGER

  let authenticated = false
  let running = false
  let pollInFlight = false
  let evidenceCapacityWait: AbortController | null = null
  let evidenceBackpressureActive = false
  let lastOnlineWarnings: TrackingWarningFields = { warning: null, warningCodes: [] }
  let currentPollSequence = 0
  let immediatePollRequested = false
  const activeHistoryTasksByMission = new Map<string | null, HistoryRefreshTask>()
  const pendingHistoryRefreshByMission = new Map<string | null, HistoryRefreshRequest>()
  const historyTaskPromises = new Set<Promise<void>>()
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
  let breadcrumbStatusWarning: TrackingWarning | null = null
  // When each device's re-check backlog was first reported without emptying
  // since, and the warning naming devices behind for too long [DON-338].
  const recheckBacklogSinceMsByDevice = new Map<string, number>()
  let recheckBacklogWarning: TrackingWarning | null = null
  let recheckBacklogWarningWhileSuspended: TrackingWarning | null = null
  // The same history warning worded for suspended live tracking (paused or
  // recovery), when nothing is retried. Shown on the paused status [DON-338].
  let breadcrumbStatusWarningWhileSuspended: TrackingWarning | null = null
  // Devices the latest 5-minute re-check could not sweep. Initial-phase
  // progress does not list them, so they are kept here until the next re-check
  // reports [DON-338].
  let latestAntiEntropyFailedNames: readonly string[] = []
  let breadcrumbIngestWarning: TrackingWarning | null = null
  const latestBreadcrumbTimestampByDevice = new Map<string, string>()
  let latestDevices: readonly NormalizedTrackingDevice[] = []
  let latestParticipantRosterAuthoritative = false
  // Which roster fetch each published device list came from. A list replayed
  // later (fallback, pause, history) keeps its own fetch, so a repeat is never
  // taken for a second roster (DON-300 item 8, box run 5a).
  const rosterFetchByDevices = new WeakMap<
    readonly NormalizedTrackingDevice[],
    { readonly rosterObservationId: string, readonly complete: boolean }
  >()
  let rosterFetchSequence = 0
  // Roster progress for the latest poll: refreshing, unavailable, or the
  // incomplete-roster warning when that poll's roster answered.
  let latestRosterWarning: TrackingWarning | null = null
  // The last settled roster problem ("a tracker may be missing"). A pending
  // or failed refresh proves nothing new, so only a complete roster response
  // clears it; it shows on active, paused and offline statuses [DON-338].
  let settledRosterProblem: TrackingWarning | null = null
  // The detached roster request, tagged with the roster epoch that asked for
  // it. The epoch advances at every mission boundary and on stop, so a mission
  // id that comes round again (A -> B -> A) never revives an old request. Only
  // the request this manager currently holds is applied, so a stale answer
  // can never shrink the device list or change the roster warning [DON-338].
  let rosterEpoch = 0
  let rosterRefreshInFlight: {
    readonly request: Promise<DeviceRosterNormalizationResult>
    readonly generation: number
    readonly historyResetKey: string | null
    readonly epoch: number
  } | null = null
  // True only while latestDevices came from a roster Traccar reported
  // complete. Only such a list is carried into the next mission; an
  // incomplete one was warned about in its own mission only [DON-338].
  let latestDevicesFromCompleteRoster = false
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
  // Store agreement fence [DON-338 round 11]. Every trail write for the
  // current mission whose outcome went unconfirmed advances the counter; a
  // store reload that applies records the counter it saw when it began
  // reading. The live line awaits agreement while the two differ.
  let unconfirmedTrailWrites = 0
  let trailWritesAgreedThrough = 0
  // Owed-reload spacing [DON-349 P-6]. A fault that fails every write (a full
  // disk, a participant scope stuck in error) must not reload the whole trail
  // on every poll. After an owed reload starts, further owed reloads wait out
  // a cooldown that doubles while writes keep going unconfirmed, up to a cap.
  // The line keeps awaiting agreement meanwhile (the storage warning stays
  // up), and the reload is never given up: each cooldown ends with the owed
  // reload. A cooldown with no unconfirmed write resets the spacing. Timers,
  // not clock reads, so an injected or frozen clock cannot stall it.
  let owedReloadSpacingMs = 0
  let owedReloadCooldownTimer: ReturnType<typeof setTimeout> | null = null
  let unconfirmedWriteDuringCooldown = false
  let owedReloadFailedDuringCooldown = false
  // How far initial catch-up has settled for the selected devices: every
  // window tried ('attempted', possibly with an open history gap) or truly
  // complete. Each step runs the forced flush and canonical reload once, so a
  // gap Traccar can never serve does not starve them [DON-338].
  let initialCatchUpSettled: 'pending' | 'attempted' | 'complete' = 'pending'
  let initialReconciliationSelectionKey: string | null = null
  let canonicalizationInFlight: {
    readonly sequence: number
    readonly historyResetKey: string
    readonly abortController: AbortController
    readonly trailingPositions: NormalizedTrackingPosition[]
  } | null = null
  let boundedSourceRetention = false
  let lifecycleGeneration = 0
  let stopping = false
  let stopPromise: Promise<void> | null = null
  let currentPositionObservationInFlight: Promise<void> | null = null
  let settleCurrentPositionForStop: (() => void) | null = null
  let historyTransportAbortController = new AbortController()
  let activeHistoryTransportCount = 0
  let activeBackgroundHistoryTransportCount = 0
  const historyTransportWaiters: Record<HistoryTransportPriority, (() => void)[]> = {
    live: [],
    background: [],
  }
  const historyEvidenceOperations = new Set<Promise<BreadcrumbNormalizationResult>>()
  const historyPersistenceOperations = new Set<Promise<unknown>>()

  const createHistoryPersistenceInput = (
    chunk: BreadcrumbHistoryChunk,
  ): TrackingHistoryChunkPersistenceInput => ({
    phase: chunk.phase,
    expectedMissionId: activeHistoryResetKey,
    deviceId: chunk.deviceId,
    historyFrom: chunk.historyFrom.toISOString(),
    reconciledUntil: chunk.to.toISOString(),
    reconciledFrom: chunk.from.toISOString(),
    positions: chunk.positions,
  })

  /** Keeps accepted history writes inside one Finish fence and joins them on stop. */
  async function runMissionEvidencePersistence<Result>(
    missionId: string | null,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const trackedOperation = (async () => {
      if (options.beginMissionEvidenceObservation === undefined) {
        return operation()
      }
      const observation = options.beginMissionEvidenceObservation(missionId)
      if (observation.missionId === null) {
        throw new Error('Mission evidence scope closed before tracking history persistence.')
      }
      try {
        return await operation()
      } finally {
        observation.complete()
      }
    })()
    historyPersistenceOperations.add(trackedOperation)
    try {
      return await trackedOperation
    } finally {
      historyPersistenceOperations.delete(trackedOperation)
    }
  }

  /** True while an unconfirmed trail write has not been followed by an applied store reload. */
  function trailAwaitsStoreAgreement(): boolean {
    return unconfirmedTrailWrites > trailWritesAgreedThrough
  }

  /**
   * A trail write whose outcome was not confirmed may still have committed:
   * an earlier piece, or the whole write under a lost or malformed answer.
   * Its retry can then report nothing changed and draw nothing, so the live
   * line awaits agreement with the store and is reloaded from it. Recorded in
   * every polling mode (pause, suspend, offline) while the write's mission is
   * the current one; only a reload that begins after this write clears it
   * [DON-313] [DON-338 round 11].
   */
  function recordUnconfirmedTrailWrite(missionKey: string | null): void {
    if (
      missionKey === null ||
      missionKey !== activeHistoryResetKey ||
      !isHistoryPublicationCurrent()
    ) {
      // Another mission's write, or a stopped poller: that line is rebuilt
      // from the store when its mission is next loaded.
      return
    }
    const wasAwaiting = trailAwaitsStoreAgreement()
    unconfirmedWriteDuringCooldown = true
    unconfirmedTrailWrites += 1
    if (!wasAwaiting) options.onTrailStoreAgreementChange?.(true)
    // Starts a reload, or schedules it after the owed-reload spacing. A reload
    // already running does not cover this write; when it ends, the owed
    // reload is requested again through the same spacing. Outside active
    // polling it does nothing; the poll tick re-requests on resume.
    requestOwedTrailReload()
  }

  /** Clears the 5 s retry after a failed reload. */
  function clearCanonicalizationRetryTimer(): void {
    if (canonicalizationRetryTimer !== null) {
      clearScheduledTimeout(canonicalizationRetryTimer)
      canonicalizationRetryTimer = null
    }
  }

  /**
   * Starts the cooldown after an owed reload began. It doubles from the base
   * (two poll intervals, so a fault that fails every poll lands inside it)
   * up to the cap. When it ends, a cooldown with neither an unconfirmed write
   * nor a failed owed reload resets the spacing, and any reload still owed is
   * requested [DON-349 P-6].
   */
  function startOwedReloadCooldown(): void {
    const baseMs = Math.max(OWED_RELOAD_SPACING_BASE_MS, 2 * pollIntervalMs)
    const capMs = Math.max(OWED_RELOAD_SPACING_MAX_MS, 4 * pollIntervalMs)
    owedReloadSpacingMs = owedReloadSpacingMs === 0
      ? baseMs
      : Math.min(capMs, owedReloadSpacingMs * 2)
    unconfirmedWriteDuringCooldown = false
    owedReloadFailedDuringCooldown = false
    owedReloadCooldownTimer = scheduleTimeout(() => {
      owedReloadCooldownTimer = null
      if (!unconfirmedWriteDuringCooldown && !owedReloadFailedDuringCooldown) owedReloadSpacingMs = 0
      requestOwedTrailReload()
    }, owedReloadSpacingMs)
  }

  /** Ends any owed-reload cooldown and resets the spacing. */
  function resetOwedReloadSpacing(): void {
    if (owedReloadCooldownTimer !== null) {
      clearScheduledTimeout(owedReloadCooldownTimer)
      owedReloadCooldownTimer = null
    }
    owedReloadSpacingMs = 0
    unconfirmedWriteDuringCooldown = false
    owedReloadFailedDuringCooldown = false
  }

  /**
   * Requests the store reload owed by an unconfirmed write when none is
   * running or scheduled. Called on every active poll tick (so resume after
   * pause or suspend picks it up), after each confirmed save, and after a
   * reload completes [DON-338 round 11].
   */
  function requestOwedTrailReload(): void {
    if (
      !trailAwaitsStoreAgreement() ||
      canonicalizationInFlight !== null ||
      canonicalizationRetryTimer !== null ||
      owedReloadCooldownTimer !== null
    ) {
      // A reload running, a failed reload's retry or a cooldown each end by
      // requesting the owed reload again.
      return
    }
    requestCanonicalization()
    if (canonicalizationInFlight !== null) startOwedReloadCooldown()
  }

  /**
   * Drops the owed reload when this poller stops tracking the mission's line:
   * a mission or history identity change (the new line starts empty and is
   * seeded from the store) or stop (a restarted poller seeds from the store).
   */
  function forgetAwaitedStoreAgreement(): void {
    const wasAwaiting = trailAwaitsStoreAgreement()
    trailWritesAgreedThrough = unconfirmedTrailWrites
    resetOwedReloadSpacing()
    if (wasAwaiting) options.onTrailStoreAgreementChange?.(false)
  }

  const acceptPersistedHistoryChunk = (
    chunk: BreadcrumbHistoryChunk,
    persistedDirectly: boolean,
    persistenceResult: TrackingHistoryChunkPersistenceResult | null,
    keptPositions: readonly NormalizedTrackingPosition[] = readKeptPositions(persistenceResult),
  ): void => {
    if (!isHistoryReconciliationCurrent()) {
      return
    }
    rememberAcknowledgedHistoryCheckpoint(chunk)
    if (persistedDirectly) requestOwedTrailReload()
    // Only what was sent to the store and kept reaches the live trail; the
    // fallback port (no store answer) is not used while a mission is active
    // [DON-338 round 10].
    const renderablePositions = persistedDirectly
      ? onlyKeptPositions(chunk.positions, keptPositions)
      : chunk.positions
    canonicalizationInFlight?.trailingPositions.push(...renderablePositions)
    if (
      chunk.phase === 'anti_entropy' &&
      persistenceResult?.changed === true
    ) {
      requestCanonicalization()
    }
    if (renderablePositions.length === 0) {
      return
    }
    // DON-305: the sweep re-reads every device's recent hours each tick. A
    // chunk the store reports unchanged holds only fixes already durable and
    // already published, so it is not pushed through the render path again.
    if (
      chunk.phase === 'anti_entropy' &&
      persistedDirectly &&
      persistenceResult?.changed === false
    ) {
      return
    }
    for (const position of renderablePositions) {
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
    fetchBreadcrumbs: async (deviceId, from, to) => {
      const expectedHistoryResetKey = activeHistoryResetKey
      return (await fetchBreadcrumbsWithEvidence(
        deviceId,
        from,
        to,
        expectedHistoryResetKey,
        'background',
      )).accepted
    },
    onChunk: async (chunk) => {
      if (!isHistoryReconciliationCurrent()) {
        return
      }
      const input = createHistoryPersistenceInput(chunk)
      let persistedDirectly = false
      let persistenceResult: TrackingHistoryChunkPersistenceResult | null = null
      let keptPositions: readonly NormalizedTrackingPosition[] = []
      try {
        if (options.persistHistoryChunk !== undefined) {
          persistenceResult = await runMissionEvidencePersistence(
            input.expectedMissionId,
            () => persistHistoryChunkInPieces(input, options.persistHistoryChunk!, continueWithNextPiece),
          )
          keptPositions = persistenceResult.keptPositions
          persistedDirectly = true
        } else if (
          chunk.phase === 'initial' &&
          options.persistHistoryChunks !== undefined
        ) {
          const groupResult = await runMissionEvidencePersistence(
            input.expectedMissionId,
            () => persistHistoryChunkInPieces(input, (piece) => options.persistHistoryChunks!([piece]), continueWithNextPiece),
          )
          keptPositions = groupResult.keptPositions
          persistedDirectly = true
        }
      } catch (reason) {
        recordUnconfirmedTrailWrite(input.expectedMissionId)
        throw reason
      }
      acceptPersistedHistoryChunk(
        chunk,
        persistedDirectly,
        persistenceResult,
        keptPositions,
      )
    },
    onChunks: async (chunks) => {
      if (!isHistoryReconciliationCurrent()) {
        return
      }
      const inputs = chunks.map(createHistoryPersistenceInput)
      if (options.persistHistoryChunks !== undefined) {
        try {
          const groupResults = await runMissionEvidencePersistence(
            inputs[0]?.expectedMissionId ?? null,
            () => persistHistoryChunkGroups({
              inputs,
              persistGroup: options.persistHistoryChunks!,
              ...(options.persistHistoryChunk === undefined
                ? {} : { persistChunk: options.persistHistoryChunk }),
              onAcknowledged: (input, index, result, keptPositions) => {
                if (input.expectedMissionId !== activeHistoryResetKey) return
                const chunk = chunks[index]
                if (chunk !== undefined) {
                  acceptPersistedHistoryChunk(chunk, true, result, keptPositions)
                }
              },
              yieldBetweenGroups: () => new Promise<void>((resolve) => {
                scheduleTimeout(resolve, 0)
              }),
            }),
          )
          if (groupResults.some((result) => result.status === 'rejected')) {
            recordUnconfirmedTrailWrite(inputs[0]?.expectedMissionId ?? null)
          }
          return groupResults
        } catch (reason) {
          // A closed wave fence must not reopen through reconciler fallback.
          recordUnconfirmedTrailWrite(inputs[0]?.expectedMissionId ?? null)
          return chunks.map(() => ({ status: 'rejected' as const, reason }))
        }
      }
      if (options.persistHistoryChunk !== undefined) {
        const results = await Promise.all(inputs.map((input) =>
          runMissionEvidencePersistence(
            input.expectedMissionId,
            () => persistHistoryChunkInPieces(input, options.persistHistoryChunk!, continueWithNextPiece),
          ).catch((reason: unknown) => {
            recordUnconfirmedTrailWrite(input.expectedMissionId)
            throw reason
          })))
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
          // Device ids and ranges only: diagnostics never carry device names.
          recheckBacklog: progress.recheckBacklog.map(({ deviceId, from, to }) => ({ deviceId, from, to })),
        })
      }
      updateRecheckBacklogWarning(progress.recheckBacklog)
      // "Every window tried" (no pending device) is not "complete": an open
      // history gap keeps complete false and the gap warning up. Only the
      // forced flush and the canonical reload use the weaker signal, so an
      // unfillable gap cannot starve them [DON-338].
      const everyWindowTried = progress.pendingDeviceCount === 0
      if (progress.phase === 'initial') {
        const settled = progress.complete ? 'complete' : everyWindowTried ? 'attempted' : 'pending'
        if (settled === 'pending') {
          initialCatchUpSettled = 'pending'
        } else if (settled !== initialCatchUpSettled) {
          initialCatchUpSettled = settled
          flushHistorySnapshot(true, true)
          requestCanonicalization()
        }
      } else if (everyWindowTried) {
        // The re-check swept every device (its completion count ignores gaps).
        flushHistorySnapshot(true, true)
      }
      // A failure or gap found by the 5-minute re-check is raised when that
      // re-check reports, and cleared when it is filled; not deferred to the
      // next poll [DON-338].
      if (progress.phase === 'anti_entropy') {
        latestAntiEntropyFailedNames = progress.failedDeviceNames
      }
      const warningProgress = progress.phase === 'anti_entropy'
        ? { ...historyReconciler.getProgress(), historyGaps: progress.historyGaps }
        : progress
      const warningContext = { nowMs: now().getTime(), extraFailedNames: latestAntiEntropyFailedNames }
      breadcrumbStatusWarning = createHistoryReconciliationWarning(
        warningProgress,
        { ...warningContext, retry: 'retrying' },
      )
      breadcrumbStatusWarningWhileSuspended = createHistoryReconciliationWarning(
        warningProgress,
        { ...warningContext, retry: 'suspended' },
      )
      if (lastSuccessAt !== null && consecutiveFailures === 0) {
        publishOnlineStatusIfActive(combineTrackingWarnings(
          // History progress must not wipe a roster warning (ING-4 [DON-338]).
          ...getRosterWarnings(latestRosterWarning, true),
          breadcrumbStatusWarning,
          recheckBacklogWarning,
          breadcrumbIngestWarning,
        ))
      }
    },
    ...(options.historyAntiEntropyIntervalMs === undefined
      ? {}
      : { antiEntropyIntervalMs: options.historyAntiEntropyIntervalMs }),
    // Batches match the reconciler's transport share; a larger batch would
    // wait a whole extra round for the slots reserved for live trails.
    maxConcurrency: HISTORY_TRANSPORT_BACKGROUND_MAX_CONCURRENCY,
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
      // Already-persisted display history may finish publishing during pause,
      // without waiting for a held current request. A different mission must
      // never inherit this batch, even while its wake is coalesced behind I/O.
      if (isHistoryPublicationCurrent()) flushHistorySnapshot(false)
      else discardPendingHistorySnapshot()
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
    clearCanonicalizationRetryTimer()
    const sequence = ++canonicalizationSequence
    const historyResetKey = activeHistoryResetKey
    // Unconfirmed writes up to here may be in what this read returns; any
    // later one may not, so it keeps the line awaiting agreement.
    const agreementFence = unconfirmedTrailWrites
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
          missionEvidenceId: null,
          ...rosterAuthorityContext(snapshot.devices, latestParticipantRosterAuthoritative),
        },
      )
      completedSuccessfully = true
      if (agreementFence > trailWritesAgreedThrough) {
        trailWritesAgreedThrough = agreementFence
        if (!trailAwaitsStoreAgreement()) options.onTrailStoreAgreementChange?.(false)
      }
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
        if (trailAwaitsStoreAgreement()) {
          // An owed reload retries through the owed-reload spacing, so a fault
          // that fails reads as well as writes is not re-read every 5 s. The
          // retry is never dropped: the cooldown's end requests it [DON-349 P-6].
          if (owedReloadCooldownTimer !== null) {
            owedReloadFailedDuringCooldown = true
            return
          }
        }
        canonicalizationRetryTimer = scheduleTimeout(() => {
          canonicalizationRetryTimer = null
          if (trailAwaitsStoreAgreement()) requestOwedTrailReload()
          else requestCanonicalization()
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
          // A result discarded while paused or suspended schedules nothing;
          // the owed reload is re-requested on the next active poll tick.
          canonicalizationRefreshPending = false
        } else {
          requestOwedTrailReload()
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
    const historyObservation = rawBreadcrumbsForPersistence.length === 0
      ? null
      : options.beginMissionEvidenceObservation?.(activeHistoryResetKey) ?? null
    const context: TrackingSnapshotContext = {
      historyResetKey: activeHistoryResetKey,
      suppressTrackingCache: !writeTrackingCache,
      // Already-acknowledged history is a display update, not a fresh current fix.
      missionEvidenceId: rawBreadcrumbsForPersistence.length === 0
        ? null
        : historyObservation === null ? activeHistoryResetKey : historyObservation.missionId,
      ...rosterAuthorityContext(publishedSnapshot.devices, latestParticipantRosterAuthoritative),
    }
    const publication = Promise.resolve().then(() => options.onSnapshot(
      annotateTrackingSnapshotHealth(publishedSnapshot, {
        now: now(),
        deviceStaleThresholdMs: options.staleThresholdMs,
      }),
      context,
    )).finally(() => historyObservation?.complete())
    void publication.catch((error) => {
      logger.warn('Tracking history snapshot publication failed.', {
        failureKind: classifyTrackingFailure(error),
      })
    })
  }

  // The last status handed to the UI, so a non-active status is re-published
  // only when its text changes [DON-338].
  let lastPublishedStatus: TrackingConnectionStatus | null = null
  const publishStatus = (overrides: Partial<TrackingConnectionStatus> = {}) => {
    const status: TrackingConnectionStatus = {
      mode: 'idle',
      consecutiveFailures,
      recovered: false,
      lastSuccessAt,
      warning: null,
      ...overrides,
    }
    lastPublishedStatus = status
    options.onStatusChange(status)
  }

  /**
   * Publishes an "online" status from work that may settle after the mission
   * stopped being active (history progress, history completion or failure, a
   * late roster, a slow current-fix render). While paused or idle it never
   * publishes "online": the stored warnings are already updated by the
   * caller, and the inactive status is re-published only if its text changed,
   * so a paused status never gives way to "online" [DON-338].
   *
   * @param warnings the online status warnings, used only while active
   * @param recovered whether the online status reports a restored connection
   */
  function publishOnlineStatusIfActive(warnings: TrackingWarningFields, recovered = false): void {
    const pollingMode = options.getPollingMode?.() ?? 'active'
    if (pollingMode === 'active') {
      lastOnlineWarnings = warnings
      publishStatus({
        mode: 'online',
        recovered,
        ...(evidenceBackpressureActive
          ? {
              warning: [EVIDENCE_BACKPRESSURE_WARNING.text, warnings.warning].filter((text): text is string => text !== null).join(' '),
              warningCodes: [EVIDENCE_BACKPRESSURE_WARNING.code, ...warnings.warningCodes],
            }
          : warnings),
      })
      return
    }
    const inactive = getInactiveMissionWarning(pollingMode)
    if (lastPublishedStatus?.mode === 'idle' && lastPublishedStatus.warning === inactive.warning) return
    publishStatus({ mode: 'idle', ...inactive })
  }

  /**
   * Re-publishes the last good snapshot with each position's staleness
   * re-evaluated against the current time, so positions held while the poll
   * loop is parked go stale on schedule [DON-349 M-83].
   *
   * @param historyResetKey the mission scope of the parked poll
   */
  function republishLastGoodSnapshot(historyResetKey: string | null): void {
    if (lastGoodSnapshot === null) return
    options.onSnapshot(
      annotateTrackingSnapshotHealth(lastGoodSnapshot, {
        now: now(),
        deviceStaleThresholdMs: options.staleThresholdMs,
      }),
      {
        historyResetKey,
        missionEvidenceId: null,
        ...rosterAuthorityContext(lastGoodSnapshot.devices, latestParticipantRosterAuthoritative),
      },
    )
  }

  /**
   * Waits for room in the mission evidence queue without going quiet. If the
   * wait outlasts the larger of two poll intervals and half the stale
   * threshold, the status gains a critical "live refresh suspended" warning and
   * the last positions are re-published with their staleness re-evaluated, then
   * again every poll interval until the wait ends. Nothing is retried or given
   * up here: the wait itself is unchanged [DON-349 M-83].
   *
   * @param wait starts the capacity wait
   * @param republishLastPositions re-publishes the last good snapshot with fresh health
   * @returns what the wait returns
   */
  async function waitForEvidenceCapacityVisibly<T>(
    wait: () => Promise<T>,
    republishLastPositions: () => void,
  ): Promise<T> {
    // The status showing when the park was first reported, if it was not a
    // healthy online one: its mode and warnings stay, with this one first.
    let statusBeforePark: TrackingConnectionStatus | null = null
    const report = (): void => {
      if (stopping || (options.getPollingMode?.() ?? 'active') !== 'active') return
      evidenceBackpressureActive = true
      republishLastPositions()
      if (lastSuccessAt !== null && consecutiveFailures === 0) {
        publishOnlineStatusIfActive(lastOnlineWarnings)
        return
      }
      // Never online before a successful poll or while polls are failing:
      // an offline status stays offline [DON-349 coordinator review].
      statusBeforePark ??= lastPublishedStatus ?? { mode: 'idle', consecutiveFailures, recovered: false, lastSuccessAt, warning: null }
      publishStatus({
        mode: statusBeforePark.mode === 'online' ? 'idle' : statusBeforePark.mode,
        warning: [EVIDENCE_BACKPRESSURE_WARNING.text, statusBeforePark.warning].filter((text): text is string => text !== null).join(' '),
        warningCodes: [
          EVIDENCE_BACKPRESSURE_WARNING.code,
          ...(statusBeforePark.warning === null
            ? []
            : statusBeforePark.warningCodes !== undefined && statusBeforePark.warningCodes.length > 0
              ? statusBeforePark.warningCodes
              : ['unclassified' as const]),
        ],
      })
    }
    let repeat: ReturnType<typeof setInterval> | null = null
    const first = setTimeout(() => {
      report()
      repeat = setInterval(report, pollIntervalMs)
    }, Math.max(2 * pollIntervalMs, Math.floor(options.staleThresholdMs / 2)))
    try {
      return await wait()
    } finally {
      clearTimeout(first)
      if (repeat !== null) clearInterval(repeat)
      evidenceBackpressureActive = false
    }
  }

  /**
   * Tracks how long each device's re-check backlog has been outstanding and
   * names, in plain words, the devices behind for at least
   * RECHECK_BACKLOG_WARNING_INTERVALS re-check intervals. The warning clears
   * when their backlog empties [DON-338].
   *
   * @param backlog the re-check ranges still to be re-read, from the reconciler
   */
  function updateRecheckBacklogWarning(backlog: BreadcrumbHistoryProgress['recheckBacklog']): void {
    const nowMs = now().getTime()
    const behind = new Set(backlog.map((range) => range.deviceId))
    for (const deviceId of [...recheckBacklogSinceMsByDevice.keys()]) {
      if (!behind.has(deviceId)) recheckBacklogSinceMsByDevice.delete(deviceId)
    }
    for (const deviceId of behind) {
      if (!recheckBacklogSinceMsByDevice.has(deviceId)) recheckBacklogSinceMsByDevice.set(deviceId, nowMs)
    }
    const thresholdMs = RECHECK_BACKLOG_WARNING_INTERVALS *
      (options.historyAntiEntropyIntervalMs ?? DEFAULT_HISTORY_RECHECK_INTERVAL_MS)
    const overdue = backlog.filter((range) =>
      nowMs - (recheckBacklogSinceMsByDevice.get(range.deviceId) ?? nowMs) >= thresholdMs)
    const retrying = describeRecheckBacklogForOperator(overdue, nowMs, undefined, 'retrying')
    const suspended = describeRecheckBacklogForOperator(overdue, nowMs, undefined, 'suspended')
    recheckBacklogWarning = retrying === null ? null : { code: 'history_recheck_behind', text: retrying }
    recheckBacklogWarningWhileSuspended = suspended === null
      ? null
      : { code: 'history_recheck_behind', text: suspended }
  }

  /**
   * The roster warnings for a status: the latest roster progress (unless it
   * repeats the settled problem, or is a transient "refreshing" the status
   * leaves out), then the settled roster problem.
   *
   * @param progress the latest poll's roster warning
   * @param includeRefreshing whether a "refreshing" notice belongs on this status
   * @returns the warnings in display order; null entries are skipped later
   */
  function getRosterWarnings(
    progress: TrackingWarning | null,
    includeRefreshing: boolean,
  ): readonly (TrackingWarning | null)[] {
    const shownProgress = progress === null ||
      progress.text === settledRosterProblem?.text ||
      (progress.code === 'roster_refreshing' && !includeRefreshing)
      ? null
      : progress
    return [shownProgress, settledRosterProblem]
  }

  /**
   * Unresolved warnings about the trail and roster still on the map: the
   * roster warning (not a transient "refreshing"), the history warning and
   * rejected history rows. A paused or offline status must keep them for as
   * long as that trail is shown [DON-338].
   *
   * @param retry whether history retries are running; picks the wording
   * @returns the warnings in display order; null entries are skipped later
   */
  function getDisplayedTrailWarnings(retry: HistoryRetryState): readonly (TrackingWarning | null)[] {
    const historyWarning = retry === 'retrying' ? breadcrumbStatusWarning : breadcrumbStatusWarningWhileSuspended
    return [
      ...getRosterWarnings(latestRosterWarning, false),
      historyWarning?.code === 'connection_restored' ? null : historyWarning,
      retry === 'retrying' ? recheckBacklogWarning : recheckBacklogWarningWhileSuspended,
      breadcrumbIngestWarning,
    ]
  }

  /**
   * Returns the operator warning for a non-active polling mode. A paused
   * mission keeps its trail on the map, so its unresolved trail and roster
   * warnings follow the pause notice; a mission-less idle state shows none.
   */
  function getInactiveMissionWarning(pollingMode: 'paused' | 'idle'): TrackingWarningFields {
    const code = pollingMode === 'paused' ? 'mission_paused' : 'mission_waiting'
    const notice = options.getInactiveWarning?.(pollingMode) ?? {
      code,
      text: pollingMode === 'paused'
        ? 'Live refresh suspended while mission is paused.'
        : 'Waiting for an active mission.',
    }
    return pollingMode === 'paused'
      ? combineTrackingWarnings(notice, ...getDisplayedTrailWarnings('suspended'))
      : combineTrackingWarnings(notice)
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
        ...(stopping ? { suppressOperationalPublication: true } : {}),
      })
    } catch (error) {
      logger.warn('Current-position rejection evidence delivery failed.', {
        failureKind: classifyTrackingFailure(error),
      })
    }
    return true
  }

  /** Reports rejected history rows without exposing source payloads or blocking valid fixes. */
  async function publishBreadcrumbRejections(
    rejections: readonly CurrentPositionRejection[],
    missionId: string | null,
  ): Promise<void> {
    if (rejections.length === 0) return
    breadcrumbIngestWarning = createBreadcrumbIngestWarning(rejections.length)
    try {
      await options.onBreadcrumbRejections?.(rejections, {
        missionId,
        observedAt: now().toISOString(),
      })
    } catch (error) {
      logger.warn('Breadcrumb rejection evidence delivery failed.', {
        failureKind: classifyTrackingFailure(error),
      })
      throw error
    }
  }

  /** Whether a request of this priority may take a transport slot now. */
  function canAdmitHistoryTransport(priority: HistoryTransportPriority): boolean {
    return activeHistoryTransportCount < HISTORY_TRANSPORT_MAX_CONCURRENCY && (
      priority === 'live' ||
      activeBackgroundHistoryTransportCount < HISTORY_TRANSPORT_BACKGROUND_MAX_CONCURRENCY
    )
  }

  /** Hands freed slots to waiting live requests first, then to backfill. */
  function admitHistoryTransportWaiters(): void {
    for (const priority of ['live', 'background'] as const) {
      const waiters = historyTransportWaiters[priority]
      while (waiters.length > 0 && canAdmitHistoryTransport(priority)) {
        waiters.shift()!()
      }
    }
  }

  /**
   * Shares one bounded transport budget across incremental and reconciler
   * history. Reconciler requests never take the last slots, so a slow or
   * stalled backfill cannot freeze live trails [DON-305, DON-311].
   */
  async function acquireHistoryTransport(
    signal: AbortSignal,
    priority: HistoryTransportPriority,
  ): Promise<() => void> {
    signal.throwIfAborted()
    const waiters = historyTransportWaiters[priority]
    if (waiters.length > 0 || !canAdmitHistoryTransport(priority)) {
      await new Promise<void>((resolve, reject) => {
        const admit = () => {
          signal.removeEventListener('abort', abort)
          // Counted on admission so a later waiter cannot take the same slot.
          activeHistoryTransportCount += 1
          if (priority === 'background') activeBackgroundHistoryTransportCount += 1
          resolve()
        }
        const abort = () => {
          const waiterIndex = waiters.indexOf(admit)
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)
          reject(signal.reason ?? new DOMException('History request aborted.', 'AbortError'))
        }
        waiters.push(admit)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    } else {
      activeHistoryTransportCount += 1
      if (priority === 'background') activeBackgroundHistoryTransportCount += 1
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      activeHistoryTransportCount -= 1
      if (priority === 'background') activeBackgroundHistoryTransportCount -= 1
      admitHistoryTransportWaiters()
    }
    if (signal.aborted) {
      release()
      signal.throwIfAborted()
    }
    return release
  }

  /** Fetches exact history plus structured rejection evidence for one source response. */
  function fetchBreadcrumbsWithEvidence(
    deviceId: string,
    from: Date,
    to: Date,
    expectedHistoryResetKey: string | null,
    priority: HistoryTransportPriority,
  ): Promise<BreadcrumbNormalizationResult> {
    const signal = historyTransportAbortController.signal
    const operation = (async (): Promise<BreadcrumbNormalizationResult> => {
      const observation = options.beginMissionEvidenceObservation?.(
        expectedHistoryResetKey,
      ) ?? {
        missionId: expectedHistoryResetKey,
        complete: () => undefined,
      }
      let releaseTransport: (() => void) | null = null
      try {
        if (expectedHistoryResetKey !== null && observation.missionId === null) {
          throw new Error('Mission history evidence scope closed before transport admission.')
        }
        releaseTransport = await acquireHistoryTransport(signal, priority)
        const historyFrom = options.getInitialBreadcrumbFrom?.()
        if (observation.missionId !== null && historyFrom !== null && historyFrom !== undefined) {
          await options.persistHistoryRequest?.({ expectedMissionId: observation.missionId, deviceId,
            historyFrom: historyFrom.toISOString(), requestedUntil: to.toISOString() })
        }
        if (signal.aborted || expectedHistoryResetKey !== activeHistoryResetKey) {
          throw new Error('Mission history request was superseded before transport.')
        }
        const result = await (
          client.getBreadcrumbsWithReport?.(deviceId, from, to, signal) ??
          client.getBreadcrumbs(deviceId, from, to, signal).then((accepted) => ({
            accepted,
            rejected: [],
          }))
        )
        await publishBreadcrumbRejections(result.rejected, observation.missionId)
        return result
      } finally {
        releaseTransport?.()
        observation.complete()
      }
    })()
    const trackedOperation = operation.finally(() => {
      historyEvidenceOperations.delete(trackedOperation)
    })
    historyEvidenceOperations.add(trackedOperation)
    return trackedOperation
  }

  const scheduleNextPoll = (delayMs: number) => {
    if (!running || stopping) {
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

  /**
   * Snapshot context for the device list a snapshot carries: authoritative
   * only when the current roster is and the list came from a complete fetch,
   * named by that fetch; otherwise explicitly not authoritative.
   */
  function rosterAuthorityContext(
    devices: readonly NormalizedTrackingDevice[],
    authoritative: boolean,
  ): Pick<TrackingSnapshotContext, 'participantRosterAuthoritative' | 'rosterObservationId'> {
    const fetch = rosterFetchByDevices.get(devices)
    if (!authoritative || fetch === undefined || !fetch.complete) return { participantRosterAuthoritative: false }
    return { rosterObservationId: fetch.rosterObservationId }
  }

  /**
   * Publishes the status when a detached roster settles with a different
   * warning. Without this, a roster that lands after the current fixes and
   * history have both published would stay "refreshing" (or unwarned) until
   * the next poll [DON-338]. Skipped for a stopped, superseded or failing
   * poller; while paused it can only re-publish the paused status.
   *
   * @param previousRosterText the composed roster warning text before this roster settled
   * @param requestGeneration the lifecycle generation that started the request
   * @param requestHistoryResetKey the mission the request was started for
   */
  function publishSettledRosterStatus(
    previousRosterText: string | null,
    requestGeneration: number,
    requestHistoryResetKey: string | null,
  ): void {
    if (previousRosterText === composedRosterText()) return
    if (requestGeneration !== lifecycleGeneration || requestHistoryResetKey !== activeHistoryResetKey) return
    if (lastSuccessAt === null || consecutiveFailures !== 0) return
    publishOnlineStatusIfActive(combineTrackingWarnings(
      ...getRosterWarnings(latestRosterWarning, true),
      breadcrumbIngestWarning,
      !breadcrumbFetchCompleted && breadcrumbPositions.length === 0
        ? { code: 'history_loading', text: 'Current fixes loaded; loading breadcrumb history.' }
        : breadcrumbStatusWarning,
      recheckBacklogWarning,
    ))
  }

  /** The roster part of an active status, to tell whether a settle changed it. */
  function composedRosterText(): string | null {
    return combineTrackingWarnings(...getRosterWarnings(latestRosterWarning, true)).warning
  }

  /**
   * True while a roster request made under `generation` for mission
   * `historyResetKey` still belongs to the running lifecycle and mission.
   */
  function isRosterRequestCurrent(
    generation: number,
    historyResetKey: string | null,
    epoch: number,
  ): boolean {
    return running && !stopping &&
      epoch === rosterEpoch &&
      generation === lifecycleGeneration &&
      historyResetKey === activeHistoryResetKey &&
      historyResetKey === (options.getHistoryResetKey?.() ?? null)
  }

  /**
   * Reuses one detached roster request per lifecycle and mission so slow
   * metadata cannot accumulate; a new mission or lifecycle gets its own.
   */
  function getRosterRefresh(): Promise<DeviceRosterNormalizationResult> {
    if (
      rosterRefreshInFlight !== null &&
      rosterRefreshInFlight.epoch === rosterEpoch &&
      rosterRefreshInFlight.generation === lifecycleGeneration &&
      rosterRefreshInFlight.historyResetKey === activeHistoryResetKey
    ) return rosterRefreshInFlight.request
    const rosterObservationId = `roster-${++rosterFetchSequence}`
    const request = (client.getDevicesWithReport?.() ?? client.getDevices().then(
      (accepted) => ({ accepted, complete: true }),
    )).then((result): DeviceRosterNormalizationResult => {
      // A fresh list per fetch, so the fetch it came from is unambiguous.
      const accepted = [...result.accepted]
      rosterFetchByDevices.set(accepted, { rosterObservationId, complete: result.complete })
      return { ...result, accepted }
    })
    const requestGeneration = lifecycleGeneration
    const requestHistoryResetKey = activeHistoryResetKey
    const handle = {
      request,
      generation: requestGeneration,
      historyResetKey: requestHistoryResetKey,
      epoch: rosterEpoch,
    }
    rosterRefreshInFlight = handle
    void request.then((result) => {
      // A roster answer requested for an earlier lifecycle, mission or epoch,
      // or one this manager no longer holds, changes nothing in the current
      // mission: not the device list, not the roster authority, not the
      // missing-tracker warning [DON-338].
      if (
        rosterRefreshInFlight !== handle ||
        !isRosterRequestCurrent(requestGeneration, requestHistoryResetKey, handle.epoch)
      ) return
      applyRosterDevices(result.accepted, result.complete)
      latestParticipantRosterAuthoritative = result.complete
      // A roster that settles after the poll's grace period replaces
      // "refreshing"; an incomplete one must keep warning (ING-4 [DON-338]).
      const previousRosterText = composedRosterText()
      latestRosterWarning = createIncompleteRosterWarning(result)
      settledRosterProblem = latestRosterWarning
      publishSettledRosterStatus(previousRosterText, requestGeneration, requestHistoryResetKey)
    }, () => undefined).finally(() => {
      if (rosterRefreshInFlight === handle) rosterRefreshInFlight = null
    })
    return request
  }

  /** Adopts an answered roster's devices and records whether it was complete. */
  function applyRosterDevices(
    accepted: readonly NormalizedTrackingDevice[],
    complete: boolean,
  ): void {
    const resolved = resolveCurrentPositionDevices(accepted, latestCurrentPositions, latestDevices)
    if (resolved === accepted) latestDevicesFromCompleteRoster = complete
    else if (resolved !== latestDevices) latestDevicesFromCompleteRoster = false
    latestDevices = resolved
  }

  const poll = async (generation: number) => {
    const pollSequence = ++currentPollSequence
    const pollStartedAt = now().toISOString()
    let pollPhase: TrackingPollPhase = 'authentication'
    const pollHistoryResetKey = options.getHistoryResetKey?.() ?? null
    let completeCurrentPositionObservation = (): void => undefined
    let releaseEvidenceCapacity = (): void => undefined
    try {
      if (pollHistoryResetKey !== activeHistoryResetKey) {
        // Provider device metadata may be reused, but positions and fallback
        // coordinates belong to the mission that accepted their response.
        latestCurrentPositions = []
        initialSeedAbortController?.abort()
        initialSeedAbortController = null
        historyTransportAbortController.abort(
          new DOMException('Mission history request superseded.', 'AbortError'),
        )
        historyTransportAbortController = new AbortController()
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
        forgetAwaitedStoreAgreement()
        initialCatchUpSettled = 'pending'
        initialReconciliationSelectionKey = null
        canonicalizationInFlight?.abortController.abort()
        canonicalizationInFlight = null
        clearCanonicalizationRetryTimer()
        breadcrumbFetchCompleted = false
        breadcrumbStatusWarning = null
        breadcrumbStatusWarningWhileSuspended = null
        recheckBacklogSinceMsByDevice.clear()
        recheckBacklogWarning = null
        recheckBacklogWarningWhileSuspended = null
        latestAntiEntropyFailedNames = []
        breadcrumbIngestWarning = null
        latestRosterWarning = null
        settledRosterProblem = null
        // The old mission's roster request is not this mission's; and a device
        // list not proven complete is not carried over without its warning.
        rosterRefreshInFlight = null
        rosterEpoch += 1
        if (!latestDevicesFromCompleteRoster) latestDevices = []
        latestBreadcrumbTimestampByDevice.clear()
        historyReconciler.reset()
        lastGoodSnapshot = null
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
              missionEvidenceId: null,
              ...rosterAuthorityContext(lastGoodSnapshot.devices, latestParticipantRosterAuthoritative),
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
          ...getInactiveMissionWarning(pollingMode),
        })
        scheduleNextPoll(pollIntervalMs)
        return
      }

      // Resume pump: a reload owed by an unconfirmed write whose reload was
      // skipped or discarded while polling was not active [DON-338 round 11].
      requestOwedTrailReload()

      await withPollPhase('authentication', authenticateIfNeeded())
      if (stopping || discardSupersededPoll(generation, pollHistoryResetKey)) return

      // A mission switch may interrupt the previous producer's capacity wait.
      // Reserve room before observing another fix, even on the first new poll.
      if (options.reserveCurrentEvidenceCapacity !== undefined || options.waitForCurrentEvidenceCapacity !== undefined) {
        const controller = new AbortController()
        evidenceCapacityWait = controller
        try {
          const reserve = options.reserveCurrentEvidenceCapacity
          if (reserve !== undefined) {
            releaseEvidenceCapacity = await waitForEvidenceCapacityVisibly(
              () => reserve(controller.signal),
              () => republishLastGoodSnapshot(pollHistoryResetKey),
            )
          } else {
            await waitForEvidenceCapacityVisibly(
              async () => { await options.waitForCurrentEvidenceCapacity?.(controller.signal) },
              () => republishLastGoodSnapshot(pollHistoryResetKey),
            )
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error
          // Pause, scope replacement and stop cancel admission, not the provider.
          if (!stopping && !discardSupersededPoll(generation, pollHistoryResetKey)) {
            scheduleNextPoll(0)
          }
          return
        } finally {
          if (evidenceCapacityWait === controller) evidenceCapacityWait = null
        }
        if (stopping || discardSupersededPoll(generation, pollHistoryResetKey)) return
      }
      pollPhase = 'current_positions'
      const recoveredBeforeCurrentPositions = consecutiveFailures > 0
      const missionObservation = options.beginMissionEvidenceObservation?.(
        pollHistoryResetKey,
      ) ?? {
        missionId: pollHistoryResetKey,
        complete: () => undefined,
      }
      let missionEvidenceTransferred = false
      const missionEvidenceTransfer: TrackingMissionEvidenceTransfer = {
        ...missionObservation,
        claim: () => {
          missionEvidenceTransferred = true
        },
      }
      let resolveCurrentPositionObservation = (): void => undefined
      let currentPositionObservationCompleted = false
      const currentPositionObservation = new Promise<void>((resolve) => {
        resolveCurrentPositionObservation = resolve
      })
      let settleRosterGrace = (): void => undefined
      const rosterGraceSettlement = new Promise<void>((resolve) => {
        settleRosterGrace = resolve
      })
      settleCurrentPositionForStop = settleRosterGrace
      currentPositionObservationInFlight = currentPositionObservation
      const settleCurrentPositionObservation = (completeMissionEvidence: boolean): void => {
        if (currentPositionObservationCompleted) return
        currentPositionObservationCompleted = true
        releaseEvidenceCapacity()
        if (completeMissionEvidence) missionObservation.complete()
        resolveCurrentPositionObservation()
        if (currentPositionObservationInFlight === currentPositionObservation) {
          currentPositionObservationInFlight = null
        }
        settleCurrentPositionForStop = null
      }
      completeCurrentPositionObservation = () => {
        settleCurrentPositionObservation(!missionEvidenceTransferred)
      }
      const currentPositionResult = await fetchRosterAndCurrentPositions({
        getDevices: () => getRosterRefresh().then((result) => result.accepted),
        getDevicesWithReport: getRosterRefresh,
        getCurrentPositions: () => withPollPhase(
          'current_positions',
          client.getCurrentPositionsWithReport?.() ??
          client.getCurrentPositions().then((accepted) => ({
            accepted,
            rejected: [],
          })),
        ),
      }, latestDevices, {
        rosterGraceMs: CURRENT_POSITION_ROSTER_GRACE_MS,
        setTimeout: scheduleTimeout,
        settleRosterGrace: rosterGraceSettlement,
      })
      if (discardSupersededPoll(generation, pollHistoryResetKey)) {
        completeCurrentPositionObservation()
        return
      }

      const rosterBaseline = latestDevices
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
        completeCurrentPositionObservation()
        scheduleNextPoll(pollIntervalMs)
        return
      }

      const recovered = recoveredBeforeCurrentPositions
      consecutiveFailures = 0
      lastSuccessAt = now().toISOString()
      // Same provenance rule as the detached callback: the poll was checked
      // current above, and its roster request was made for this mission.
      if (devices === currentPositionResult.devices && devices !== rosterBaseline) {
        latestDevicesFromCompleteRoster = currentPositionResult.rosterComplete
      } else if (devices !== rosterBaseline) {
        latestDevicesFromCompleteRoster = false
      }
      latestDevices = devices
      latestCurrentPositions = positions
      latestParticipantRosterAuthoritative = currentPositionResult.rosterComplete
      latestRosterWarning = currentPositionResult.rosterWarning

      const currentSnapshot = {
        devices,
        positions,
        breadcrumbs: breadcrumbPositions,
        rawBreadcrumbsForPersistence: [],
        breadcrumbMetadata,
      }
      lastGoodSnapshot = currentSnapshot
      const publishedSnapshot = annotateTrackingSnapshotHealth(currentSnapshot, {
        now: now(),
        deviceStaleThresholdMs: options.staleThresholdMs,
      })
      const snapshotContext = {
        historyResetKey: pollHistoryResetKey,
        missionEvidenceId: missionObservation.missionId,
        ...rosterAuthorityContext(devices, currentPositionResult.rosterComplete),
      }
      let currentFixPublishedAtMs = monotonicNow()
      if (options.onCurrentSnapshot === undefined) {
        try {
          releaseEvidenceCapacity()
          const snapshotSettlement = options.onSnapshot(
            publishedSnapshot,
            snapshotContext,
          )
          currentFixPublishedAtMs = monotonicNow()
          await snapshotSettlement
        } finally {
          publishCurrentPositionRejections(
            currentPositionResult.rejected,
            missionObservation.missionId,
          )
          completeCurrentPositionObservation()
        }
      } else {
        publishCurrentPositionRejections(
          currentPositionResult.rejected,
          missionObservation.missionId,
        )
        // Convert the reserved slot to retained ownership in this synchronous
        // callback. No await or other producer can run between release/admission.
        releaseEvidenceCapacity()
        options.onCurrentSnapshot(
          publishedSnapshot,
          snapshotContext,
          missionEvidenceTransfer,
        )
        currentFixPublishedAtMs = monotonicNow()
        if (
          missionObservation.missionId !== null &&
          !missionEvidenceTransferred
        ) {
          throw new Error(
            'Current mission evidence publication returned without claiming its observation.',
          )
        }
        settleCurrentPositionObservation(!missionEvidenceTransferred)
      }
      // The current-fix render above may await; a pause meanwhile wins.
      publishOnlineStatusIfActive(combineTrackingWarnings(
        ...getRosterWarnings(currentPositionResult.rosterWarning, true),
        createRejectedCurrentPositionWarning(currentPositionResult.rejected),
        breadcrumbIngestWarning,
        recovered
          ? { code: 'connection_restored', text: 'CONNECTION RESTORED' }
          : !breadcrumbFetchCompleted && breadcrumbPositions.length === 0
            ? { code: 'history_loading', text: 'Current fixes loaded; loading breadcrumb history.' }
            : breadcrumbStatusWarning,
        recheckBacklogWarning,
      ), recovered)
      const completedAt = now().toISOString()
      options.onPollDiagnostic?.({
        ts: completedAt,
        kind: 'poll_cycle',
        outcome: recovered ? 'recovered' : 'success',
        phase: 'current_positions',
        durationMs: calculateDurationMs(pollStartedAt, completedAt),
        consecutiveFailures: 0,
        retryDelayMs: pollIntervalMs,
        ...(recovered && firstFailureAt !== null
          ? { outageDurationMs: calculateDurationMs(firstFailureAt, completedAt) }
          : {}),
        deviceCount: devices.length,
        currentPositionCount: acceptedPositions.length,
      })
      if (options.waitForCurrentEvidenceCapacity !== undefined) {
        const controller = new AbortController()
        evidenceCapacityWait = controller
        const waitForCapacity = options.waitForCurrentEvidenceCapacity
        try {
          await waitForEvidenceCapacityVisibly(
            () => waitForCapacity(controller.signal),
            () => republishLastGoodSnapshot(pollHistoryResetKey),
          )
        } finally {
          if (evidenceCapacityWait === controller) evidenceCapacityWait = null
        }
        if (stopping || discardSupersededPoll(generation, pollHistoryResetKey)) return
      }
      scheduleNextPoll(calculateRemainingPollIntervalMs(
        pollIntervalMs,
        currentFixPublishedAtMs,
        monotonicNow(),
      ))
      requestHistoryRefresh({
        generation,
        currentPollSequence: pollSequence,
        historyResetKey: pollHistoryResetKey,
      })
      firstFailureAt = null
    } catch (error) {
      completeCurrentPositionObservation()
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
        try {
          void Promise.resolve(options.onSnapshot(
            annotateTrackingSnapshotHealth(lastGoodSnapshot, {
              now: now(),
              deviceStaleThresholdMs: options.staleThresholdMs,
            }),
            {
              historyResetKey: pollHistoryResetKey,
              missionEvidenceId: null,
              ...rosterAuthorityContext(lastGoodSnapshot.devices, latestParticipantRosterAuthoritative),
            },
          )).catch((fallbackError) => {
            logger.warn('Tracking fallback snapshot publication failed.', {
              failureKind: classifyTrackingFailure(fallbackError),
            })
          })
        } catch (fallbackError) {
          logger.warn('Tracking fallback snapshot publication failed.', {
            failureKind: classifyTrackingFailure(fallbackError),
          })
        }
      }

      publishStatus({
        mode: 'offline',
        ...combineTrackingWarnings(isAuthenticationFailure(failure.cause)
          ? { code: 'auth_failed', text: 'TRACKING AUTHENTICATION FAILED — check Traccar credentials.' }
          : lastGoodSnapshot !== null && lastGoodSnapshot.positions.length > 0
            ? { code: 'offline_last_known', text: 'OFFLINE MODE — showing last known positions.' }
            : { code: 'offline_no_positions', text: 'OFFLINE MODE — no current positions received for this mission.' },
          ...getDisplayedTrailWarnings('retrying')),
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
    } finally {
      releaseEvidenceCapacity()
    }
  }

  /** Coalesces one mission without letting superseded transport block a new mission. */
  function requestHistoryRefresh(request: HistoryRefreshRequest): void {
    if (activeHistoryTasksByMission.has(request.historyResetKey)) {
      pendingHistoryRefreshByMission.set(request.historyResetKey, request)
      return
    }
    startHistoryRefreshTask(request)
  }

  /** Owns one admitted mission-history refresh through evidence settlement. */
  function startHistoryRefreshTask(request: HistoryRefreshRequest): void {
    const historyStartedAt = now().toISOString()
    const promise = refreshHistory(request, historyStartedAt).catch((error) => {
      if (!isHistoryRefreshCurrent(request)) return
      breadcrumbStatusWarning = {
        code: 'history_refresh_failed',
        text: 'BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
      }
      breadcrumbStatusWarningWhileSuspended = {
        code: 'history_refresh_failed',
        text: 'BREADCRUMB HISTORY REFRESH FAILED — exact history will retry when live tracking resumes.',
      }
      logger.warn('Tracking breadcrumb refresh failed.', {
        failureKind: classifyTrackingFailure(error),
      })
      if (canPublishHistoryStatus(request)) {
        publishOnlineStatusIfActive(combineTrackingWarnings(
          ...getRosterWarnings(latestRosterWarning, true),
          breadcrumbStatusWarning,
          recheckBacklogWarning,
          breadcrumbIngestWarning,
        ))
      }
      const completedAt = now().toISOString()
      options.onPollDiagnostic?.({
        ts: completedAt,
        kind: 'poll_cycle',
        outcome: 'failure',
        phase: 'breadcrumbs',
        durationMs: calculateDurationMs(historyStartedAt, completedAt),
        consecutiveFailures: 0,
        retryDelayMs: pollIntervalMs,
        failureKind: classifyTrackingFailure(error),
      })
    }).finally(() => {
      historyTaskPromises.delete(promise)
      const active = activeHistoryTasksByMission.get(request.historyResetKey)
      if (active?.promise === promise) {
        activeHistoryTasksByMission.delete(request.historyResetKey)
      }
      const pending = pendingHistoryRefreshByMission.get(request.historyResetKey)
      pendingHistoryRefreshByMission.delete(request.historyResetKey)
      if (pending !== undefined && running && !stopping) {
        startHistoryRefreshTask(pending)
      }
    })
    const task = { request, promise }
    activeHistoryTasksByMission.set(request.historyResetKey, task)
    historyTaskPromises.add(promise)
    if (!isHistoryRefreshCurrent(request)) {
      pendingHistoryRefreshByMission.delete(request.historyResetKey)
    }
  }

  /** Refreshes breadcrumb evidence without owning the live-current poll cadence. */
  async function refreshHistory(
    request: HistoryRefreshRequest,
    historyStartedAt: string,
  ): Promise<void> {
    if (!isHistoryRefreshCurrent(request)) return
    // Keep one stable fetch/diagnostic cohort for this history request while
    // snapshots deliberately pair its evidence with the newest live roster.
    const historyDevices = latestDevices
    const breadcrumbPositionsBeforeSeed = breadcrumbPositions
    const seedState = await seedInitialBreadcrumbs()
    if (!isHistoryRefreshCurrent(request)) return

    const pollingModeAfterSeed = options.getPollingMode?.() ?? 'active'
    if (pollingModeAfterSeed !== 'active') {
      publishInactiveMissionSnapshot(pollingModeAfterSeed)
      return
    }
    if (
      seedState === 'loaded' &&
      breadcrumbPositions !== breadcrumbPositionsBeforeSeed &&
      breadcrumbPositions.length > 0
    ) {
      const seededSnapshot = {
        devices: latestDevices,
        positions: latestCurrentPositions,
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
          historyResetKey: request.historyResetKey,
          missionEvidenceId: null,
          ...rosterAuthorityContext(seededSnapshot.devices, latestParticipantRosterAuthoritative),
        },
      )
    }

    const breadcrumbDevices = selectBreadcrumbDevices(historyDevices)
    const breadcrumbFetchPromise = fetchIncrementalBreadcrumbs(
      historyDevices,
      seedState,
      request,
    )
    if (seedState === 'loaded') {
      const initialBreadcrumbFrom = options.getInitialBreadcrumbFrom?.() ?? null
      const selectionKey = JSON.stringify([
        initialBreadcrumbFrom?.toISOString() ?? null,
        breadcrumbDevices.map((device) => device.device_id).sort(),
      ])
      if (selectionKey !== initialReconciliationSelectionKey) {
        initialReconciliationSelectionKey = selectionKey
        initialCatchUpSettled = 'pending'
      }
      const reconciliationUntil = now()
      historyReconciler.reconcile({
        devices: breadcrumbDevices,
        from: initialBreadcrumbFrom,
        until: reconciliationUntil,
        checkpointsByDevice: resolveCurrentHistoryCheckpoints(
          breadcrumbDevices,
          initialBreadcrumbFrom,
          reconciliationUntil,
        ),
      })
    }
    const breadcrumbFetch = await breadcrumbFetchPromise
    if (!isHistoryRefreshCurrent(request)) return

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
      devices: latestDevices,
      positions: latestCurrentPositions,
      breadcrumbs: breadcrumbPositions,
      rawBreadcrumbsForPersistence: breadcrumbFetch.positions,
      breadcrumbMetadata,
    }
    const latestPollingMode = options.getPollingMode?.() ?? 'active'
    if (latestPollingMode !== 'active') {
      flushHistorySnapshot(false)
      historyReconciler.suspend()
      publishInactiveMissionSnapshot(latestPollingMode)
      return
    }

    lastGoodSnapshot = {
      ...rawSnapshot,
      rawBreadcrumbsForPersistence: [],
    }
    if (breadcrumbPositions !== previousBreadcrumbPositions) {
      const historyObservation = options.beginMissionEvidenceObservation?.(
        request.historyResetKey,
      ) ?? {
        missionId: request.historyResetKey,
        complete: () => undefined,
      }
      try {
        await options.onSnapshot(
          annotateTrackingSnapshotHealth(rawSnapshot, {
            now: now(),
            deviceStaleThresholdMs: options.staleThresholdMs,
          }),
          {
            historyResetKey: request.historyResetKey,
            missionEvidenceId: historyObservation.missionId,
            ...rosterAuthorityContext(rawSnapshot.devices, latestParticipantRosterAuthoritative),
          },
        )
      } finally {
        historyObservation.complete()
      }
    }
    breadcrumbFetchCompleted = true
    const completionProgress = historyReconciler.getProgress()
    const completionContext = { nowMs: now().getTime(), extraFailedNames: latestAntiEntropyFailedNames }
    breadcrumbStatusWarning = createBreadcrumbCompletionWarning(
      breadcrumbFetch,
      false,
      seedState,
      completionProgress,
      { ...completionContext, retry: 'retrying' },
    )
    breadcrumbStatusWarningWhileSuspended = createBreadcrumbCompletionWarning(
      breadcrumbFetch,
      false,
      seedState,
      completionProgress,
      { ...completionContext, retry: 'suspended' },
    )
    // The history render above may await; a pause meanwhile must not be
    // replaced by "online" (the poll sequence only moves once a poll runs).
    if (canPublishHistoryStatus(request)) {
      publishOnlineStatusIfActive(combineTrackingWarnings(
        ...getRosterWarnings(latestRosterWarning, true),
        breadcrumbIngestWarning,
        breadcrumbStatusWarning,
        recheckBacklogWarning,
      ))
    }

    const completedAt = now().toISOString()
    const historySucceeded =
      seedState !== 'failed' && breadcrumbFetch.failedDeviceCount === 0
    options.onPollDiagnostic?.({
      ts: completedAt,
      kind: 'poll_cycle',
      outcome: historySucceeded ? 'success' : 'failure',
      phase: 'breadcrumbs',
      durationMs: calculateDurationMs(historyStartedAt, completedAt),
      consecutiveFailures: 0,
      retryDelayMs: pollIntervalMs,
      deviceCount: historyDevices.length,
      breadcrumbRequestedDeviceCount: breadcrumbFetch.requestedDeviceCount,
      breadcrumbReturnedCount: breadcrumbFetch.positions.length,
      breadcrumbAcceptedCount: acceptedBreadcrumbCount,
      breadcrumbDuplicateCount: Math.max(
        0,
        breadcrumbFetch.positions.length - acceptedBreadcrumbCount,
      ),
      breadcrumbRejectedCount: breadcrumbFetch.rejectedCount,
      breadcrumbFailedDeviceCount: breadcrumbFetch.failedDeviceCount,
      ...(!historySucceeded ? { failureKind: 'unknown' as const } : {}),
      ...(breadcrumbFetch.window === null
        ? {}
        : { breadcrumbWindow: breadcrumbFetch.window }),
    })
  }

  function isHistoryRefreshCurrent(request: HistoryRefreshRequest): boolean {
    return (
      running &&
      !stopping &&
      request.generation === lifecycleGeneration &&
      request.historyResetKey === activeHistoryResetKey &&
      (options.getHistoryResetKey?.() ?? null) === request.historyResetKey &&
      (options.getPollingMode?.() ?? 'active') === 'active'
    )
  }

  /** Prevents older history completion from restoring online after a newer current poll. */
  function canPublishHistoryStatus(request: HistoryRefreshRequest): boolean {
    return (
      request.currentPollSequence === currentPollSequence &&
      consecutiveFailures === 0
    )
  }

  async function runPoll(generation: number): Promise<void> {
    if (!running || stopping || generation !== lifecycleGeneration) {
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
          missionEvidenceId: null,
          ...rosterAuthorityContext(lastGoodSnapshot.devices, latestParticipantRosterAuthoritative),
        },
      )
    } else if (pollingMode === 'idle') {
      options.onSnapshot(EMPTY_TRACKING_SNAPSHOT, {
        historyResetKey: activeHistoryResetKey,
        missionEvidenceId: null,
        participantRosterAuthoritative: false,
      })
    }

    publishStatus({
      mode: 'idle',
      ...getInactiveMissionWarning(pollingMode),
    })
  }

  return {
    start: () => {
      if (running || stopping) {
        return
      }

      running = true
      lifecycleGeneration += 1
      void runPoll(lifecycleGeneration)
    },
    stop: () => {
      stopPromise ??= stopPolling().catch((error: unknown) => {
        stopPromise = null
        throw error
      })
      return stopPromise
    },
    requestPollNow: () => {
      if (!running) {
        return
      }
      if (
        (options.getHistoryResetKey?.() ?? null) !== activeHistoryResetKey ||
        (options.getPollingMode?.() ?? 'active') !== 'active'
      ) {
        evidenceCapacityWait?.abort()
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

  /** Stops new work, settles the current safety observation, then invalidates the poll. */
  async function stopPolling(): Promise<void> {
    stopping = true
    flushHistorySnapshot(false)
    evidenceCapacityWait?.abort()
    immediatePollRequested = false
    pendingHistoryRefreshByMission.clear()
    if (timer !== null) {
      clearScheduledTimeout(timer)
      timer = null
    }
    initialSeedAbortController?.abort()
    canonicalizationInFlight?.abortController.abort()
    historyTransportAbortController.abort(
      new DOMException('Tracking history stopped before transport completed.', 'AbortError'),
    )
    settleCurrentPositionForStop?.()
    if (currentPositionObservationInFlight !== null) {
      await currentPositionObservationInFlight
    }
    if (historyTaskPromises.size > 0) {
      await Promise.allSettled([...historyTaskPromises])
    }
    if (historyEvidenceOperations.size > 0) {
      await Promise.allSettled([...historyEvidenceOperations])
    }
    if (historyPersistenceOperations.size > 0) {
      await Promise.allSettled([...historyPersistenceOperations])
    }
    running = false
    lifecycleGeneration += 1
    historyReconciler.reset()
    latestAntiEntropyFailedNames = []
    latestRosterWarning = null
    settledRosterProblem = null
    rosterRefreshInFlight = null
    rosterEpoch += 1
    canonicalizationSequence += 1
    canonicalizationRefreshPending = false
    forgetAwaitedStoreAgreement()
    initialCatchUpSettled = 'pending'
    initialReconciliationSelectionKey = null
    initialSeedAbortController = null
    canonicalizationInFlight = null
    clearCanonicalizationRetryTimer()
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

  /** Permits accepted display history for this mission, including during pause. */
  function isHistoryPublicationCurrent(): boolean {
    return (
      running &&
      !stopping &&
      (options.getHistoryResetKey?.() ?? null) === activeHistoryResetKey
    )
  }

  /** Fetches new history only while the same mission remains active. */
  function isHistoryReconciliationCurrent(): boolean {
    return isHistoryPublicationCurrent() &&
      (options.getPollingMode?.() ?? 'active') === 'active'
  }

  async function fetchIncrementalBreadcrumbs(
    devices: readonly NormalizedTrackingDevice[],
    seedState: InitialBreadcrumbSeedState,
    request: HistoryRefreshRequest,
  ): Promise<BreadcrumbFetchResult> {
    if (seedState === 'failed') {
      return {
        positions: [],
        recentPositions: [],
        requestedDeviceCount: 0,
        failedDeviceCount: 0,
        failedDeviceNames: [],
        rejectedCount: 0,
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

        const result = await fetchBreadcrumbsWithEvidence(
          device.device_id,
          fetchFrom,
          fetchUntil,
          request.historyResetKey,
          'live',
        )
        const breadcrumbs = result.accepted
        let recentBreadcrumbs = breadcrumbs
        if (options.persistHistoryChunk !== undefined && request.historyResetKey !== null && initialFrom !== null) {
          // The live line waits for the store's answer and draws only what
          // was sent and kept; a failed or unanswered write draws nothing and
          // the line is reconciled with the store before the failure is
          // treated as resolved [DON-338].
          const persisted = await runMissionEvidencePersistence(request.historyResetKey, () => persistHistoryChunkInPieces({
            phase: 'incremental', expectedMissionId: request.historyResetKey, deviceId: device.device_id,
            historyFrom: initialFrom.toISOString(), reconciledFrom: fetchFrom.toISOString(),
            reconciledUntil: fetchUntil.toISOString(), positions: breadcrumbs,
          }, options.persistHistoryChunk!, continueWithNextPiece)).catch((reason: unknown) => {
            // The write may have committed: fixes stored before the failure may
            // fall out of the next live window, so read the store back.
            recordUnconfirmedTrailWrite(request.historyResetKey)
            throw reason
          })
          recentBreadcrumbs = onlyKeptPositions(breadcrumbs, persisted.keptPositions)
          requestOwedTrailReload()
        }
        const newestTimestamp = getCursorTimestampFromBatch(
          breadcrumbs,
          fetchUntil,
        )
        if (newestTimestamp !== null && isHistoryRefreshCurrent(request)) {
          latestBreadcrumbTimestampByDevice.set(device.device_id, newestTimestamp)
        }

        return {
          breadcrumbs,
          recentBreadcrumbs,
          previousCursor: lastTimestamp ?? null,
          requestedFrom: fetchFrom.toISOString(),
          requestedTo: fetchUntil.toISOString(),
          newestReturned: newestTimestamp,
          rejectedCount: result.rejected.length,
        }
      }),
    )

    const aggregated: NormalizedTrackingPosition[] = []
    const recentPositions: NormalizedTrackingPosition[] = []
    let failedDeviceCount = 0
    let rejectedCount = 0
    const failedDeviceNames: string[] = []
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      if (result === undefined) {
        continue
      }
      if (result.status === 'fulfilled') {
        aggregated.push(...result.value.breadcrumbs)
        recentPositions.push(...result.value.recentBreadcrumbs)
        rejectedCount += result.value.rejectedCount
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
      rejectedCount,
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

  /** Combines durable cursors with the latest participant-scope origin. */
  function resolveCurrentHistoryCheckpoints(
    devices: readonly NormalizedTrackingDevice[],
    from: Date | null,
    until: Date,
  ): Readonly<Record<string, BreadcrumbHistoryCheckpointSeed>> {
    if (from === null || options.getParticipantHistoryStarts === undefined) {
      return initialHistoryCheckpointsByDevice
    }
    const scopeStarts = options.getParticipantHistoryStarts(
      devices.map((device) => device.device_id),
      from,
      until,
    )
    const resolved = { ...initialHistoryCheckpointsByDevice }
    for (const device of devices) {
      const scopeStart = scopeStarts[device.device_id]
      if (scopeStart === undefined) continue
      const persisted = resolved[device.device_id]
      if (persisted === undefined || scopeStart < persisted.historyFrom) {
        resolved[device.device_id] = {
          historyFrom: scopeStart,
          reconciledUntil: scopeStart,
        }
      }
    }
    return resolved
  }

  /** Mirrors the durable monotonic checkpoint after a chunk acknowledgement. */
  function rememberAcknowledgedHistoryCheckpoint(
    chunk: BreadcrumbHistoryChunk,
  ): void {
    const historyFrom = chunk.historyFrom.toISOString()
    const reconciledUntil = chunk.to.toISOString()
    const existing = initialHistoryCheckpointsByDevice[chunk.deviceId]
    if (
      existing !== undefined &&
      historyFrom < existing.historyFrom &&
      reconciledUntil < existing.historyFrom
    ) {
      return
    }
    if (existing !== undefined && historyFrom > existing.historyFrom) {
      return
    }
    initialHistoryCheckpointsByDevice = {
      ...initialHistoryCheckpointsByDevice,
      [chunk.deviceId]: {
        historyFrom: existing === undefined
          ? historyFrom
          : historyFrom < existing.historyFrom
            ? historyFrom
            : existing.historyFrom,
        reconciledUntil:
          existing !== undefined && existing.reconciledUntil > reconciledUntil
            ? existing.reconciledUntil
            : reconciledUntil,
      },
    }
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
): TrackingWarning | null {
  return rejections.length > 0
    ? {
        code: 'positions_rejected',
        text: 'POSITION DATA REJECTED — showing the last accepted fix where no valid replacement was available.',
      }
    : null
}

type InitialBreadcrumbSeedState = 'loaded' | 'failed'

type BreadcrumbFetchResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly recentPositions: readonly NormalizedTrackingPosition[]
  readonly requestedDeviceCount: number
  readonly failedDeviceCount: number
  readonly failedDeviceNames: readonly string[]
  readonly rejectedCount: number
  readonly window: TrackingBreadcrumbWindowSummary | null
}

/** Creates the persistent operator warning for the latest rejected history response. */
function createBreadcrumbIngestWarning(rejectedCount: number): TrackingWarning {
  return {
    code: 'history_rows_rejected',
    text: `BREADCRUMB EVIDENCE WARNING — the latest affected history response rejected ${rejectedCount} source ${rejectedCount === 1 ? 'row' : 'rows'}. Valid canonical fixTime evidence remains available; rejected rows stay excluded and are reported.`,
  }
}

/** What the history warning needs beyond the reconciler's progress. */
type HistoryWarningContext = {
  /** The current time, which decides whether a gap's date is shown. */
  readonly nowMs: number
  /** Failed devices the progress itself does not list (re-check failures). */
  readonly extraFailedNames: readonly string[]
  /** Whether history retries are running, or suspended with live tracking. */
  readonly retry: HistoryRetryState
}

/** The closing clause for a history warning about devices that still fail. */
function failedHistoryClause(retry: HistoryRetryState): string {
  return historyRetryClause(retry, 'retrying while current fixes remain live')
}

/**
 * Builds the history warning shown once a breadcrumb fetch completes: storage
 * failure first, then failed devices, then reconciliation, then a restored
 * connection (never claimed while live tracking is suspended).
 */

function createBreadcrumbCompletionWarning(
  result: BreadcrumbFetchResult,
  recovered: boolean,
  seedState: InitialBreadcrumbSeedState,
  historyProgress: BreadcrumbHistoryProgress,
  context: HistoryWarningContext,
): TrackingWarning | null {
  if (seedState === 'failed') {
    return {
      code: 'history_storage_failed',
      text: context.retry === 'retrying'
        ? 'Breadcrumb history could not be loaded from mission storage; current fixes remain live.'
        : 'Breadcrumb history could not be loaded from mission storage.',
    }
  }
  if (result.failedDeviceCount > 0 && historyProgress.historyGaps.length === 0) {
    return {
      code: 'history_incomplete',
      text: `Breadcrumb history incomplete for ${listNamesBounded(
        mergeNames(result.failedDeviceNames, context.extraFailedNames),
      )}; ${historyRetryClause(context.retry, 'current fixes remain live')}.`,
    }
  }
  const reconciliationWarning = createHistoryReconciliationWarning(historyProgress, {
    ...context,
    extraFailedNames: mergeNames(result.failedDeviceNames, context.extraFailedNames),
  })
  if (reconciliationWarning !== null) {
    return reconciliationWarning
  }
  return recovered && context.retry === 'retrying'
    ? { code: 'connection_restored', text: 'CONNECTION RESTORED' }
    : null
}

/**
 * Builds the history warning. Unfetchable ranges are named with device and
 * local time range [DON-338]; other failing devices are named after them;
 * otherwise devices still catching up are listed.
 */
function createHistoryReconciliationWarning(
  progress: BreadcrumbHistoryProgress,
  context: HistoryWarningContext,
): TrackingWarning | null {
  const failedNames = mergeNames(progress.failedDeviceNames, context.extraFailedNames)
  const gapSentence = describeHistoryGapsForOperator(
    progress.historyGaps,
    context.nowMs,
    undefined,
    context.retry,
  )
  if (gapSentence !== null) {
    const gapNames = new Set(progress.historyGaps.map((gap) => gap.deviceName))
    const otherFailed = failedNames.filter((name) => !gapNames.has(name))
    return {
      code: 'history_incomplete',
      text: otherFailed.length === 0
        ? gapSentence
        : `${gapSentence} Breadcrumb history also incomplete for ${listNamesBounded(
          otherFailed,
        )}; ${failedHistoryClause(context.retry)}.`,
    }
  }
  if (failedNames.length > 0) {
    return {
      code: 'history_incomplete',
      text: `Breadcrumb history incomplete for ${listNamesBounded(
        failedNames,
      )}; ${failedHistoryClause(context.retry)}.`,
    }
  }
  if (progress.pendingDeviceNames.length > 0) {
    return {
      code: 'history_reconciling',
      text: `Breadcrumb history is reconciling for ${listNamesBounded(
        progress.pendingDeviceNames,
      )}; ${context.retry === 'retrying'
        ? 'current fixes remain live'
        : 'loading resumes when live tracking resumes'}.`,
    }
  }
  return null
}

/** Joins two name lists in order without repeating a name. */
function mergeNames(first: readonly string[], second: readonly string[]): readonly string[] {
  if (second.length === 0) return first
  return [...new Set([...first, ...second])]
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

/** Keeps the already-clamped cadence, counting elapsed settlement without overlapping polls. */
function calculateRemainingPollIntervalMs(
  intervalMs: number,
  startedAtMs: number,
  completedAtMs: number,
): number {
  if (!Number.isFinite(startedAtMs)
    || !Number.isFinite(completedAtMs)
    || completedAtMs < startedAtMs) {
    return intervalMs
  }
  // intervalMs already includes the configured minimum. Reapplying that minimum
  // to the remaining delay would charge elapsed work twice and slow fresh fixes.
  return Math.max(0, intervalMs - (completedAtMs - startedAtMs))
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
