'use strict'

const { isMainThread, parentPort, threadId, workerData } = require('node:worker_threads')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID: cryptoRandomUUID } = require('node:crypto')

const Database = require('better-sqlite3')
const { randomUUID } = require('node:crypto')
const { rehydrateMissionFromSnapshot } = require('./archive-rehydrate.cjs')
const { copyVerifiedAttachment } = require('./archive-correction-attachment-copy.cjs')
const {
  removeCorrectionAttachmentJournal,
  syncDirectory,
  writeCorrectionAttachmentJournal,
} = require('./archive-correction-custody.cjs')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction worker must run outside the Electron main isolate.')
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u

/** Returns a stable invalid-mapping failure before any custody journal is published. */
function invalidAttachmentMappingError() {
  const error = new Error('Archive correction attachment mapping is invalid.')
  error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
  return error
}

/** Validates one archive-authenticated attachment mapping before filesystem work. */
function isValidAttachmentMapping(mapping) {
  return mapping !== null && typeof mapping === 'object' && !Array.isArray(mapping)
    && typeof mapping.entryName === 'string'
    && mapping.entryName.startsWith('attachments/') === true
    && path.posix.dirname(mapping.entryName) === 'attachments'
    && mapping.entryName.split('/').length === 2
    && typeof mapping.sourceRelativePath === 'string'
    && path.basename(mapping.sourceRelativePath) === mapping.sourceRelativePath
    && ['.', '..'].includes(mapping.sourceRelativePath) === false
    && mapping.sourceRelativePath.length > 0
    && SHA256.test(mapping.sha256 ?? '')
    && Number.isSafeInteger(mapping.sizeBytes)
    && mapping.sizeBytes >= 1 && mapping.sizeBytes <= MAX_ATTACHMENT_BYTES
    && Array.isArray(mapping.references)
}

/** Hashes one bounded attachment file while proving its byte length. */
async function hashAttachment(filePath) {
  let handle
  try {
    handle = await fs.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1
      || stat.size < 1 || stat.size > MAX_ATTACHMENT_BYTES) {
      const error = new Error('Archive correction attachment size is outside the supported bound.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let sizeBytes = 0
    while (sizeBytes < stat.size) {
      const result = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, stat.size - sizeBytes),
        sizeBytes,
      )
      if (result.bytesRead < 1) {
        const error = new Error('Archive correction attachment ended before its pinned size.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
      hash.update(chunk.subarray(0, result.bytesRead))
      sizeBytes += result.bytesRead
    }
    return Object.freeze({ sizeBytes, sha256: hash.digest('hex') })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** Copies verified archived attachment bytes into canonical mission custody. */
async function restoreAttachmentCustody() {
  const mappings = workerData.attachmentMappings
  if (!Array.isArray(mappings) || mappings.length === 0) return { created: [], references: new Map() }
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  const throwIfCancelled = () => {
    if (Atomics.load(cancellationFlag, 0) !== 0) {
      const error = new Error('Archive correction restore was cancelled.')
      error.code = 'ARCHIVE_CANCELLED'
      throw error
    }
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(workerData.missionId)) {
    const error = new Error('Archive correction mission attachment identity is invalid.')
    error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
    throw error
  }
  const sourceRoot = workerData.attachmentDirectory
  const targetRoot = path.join(path.dirname(workerData.databasePath), 'missions', workerData.missionId, 'attachments')
  const targetRootExisted = await fs.lstat(targetRoot).then(() => true).catch((error) => {
    if (error?.code === 'ENOENT') return false
    throw error
  })
  await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 })
  if (!targetRootExisted) {
    await syncDirectory(path.dirname(targetRoot))
    await syncDirectory(targetRoot)
  }
  const created = []
  const references = new Map()
  const journalEntries = []
  let journalPath
  try {
    for (const mapping of mappings) {
      if (!isValidAttachmentMapping(mapping)) throw invalidAttachmentMappingError()
      const targetPath = path.join(targetRoot, mapping.sourceRelativePath)
      const preexisting = await fs.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      })
      journalEntries.push(Object.freeze({
        sourceRelativePath: mapping.sourceRelativePath,
        targetPath,
        preexisting,
        sha256: mapping.sha256,
        sizeBytes: mapping.sizeBytes,
      }))
    }
    if (journalEntries.length > 0) {
      journalPath = await writeCorrectionAttachmentJournal({
        databasePath: workerData.databasePath,
        missionId: workerData.missionId,
        archiveId: workerData.archiveId,
        operationId: workerData.operationId,
        targetRoot,
        entries: journalEntries,
      })
    }
    for (const mapping of mappings) {
      throwIfCancelled()
      if (!isValidAttachmentMapping(mapping)) throw invalidAttachmentMappingError()
      const sourcePath = path.join(sourceRoot, mapping.entryName.slice('attachments/'.length))
      if (path.dirname(sourcePath) !== sourceRoot) {
        const error = new Error('Archive correction attachment source escaped its staging directory.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
      const sourceStat = await fs.lstat(sourcePath)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        const error = new Error('Archive correction attachment source is not a regular file.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
      const targetPath = path.join(targetRoot, mapping.sourceRelativePath)
      const targetExists = await fs.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      })
      if (targetExists) {
        const targetStat = await fs.lstat(targetPath)
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
          const error = new Error('Canonical mission attachment custody is not a regular file.')
          error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
          throw error
        }
        const targetProof = await hashAttachment(targetPath)
        if (targetProof.sizeBytes !== mapping.sizeBytes || targetProof.sha256 !== mapping.sha256) {
          const error = new Error('Canonical mission attachment custody conflicts with the archived bytes.')
          error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
          throw error
        }
      } else {
        const temporaryPath = path.join(targetRoot, `.${mapping.sourceRelativePath}.restore-${cryptoRandomUUID()}`)
        try {
          await copyVerifiedAttachment({
            sourcePath,
            temporaryPath,
            expected: mapping,
          })
          throwIfCancelled()
          throwIfCancelled()
          await fs.rename(temporaryPath, targetPath)
          if (process.platform !== 'win32') {
            const directory = await fs.open(targetRoot, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
            try { await directory.sync() } finally { await directory.close() }
          }
        } finally {
          try {
            await fs.rm(temporaryPath, { force: true })
            await syncDirectory(targetRoot)
          } catch (cleanupError) {
            const failure = new Error('Archive correction temporary attachment cleanup requires recovery.')
            failure.code = 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'
            failure.cause = cleanupError
            throw failure
          }
        }
        created.push(targetPath)
      }
      throwIfCancelled()
      for (const reference of mapping.references) {
        if (reference === null || typeof reference !== 'object'
          || typeof reference.referenceId !== 'string'
          || typeof reference.referenceKind !== 'string') {
          const error = new Error('Archive correction attachment reference is invalid.')
          error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
          throw error
        }
        const key = `${reference.referenceKind}\0${reference.referenceId}`
        if (references.has(key)) {
          const error = new Error('Archive correction attachment reference is ambiguous.')
          error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
          throw error
        }
        references.set(key, targetPath)
      }
    }
    return { created, references, journalPath }
  } catch (error) {
    await cleanupAttachmentCustody({
      created,
      journalPath,
      preserveJournal: error?.code === 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      faultInjection: workerData.faultInjection,
    })
    throw error
  }
}

/** Rolls back newly-created canonical files before releasing their custody journal. */
async function cleanupAttachmentCustody(input) {
  if (input.faultInjection?.failAttachmentCleanup === true) {
    const failure = new Error('Archive correction attachment cleanup requires recovery.')
    failure.code = 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'
    throw failure
  }
  let cleanupError = null
  for (const filePath of input.created) {
    try {
      await fs.rm(filePath, { force: true })
      await fs.lstat(filePath).then(() => {
        throw new Error('Canonical attachment remained after rollback.')
      }).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
    } catch (error) {
      cleanupError ??= error
    }
  }
  for (const directory of new Set(input.created.map((filePath) => path.dirname(filePath)))) {
    try {
      await syncDirectory(directory)
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (cleanupError !== null || input.preserveJournal === true) {
    if (cleanupError !== null) {
      const failure = new Error('Archive correction attachment cleanup requires recovery.')
      failure.code = 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'
      failure.cause = cleanupError
      throw failure
    }
    return
  }
  if (input.journalPath !== undefined) {
    try {
      await removeCorrectionAttachmentJournal(input.journalPath)
    } catch (error) {
      const failure = new Error('Archive correction attachment cleanup requires recovery.')
      failure.code = 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'
      failure.cause = error
      throw failure
    }
  }
}

/** Rewrites restored evidence references to canonical mission attachment custody. */
function rewriteAttachmentReferences(database, missionId, references) {
  for (const [key, targetPath] of references) {
    const separator = key.indexOf('\0')
    const kind = key.slice(0, separator)
    const referenceId = key.slice(separator + 1)
    if (kind === 'marker') {
      database.prepare('UPDATE markers SET attachment_path = ? WHERE id = ? AND mission_id = ?')
        .run(targetPath, referenceId, missionId)
    } else if (kind === 'marker_version') {
      const row = database.prepare('SELECT state_json FROM mission_object_versions WHERE id = ? AND mission_id = ?')
        .get(referenceId, missionId)
      if (row !== undefined) {
        const state = JSON.parse(row.state_json)
        state.attachment_path = targetPath
        database.prepare('UPDATE mission_object_versions SET state_json = ? WHERE id = ? AND mission_id = ?')
          .run(JSON.stringify(state), referenceId, missionId)
      }
    } else {
      const event = database.prepare('SELECT details_json FROM mission_events WHERE id = ? AND mission_id = ?')
        .get(referenceId, missionId)
      if (event !== undefined) {
        const details = JSON.parse(event.details_json)
        details.attachment_path = targetPath
        database.prepare('UPDATE mission_events SET details_json = ? WHERE id = ? AND mission_id = ?')
          .run(JSON.stringify(details), referenceId, missionId)
      }
    }
  }
}

/** Performs one archive correction restore and its final unlock in one transaction. */
async function run() {
  let database
  let attachmentCustody = null
  let transactionCommitted = false
  try {
    const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    database = new Database(workerData.databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('foreign_keys = ON')
    // File custody is prepared before the SQLite transaction; await it here so
    // the transaction callback remains synchronous and all-or-nothing for rows.
    attachmentCustody = await restoreAttachmentCustody()
    rehydrateMissionFromSnapshot({
      db: database,
      snapshotPath: workerData.snapshotPath,
      missionId: workerData.missionId,
      archiveId: workerData.archiveId,
      schemaVersion: 13,
      onRestored: () => {
        rewriteAttachmentReferences(database, workerData.missionId, attachmentCustody.references)
        const operational = database.prepare(
          "SELECT 1 FROM missions WHERE status IN ('active', 'paused') LIMIT 1",
        ).get()
        if (operational !== undefined) {
          const error = new Error('An operational mission is active; archive correction restore is deferred.')
          error.code = 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY'
          throw error
        }
        if (Atomics.load(cancellationFlag, 0) !== 0) {
          const error = new Error('Archive correction restore was cancelled.')
          error.code = 'ARCHIVE_CANCELLED'
          throw error
        }
        const mission = database.prepare('SELECT status FROM missions WHERE id = ?')
          .get(workerData.missionId)
        const cleanup = database.prepare(`SELECT state FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(workerData.missionId)
        const finalizedEpoch = database.prepare(`SELECT rowid FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_finalized'
          ORDER BY rowid DESC LIMIT 1`).get(workerData.missionId)?.rowid
        if (mission?.status !== 'finalized' || cleanup?.state !== 'completed'
          || Number(finalizedEpoch) !== workerData.finalizedEpoch) {
          const error = new Error('Mission finalization or archive storage changed before correction unlock could commit.')
          error.code = 'ARCHIVE_REHYDRATE_EPOCH_CHANGED'
          throw error
        }
        if (workerData.faultInjection?.afterRehydrateBeforeUnlock === true) {
          const error = new Error('Archive correction restore was interrupted before unlock.')
          error.code = 'ARCHIVE_REHYDRATE_FAILED'
          throw error
        }
        const timestamp = new Date().toISOString()
        database.prepare('UPDATE missions SET status = ? WHERE id = ?')
          .run('finished', workerData.missionId)
        database.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
        ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
          randomUUID(),
          workerData.missionId,
          timestamp,
          JSON.stringify({
            admin_name: workerData.adminName,
            reason: workerData.reason,
            restored_from_archive_id: workerData.archiveId,
            archive_correction_operation_id: workerData.operationId,
            resulting_status: 'finished',
            storage_state: 'live',
          }),
          timestamp,
        )
        database.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
          VALUES (?, 1) ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`)
          .run(workerData.missionId)
      },
    })
    transactionCommitted = true
    if (attachmentCustody.journalPath !== undefined) {
      await removeCorrectionAttachmentJournal(attachmentCustody.journalPath)
    }
    parentPort.postMessage({
      type: 'complete',
      missionId: workerData.missionId,
      archiveId: workerData.archiveId,
    })
  } catch (error) {
    if (!transactionCommitted && attachmentCustody !== null) {
      try {
        await cleanupAttachmentCustody({
          created: attachmentCustody.created,
          journalPath: attachmentCustody.journalPath,
          preserveJournal: error?.code === 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
          faultInjection: workerData.faultInjection,
        })
      } catch (cleanupError) {
        error = cleanupError
      }
    }
    parentPort.postMessage({
      type: 'error',
      code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_REHYDRATE_FAILED',
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'cancel') return
})

void run()

module.exports = { threadId }
