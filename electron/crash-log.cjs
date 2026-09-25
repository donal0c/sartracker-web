const fs = require('node:fs/promises')
const path = require('node:path')
const { assertRegularFileOrAbsent } = require('./regular-file-guard.cjs')

const { sanitizeDiagnosticText } = require('./diagnostic-sanitizer.cjs')
const { removeFileDurably, syncDirectoryDurably, writeFileDurably } = require('./durable-file.cjs')

const CRASH_DIR_NAME = 'crashes'
const CRASH_LOG_FILE_NAME = 'crash-log.json'
const CLEAN_EXIT_FILE_NAME = 'last-clean-exit'
const ACTIVE_SESSION_FILE_NAME = 'active-session'
const DEFAULT_MAX_ENTRIES = 10

// `render-process-gone` fires on normal window teardown (`clean-exit`) as well as on
// genuine faults. Only these reasons represent an actual crash worth recording.
const RENDERER_FAULT_REASONS = new Set([
  'crashed',
  'oom',
  'abnormal-exit',
  'killed',
  'launch-failed',
  'integrity-failure',
])

/**
 * Returns true only for `render-process-gone` reasons that represent a genuine fault,
 * so normal renderer teardown (`clean-exit`) is never logged as a crash.
 */
function isRendererFaultReason(reason) {
  return typeof reason === 'string' && RENDERER_FAULT_REASONS.has(reason)
}
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
  const fileSystem = options.fileSystem ?? fs
  const crashDir = path.join(options.userDataPath, CRASH_DIR_NAME)
  const crashLogPath = path.join(crashDir, CRASH_LOG_FILE_NAME)
  const cleanExitPath = path.join(crashDir, CLEAN_EXIT_FILE_NAME)
  const activeSessionPath = path.join(crashDir, ACTIVE_SESSION_FILE_NAME)
  const maxEntries =
    typeof options.maxEntries === 'number' && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()

  // Serialize writes so concurrent crash signals cannot corrupt the JSON array.
  let writeChain = Promise.resolve()

  return {
    record,
    recordDurably,
    readRecent,
    markSessionStart,
    markCleanExit,
    hadUncleanShutdown,
    crashLogPath,
  }

  function record(input) {
    return recordDurably(input).catch(() => undefined)
  }

  function recordDurably(input) {
    const operation = writeChain.then(() => recordInternal(input))
    writeChain = operation.catch(() => undefined)
    return operation
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

    await ensureCrashDirectory()
    await writeJsonAtomically(crashLogPath, trimmed)
  }

  /**
   * Creates crashes/ when needed and makes a new directory entry durable, so a
   * first-ever crash record cannot vanish with its parent entry on power loss.
   */
  async function ensureCrashDirectory() {
    // mkdir returns the first directory it created, or undefined if none.
    const created = await fileSystem.mkdir(crashDir, { recursive: true })
    if (created === undefined) return
    await syncDirectoryDurably(path.dirname(crashDir))
    if (created !== crashDir) await syncDirectoryDurably(path.dirname(created))
  }

  async function readRecent(limit) {
    const entries = await readAll()
    if (typeof limit === 'number' && limit >= 0 && entries.length > limit) {
      return entries.slice(entries.length - limit)
    }
    return entries
  }

  async function markCleanExit() {
    await ensureCrashDirectory()
    await writeFileDurably(cleanExitPath, now())
    await removeFileDurably(activeSessionPath)
  }

  async function markSessionStart() {
    await ensureCrashDirectory()
    await writeFileDurably(activeSessionPath, now())
  }

  async function hadUncleanShutdown() {
    if (await fileExists(activeSessionPath, fileSystem)) {
      return true
    }
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
      if (!(await assertRegularFileOrAbsent(crashLogPath, fileSystem))) return []
      const contents = await fileSystem.readFile(crashLogPath, 'utf8')
      const parsed = JSON.parse(contents)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (error?.code === 'ERR_SARTRACKER_NON_REGULAR_FILE') throw error
      if (error?.code === 'ENOENT') {
        return []
      }
      // A corrupt crash log should never block startup or the recovery check.
      return []
    }
  }

  async function readCleanExitTimestamp() {
    try {
      if (!(await assertRegularFileOrAbsent(cleanExitPath, fileSystem))) return null
      const contents = await fileSystem.readFile(cleanExitPath, 'utf8')
      const trimmed = contents.trim()
      return trimmed === '' ? null : trimmed
    } catch (error) {
      if (error?.code === 'ERR_SARTRACKER_NON_REGULAR_FILE') throw error
      if (error?.code === 'ENOENT') {
        return null
      }
      return null
    }
  }
}

async function fileExists(filePath, fileSystem = fs) {
  try {
    await fileSystem.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function sanitizeText(value) {
  return sanitizeDiagnosticText(value).replace(
    /\b(password|secret|token|credential|api[-_]?key)\b\s*[:=]\s*\S+/gi,
    (match) => match.replace(/[:=]\s*\S+$/u, (kv) => kv.replace(/\S+$/u, '[redacted]')),
  )
}

async function writeJsonAtomically(filePath, value) {
  await writeFileDurably(filePath, JSON.stringify(value, null, 2))
}

module.exports = {
  createCrashLog,
  isRendererFaultReason,
}
