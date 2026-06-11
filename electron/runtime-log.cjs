const fs = require('node:fs/promises')
const path = require('node:path')

const LOGS_DIR_NAME = 'logs'
const LOG_FILE_NAME = 'runtime.log'
const BACKUP_LOG_FILE_NAME = 'runtime.log.1'
const DEFAULT_MAX_BYTES = 1_000_000
const SECRET_KEY_PATTERN = /(password|secret|token|credential|api[-_]?key)/i

/**
 * Creates a bounded, sanitized runtime event log for the Electron main process.
 *
 * Entries are written as JSON lines to `userData/logs/runtime.log`. When the file
 * exceeds the size cap it is rotated to a single `.1` backup, so on-disk growth is
 * bounded to roughly `2 * maxBytes` regardless of mission duration. Field laptops
 * cannot afford unbounded log growth during multi-day incidents.
 *
 * Entries are sanitized before they touch disk: secret-bearing fields are redacted
 * and home-directory paths are stripped of the username segment, matching the rules
 * the diagnostics export already enforces.
 */
function createRuntimeLog(options) {
  const logsDir = path.join(options.userDataPath, LOGS_DIR_NAME)
  const logFilePath = path.join(logsDir, LOG_FILE_NAME)
  const backupLogFilePath = path.join(logsDir, BACKUP_LOG_FILE_NAME)
  const maxBytes =
    typeof options.maxBytes === 'number' && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_MAX_BYTES
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()

  // Serialize appends so concurrent callers cannot interleave partial lines or race
  // the rotation check.
  let writeChain = Promise.resolve()

  return {
    append,
    readRecent,
    logFilePath,
  }

  function append(input) {
    writeChain = writeChain.then(() => appendInternal(input)).catch(() => {})
    return writeChain
  }

  async function appendInternal(input) {
    const entry = {
      ts: now(),
      level: typeof input.level === 'string' ? input.level : 'info',
      event: typeof input.event === 'string' ? input.event : 'unknown',
      ...sanitizeFields(input.fields),
    }
    const line = `${JSON.stringify(entry)}\n`

    await fs.mkdir(logsDir, { recursive: true })
    await rotateIfNeeded(Buffer.byteLength(line, 'utf8'))
    await fs.appendFile(logFilePath, line, 'utf8')
  }

  async function rotateIfNeeded(incomingBytes) {
    let currentSize = 0
    try {
      currentSize = (await fs.stat(logFilePath)).size
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      return
    }

    if (currentSize + incomingBytes <= maxBytes) {
      return
    }

    // Replace the single backup with the current file; the live file restarts empty.
    await fs.rm(backupLogFilePath, { force: true })
    await fs.rename(logFilePath, backupLogFilePath)
  }

  async function readRecent(limit) {
    const backupLines = await readLines(backupLogFilePath)
    const liveLines = await readLines(logFilePath)
    const combined = [...backupLines, ...liveLines]

    const parsed = []
    for (const raw of combined) {
      const trimmed = raw.trim()
      if (trimmed === '') {
        continue
      }
      try {
        parsed.push(JSON.parse(trimmed))
      } catch {
        // Skip a torn final line from a crash mid-write rather than failing the read.
      }
    }

    if (typeof limit === 'number' && limit >= 0 && parsed.length > limit) {
      return parsed.slice(parsed.length - limit)
    }
    return parsed
  }

  async function readLines(filePath) {
    try {
      const contents = await fs.readFile(filePath, 'utf8')
      return contents.split('\n')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}

/**
 * Returns a shallow copy of `fields` with secrets redacted and home paths anonymized.
 */
function sanitizeFields(fields) {
  if (fields === null || typeof fields !== 'object') {
    return {}
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'ts' || key === 'level' || key === 'event') {
      // Reserved structural keys cannot be overridden by caller fields.
      continue
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = '[redacted]'
      continue
    }
    sanitized[key] = sanitizeValue(value)
  }
  return sanitized
}

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return anonymizeHomePath(value)
  }
  return value
}

/**
 * Replaces the username segment of a home-directory path with `[redacted]`, on both
 * POSIX (`/home/<user>/`, `/Users/<user>/`) and Windows (`C:\\Users\\<user>\\`) layouts.
 */
function anonymizeHomePath(value) {
  return value
    .replace(/(\/(?:home|Users)\/)[^/]+/g, '$1[redacted]')
    .replace(/([A-Za-z]:\\Users\\)[^\\]+/g, '$1[redacted]')
}

module.exports = {
  createRuntimeLog,
}
