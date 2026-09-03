'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const JOURNAL_DIRECTORY_NAME = 'correction-attachment-journals'
const JOURNAL_NAME = /^[A-Za-z0-9_-]{1,200}\.json$/u

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
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    validateJournal(journal, input.databasePath)
    const mission = input.db.prepare(
      'SELECT status, storage_state FROM missions WHERE id = ?',
    ).get(journal.missionId)
    const committed = mission?.status === 'finished' && mission.storage_state === 'live'
    if (committed && !fs.existsSync(journal.targetRoot)) {
      fs.rmSync(journalPath, { force: true })
      recovered += 1
      continue
    }
    if (!committed) {
      if (!fs.existsSync(journal.targetRoot)) {
        throw new Error('Correction attachment custody root disappeared before recovery.')
      }
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
  fs.rmSync(directory, { recursive: false, force: true })
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
      || typeof entry.preexisting !== 'boolean') {
      throw new Error('Correction attachment custody journal entry is invalid.')
    }
  }
}

/** Flushes one directory on hosts that support directory synchronization. */
async function syncDirectory(directory) {
  if (process.platform !== 'linux') return
  const handle = await fsp.open(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

module.exports = {
  correctionJournalDirectory,
  recoverCorrectionAttachmentJournals,
  removeCorrectionAttachmentJournal,
  writeCorrectionAttachmentJournal,
}
