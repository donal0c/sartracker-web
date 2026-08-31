'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const {
  inspectArchiveCustodyFile,
} = require('./archive-custody-file.cjs')
const {
  normalizeArchiveLegacyPredecessorTicket,
} = require('./archive-legacy-predecessor-envelope.cjs')

const PROGRESS_REPORT_BYTES = 8 * 1024 * 1024

/** Returns whether two closed custody identities are exactly equal. */
function sameFileIdentity(left, right) {
  const keys = [
    'changedTimeNanoseconds',
    'device',
    'inode',
    'linkCount',
    'modifiedTimeNanoseconds',
    'sizeBytes',
  ]
  return keys.every((key) => left[key] === right[key])
}

/** Creates a byte-cadenced reporter with exact final progress. */
function createProgressReporter(operationId) {
  let lastReportedBytes = 0
  return (completedBytes, totalBytes) => {
    if (completedBytes !== totalBytes
      && completedBytes - lastReportedBytes < PROGRESS_REPORT_BYTES) return
    parentPort.postMessage({
      type: 'progress',
      operationId,
      completedBytes,
      totalBytes,
    })
    lastReportedBytes = completedBytes
  }
}

/** Hashes every byte of one exact legacy predecessor and rejects identity drift. */
function hashArchiveLegacyPredecessor(input) {
  const ticket = normalizeArchiveLegacyPredecessorTicket(input?.ticket)
  if (!(input?.cancellationFlag instanceof Int32Array)
    || input.cancellationFlag.length !== 1
    || typeof input.onProgress !== 'function') {
    const error = new Error('Legacy archive predecessor hash input is invalid.')
    error.code = 'ARCHIVE_LEGACY_PREDECESSOR_INPUT_INVALID'
    throw error
  }
  const observed = inspectArchiveCustodyFile({
    archiveDirectory: ticket.archiveDirectory,
    archiveRelativePath: ticket.archiveRelativePath,
    cancellationFlag: input.cancellationFlag,
    onChunk: input.onProgress,
  })
  if (!sameFileIdentity(observed.fileIdentity, ticket.expectedFileIdentity)) {
    const error = new Error('Legacy archive predecessor changed before it could be chained.')
    error.code = 'ARCHIVE_LEGACY_PREDECESSOR_CHANGED'
    throw error
  }
  return Object.freeze({
    type: 'complete',
    operationId: ticket.operationId,
    archiveId: ticket.archiveId,
    missionId: ticket.missionId,
    archiveRelativePath: ticket.archiveRelativePath,
    sha256: observed.ciphertextSha256,
    sizeBytes: observed.sizeBytes,
    fileIdentity: observed.fileIdentity,
  })
}

/** Maps worker failures to a closed non-reflective code vocabulary. */
function mapFailureCode(error) {
  if (error?.code === 'ARCHIVE_CUSTODY_CANCELLED') return 'ARCHIVE_CANCELLED'
  if (error?.code === 'ARCHIVE_LEGACY_PREDECESSOR_CHANGED'
    || error?.code === 'ARCHIVE_CUSTODY_IDENTITY_CHANGED') {
    return 'ARCHIVE_LEGACY_PREDECESSOR_CHANGED'
  }
  if (error?.code === 'ARCHIVE_CUSTODY_MISSING') {
    return 'ARCHIVE_LEGACY_PREDECESSOR_MISSING'
  }
  if (error?.code === 'ARCHIVE_CUSTODY_NOT_REGULAR'
    || error?.code === 'ARCHIVE_CUSTODY_INVALID_PATH') {
    return 'ARCHIVE_LEGACY_PREDECESSOR_UNSAFE'
  }
  return 'ARCHIVE_LEGACY_PREDECESSOR_FAILED'
}

/** Runs one predecessor hash worker with closed progress and terminal envelopes. */
function runArchiveLegacyPredecessorWorker() {
  let operationId = null
  try {
    const ticket = normalizeArchiveLegacyPredecessorTicket(workerData?.ticket)
    operationId = ticket.operationId
    if (!(workerData?.cancellationBuffer instanceof SharedArrayBuffer)
      || workerData.cancellationBuffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
      const error = new Error('Legacy archive predecessor cancellation input is invalid.')
      error.code = 'ARCHIVE_LEGACY_PREDECESSOR_INPUT_INVALID'
      throw error
    }
    const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    parentPort.on('message', (message) => {
      if (message?.type === 'cancel' && message.operationId === operationId) {
        Atomics.store(cancellationFlag, 0, 1)
      }
    })
    const result = hashArchiveLegacyPredecessor({
      ticket,
      cancellationFlag,
      onProgress: createProgressReporter(operationId),
    })
    parentPort.postMessage(result)
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId,
      code: mapFailureCode(error),
    })
  } finally {
    parentPort.close()
  }
}

if (!isMainThread) runArchiveLegacyPredecessorWorker()

module.exports = {
  hashArchiveLegacyPredecessor,
  mapFailureCode,
  sameFileIdentity,
}
