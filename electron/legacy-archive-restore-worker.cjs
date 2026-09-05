'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const {
  restoreLegacyMissionArchive,
} = require('./legacy-archive-restore.cjs')
const {
  normalizeLegacyRestoreRequest,
} = require('./legacy-archive-restore-runner.cjs')

const DIRECT_FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'LEGACY_ARCHIVE_CORRUPT_ENTRY',
  'LEGACY_ARCHIVE_DISK_FULL',
  'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA',
])

/** Maps parser and platform errors into the runner's closed vocabulary. */
function mapFailureCode(error) {
  if (error?.code === 'ENOSPC') return 'LEGACY_ARCHIVE_DISK_FULL'
  if (DIRECT_FAILURE_CODES.has(error?.code)) return error.code
  return 'LEGACY_ARCHIVE_RESTORE_FAILED'
}

/** Runs one credential-free legacy restore entirely off the main isolate. */
async function runWorker() {
  const request = normalizeLegacyRestoreRequest(workerData.request)
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  let databaseFileHandle
  let sequence = 0
  const emitProgress = (progress) => {
    parentPort.postMessage({
      type: 'progress',
      operationId: request.operationId,
      sequence: ++sequence,
      ...progress,
    })
  }
  const onCancel = (message) => {
    if (message?.type === 'cancel' && message.operationId === request.operationId) {
      Atomics.store(cancellationFlag, 0, 1)
    }
  }
  parentPort.on('message', onCancel)
  try {
    const result = await restoreLegacyMissionArchive({
      archivePath: request.archivePath,
      sessionDirectory: request.sessionDirectory,
      expectedMissionId: request.expectedMissionId,
      cancellationFlag,
      onProgress: emitProgress,
    })
    databaseFileHandle = result.databaseFileHandle
    parentPort.postMessage({
      type: 'complete',
      operationId: request.operationId,
      sessionId: request.sessionId,
      ...result,
    }, [databaseFileHandle])
    databaseFileHandle = undefined
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId: request.operationId,
      code: mapFailureCode(error),
    })
  } finally {
    if (databaseFileHandle !== undefined) {
      try { await databaseFileHandle.close() } catch {}
    }
    parentPort.off('message', onCancel)
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()

module.exports = { mapFailureCode }
