'use strict'

const path = require('node:path')

const Database = require('better-sqlite3')
const {
  prepareCorrectionAttachmentCustodyReconciliation,
  readCorrectionAttachmentCustody,
  reconcileCorrectionAttachmentCustody,
} = require('./archive-correction-custody.cjs')
const {
  assertCorrectionDirectoryIdentity,
  captureCorrectionDirectoryIdentity,
  enterExistingCorrectionAttachmentRoot,
  proveCorrectionAttachmentResidue,
  revalidateCorrectionAttachmentResidue,
  removeUncommittedCorrectionAttachment,
} = require('./archive-correction-directory-capability.cjs')

const parentPort = process.parentPort
if (parentPort === undefined || parentPort === null
  || typeof parentPort.on !== 'function' || typeof parentPort.postMessage !== 'function') {
  throw new Error('Archive correction recovery requires an Electron utility-process parent.')
}

const initialDirectory = path.resolve(process.cwd())
const readyIdentity = captureCorrectionDirectoryIdentity('.')
let cancelled = false
let started = false

/** Reads utility-process cancellation delivered between synchronous boundaries. */
function isCancelled() {
  return cancelled
}

/** Throws a closed recovery cancellation failure. */
function throwIfCancelled() {
  if (!isCancelled()) return
  const error = new Error('Archive correction attachment custody recovery was cancelled.')
  error.code = 'ARCHIVE_CANCELLED'
  throw error
}

/** Receives exactly one identity-bound recovery request. */
function onParentMessage(event) {
  const message = event?.data
  if (message?.type === 'cancel' && Object.keys(message).length === 1) {
    cancelled = true
    return
  }
  if (started) {
    finishWithError()
    return
  }
  started = true
  try {
    validateStartEnvelope(message)
    assertCorrectionDirectoryIdentity(message.directoryIdentity)
    const result = recover(message.request)
    parentPort.postMessage({ type: 'complete', recovered: result.recovered })
    finish(0)
  } catch {
    finishWithError()
  }
}

/** Reclaims unpublished copies before clearing custody; committed attachment pairs remain intact. */
function recover(request) {
  validateRequest(request)
  throwIfCancelled()
  let database
  try {
    assertCorrectionDirectoryIdentity(readyIdentity)
    database = new Database(request.databaseName)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('foreign_keys = ON')
    const plan = readCorrectionAttachmentCustody(database)
    if (plan === null) return Object.freeze({ recovered: 0 })
    const targetIdentity = enterExistingCorrectionAttachmentRoot(plan.missionId)
    if (targetIdentity.dev !== plan.targetIdentity.dev
      || targetIdentity.ino !== plan.targetIdentity.ino) {
      throw new Error('Archive correction recovery attachment directory identity changed.')
    }
    const targetRoot = path.join(
      initialDirectory,
      'missions',
      plan.missionId,
      'attachments',
    )
    assertRecoveryTargetRoot(plan, targetRoot)
    const inspection = prepareCorrectionAttachmentCustodyReconciliation({
      db: database,
      inspectEntry: (entry) => {
        throwIfCancelled()
        assertRecoveryTargetRoot(plan, targetRoot)
        return proveCorrectionAttachmentResidue({
          sourcePath: path.join(initialDirectory, entry.sourceRelativePath),
          targetName: entry.targetName,
          peerName: entry.peerName,
          expected: entry,
        })
      },
      plan,
    })
    return database.transaction(() => reconcileCorrectionAttachmentCustody({
      db: database,
      inspection,
      removeUncommittedEntry: (entry, observation) => {
        throwIfCancelled()
        assertRecoveryTargetRoot(plan, targetRoot)
        return removeUncommittedCorrectionAttachment({
          sourcePath: path.join(initialDirectory, entry.sourceRelativePath),
          targetName: entry.targetName, peerName: entry.peerName, expected: entry,
        }, observation)
      },
      revalidateEntry: (entry, observation) => {
        throwIfCancelled()
        assertRecoveryTargetRoot(plan, targetRoot)
        return revalidateCorrectionAttachmentResidue({
          sourcePath: path.join(initialDirectory, entry.sourceRelativePath),
          targetName: entry.targetName,
          peerName: entry.peerName,
          expected: entry,
        }, observation)
      },
    })).immediate()
  } finally {
    database?.close()
  }
}

/** Proves recovery still owns the recorded inode at its original pathname. */
function assertRecoveryTargetRoot(plan, targetRoot) {
  assertCorrectionDirectoryIdentity(plan.targetIdentity)
  const current = path.resolve(process.cwd())
  if (path.relative(targetRoot, current) !== '') {
    throw new Error('Archive correction recovery attachment directory pathname changed.')
  }
}

/** Validates the closed identity-bound start envelope. */
function validateStartEnvelope(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).sort().join(',')
      !== 'directoryIdentity,request,type'
    || message.type !== 'start'
    || message.directoryIdentity === null || typeof message.directoryIdentity !== 'object'
    || Array.isArray(message.directoryIdentity)
    || Object.keys(message.directoryIdentity).sort().join(',') !== 'dev,ino') {
    throw new Error('Archive correction recovery start request is invalid.')
  }
}

/** Validates the sole cwd-relative database name. */
function validateRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).join(',') !== 'databaseName'
    || typeof request.databaseName !== 'string'
    || path.basename(request.databaseName) !== request.databaseName
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.databaseName)) {
    throw new Error('Archive correction recovery request is invalid.')
  }
}

/** Sends the one public fail-closed recovery envelope. */
function finishWithError() {
  try {
    parentPort.postMessage({
      type: 'error',
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
  } finally {
    finish(1)
  }
}

/** Releases the parent listener after the terminal envelope. */
function finish(exitCode) {
  parentPort.removeListener('message', onParentMessage)
  process.exitCode = exitCode
}

parentPort.on('message', onParentMessage)
parentPort.postMessage({ type: 'ready', directoryIdentity: readyIdentity })
