'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const {
  inspectArchiveCustodyFile,
  readArchiveCustodyFileIdentity,
} = require('./archive-custody-file.cjs')
const {
  normalizeArchiveCustodyReconcileTicket,
} = require('./archive-custody-reconcile-envelope.cjs')

const PROGRESS_REPORT_BYTES = 8 * 1024 * 1024

/** Maps an inspection failure to the closed custody outcome vocabulary. */
function mapOutcome(error) {
  if (error?.code === 'ARCHIVE_CUSTODY_MISSING') return 'missing'
  if (error?.code === 'ARCHIVE_CUSTODY_NOT_REGULAR'
    || error?.code === 'ARCHIVE_CUSTODY_INVALID_PATH') return 'not_regular'
  if (error?.code === 'ARCHIVE_CUSTODY_IDENTITY_CHANGED') return 'changed'
  return 'unreadable'
}

/** Creates a byte-cadenced reporter that always emits exact final progress. */
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

/** Runs one full-file custody inspection and emits one terminal observation. */
function runArchiveCustodyReconcileWorker() {
  const ticket = normalizeArchiveCustodyReconcileTicket(workerData?.ticket)
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  const identity = {
    type: 'complete',
    operationId: ticket.operationId,
    registryRowid: ticket.registryRowid,
    archiveId: ticket.archiveId,
    containerVersion: ticket.containerVersion,
    archiveRelativePath: ticket.archiveRelativePath,
    expectedSizeBytes: ticket.expectedSizeBytes,
    expectedCiphertextSha256: ticket.expectedCiphertextSha256,
  }
  try {
    const identityOnly = ticket.containerVersion === 1
      && ticket.expectedCiphertextSha256 === null
    const observed = identityOnly
      ? {
          fileIdentity: readArchiveCustodyFileIdentity({
            archiveDirectory: ticket.archiveDirectory,
            archiveRelativePath: ticket.archiveRelativePath,
          }),
          ciphertextSha256: null,
        }
      : inspectArchiveCustodyFile({
          archiveDirectory: ticket.archiveDirectory,
          archiveRelativePath: ticket.archiveRelativePath,
          cancellationFlag,
          onChunk: createProgressReporter(ticket.operationId),
        })
    parentPort.postMessage({
      ...identity,
      outcome: 'available',
      observedSizeBytes: observed.fileIdentity.sizeBytes,
      observedCiphertextSha256: observed.ciphertextSha256,
      fileIdentity: observed.fileIdentity,
    })
  } catch (error) {
    if (error?.code === 'ARCHIVE_CUSTODY_CANCELLED') {
      parentPort.postMessage({
        type: 'error',
        operationId: ticket.operationId,
        code: 'ARCHIVE_CANCELLED',
      })
      return
    }
    parentPort.postMessage({
      ...identity,
      outcome: mapOutcome(error),
      observedSizeBytes: null,
      observedCiphertextSha256: null,
      fileIdentity: null,
    })
  }
}

if (!isMainThread) runArchiveCustodyReconcileWorker()

module.exports = { runArchiveCustodyReconcileWorker }
