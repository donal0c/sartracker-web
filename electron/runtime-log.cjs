const fs = require('node:fs/promises')
const path = require('node:path')

const { sanitizeDiagnosticFields } = require('./diagnostic-sanitizer.cjs')

const LOGS_DIR_NAME = 'logs'
const LOG_FILE_NAME = 'runtime.log'
const BACKUP_LOG_FILE_NAME = 'runtime.log.1'
const DEFAULT_MAX_BYTES = 1_000_000

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
    appendDurable,
    readRecent,
    logFilePath,
  }

  function append(input) {
    return appendDurable(input).catch(() => {})
  }

  /**
   * Flushes an entry through the serialized write chain and exposes write failure.
   * Storage-operation start markers use this before entering blocking work; ordinary
   * best-effort logging continues to use `append`, which never breaks app flow.
   */
  function appendDurable(input) {
    const run = writeChain.then(() => appendInternal(input))
    writeChain = run.catch(() => {})
    return run
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
    if (typeof limit === 'number' && limit >= 0) {
      if (limit === 0) {
        return []
      }
      const liveLines = await readTailLines(logFilePath, limit)
      const remaining = limit - liveLines.length
      const backupLines =
        remaining > 0 ? await readTailLines(backupLogFilePath, remaining) : []
      return parseLogLines([...backupLines, ...liveLines])
    }

    const backupLines = await readLines(backupLogFilePath)
    const liveLines = await readLines(logFilePath)
    return parseLogLines([...backupLines, ...liveLines])
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

  async function readTailLines(filePath, limit) {
    try {
      const contents = await fs.readFile(filePath, 'utf8')
      return tailNonEmptyLines(contents, limit)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}

function parseLogLines(lines) {
  const parsed = []
  for (const raw of lines) {
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
  return parsed
}

function tailNonEmptyLines(contents, limit) {
  const lines = []
  let end = contents.length

  while (end > 0 && (contents[end - 1] === '\n' || contents[end - 1] === '\r')) {
    end -= 1
  }

  for (let index = end - 1; index >= 0 && lines.length < limit; index -= 1) {
    const char = contents[index]
    if (char !== '\n' && char !== '\r') {
      continue
    }
    const line = contents.slice(index + 1, end)
    if (line.trim() !== '') {
      lines.push(line)
    }
    while (index > 0 && (contents[index - 1] === '\n' || contents[index - 1] === '\r')) {
      index -= 1
    }
    end = index
  }

  if (end > 0 && lines.length < limit) {
    const line = contents.slice(0, end)
    if (line.trim() !== '') {
      lines.push(line)
    }
  }

  return lines.reverse()
}

/**
 * Returns a shallow copy of `fields` with secrets redacted and home paths anonymized.
 */
function sanitizeFields(fields) {
  return sanitizeDiagnosticFields(fields, new Set(['ts', 'level', 'event']))
}

module.exports = {
  createRuntimeLog,
}
