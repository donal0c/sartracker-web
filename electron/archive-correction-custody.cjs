'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

const JOURNAL_DIRECTORY_NAME = 'correction-attachment-journals'
const JOURNAL_NAME = /^[A-Za-z0-9_-]{1,200}\.json(?:\.tmp)?$/u
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Returns the app-owned directory containing correction attachment journals. */
function correctionJournalDirectory(databasePath) {
  return path.join(path.dirname(databasePath), JOURNAL_DIRECTORY_NAME)
}

/** Writes one durable attachment-custody plan before any canonical byte is created. */
async function writeCorrectionAttachmentJournal(input) {
  const directory = correctionJournalDirectory(input.databasePath)
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 })
  const journalPath = path.join(directory, `${input.operationId}.json`)
  const document = JSON.stringify({
    version: 1,
    missionId: input.missionId,
    archiveId: input.archiveId,
    operationId: input.operationId,
    targetRoot: input.targetRoot,
    entries: input.entries,
  })
  const temporaryPath = `${journalPath}.tmp`
  const file = await fsp.open(temporaryPath, 'w', 0o600)
  try {
    await file.writeFile(document, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  await fsp.rename(temporaryPath, journalPath)
  await syncDirectory(directory)
  return journalPath
}

/** Removes one durable custody journal only after its recovery decision is complete. */
async function removeCorrectionAttachmentJournal(journalPath) {
  await fsp.rm(journalPath, { force: true })
  await syncDirectory(path.dirname(journalPath))
}

/** Recovers pending attachment custody after an interrupted correction worker. */
function recoverCorrectionAttachmentJournals(input) {
  const directory = correctionJournalDirectory(input.databasePath)
  if (!fs.existsSync(directory)) return Object.freeze({ recovered: 0 })
  const names = fs.readdirSync(directory)
  let recovered = 0
  for (const name of names) {
    if (!JOURNAL_NAME.test(name)) {
      throw new Error('Correction attachment custody journal directory contains an invalid entry.')
    }
    const journalPath = path.join(directory, name)
    if (name.endsWith('.json.tmp')) {
      // The publish rename happens before any canonical attachment byte is
      // created, so a leftover temporary record is always incomplete custody.
      fs.rmSync(journalPath, { force: true })
      recovered += 1
      continue
    }
    let journal
    try {
      journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    } catch (error) {
      throw error
    }
    validateJournal(journal, input.databasePath)
    const mission = input.db.prepare(
      'SELECT status FROM missions WHERE id = ?',
    ).get(journal.missionId)
    const cleanup = input.db.prepare(
      'SELECT state FROM mission_cleanup_journal WHERE mission_id = ?',
    ).get(journal.missionId)
    const unlockEvents = input.db.prepare(`SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_unlocked'`).all(journal.missionId)
    const hasMatchingCorrectionUnlock = unlockEvents.some((event) => {
      try {
        const details = JSON.parse(event.details_json)
        return details !== null && typeof details === 'object'
          && details.restored_from_archive_id === journal.archiveId
          && details.archive_correction_operation_id === journal.operationId
      } catch {
        return false
      }
    })
    if (mission?.status === 'finished' && !hasMatchingCorrectionUnlock) {
      throw new Error('Finished correction custody has no matching durable unlock evidence.')
    }
    const committed = hasMatchingCorrectionUnlock
      && (cleanup === undefined || ['eligible', 'completed'].includes(cleanup.state))
    if (!fs.existsSync(journal.targetRoot)) {
      throw new Error(committed
        ? 'Committed correction attachment custody is missing its canonical root.'
        : 'Correction attachment custody root disappeared before recovery.')
    }
    if (committed) {
      for (const entry of journal.entries) {
        const proof = digestAttachment(entry.targetPath)
        if (proof.sizeBytes !== entry.sizeBytes || proof.sha256 !== entry.sha256) {
          throw new Error('Committed correction attachment custody does not match its journaled bytes.')
        }
      }
    } else {
      for (const entry of journal.entries) {
        if (entry.preexisting === false) fs.rmSync(entry.targetPath, { force: true })
        const prefix = `.${entry.sourceRelativePath}.restore-`
        for (const target of fs.readdirSync(journal.targetRoot, { withFileTypes: true })) {
          if (target.name.startsWith(prefix)) {
            fs.rmSync(path.join(journal.targetRoot, target.name), { force: true })
          }
        }
      }
    }
    fs.rmSync(journalPath, { force: true })
    recovered += 1
  }
  syncDirectorySync(directory)
  try {
    fs.rmdirSync(directory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return Object.freeze({ recovered })
}

/** Validates one recovery journal without accepting paths outside its mission custody root. */
function validateJournal(value, databasePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || typeof value.missionId !== 'string'
    || typeof value.archiveId !== 'string' || typeof value.operationId !== 'string'
    || typeof value.targetRoot !== 'string' || !Array.isArray(value.entries)
    || value.targetRoot !== path.join(path.dirname(databasePath), 'missions', value.missionId, 'attachments')) {
    throw new Error('Correction attachment custody journal is invalid.')
  }
  for (const entry of value.entries) {
    if (entry === null || typeof entry !== 'object'
      || typeof entry.targetPath !== 'string'
      || path.dirname(entry.targetPath) !== value.targetRoot
      || typeof entry.sourceRelativePath !== 'string'
      || path.basename(entry.sourceRelativePath) !== entry.sourceRelativePath
      || ['.', '..'].includes(entry.sourceRelativePath)
      || typeof entry.preexisting !== 'boolean'
      || !Number.isSafeInteger(entry.sizeBytes)
      || entry.sizeBytes < 1 || entry.sizeBytes > MAX_ATTACHMENT_BYTES
      || !SHA256.test(entry.sha256 ?? '')) {
      throw new Error('Correction attachment custody journal entry is invalid.')
    }
  }
}

/** Hashes one canonical attachment through a bounded descriptor for recovery proof. */
function digestAttachment(filePath) {
  let descriptor
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const identity = fs.fstatSync(descriptor)
    if (!identity.isFile() || identity.nlink !== 1
      || identity.size < 1 || identity.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Correction attachment custody target is not a bounded regular file.')
    }
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < identity.size) {
      const read = fs.readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, identity.size - offset),
        offset,
      )
      if (read < 1) throw new Error('Correction attachment custody target ended early.')
      hash.update(chunk.subarray(0, read))
      offset += read
    }
    return { sizeBytes: identity.size, sha256: hash.digest('hex') }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

/** Flushes one directory on hosts that support directory synchronization. */
async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  const handle = await fsp.open(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Flushes one directory synchronously during startup recovery on supported hosts. */
function syncDirectorySync(directory) {
  if (process.platform === 'win32') return
  const descriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0),
  )
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

module.exports = {
  correctionJournalDirectory,
  recoverCorrectionAttachmentJournals,
  removeCorrectionAttachmentJournal,
  writeCorrectionAttachmentJournal,
}
