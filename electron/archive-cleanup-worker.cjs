'use strict'

const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { parentPort, workerData, isMainThread } = require('node:worker_threads')

const Database = require('better-sqlite3')

const { createArchiveCleanupCoordinator } = require('./archive-cleanup.cjs')
const { withPinnedCustodyFileIdentity } = require('./archive-custody-file.cjs')
const {
  cleanupCauseClassForCode,
  normalizeCleanupFailureDiagnostic,
} = require('./archive-cleanup-failure.cjs')

/** Inserts one complete lifecycle event and advances its Replay generation. */
function appendEvent(db, missionId, eventType, timestamp, details) {
  const eventId = randomUUID()
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`).run(
    eventId,
    missionId,
    eventType,
    timestamp,
    details === undefined || details === null ? null : JSON.stringify(details),
    timestamp,
  )
  db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES (?, 1)
    ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`).run(missionId)
  return eventId
}

/** Rejects malformed parent input before opening a database or archive path. */
function validateRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)
    || typeof request.databasePath !== 'string' || !path.isAbsolute(request.databasePath)
    || typeof request.archiveDirectory !== 'string' || !path.isAbsolute(request.archiveDirectory)
    || typeof request.archiveRelativePath !== 'string'
    || path.isAbsolute(request.archiveRelativePath)
    || request.archiveRelativePath.includes('\\')
    || request.archiveRelativePath.split('/').includes('..')
    || typeof request.operationId !== 'string'
    || request.evidence === null || typeof request.evidence !== 'object'
    || Array.isArray(request.evidence)
    || !['start', 'resume'].includes(request.mode)) {
    throw createError('ARCHIVE_CLEANUP_INPUT_INVALID')
  }
}

/** Creates one bounded worker error code for the parent boundary. */
function createError(code) {
  const error = new Error('Mission archive cleanup failed safely.')
  error.code = code
  return error
}

/** Runs cleanup on a dedicated SQLite connection so main-loop cadence is independent. */
async function runWorker() {
  const request = workerData.request
  let stage = 'input_validation'
  const cancellationController = new AbortController()
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  const onControlMessage = (message) => {
    if (message?.type === 'cancel' && message.operationId === request.operationId) {
      Atomics.store(cancellationFlag, 0, 1)
      cancellationController.abort()
    }
  }
  parentPort.on('message', onControlMessage)
  let db = null
  try {
    validateRequest(request)
    stage = 'worker_open'
    db = new Database(request.databasePath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    stage = 'worker_execute'
    const coordinator = createArchiveCleanupCoordinator({
      db,
      schemaVersion: 13,
      now: () => new Date().toISOString(),
      yieldToMain: () => new Promise((resolve) => setImmediate(resolve)),
      appendEvent: (missionId, eventType, timestamp, details) =>
        appendEvent(db, missionId, eventType, timestamp, details),
      ...(request.batchLimits === undefined ? {} : { batchLimits: request.batchLimits }),
    })
    const withCustodyCommit = (commit) => withPinnedCustodyFileIdentity({
      archiveDirectory: request.archiveDirectory,
      archiveRelativePath: request.archiveRelativePath,
      expectedFileIdentity: request.expectedFileIdentity,
    }, commit)
    const execution = {
      signal: cancellationController.signal,
      withCustodyCommit,
      onProgress: (progress) => parentPort.postMessage({
        type: 'progress',
        operationId: request.operationId,
        progress,
      }),
      ...(request.faultInjection === undefined
        ? {} : { faultInjection: request.faultInjection }),
    }
    const result = request.mode === 'start'
      ? await coordinator.start(request.evidence, execution)
      : await coordinator.resume(request.evidence, execution)
    parentPort.postMessage({ type: 'complete', operationId: request.operationId, result })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId: request.operationId,
      code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_CLEANUP_FAILED',
      diagnostic: normalizeCleanupFailureDiagnostic({
        ...(error?.cleanupDiagnostic ?? {}),
        substage: error?.cleanupDiagnostic?.substage ?? stage,
        causeClass: error?.cleanupDiagnostic?.causeClass
          ?? cleanupCauseClassForCode(error?.code),
        workerExit: { observed: false, event: 'message', code: null },
      }),
    })
  } finally {
    parentPort.off('message', onControlMessage)
    if (db !== null) {
      try {
        db.close()
      } catch (error) {
        parentPort.postMessage({
          type: 'error',
          operationId: request.operationId,
          code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_CLEANUP_FAILED',
          diagnostic: normalizeCleanupFailureDiagnostic({
            substage: 'worker_close',
            causeClass: cleanupCauseClassForCode(error?.code),
            workerExit: { observed: false, event: 'message', code: null },
          }),
        })
        process.exitCode = 1
      }
    }
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()
