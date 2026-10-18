const path = require('node:path')
const { randomUUID } = require('node:crypto')

const { formatStorageDiagnostics } = require('./storage-diagnostics-format.cjs')
const {
  BACKUP_STAGES,
  STATE_FILE_NAME,
  createEmptyMissionState,
  createEmptyState,
  duration,
  elapsedSince,
  knownStage,
  nonNegativeInteger,
  nullableIsoTimestamp,
  observedCadence,
  positiveNumberOrNull,
  publicOperation,
  readState,
  readStorageFileSizes,
  readValidationMetadata,
  safeErrorName,
  safeIsoTimestamp,
  writeStateAtomically,
} = require('./storage-diagnostics-state.cjs')

// Tracking writes arrive many times a second under load; logging each one rotated
// the runtime log in ~20 s and evicted earlier warnings [DON-336].
const TRACKING_SUMMARY_INTERVAL_MS = 60_000
const SLOW_WRITE_LOG_LIMIT = 100

/**
 * Creates the bounded, identity-free storage diagnostics checkpoint and event writer.
 *
 * The rotated runtime log remains the timeline of record. A single small JSON checkpoint
 * records the active/last operation and cumulative numeric facts so kill/restart evidence
 * survives log rotation without becoming a parallel telemetry store.
 */
function createStorageDiagnostics(options) {
  const userDataPath = options.userDataPath
  const statePath = path.join(userDataPath, STATE_FILE_NAME)
  const runtimeLog = options.runtimeLog
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()
  const monotonicNow =
    typeof options.monotonicNow === 'function' ? options.monotonicNow : () => performance.now()
  const createId = typeof options.createId === 'function' ? options.createId : randomUUID
  const validationMode = options.validationMode === true
  let state = createEmptyState()
  let writeChain = Promise.resolve()
  let trackingWindow = null
  let slowWriteCount = 0

  return {
    initialize,
    configureStore,
    createOperation,
    requested,
    started,
    phase,
    completed,
    failed,
    configurePolling,
    startMission,
    recordRestart,
    recordTrackingBatch,
    recordInsertedPositions,
    flushTrackingSummary,
    recordSlowWrite,
    recordEventLoopSummary,
    recordBackupTemporaryCleanup,
    recordBackupShutdownTimeout,
    readSupportSnapshot,
    statePath,
  }

  /** Converts an active prior-run marker into explicit interrupted-operation evidence. */
  async function initialize() {
    state = await readState(statePath)
    if (state.activeOperation === null) return

    const interrupted = {
      type: state.activeOperation.type,
      stage: state.activeOperation.stage,
      startedAt: state.activeOperation.startedAt,
      detectedAt: now(),
    }
    state = {
      ...state,
      activeOperation: null,
      previousInterruptedOperation: interrupted,
    }
    await persistState()
    await appendDurable({
      level: 'error',
      event: 'storage_previous_run_interrupted',
      fields: interrupted,
    })
  }

  /** Records the current mission-store schema without inspecting operational rows. */
  async function configureStore(input) {
    state = {
      ...state,
      schemaVersion: nonNegativeInteger(input.schemaVersion),
    }
    await persistState()
  }

  /** Creates an in-memory operation token containing no mission or operator identity. */
  function createOperation(type) {
    if (type !== 'backup') {
      throw new Error(`Unsupported storage diagnostics operation: ${String(type)}`)
    }
    return {
      id: createId(),
      type,
      requestedAtMs: monotonicNow(),
    }
  }

  /** Records a low-volume queue request in the existing bounded runtime log. */
  async function requested(operation, input = {}) {
    assertOperation(operation)
    await appendDurable({
      level: 'info',
      event: `storage_${operation.type}_requested`,
      fields: {
        operationId: operation.id,
        queueDepth: nonNegativeInteger(input.queueDepth),
        trigger: safeBackupTrigger(input.trigger),
      },
    })
  }

  /** Flushes the active crash marker before the storage operation begins. */
  async function started(operation) {
    assertOperation(operation)
    const startedAtMs = monotonicNow()
    const marker = {
      id: operation.id,
      type: operation.type,
      stage: 'started',
      startedAt: now(),
      startedAtMs,
      requestedAtMs: operation.requestedAtMs,
      lastPhaseAtMs: startedAtMs,
    }
    state = { ...state, activeOperation: marker }
    await persistState()
    await appendDurable({
      level: 'info',
      event: `storage_${operation.type}_started`,
      fields: {
        operationId: operation.id,
        queueWaitMs: duration(startedAtMs - operation.requestedAtMs),
        ...(await readStorageFileSizes(userDataPath)),
      },
    })
  }

  /** Flushes a known backup phase marker before the next potentially blocking phase. */
  async function phase(operation, stage) {
    const active = requireActiveOperation(operation)
    if (!BACKUP_STAGES.has(stage)) {
      throw new Error(`Unsupported backup diagnostics stage: ${String(stage)}`)
    }
    const atMs = monotonicNow()
    const phaseDurationMs = duration(atMs - active.lastPhaseAtMs)
    state = {
      ...state,
      activeOperation: {
        ...active,
        stage,
        lastPhaseAtMs: atMs,
      },
    }
    await persistState()
    await appendDurable({
      level: 'info',
      event: `storage_${operation.type}_${stage}`,
      fields: {
        operationId: operation.id,
        phaseDurationMs,
        elapsedDurationMs: duration(atMs - operation.requestedAtMs),
        ...(await readStorageFileSizes(userDataPath)),
      },
    })
  }

  /** Clears the crash marker and records the last successfully completed operation. */
  async function completed(operation) {
    const active = requireActiveOperation(operation)
    const completedAtMs = monotonicNow()
    const result = {
      type: operation.type,
      completedAt: now(),
      totalDurationMs: duration(completedAtMs - operation.requestedAtMs),
      finalStage: active.stage,
    }
    state = {
      ...state,
      activeOperation: null,
      lastCompletedOperation: result,
    }
    await persistState()
    await appendDurable({
      level: 'info',
      event: `storage_${operation.type}_completed`,
      fields: {
        operationId: operation.id,
        totalDurationMs: result.totalDurationMs,
        ...(await readStorageFileSizes(userDataPath)),
      },
    })
  }

  /** Records a safe failure category without arbitrary exception or operational text. */
  async function failed(operation, input = {}) {
    const active = requireActiveOperation(operation)
    const atMs = monotonicNow()
    const result = {
      type: operation.type,
      failedAt: now(),
      stage: knownStage(input.stage, active.stage),
      errorName: safeErrorName(input.errorName),
      totalDurationMs: duration(atMs - operation.requestedAtMs),
    }
    state = {
      ...state,
      activeOperation: null,
      lastFailedOperation: result,
    }
    await persistState()
    await appendDurable({
      level: 'error',
      event: `storage_${operation.type}_failed`,
      fields: {
        operationId: operation.id,
        ...result,
        ...(await readStorageFileSizes(userDataPath)),
      },
    })
  }

  /** Stores the configured cadence independently of mission or provider identity. */
  async function configurePolling(input) {
    state = {
      ...state,
      mission: {
        ...state.mission,
        configuredPollIntervalMs: positiveNumberOrNull(input.configuredPollIntervalMs),
      },
    }
    await persistState()
  }

  /** Resets bounded multi-day counters for a newly started mission. */
  async function startMission(input) {
    const configuredPollIntervalMs =
      positiveNumberOrNull(input.configuredPollIntervalMs) ??
      state.mission.configuredPollIntervalMs
    state = {
      ...state,
      mission: {
        ...createEmptyMissionState(),
        startedAt: safeIsoTimestamp(input.startedAt),
        configuredPollIntervalMs,
        initialDatabaseBytes: (await readStorageFileSizes(userDataPath)).databaseBytes,
      },
    }
    await persistState()
  }

  /** Increments the identity-free mission recovery/restart counter. */
  async function recordRestart(input = {}) {
    const fileSizes = await readStorageFileSizes(userDataPath)
    state = {
      ...state,
      mission: {
        ...state.mission,
        startedAt: state.mission.startedAt ?? nullableIsoTimestamp(input.startedAt),
        initialDatabaseBytes:
          state.mission.initialDatabaseBytes > 0
            ? state.mission.initialDatabaseBytes
            : fileSizes.databaseBytes,
        restartCount: state.mission.restartCount + 1,
      },
    }
    await persistState()
  }

  /** Records one device-persistence poll aggregate, never individual records. */
  async function recordTrackingBatch(input) {
    const observedAt = safeIsoTimestamp(input.observedAt)
    const mission = state.mission
    const observedPollCount = mission.observedPollCount + 1
    const next = {
      ...mission,
      firstPollAt: mission.firstPollAt ?? observedAt,
      lastPollAt: observedAt,
      observedPollCount,
      currentDeviceCount: nonNegativeInteger(input.deviceCount),
      peakDeviceCount: Math.max(mission.peakDeviceCount, nonNegativeInteger(input.deviceCount)),
      changedDeviceEventCount:
        mission.changedDeviceEventCount + nonNegativeInteger(input.changedDeviceEventCount),
    }
    state = { ...state, mission: next }
    await persistState()
    const window = openTrackingWindow()
    const pollMs = duration(input.durationMs)
    window.pollCount += 1
    window.maxPollMs = Math.max(window.maxPollMs, pollMs)
    window.totalPollMs += pollMs
    window.peakDeviceCount = Math.max(window.peakDeviceCount, next.currentDeviceCount)
    window.changedDeviceEventCount += nonNegativeInteger(input.changedDeviceEventCount)
    await flushTrackingSummaryIfDue()
  }

  /** Adds one position-write aggregate without logging any position content. */
  async function recordInsertedPositions(input) {
    const insertedPositionCount = nonNegativeInteger(input.insertedPositionCount)
    const positionTelemetryEventCount = nonNegativeInteger(input.positionTelemetryEventCount)
    const skippedAmbiguousLegacyAdoptionCount = nonNegativeInteger(
      input.skippedAmbiguousLegacyAdoptionCount,
    )
    state = {
      ...state,
      mission: {
        ...state.mission,
        insertedPositionCount: state.mission.insertedPositionCount + insertedPositionCount,
        positionTelemetryEventCount:
          state.mission.positionTelemetryEventCount + positionTelemetryEventCount,
      },
    }
    await persistState()
    const window = openTrackingWindow()
    const writeMs = duration(input.durationMs)
    window.positionWriteCount += 1
    window.insertedPositionCount += insertedPositionCount
    window.positionTelemetryEventCount += positionTelemetryEventCount
    window.skippedAmbiguousLegacyAdoptionCount += skippedAmbiguousLegacyAdoptionCount
    window.maxPositionWriteMs = Math.max(window.maxPositionWriteMs, writeMs)
    window.totalPositionWriteMs += writeMs
    await flushTrackingSummaryIfDue()
  }

  /** Returns the open tracking aggregate, starting one at the first fact after a flush. */
  function openTrackingWindow() {
    if (trackingWindow === null) {
      trackingWindow = {
        startedAtMs: monotonicNow(),
        pollCount: 0,
        maxPollMs: 0,
        totalPollMs: 0,
        peakDeviceCount: 0,
        changedDeviceEventCount: 0,
        positionWriteCount: 0,
        insertedPositionCount: 0,
        positionTelemetryEventCount: 0,
        skippedAmbiguousLegacyAdoptionCount: 0,
        maxPositionWriteMs: 0,
        totalPositionWriteMs: 0,
      }
    }
    return trackingWindow
  }

  async function flushTrackingSummaryIfDue() {
    if (trackingWindow !== null && monotonicNow() - trackingWindow.startedAtMs >= TRACKING_SUMMARY_INTERVAL_MS) {
      await flushTrackingSummary()
    }
  }

  /**
   * Logs the open tracking aggregate as one entry and closes the window. Called once a
   * minute by tracking writes themselves and at store shutdown for the final partial
   * window; does nothing when no tracking fact arrived since the last flush.
   */
  async function flushTrackingSummary() {
    if (trackingWindow === null) return
    const { startedAtMs, ...totals } = trackingWindow
    trackingWindow = null
    await appendDurable({
      level: 'info',
      event: 'storage_tracking_summary',
      fields: {
        windowMs: duration(monotonicNow() - startedAtMs),
        ...totals,
        cumulativeInsertedPositionCount: state.mission.insertedPositionCount,
        cumulativeObservedPollCount: state.mission.observedPollCount,
      },
    })
  }

  /**
   * Records a writer transaction that held the main thread too long, split into body
   * and commit, at most SLOW_WRITE_LOG_LIMIT times per session [DON-313] [DON-336].
   */
  async function recordSlowWrite(input) {
    slowWriteCount += 1
    if (slowWriteCount > SLOW_WRITE_LOG_LIMIT) {
      if (slowWriteCount === SLOW_WRITE_LOG_LIMIT + 1) {
        await appendDurable({ level: 'warn', event: 'storage_slow_write_suppressed',
          fields: { limit: SLOW_WRITE_LOG_LIMIT } })
      }
      return
    }
    await appendDurable({ level: 'warn', event: 'storage_slow_write', fields: {
      totalMs: duration(input.totalMs),
      bodyMs: duration(input.bodyMs),
      commitMs: duration(input.commitMs),
    } })
  }

  /** Stores one bounded event-loop summary rather than per-sample telemetry. */
  async function recordEventLoopSummary(input) {
    const summary = {
      recordedAt: now(),
      intervalMs: positiveNumberOrNull(input.intervalMs),
      maximumDelayMs: duration(input.maximumDelayMs),
      p99DelayMs: duration(input.p99DelayMs),
    }
    state = {
      ...state,
      eventLoop: {
        latest: summary,
        maximumObservedDelayMs: Math.max(
          state.eventLoop.maximumObservedDelayMs,
          summary.maximumDelayMs,
        ),
      },
    }
    await persistState()
    await appendDurable({
      level: summary.maximumDelayMs >= 1_000 ? 'warn' : 'info',
      event: 'storage_main_event_loop_summary',
      fields: summary,
    })
  }

  /** Records identity-free removed/preserved counts and incomplete startup sweeps. */
  async function recordBackupTemporaryCleanup(input) {
    await appendDurable({
      level: input.failedFileCount > 0 || input.preservedSetCount > 0 || input.skippedRoot || input.sweepFailed ? 'warn' : 'info',
      event: 'storage_backup_temporary_cleanup',
      fields: {
        removedFileCount: nonNegativeInteger(input.removedFileCount),
        removedBytes: nonNegativeInteger(input.removedBytes),
        preservedSetCount: nonNegativeInteger(input.preservedSetCount),
        failedFileCount: nonNegativeInteger(input.failedFileCount),
        skippedRoot: input.skippedRoot === true,
        sweepFailed: input.sweepFailed === true,
      },
    })
  }

  /** Records the bounded quit refusal; the admitted backup continues to completion. */
  async function recordBackupShutdownTimeout(input) {
    await appendDurable({ level: 'error', event: 'storage_backup_shutdown_wait_timed_out',
      fields: { pendingBackupCount: nonNegativeInteger(input.pendingBackupCount) } })
  }

  /** Returns a fresh safe snapshot for support bundle export. */
  async function readSupportSnapshot() {
    const fileSizes = await readStorageFileSizes(userDataPath)
    return {
      version: state.version,
      schemaVersion: state.schemaVersion,
      validation: validationMode ? await readValidationMetadata(userDataPath) : null,
      activeOperation: publicOperation(state.activeOperation),
      previousInterruptedOperation: state.previousInterruptedOperation,
      lastCompletedOperation: state.lastCompletedOperation,
      lastFailedOperation: state.lastFailedOperation,
      fileSizes,
      mission: {
        ...state.mission,
        elapsedDurationMs: elapsedSince(state.mission.startedAt, now()),
        observedPollCadenceMs: observedCadence(state.mission),
        databaseGrowthBytes: Math.max(
          0,
          fileSizes.databaseBytes - state.mission.initialDatabaseBytes,
        ),
      },
      eventLoop: state.eventLoop,
    }
  }

  function requireActiveOperation(operation) {
    assertOperation(operation)
    if (state.activeOperation === null || state.activeOperation.id !== operation.id) {
      throw new Error('Storage diagnostics operation is not active.')
    }
    return state.activeOperation
  }

  function persistState() {
    const snapshot = JSON.stringify(state)
    writeChain = writeChain.then(() => writeStateAtomically(statePath, snapshot))
    return writeChain
  }

  function appendDurable(entry) {
    return runtimeLog.appendDurable(entry)
  }
}

function assertOperation(operation) {
  if (
    operation === null ||
    typeof operation !== 'object' ||
    operation.type !== 'backup' ||
    typeof operation.id !== 'string' ||
    !Number.isFinite(operation.requestedAtMs)
  ) {
    throw new Error('Invalid storage diagnostics operation token.')
  }
}

function safeBackupTrigger(input) {
  return [
    'interval',
    'visibilitychange',
    'pagehide',
    'mission-start',
    'mission-pause',
    'mission-resume',
    'mission-finish',
    'mission-recover-resume',
    'mission-start-fresh',
    'mission-finalize',
    'mission-unlock',
    'manual',
    'unknown',
  ].includes(input)
    ? input
    : 'unknown'
}

module.exports = {
  createStorageDiagnostics,
  formatStorageDiagnostics,
}
