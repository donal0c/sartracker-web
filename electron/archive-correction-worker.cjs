'use strict'

const path = require('node:path')

const Database = require('better-sqlite3')
const { rehydrateMissionFromSnapshot } = require('./archive-rehydrate.cjs')
const { rewriteAttachmentReferences } = require('./archive-correction-attachment-references.cjs')
const {
  deriveArchiveLifecycleEventId,
  readCurrentMissionFinalizationBoundary,
} = require('./mission-finalization-boundary.cjs')
const {
  clearCorrectionAttachmentCustody,
  createCorrectionAttachmentCustodyPlan,
  prepareCorrectionAttachmentCustodyReconciliation,
  reconcileCorrectionAttachmentCustody,
  writeCorrectionAttachmentCustody,
} = require('./archive-correction-custody.cjs')
const {
  assertCorrectionDirectoryIdentity,
  captureCorrectionDirectoryIdentity,
  createCorrectionAttachmentPair,
  enterCorrectionAttachmentRoot,
  proveCorrectionAttachmentResidue,
  revalidateCorrectionAttachmentResidue,
} = require('./archive-correction-directory-capability.cjs')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_MAPPING_BYTES = 4 * 1024 * 1024
const IDENTIFIER = /^[A-Za-z0-9_-]{1,200}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const parentPort = process.parentPort

if (parentPort === undefined || parentPort === null
  || typeof parentPort.on !== 'function' || typeof parentPort.postMessage !== 'function') {
  throw new Error('Archive correction worker requires an Electron utility-process parent.')
}

const initialDirectory = path.resolve(process.cwd())
const readyIdentity = captureCorrectionDirectoryIdentity('.')
let started = false
let cancelled = false

/** Observes cancellation delivered over the utility-process parent channel. */
function isCancelled() {
  return cancelled
}

/** Throws the stable cancellation failure at a safe operation boundary. */
function throwIfCancelled() {
  if (!isCancelled()) return
  throw correctionError('ARCHIVE_CANCELLED', 'Archive correction restore was cancelled.')
}

/** Handles the closed READY/start/cancel protocol from Electron main. */
function onParentMessage(event) {
  const message = event?.data
  if (message?.type === 'cancel' && Object.keys(message).length === 1) {
    cancelled = true
    return
  }
  if (started) {
    finishWithError(correctionError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction utility received more than one start request.',
    ))
    return
  }
  started = true
  try {
    validateStartEnvelope(message)
    assertCorrectionDirectoryIdentity(message.directoryIdentity)
  } catch (error) {
    finishWithError(error)
    return
  }
  void runCorrection(message.request)
    .then(() => {
      parentPort.postMessage({
        type: 'complete',
        missionId: message.request.missionId,
        archiveId: message.request.archiveId,
        operationId: message.request.operationId,
      })
      finish(0)
    })
    .catch(finishWithError)
}

/** Runs attachment custody, row restoration, and unlock with one worker-owned database. */
async function runCorrection(request) {
  validateCorrectionRequest(request)
  throwIfCancelled()
  let database
  const custodyState = { plan: null, targetRoot: null }
  let transactionCommitted = false
  try {
    assertCorrectionDirectoryIdentity(readyIdentity)
    database = new Database(request.databaseName)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('foreign_keys = ON')
    const attachmentCustody = await restoreAttachmentCustody(
      database,
      request,
      custodyState,
    )
    assertBoundAttachmentRoot(custodyState)
    rehydrateMissionFromSnapshot({
      db: database,
      snapshotPath: request.snapshotPath,
      missionId: request.missionId,
      archiveId: request.archiveId,
      finalizedEpoch: request.finalizedEpoch,
      schemaVersion: 13,
      expectedSha256: request.expectedSha256,
      expectedIdentity: request.expectedIdentity,
      onRestored: () => {
        assertBoundAttachmentRoot(custodyState)
        const attachmentReferenceRelocations = rewriteAttachmentReferences(
          database,
          request.missionId,
          attachmentCustody.references,
        )
        const operational = database.prepare(
          "SELECT 1 FROM missions WHERE status IN ('active', 'paused') LIMIT 1",
        ).get()
        if (operational !== undefined) {
          throw correctionError(
            'ARCHIVE_REHYDRATE_LIVE_ACTIVITY',
            'An operational mission is active; archive correction restore is deferred.',
          )
        }
        throwIfCancelled()
        const mission = database.prepare('SELECT status FROM missions WHERE id = ?')
          .get(request.missionId)
        const cleanup = database.prepare(`SELECT state FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(request.missionId)
        const finalizationBoundary = readCurrentMissionFinalizationBoundary(database, {
          missionId: request.missionId,
          archiveId: request.archiveId,
        })
        if (mission?.status !== 'finalized' || cleanup?.state !== 'completed'
          || finalizationBoundary?.eventRowid !== request.finalizedEpoch) {
          throw correctionError(
            'ARCHIVE_REHYDRATE_EPOCH_CHANGED',
            'Mission finalization or archive storage changed before correction unlock could commit.',
          )
        }
        if (request.faultInjection.afterRehydrateBeforeUnlock === true) {
          throw correctionError(
            'ARCHIVE_REHYDRATE_FAILED',
            'Archive correction restore was interrupted before unlock.',
          )
        }
        const timestamp = new Date().toISOString()
        database.prepare('UPDATE missions SET status = ? WHERE id = ?')
          .run('finished', request.missionId)
        database.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
        ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
          deriveArchiveLifecycleEventId(request.archiveId, 'mission-unlocked'),
          request.missionId,
          timestamp,
          JSON.stringify({
            admin_name: request.adminName,
            reason: request.reason,
            restored_from_archive_id: request.archiveId,
            archive_correction_operation_id: request.operationId,
            attachment_reference_relocations: attachmentReferenceRelocations,
            resulting_status: 'finished',
            storage_state: 'live',
          }),
          timestamp,
        )
        database.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
          VALUES (?, 1) ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`)
          .run(request.missionId)
        if (custodyState.plan !== null) {
          if (request.faultInjection.failAttachmentJournalRemoval === true) {
            throw correctionError(
              'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
              'Archive correction custody clear was interrupted before unlock commit.',
            )
          }
          clearCorrectionAttachmentCustody(database, request.operationId)
        }
      },
    })
    transactionCommitted = true
  } catch (error) {
    if (!transactionCommitted && custodyState.plan !== null) {
      try {
        if (error?.code === 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'
          || request.faultInjection.failAttachmentCleanup === true) {
          throw correctionError(
            'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
            'Archive correction attachment custody requires startup reconciliation.',
          )
        }
        assertBoundAttachmentRoot(custodyState)
        const inspection = prepareCorrectionAttachmentCustodyReconciliation({
          db: database,
          plan: custodyState.plan,
          inspectEntry: (entry) => {
            throwIfCancelled()
            return proveCorrectionAttachmentResidue({
              sourcePath: path.join(
                request.attachmentDirectory,
                entry.entryName.slice('attachments/'.length),
              ),
              targetName: entry.targetName,
              peerName: entry.peerName,
              expected: entry,
            })
          },
        })
        database.transaction(() => reconcileCorrectionAttachmentCustody({
          db: database,
          inspection,
          revalidateEntry: (entry, observation) => {
            throwIfCancelled()
            assertBoundAttachmentRoot(custodyState)
            return revalidateCorrectionAttachmentResidue({
              sourcePath: path.join(
                request.attachmentDirectory,
                entry.entryName.slice('attachments/'.length),
              ),
              targetName: entry.targetName,
              peerName: entry.peerName,
              expected: entry,
            }, observation)
          },
        })).immediate()
      } catch (recoveryError) {
        const failure = correctionError(
          'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
          'Archive correction attachment custody requires startup reconciliation.',
        )
        failure.cause = recoveryError
        throw failure
      }
    }
    throw error
  } finally {
    database?.close()
  }
}

/** Creates operation-owned attachment pairs relative to the pinned cwd. */
async function restoreAttachmentCustody(database, request, custodyState) {
  if (request.attachmentMappings.length === 0) {
    return Object.freeze({ references: new Map() })
  }
  const targetIdentity = enterCorrectionAttachmentRoot(request.missionId)
  custodyState.targetRoot = path.join(
    initialDirectory,
    'missions',
    request.missionId,
    'attachments',
  )
  const plan = createCorrectionAttachmentCustodyPlan({
    missionId: request.missionId,
    archiveId: request.archiveId,
    operationId: request.operationId,
    finalizedEpoch: request.finalizedEpoch,
    targetIdentity,
    mappings: request.attachmentMappings,
  })
  writeCorrectionAttachmentCustody(database, plan)
  custodyState.plan = plan
  const references = new Map()
  for (const [index, mapping] of request.attachmentMappings.entries()) {
    throwIfCancelled()
    const entry = plan.entries[index]
    const sourcePath = path.join(
      request.attachmentDirectory,
      mapping.entryName.slice('attachments/'.length),
    )
    if (path.dirname(sourcePath) !== request.attachmentDirectory) {
      throw invalidAttachmentMappingError()
    }
    await createCorrectionAttachmentPair({
      sourcePath,
      targetName: entry.targetName,
      peerName: entry.peerName,
      expected: entry,
      isCancelled,
    })
    for (const reference of mapping.references) {
      const key = `${reference.referenceKind}\0${reference.referenceId}`
      if (references.has(key)) throw invalidAttachmentMappingError()
      references.set(key, path.join(custodyState.targetRoot, entry.targetName))
    }
  }
  throwIfCancelled()
  return Object.freeze({ references })
}


/** Proves the utility still occupies the exact attachment inode and pathname. */
function assertBoundAttachmentRoot(custodyState) {
  if (custodyState.plan === null) {
    assertCorrectionDirectoryIdentity(readyIdentity)
    return
  }
  assertCorrectionDirectoryIdentity(custodyState.plan.targetIdentity)
  let current
  try { current = path.resolve(process.cwd()) } catch {
    throw correctionError(
      'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      'Archive correction attachment directory lost its bound pathname.',
    )
  }
  if (path.relative(custodyState.targetRoot, current) !== '') {
    throw correctionError(
      'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      'Archive correction attachment directory pathname changed before commit.',
    )
  }
}

/** Validates the READY response before any request or database authority is accepted. */
function validateStartEnvelope(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).sort().join(',')
      !== 'directoryIdentity,request,type'
    || message.type !== 'start'
    || message.directoryIdentity === null || typeof message.directoryIdentity !== 'object'
    || Array.isArray(message.directoryIdentity)
    || Object.keys(message.directoryIdentity).sort().join(',') !== 'dev,ino') {
    throw correctionError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction utility start request is invalid.',
    )
  }
}

/** Validates all archive-provided mapping data before creating any directory or bytes. */
function validateCorrectionRequest(request) {
  const keys = [
    'adminName', 'archiveId', 'attachmentDirectory', 'attachmentMappings', 'databaseName',
    'expectedIdentity', 'expectedSha256', 'faultInjection', 'finalizedEpoch', 'missionId',
    'operationId', 'reason', 'snapshotPath',
  ]
  if (request === null || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join(',') !== keys.sort().join(',')
    || typeof request.databaseName !== 'string'
    || path.basename(request.databaseName) !== request.databaseName
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.databaseName)
    || !path.isAbsolute(request.snapshotPath)
    || path.resolve(request.snapshotPath) !== request.snapshotPath
    || !path.isAbsolute(request.attachmentDirectory)
    || path.resolve(request.attachmentDirectory) !== request.attachmentDirectory
    || !IDENTIFIER.test(request.missionId ?? '')
    || !IDENTIFIER.test(request.archiveId ?? '')
    || !IDENTIFIER.test(request.operationId ?? '')
    || typeof request.adminName !== 'string' || request.adminName.length < 1
    || typeof request.reason !== 'string' || request.reason.length < 1
    || !SHA256.test(request.expectedSha256 ?? '')
    || !validSnapshotIdentity(request.expectedIdentity)
    || !Number.isSafeInteger(request.finalizedEpoch) || request.finalizedEpoch < 1
    || request.faultInjection === null || typeof request.faultInjection !== 'object'
    || Array.isArray(request.faultInjection)
    || !Array.isArray(request.attachmentMappings)
    || Buffer.byteLength(JSON.stringify(request.attachmentMappings), 'utf8') > MAX_MAPPING_BYTES
    || request.attachmentMappings.some((mapping) => !isValidAttachmentMapping(mapping))) {
    throw correctionError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction utility request is invalid.',
    )
  }
}

/** Validates one archive-authenticated attachment mapping and its references. */
function isValidAttachmentMapping(mapping) {
  return mapping !== null && typeof mapping === 'object' && !Array.isArray(mapping)
    && Object.keys(mapping).sort().join(',')
      === 'entryName,references,sha256,sizeBytes,sourceRelativePath'
    && typeof mapping.entryName === 'string'
    && path.posix.dirname(mapping.entryName) === 'attachments'
    && mapping.entryName.split('/').length === 2
    && typeof mapping.sourceRelativePath === 'string'
    && path.basename(mapping.sourceRelativePath) === mapping.sourceRelativePath
    && !['.', '..'].includes(mapping.sourceRelativePath)
    && Buffer.byteLength(mapping.sourceRelativePath, 'utf8') >= 1
    && Buffer.byteLength(mapping.sourceRelativePath, 'utf8') <= 255
    && !/[\\/\u0000-\u001f\u007f:]/u.test(mapping.sourceRelativePath)
    && SHA256.test(mapping.sha256 ?? '')
    && Number.isSafeInteger(mapping.sizeBytes)
    && mapping.sizeBytes >= 1 && mapping.sizeBytes <= MAX_ATTACHMENT_BYTES
    && Array.isArray(mapping.references)
    && mapping.references.length >= 1 && mapping.references.length <= 10_000
    && mapping.references.every((reference) => isValidAttachmentReference(reference))
}

/** Validates one bounded reference without interpreting its database table yet. */
function isValidAttachmentReference(reference) {
  return reference !== null && typeof reference === 'object' && !Array.isArray(reference)
    && Object.keys(reference).sort().join(',') === 'referenceId,referenceKind'
    && typeof reference.referenceId === 'string'
    && Buffer.byteLength(reference.referenceId, 'utf8') >= 1
    && Buffer.byteLength(reference.referenceId, 'utf8') <= 200
    && typeof reference.referenceKind === 'string'
    && Buffer.byteLength(reference.referenceKind, 'utf8') >= 1
    && Buffer.byteLength(reference.referenceKind, 'utf8') <= 100
    && !/[\u0000-\u001f\u007f]/u.test(reference.referenceId)
    && !/[\u0000-\u001f\u007f]/u.test(reference.referenceKind)
}

/** Validates the already-pinned snapshot identity envelope. */
function validSnapshotIdentity(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'dev,ino,sizeBytes'
    && Number.isSafeInteger(value.dev) && value.dev >= 0
    && Number.isSafeInteger(value.ino) && value.ino >= 1
    && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 1
}

/** Returns a stable invalid-mapping failure. */
function invalidAttachmentMappingError() {
  return correctionError(
    'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID',
    'Archive correction attachment mapping is invalid.',
  )
}

/** Returns one typed correction failure. */
function correctionError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Reports a closed error envelope and releases all utility-process listeners. */
function finishWithError(error) {
  try {
    parentPort.postMessage({
      type: 'error',
      code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_REHYDRATE_FAILED',
    })
  } finally {
    finish(1)
  }
}

/** Lets the utility process exit only after its durable work and terminal envelope. */
function finish(exitCode) {
  parentPort.removeListener('message', onParentMessage)
  process.exitCode = exitCode
}

parentPort.on('message', onParentMessage)
parentPort.postMessage({ type: 'ready', directoryIdentity: readyIdentity })
