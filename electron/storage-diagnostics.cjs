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
    recordEventLoopSummary,
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
    await appendDurable({
      level: 'info',
      event: 'storage_tracking_batch_completed',
      fields: {
        durationMs: duration(input.durationMs),
        deviceCount: next.currentDeviceCount,
        peakDeviceCount: next.peakDeviceCount,
        changedDeviceEventCount: nonNegativeInteger(input.changedDeviceEventCount),
        cumulativeChangedDeviceEventCount: next.changedDeviceEventCount,
        observedPollCount,
      },
    })
  }

  /** Adds one position-write aggregate without logging any position content. */
  async function recordInsertedPositions(input) {
    const insertedPositionCount = nonNegativeInteger(input.insertedPositionCount)
    const positionTelemetryEventCount = nonNegativeInteger(input.positionTelemetryEventCount)
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
    await appendDurable({
      level: 'info',
      event: 'storage_tracking_positions_completed',
      fields: {
        durationMs: duration(input.durationMs),
        insertedPositionCount,
        positionTelemetryEventCount,
        cumulativeInsertedPositionCount: state.mission.insertedPositionCount,
        cumulativePositionTelemetryEventCount: state.mission.positionTelemetryEventCount,
      },
    })
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
