const fs = require('node:fs/promises')
const path = require('node:path')

const CRASH_DIR_NAME = 'crashes'
const CRASH_LOG_FILE_NAME = 'crash-log.json'
const CLEAN_EXIT_FILE_NAME = 'last-clean-exit'
const DEFAULT_MAX_ENTRIES = 10
const SECRET_TOKEN_PATTERN = /\b(password|secret|token|credential|api[-_]?key)\b\s*[:=]\s*\S+/gi

/**
 * Creates a bounded structured crash log for the Electron main process.
 *
 * Crash entries (unhandled exceptions, unhandled rejections, renderer-process-gone)
 * are stored as a JSON array in `userData/crashes/crash-log.json`, capped to the most
 * recent `maxEntries`. A separate clean-exit marker lets startup detect whether the
 * previous session ended unexpectedly, so the UI can offer a calm recovery notice.
 *
 * Entries are sanitized before they touch disk (no secrets, no home-path usernames).
 */
function createCrashLog(options) {
  const crashDir = path.join(options.userDataPath, CRASH_DIR_NAME)
  const crashLogPath = path.join(crashDir, CRASH_LOG_FILE_NAME)
  const cleanExitPath = path.join(crashDir, CLEAN_EXIT_FILE_NAME)
  const maxEntries =
    typeof options.maxEntries === 'number' && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()

  // Serialize writes so concurrent crash signals cannot corrupt the JSON array.
  let writeChain = Promise.resolve()

  return {
    record,
    readRecent,
    markCleanExit,
    hadUncleanShutdown,
    crashLogPath,
  }

  function record(input) {
    writeChain = writeChain.then(() => recordInternal(input)).catch(() => {})
    return writeChain
  }

  async function recordInternal(input) {
    const entry = {
      ts: now(),
      kind: typeof input.kind === 'string' ? input.kind : 'unknown',
      summary: sanitizeText(typeof input.summary === 'string' ? input.summary : ''),
    }
    if (typeof input.detail === 'string' && input.detail.trim() !== '') {
      entry.detail = sanitizeText(input.detail)
    }

    const entries = await readAll()
    entries.push(entry)
    const trimmed = entries.slice(Math.max(0, entries.length - maxEntries))

    await fs.mkdir(crashDir, { recursive: true })
    await writeJsonAtomically(crashLogPath, trimmed)
  }

  async function readRecent(limit) {
    const entries = await readAll()
    if (typeof limit === 'number' && limit >= 0 && entries.length > limit) {
      return entries.slice(entries.length - limit)
    }
    return entries
  }

  async function markCleanExit() {
    await fs.mkdir(crashDir, { recursive: true })
    await writeTextAtomically(cleanExitPath, now())
  }

  async function hadUncleanShutdown() {
    const entries = await readAll()
    if (entries.length === 0) {
      return false
    }

    const lastCrashTs = entries[entries.length - 1]?.ts ?? null
    if (lastCrashTs === null) {
      return false
    }

    const lastCleanExitTs = await readCleanExitTimestamp()
    if (lastCleanExitTs === null) {
      // A crash on record but no clean exit ever marked: treat as unclean.
      return true
    }

    // Unclean only when the most recent crash happened after the last clean exit.
    return lastCrashTs > lastCleanExitTs
  }

  async function readAll() {
    try {
      const contents = await fs.readFile(crashLogPath, 'utf8')
      const parsed = JSON.parse(contents)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return []
      }
      // A corrupt crash log should never block startup or the recovery check.
      return []
    }
  }

  async function readCleanExitTimestamp() {
    try {
      const contents = await fs.readFile(cleanExitPath, 'utf8')
      const trimmed = contents.trim()
      return trimmed === '' ? null : trimmed
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null
      }
      return null
    }
  }
}

function sanitizeText(value) {
  return String(value)
    .replace(SECRET_TOKEN_PATTERN, (match) => match.replace(/[:=]\s*\S+$/u, (kv) => kv.replace(/\S+$/u, '[redacted]')))
    .replace(/(\/(?:home|Users)\/)[^/\s]+/g, '$1[redacted]')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1[redacted]')
}

async function writeTextAtomically(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, contents, 'utf8')
  await fs.rename(tempPath, filePath)
}

async function writeJsonAtomically(filePath, value) {
  await writeTextAtomically(filePath, JSON.stringify(value, null, 2))
}

module.exports = {
  createCrashLog,
}
