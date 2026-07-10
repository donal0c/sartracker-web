const fs = require('node:fs/promises')
const path = require('node:path')

const STATE_FILE_NAME = 'storage-diagnostics.json'
const STATE_VERSION = 1
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const BACKUP_FILE_NAME = 'mission-store.backup.sqlite'
const TEMPORARY_BACKUP_PATTERN =
  /^mission-store\.backup\.sqlite\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const BACKUP_STAGES = new Set([
  'copied',
  'validation_started',
  'validated',
  'sanity_check_started',
  'sanity_checked',
  'renamed',
])

/** Returns the bounded storage checkpoint's initial schema. */
function createEmptyState() {
  return {
    version: STATE_VERSION,
    schemaVersion: null,
    activeOperation: null,
    previousInterruptedOperation: null,
    lastCompletedOperation: null,
    lastFailedOperation: null,
    mission: createEmptyMissionState(),
    eventLoop: {
      latest: null,
      maximumObservedDelayMs: 0,
    },
  }
}

/** Returns empty identity-free multi-day counters. */
function createEmptyMissionState() {
  return {
    startedAt: null,
    configuredPollIntervalMs: null,
    firstPollAt: null,
    lastPollAt: null,
    observedPollCount: 0,
    currentDeviceCount: 0,
    peakDeviceCount: 0,
    insertedPositionCount: 0,
    changedDeviceEventCount: 0,
    positionTelemetryEventCount: 0,
    restartCount: 0,
    initialDatabaseBytes: 0,
  }
}

/** Reads and normalizes the bounded checkpoint, tolerating a torn/corrupt file. */
async function readState(statePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'))
    return normalizeState(parsed)
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return createEmptyState()
    }
    throw error
  }
}

/** Replaces the checkpoint atomically so a kill cannot leave a partially parsed live file. */
async function writeStateAtomically(statePath, contents) {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.tmp`
  await fs.writeFile(temporaryPath, `${contents}\n`, 'utf8')
  await fs.rename(temporaryPath, statePath)
}

/** Reads byte counts from known storage filenames without returning private paths. */
async function readStorageFileSizes(userDataPath) {
  const entries = await fs.readdir(userDataPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const temporaryNames = entries
    .filter((entry) => entry.isFile() && TEMPORARY_BACKUP_PATTERN.test(entry.name))
    .map((entry) => entry.name)
  const temporarySizes = await Promise.all(
    temporaryNames.map((name) => safeFileSize(path.join(userDataPath, name))),
  )
  return {
    databaseBytes: await safeFileSize(path.join(userDataPath, DATABASE_FILE_NAME)),
    walBytes: await safeFileSize(path.join(userDataPath, `${DATABASE_FILE_NAME}-wal`)),
    backupBytes: await safeFileSize(path.join(userDataPath, BACKUP_FILE_NAME)),
    temporarySnapshotBytes: Math.max(0, ...temporarySizes),
    temporarySnapshotCount: temporarySizes.filter((size) => size > 0).length,
  }
}

/** Reads only allow-listed synthetic fixture metadata in explicit validation mode. */
async function readValidationMetadata(userDataPath) {
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(userDataPath, `${DATABASE_FILE_NAME}.manifest.json`), 'utf8'),
    )
    const preset = String(manifest?.preset ?? '')
    const fixtureSha256 = String(manifest?.database?.sha256 ?? '').toLowerCase()
    if (!/^[a-z0-9-]{1,40}$/u.test(preset) || !/^[a-f0-9]{64}$/u.test(fixtureSha256)) {
      return null
    }
    return {
      preset,
      generatorVersion: nonNegativeInteger(manifest.generatorVersion),
      fixtureSha256,
    }
  } catch {
    return null
  }
}

function normalizeState(input) {
  const empty = createEmptyState()
  if (input === null || typeof input !== 'object' || input.version !== STATE_VERSION) {
    return empty
  }
  return {
    ...empty,
    schemaVersion:
      input.schemaVersion === null || input.schemaVersion === undefined
        ? null
        : nonNegativeInteger(input.schemaVersion),
    activeOperation: normalizeStoredOperation(input.activeOperation),
    previousInterruptedOperation: normalizeInterruptedOperation(input.previousInterruptedOperation),
    lastCompletedOperation: normalizeCompletedOperation(input.lastCompletedOperation),
    lastFailedOperation: normalizeFailedOperation(input.lastFailedOperation),
    mission: normalizeMissionState(input.mission),
    eventLoop: normalizeEventLoopState(input.eventLoop),
  }
}

function normalizeStoredOperation(input) {
  if (input === null || typeof input !== 'object' || input.type !== 'backup') return null
  if (typeof input.id !== 'string' || !Number.isFinite(input.requestedAtMs)) return null
  return {
    id: input.id,
    type: 'backup',
    stage: knownStage(input.stage, 'started'),
    startedAt: safeIsoTimestamp(input.startedAt),
    startedAtMs: duration(input.startedAtMs),
    requestedAtMs: duration(input.requestedAtMs),
    lastPhaseAtMs: duration(input.lastPhaseAtMs),
  }
}

function normalizeInterruptedOperation(input) {
  if (input === null || typeof input !== 'object' || input.type !== 'backup') return null
  return {
    type: 'backup',
    stage: knownStage(input.stage, 'unknown'),
    startedAt: safeIsoTimestamp(input.startedAt),
    detectedAt: safeIsoTimestamp(input.detectedAt),
  }
}

function normalizeCompletedOperation(input) {
  if (input === null || typeof input !== 'object' || input.type !== 'backup') return null
  return {
    type: 'backup',
    completedAt: safeIsoTimestamp(input.completedAt),
    totalDurationMs: duration(input.totalDurationMs),
    finalStage: knownStage(input.finalStage, 'unknown'),
  }
}

function normalizeFailedOperation(input) {
  if (input === null || typeof input !== 'object' || input.type !== 'backup') return null
  return {
    type: 'backup',
    failedAt: safeIsoTimestamp(input.failedAt),
    stage: knownStage(input.stage, 'unknown'),
    errorName: safeErrorName(input.errorName),
    totalDurationMs: duration(input.totalDurationMs),
  }
}

function normalizeMissionState(input) {
  const empty = createEmptyMissionState()
  if (input === null || typeof input !== 'object') return empty
  return {
    startedAt: nullableIsoTimestamp(input.startedAt),
    configuredPollIntervalMs: positiveNumberOrNull(input.configuredPollIntervalMs),
    firstPollAt: nullableIsoTimestamp(input.firstPollAt),
    lastPollAt: nullableIsoTimestamp(input.lastPollAt),
    observedPollCount: nonNegativeInteger(input.observedPollCount),
    currentDeviceCount: nonNegativeInteger(input.currentDeviceCount),
    peakDeviceCount: nonNegativeInteger(input.peakDeviceCount),
    insertedPositionCount: nonNegativeInteger(input.insertedPositionCount),
    changedDeviceEventCount: nonNegativeInteger(input.changedDeviceEventCount),
    positionTelemetryEventCount: nonNegativeInteger(input.positionTelemetryEventCount),
    restartCount: nonNegativeInteger(input.restartCount),
    initialDatabaseBytes: nonNegativeInteger(input.initialDatabaseBytes),
  }
}

function normalizeEventLoopState(input) {
  if (input === null || typeof input !== 'object') {
    return { latest: null, maximumObservedDelayMs: 0 }
  }
  return {
    latest: input.latest === null || typeof input.latest !== 'object' ? null : {
      recordedAt: safeIsoTimestamp(input.latest.recordedAt),
      intervalMs: positiveNumberOrNull(input.latest.intervalMs),
      maximumDelayMs: duration(input.latest.maximumDelayMs),
      p99DelayMs: duration(input.latest.p99DelayMs),
    },
    maximumObservedDelayMs: duration(input.maximumObservedDelayMs),
  }
}

function publicOperation(operation) {
  if (operation === null) return null
  return {
    type: operation.type,
    stage: operation.stage,
    startedAt: operation.startedAt,
  }
}

function observedCadence(mission) {
  if (mission.observedPollCount < 2 || mission.firstPollAt === null || mission.lastPollAt === null) {
    return null
  }
  return duration(
    (Date.parse(mission.lastPollAt) - Date.parse(mission.firstPollAt)) /
      (mission.observedPollCount - 1),
  )
}

function elapsedSince(startedAt, currentAt) {
  if (startedAt === null) return 0
  return duration(Date.parse(currentAt) - Date.parse(startedAt))
}

function safeIsoTimestamp(input) {
  const milliseconds = Date.parse(String(input))
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date(0).toISOString()
}

function nullableIsoTimestamp(input) {
  return input === null || input === undefined ? null : safeIsoTimestamp(input)
}

function safeErrorName(input) {
  const value = String(input ?? '')
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value) ? value : 'UnknownError'
}

function knownStage(input, fallback) {
  const value = String(input ?? '')
  return value === 'started' || BACKUP_STAGES.has(value) ? value : fallback
}

function duration(input) {
  const value = Number(input)
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function nonNegativeInteger(input) {
  const value = Number(input)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function positiveNumberOrNull(input) {
  const value = Number(input)
  return Number.isFinite(value) && value > 0 ? value : null
}

function number(input) {
  return Number.isFinite(Number(input)) ? Number(input) : 0
}

async function safeFileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

module.exports = {
  BACKUP_STAGES,
  STATE_FILE_NAME,
  createEmptyMissionState,
  createEmptyState,
  duration,
  elapsedSince,
  knownStage,
  nonNegativeInteger,
  nullableIsoTimestamp,
  number,
  observedCadence,
  positiveNumberOrNull,
  publicOperation,
  readState,
  readStorageFileSizes,
  readValidationMetadata,
  safeErrorName,
  safeIsoTimestamp,
  writeStateAtomically,
}
