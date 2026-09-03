'use strict'

const { isMainThread, parentPort, threadId, workerData } = require('node:worker_threads')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID: cryptoRandomUUID } = require('node:crypto')

const Database = require('better-sqlite3')
const { randomUUID } = require('node:crypto')
const { rehydrateMissionFromSnapshot } = require('./archive-rehydrate.cjs')
const {
  removeCorrectionAttachmentJournal,
  writeCorrectionAttachmentJournal,
} = require('./archive-correction-custody.cjs')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction worker must run outside the Electron main isolate.')
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u

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

/** Streams one verified attachment into a temporary canonical file. */
async function copyVerifiedAttachment(sourcePath, temporaryPath, expected) {
  let source
  let target
  try {
    source = await fs.open(
      sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const sourceStat = await source.stat()
    if (!sourceStat.isFile() || sourceStat.nlink !== 1
      || sourceStat.size < 1 || sourceStat.size > MAX_ATTACHMENT_BYTES) {
      const error = new Error('Archive correction attachment source is not a pinned regular file.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    target = await fs.open(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let sizeBytes = 0
    while (sizeBytes < sourceStat.size) {
      const result = await source.read(
        chunk,
        0,
        Math.min(chunk.length, sourceStat.size - sizeBytes),
        sizeBytes,
      )
      if (result.bytesRead < 1) {
        const error = new Error('Archive correction attachment ended before its pinned size.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
      hash.update(chunk.subarray(0, result.bytesRead))
      await target.write(chunk, 0, result.bytesRead)
      sizeBytes += result.bytesRead
    }
    const proof = { sizeBytes, sha256: hash.digest('hex') }
    if (proof.sizeBytes !== expected.sizeBytes || proof.sha256 !== expected.sha256) {
      const error = new Error('Archive correction attachment digest does not match its authenticated archive proof.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    await target.sync()
  } finally {
    await target?.close().catch(() => undefined)
    await source?.close().catch(() => undefined)
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
  await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 })
  const created = []
  const references = new Map()
  const journalEntries = []
  let journalPath
  try {
    for (const mapping of mappings) {
      if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)
        || typeof mapping.sourceRelativePath !== 'string'
        || path.basename(mapping.sourceRelativePath) !== mapping.sourceRelativePath) continue
      const targetPath = path.join(targetRoot, mapping.sourceRelativePath)
      const preexisting = await fs.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      })
      journalEntries.push(Object.freeze({
        sourceRelativePath: mapping.sourceRelativePath,
        targetPath,
        preexisting,
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
      if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)
        || typeof mapping.entryName !== 'string'
        || mapping.entryName.startsWith('attachments/') !== true
        || path.posix.dirname(mapping.entryName) !== 'attachments'
        || typeof mapping.sourceRelativePath !== 'string'
        || path.basename(mapping.sourceRelativePath) !== mapping.sourceRelativePath
        || ['.', '..'].includes(mapping.sourceRelativePath)
        || mapping.entryName.split('/').length !== 2
        || mapping.sourceRelativePath.length < 1
        || !SHA256.test(mapping.sha256 ?? '')
        || !Number.isSafeInteger(mapping.sizeBytes)
        || mapping.sizeBytes < 1 || mapping.sizeBytes > MAX_ATTACHMENT_BYTES
        || !Array.isArray(mapping.references)) {
        const error = new Error('Archive correction attachment mapping is invalid.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
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
          await copyVerifiedAttachment(sourcePath, temporaryPath, mapping)
          throwIfCancelled()
          throwIfCancelled()
          await fs.rename(temporaryPath, targetPath)
          if (process.platform === 'linux') {
            const directory = await fs.open(targetRoot, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
            try { await directory.sync() } finally { await directory.close() }
          }
        } finally {
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
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
    await Promise.all(created.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)))
    throw error
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
    if (!transactionCommitted && attachmentCustody?.created?.length > 0) {
      await Promise.all(attachmentCustody.created.map((filePath) =>
        fs.rm(filePath, { force: true }).catch(() => undefined)))
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
