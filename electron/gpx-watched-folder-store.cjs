'use strict'

/**
 * Per-mission watched GPX folders, kept on this machine so a watch survives a
 * restart [DON-337]. Folder paths are local to this computer, so they live in
 * the profile beside settings rather than in the mission database or archive.
 *
 * Writes are atomic (temp file, fsync, rename, directory fsync) and serialised.
 * A damaged file is refused loudly on read; the next save keeps a copy aside
 * before replacing it, so nothing is silently discarded.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const WATCHED_FOLDERS_FILE_NAME = 'gpx-watched-folders.json'
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

  return {
    /**
     * Returns the folders saved for a mission; none when nothing was saved.
     * @param {unknown} missionId
     * @returns {Promise<{ paths: string[] }>}
     */
    loadWatchedGpxFolders: (missionId) => serialise(async () => {
      const id = readMissionId(missionId)
      const file = await readWatchedFoldersFile(filePath)
      if (file.status !== 'ok') throw new Error(file.message)
      return { paths: [...(file.missions[id]?.paths ?? [])] }
    }),
    /**
     * Replaces the folders saved for a mission. An empty list forgets them.
     * @param {unknown} input
     * @returns {Promise<{ paths: string[] }>}
     */
    saveWatchedGpxFolders: (input) => serialise(async () => {
      const { missionId, paths } = readSaveInput(input)
      const file = await readWatchedFoldersFile(filePath)
      if (file.status === 'newer') throw new Error(file.message)
      if (file.status === 'damaged') await keepDamagedCopy(filePath)
      // Null-prototype maps: a mission id such as "__proto__" stays an ordinary key.
      const next = Object.assign(Object.create(null), file.status === 'ok' ? file.missions : {})
      if (paths.length === 0) {
        delete next[missionId]
      } else {
        next[missionId] = { paths, updatedAt: new Date().toISOString() }
      }
      await writeJsonDurably(filePath, { version: WATCHED_FOLDERS_FILE_VERSION, missions: next })
      return { paths: [...paths] }
    }),
  }
}

/**
 * Reads and checks the file. A missing file is an empty store.
 * @param {string} filePath
 * @returns {Promise<{ status: 'ok', missions: Record<string, { paths: string[], updatedAt?: string }> } | { status: 'damaged' | 'newer', message: string }>}
 */
async function readWatchedFoldersFile(filePath) {
  let contents
  try {
    contents = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'ok', missions: Object.create(null) }
    return { status: 'damaged', message: damagedMessage(`the file could not be opened (${describeError(error)})`) }
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
  return { status: 'ok', missions }
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
  MAX_WATCHED_FOLDERS_PER_MISSION,
}
