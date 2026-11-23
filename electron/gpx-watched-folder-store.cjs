'use strict'

/**
 * Per-mission watched GPX folders, kept on this machine so a watch survives a
 * restart [DON-337]. Folder paths are local to this computer, so they live in
 * the profile beside settings rather than in the mission database or archive.
 *
 * Writes are atomic (temp file, fsync, rename, directory fsync) and serialised.
 * Every change is first appended to an audit journal; the main file is then
 * replaced and copied to one atomic backup mirror. A file that cannot be read
 * (an I/O error) is never replaced. A file confirmed damaged is recovered
 * from the mirror when the mirror is good, and set aside before the next save
 * replaces it, so nothing is silently discarded.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const WATCHED_FOLDERS_FILE_NAME = 'gpx-watched-folders.json'
const WATCHED_FOLDERS_BACKUP_FILE_NAME = 'gpx-watched-folders.backup.json'
const WATCHED_FOLDERS_AUDIT_FILE_NAME = 'gpx-watched-folders-audit.jsonl'
const WATCHED_FOLDERS_FILE_VERSION = 1
const MAX_WATCHED_FOLDERS_PER_MISSION = 50
const MAX_FOLDER_PATH_LENGTH = 4096
const MAX_MISSION_ID_LENGTH = 200

/**
 * Creates the watched-folder store for one profile directory.
 * @param {{ userDataPath: string }} options
 */
function createGpxWatchedFolderStore(options) {
  const filePath = path.join(options.userDataPath, WATCHED_FOLDERS_FILE_NAME)
  const backupPath = path.join(options.userDataPath, WATCHED_FOLDERS_BACKUP_FILE_NAME)
  const auditPath = path.join(options.userDataPath, WATCHED_FOLDERS_AUDIT_FILE_NAME)
  let queue = Promise.resolve()

  /**
   * Runs one operation after every earlier one has settled.
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  function serialise(operation) {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Reads the main file, falling back to the mirror only when the main file is
   * confirmed damaged (or missing while a mirror exists).
   * @returns {Promise<{ status: 'ok', missions: Record<string, { paths: string[], updatedAt?: string }>, recoveredFromBackup: boolean, mainDamaged: boolean } | { status: 'damaged' | 'newer' | 'unreadable', message: string }>}
   */
  async function readCurrent() {
    const main = await readWatchedFoldersFile(filePath)
    if (main.status === 'ok' && !main.missing) return { status: 'ok', missions: main.missions, recoveredFromBackup: false, mainDamaged: false }
    if (main.status === 'newer' || main.status === 'unreadable') return main
    const backup = await readWatchedFoldersFile(backupPath)
    // An unreadable mirror might be the only good copy, and a newer one belongs
    // to a newer SAR Tracker: never overwrite either.
    if (backup.status === 'unreadable' || backup.status === 'newer') return backup
    if (backup.status === 'ok' && !backup.missing) {
      return { status: 'ok', missions: backup.missions, recoveredFromBackup: true, mainDamaged: main.status === 'damaged' }
    }
    if (main.status === 'ok') return { status: 'ok', missions: main.missions, recoveredFromBackup: false, mainDamaged: false }
    return main
  }

  return {
    /**
     * Returns the folders saved for a mission; none when nothing was saved.
     * `warning` says when they were recovered from the backup mirror.
     * @param {unknown} missionId
     * @returns {Promise<{ paths: string[], warning?: string }>}
     */
    loadWatchedGpxFolders: (missionId) => serialise(async () => {
      const id = readMissionId(missionId)
      const file = await readCurrent()
      if (file.status !== 'ok') throw new Error(file.message)
      const paths = [...(file.missions[id]?.paths ?? [])]
      return file.recoveredFromBackup
        ? { paths, warning: 'The saved watched-folder list was damaged or missing and was restored from its backup copy. Check the Watched Folders list.' }
        : { paths }
    }),
    /**
     * Replaces the folders saved for a mission. An empty list forgets them.
     * `warning` says when the list was saved but its backup copy was not.
     * @param {unknown} input
     * @returns {Promise<{ paths: string[], warning?: string }>}
     */
    saveWatchedGpxFolders: (input) => serialise(async () => {
      const { missionId, paths } = readSaveInput(input)
      const file = await readCurrent()
      if (file.status === 'newer') throw new Error(file.message)
      // A readable main file does not make a newer mirror safe to overwrite.
      const backup = await readWatchedFoldersFile(backupPath)
      if (backup.status === 'newer') throw new Error(backup.message)
      if (file.status === 'unreadable') {
        throw new Error(`The saved watched-folder list could not be read, so nothing was changed: ${file.reason}.`)
      }
      const previous = file.status === 'ok' ? (file.missions[missionId]?.paths ?? []) : []
      // Null-prototype maps: a mission id such as "__proto__" stays an ordinary key.
      const next = Object.assign(Object.create(null), file.status === 'ok' ? file.missions : {})
      if (paths.length === 0) {
        delete next[missionId]
      } else {
        next[missionId] = { paths, updatedAt: new Date().toISOString() }
      }
      const attemptId = randomUUID()
      const request = {
        at: new Date().toISOString(),
        event: 'gpx_watched_folders_change_requested',
        attemptId,
        missionId,
        added: paths.filter((entry) => !previous.includes(entry)),
        removed: previous.filter((entry) => !paths.includes(entry)),
        ...(file.status === 'damaged' ? { previousFile: 'damaged_set_aside' } : {}),
        ...(file.status === 'ok' && file.recoveredFromBackup ? { previousFile: 'restored_from_backup' } : {}),
      }
      // The request is recorded before anything is replaced (no record, no
      // change), and its outcome after: changed, or failed with the reason.
      try {
        await appendLineDurably(auditPath, request)
      } catch (error) {
        throw new Error(`The watched-folder change record could not be written, so the list was not changed: ${describeError(error)}.`)
      }
      /** @param {Record<string, unknown>} fields */
      const recordOutcome = (fields) => appendLineDurably(auditPath, { at: new Date().toISOString(), attemptId, missionId, ...fields })
      const payload = { version: WATCHED_FOLDERS_FILE_VERSION, missions: next }
      try {
        if (file.status === 'damaged' || (file.status === 'ok' && file.mainDamaged)) await keepDamagedCopy(filePath)
        await writeJsonDurably(filePath, payload)
      } catch (error) {
        await recordOutcome({ event: 'gpx_watched_folders_change_failed', reason: describeError(error) }).catch(() => undefined)
        throw error
      }
      await recordOutcome({ event: 'gpx_watched_folders_changed' }).catch(() => undefined)
      try {
        await writeJsonDurably(backupPath, payload)
      } catch (error) {
        // The list itself is saved; only its mirror is behind.
        await recordOutcome({ event: 'gpx_watched_folders_backup_failed', reason: describeError(error) }).catch(() => undefined)
        return { paths: [...paths], warning: `The watched-folder list was saved, but its backup copy could not be updated: ${describeError(error)}.` }
      }
      return { paths: [...paths] }
    }),
  }
}

/**
 * Reads and checks the file. A missing file is an empty store. An I/O error
 * is "unreadable" (the file may be fine, so it must not be replaced); only
 * contents that parse wrongly are "damaged".
 * @param {string} filePath
 * @returns {Promise<{ status: 'ok', missing: boolean, missions: Record<string, { paths: string[], updatedAt?: string }> } | { status: 'damaged' | 'newer', message: string } | { status: 'unreadable', message: string, reason: string }>}
 */
async function readWatchedFoldersFile(filePath) {
  let contents
  try {
    contents = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'ok', missing: true, missions: Object.create(null) }
    const reason = `the file could not be opened (${describeError(error)})`
    return {
      status: 'unreadable',
      reason,
      message: `Saved watched GPX folders could not be read: ${reason}. No folders are being watched for this mission. Check the profile folder's permissions or disk, then reopen the mission; until then new watches cannot be saved.`,
    }
  }
  let parsed
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { status: 'damaged', message: damagedMessage('the file is damaged') }
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.version !== 'number') {
    return { status: 'damaged', message: damagedMessage('the file is damaged') }
  }
  if (parsed.version > WATCHED_FOLDERS_FILE_VERSION) {
    return {
      status: 'newer',
      message: 'Saved watched GPX folders were written by a newer version of SAR Tracker and were left unchanged. Update SAR Tracker, or add the folders again with Watch Folder.',
    }
  }
  if (parsed.version !== WATCHED_FOLDERS_FILE_VERSION || typeof parsed.missions !== 'object' || parsed.missions === null) {
    return { status: 'damaged', message: damagedMessage('the file is damaged') }
  }
  /** @type {Record<string, { paths: string[], updatedAt?: string }>} */
  const missions = Object.create(null)
  for (const [missionId, entry] of Object.entries(parsed.missions)) {
    try {
      const paths = readPaths(entry && entry.paths)
      missions[missionId] = typeof entry.updatedAt === 'string' ? { paths, updatedAt: entry.updatedAt } : { paths }
    } catch {
      return { status: 'damaged', message: damagedMessage('the file is damaged') }
    }
  }
  return { status: 'ok', missing: false, missions }
}

/** @param {string} reason */
function damagedMessage(reason) {
  return `Saved watched GPX folders could not be read: ${reason}. No folders are being watched for this mission; add them again with Watch Folder.`
}

/**
 * Keeps an unreadable file beside the new one for diagnosis.
 * @param {string} filePath
 */
async function keepDamagedCopy(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  try {
    await fs.rename(filePath, `${filePath}.damaged-${stamp}`)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
}

/**
 * Appends one JSON line and flushes it, so a recorded change survives a crash.
 * @param {string} filePath
 * @param {unknown} entry
 */
async function appendLineDurably(filePath, entry) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const handle = await fs.open(filePath, 'a')
  try {
    await handle.appendFile(`${JSON.stringify(entry)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Writes JSON so a crash leaves either the old file or the new one, never half of either.
 * @param {string} filePath
 * @param {unknown} payload
 */
async function writeJsonDurably(filePath, payload) {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const handle = await fs.open(tempPath, 'w')
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  try {
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
  await syncDirectory(directory)
}

/**
 * Flushes the rename to disk where the platform allows opening a directory.
 * @param {string} directory
 */
async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** @param {unknown} input */
function readSaveInput(input) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Watched GPX folders request is invalid.')
  }
  return { missionId: readMissionId(input.missionId), paths: readPaths(input.paths) }
}

/** @param {unknown} value */
function readMissionId(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_MISSION_ID_LENGTH) {
    throw new Error('Watched GPX folders request has an invalid mission.')
  }
  return value
}

/**
 * Validates a folder list: absolute local paths, no duplicates, bounded.
 * @param {unknown} value
 * @returns {string[]}
 */
function readPaths(value) {
  if (!Array.isArray(value) || value.length > MAX_WATCHED_FOLDERS_PER_MISSION) {
    throw new Error(`Watched GPX folders must be a list of at most ${MAX_WATCHED_FOLDERS_PER_MISSION} folders.`)
  }
  const paths = []
  for (const entry of value) {
    if (
      typeof entry !== 'string'
      || entry.length === 0
      || entry.length > MAX_FOLDER_PATH_LENGTH
      || entry.includes('\u0000')
      || !(path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry))
    ) {
      throw new Error('Watched GPX folders must be absolute folder paths.')
    }
    if (!paths.includes(entry)) paths.push(entry)
  }
  return paths
}

/** @param {unknown} error */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = {
  createGpxWatchedFolderStore,
  WATCHED_FOLDERS_FILE_NAME,
  WATCHED_FOLDERS_BACKUP_FILE_NAME,
  WATCHED_FOLDERS_AUDIT_FILE_NAME,
  MAX_WATCHED_FOLDERS_PER_MISSION,
}
