import { execFile as execFileCallback, spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000
const DEFAULT_TERMINATION_GRACE_MS = 5_000
const DEFAULT_OBSERVE_INTERVAL_MS = 250

/**
 * Run a reviewed direct command in its own process group with bounded output,
 * observation and cleanup. Callers own the fixed command and observation
 * callback; this primitive never accepts shell text.
 *
 * @param {object} options bounded process options
 * @returns {Promise<object>} retained process result and cleanup evidence
 */
export async function runOwnedProcess(options) {
  const settings = validateOptions(options)
  const child = spawn(settings.file, settings.args, {
    cwd: settings.cwd,
    env: settings.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = boundedOutput(settings.maxOutputBytes)
  const stderr = boundedOutput(settings.maxOutputBytes)
  const observationResults = []
  const observationErrors = []
  let observationFailed = false
  let processError = null
  let timedOut = false
  let terminationRequested = false
  let terminationTimer = null
  let timeoutTimer = null
  let hardTimer = null
  let processExited = false
  let observeBusy = false
  let runFinished = false

  const retainError = (value) => {
    if (processError !== null) return
    processError = value instanceof Error ? value.message : String(value)
  }
  const terminate = (signal) => {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        try { child.kill(signal) } catch (fallbackError) { retainError(fallbackError) }
      }
    }
  }
  const requestTermination = (reason) => {
    if (reason !== undefined) retainError(reason)
    if (terminationRequested) return
    terminationRequested = true
    terminate('SIGTERM')
    terminationTimer = setTimeout(() => {
      terminationTimer = null
      terminate('SIGKILL')
    }, settings.terminationGraceMs)
  }

  child.stdout?.on('data', (chunk) => {
    if (stdout.append(chunk)) {
      retainError(`Owned process output exceeded the ${settings.maxOutputBytes}-byte capture limit.`)
      requestTermination()
    }
  })
  child.stderr?.on('data', (chunk) => {
    if (stderr.append(chunk)) {
      retainError(`Owned process output exceeded the ${settings.maxOutputBytes}-byte capture limit.`)
      requestTermination()
    }
  })
  child.once('error', (error) => { retainError(error) })

  const startObservation = () => {
    if (typeof settings.observe !== 'function' || observationFailed || processExited || observeBusy || runFinished) return
    observeBusy = true
    void (async () => {
      try {
        const value = await settings.observe({ pid: child.pid })
        if (!runFinished && value !== undefined) observationResults.push(value)
      } catch (error) {
        if (!runFinished) {
          observationFailed = true
          const message = error instanceof Error ? error.message : String(error)
          observationErrors.push(message.slice(0, 512))
          requestTermination(`Owned process observation failed: ${message.slice(0, 512)}`)
        }
      } finally {
        observeBusy = false
      }
    })()
  }
  let resolveClose
  const closePromise = new Promise((resolve) => { resolveClose = resolve })
  child.once('close', (exitCode, signal) => {
    processExited = true
    resolveClose({ exitCode, signal })
  })
  let resolveHardTimeout
  const hardTimeoutPromise = new Promise((resolve) => { resolveHardTimeout = resolve })
  timeoutTimer = setTimeout(() => {
    timedOut = true
    requestTermination(`Owned process exceeded the ${settings.timeoutMs}-ms timeout.`)
  }, settings.timeoutMs)
  hardTimer = setTimeout(() => {
    timedOut = true
    requestTermination(`Owned process exceeded the ${settings.timeoutMs}-ms timeout.`)
    terminate('SIGKILL')
    resolveHardTimeout({ exitCode: null, signal: 'SIGKILL' })
  }, settings.timeoutMs + settings.terminationGraceMs + settings.cleanupTimeoutMs)
  const observeTimer = typeof settings.observe === 'function'
    ? setInterval(startObservation, settings.observeIntervalMs)
    : null
  startObservation()
  const terminal = await Promise.race([closePromise, hardTimeoutPromise])
  if (timeoutTimer !== null) clearTimeout(timeoutTimer)
  if (hardTimer !== null) clearTimeout(hardTimer)
  if (observeTimer !== null) clearInterval(observeTimer)
  if (observeBusy) {
    observationFailed = true
    observationErrors.push('Owned process observation did not complete before process exit.')
  }
  runFinished = true
  if (observationErrors.length > 0) retainError(`Owned process observation failed: ${observationErrors[0]}`)
  if (timedOut) retainError(`Owned process exceeded the ${settings.timeoutMs}-ms timeout.`)
  if (stdout.overflowed || stderr.overflowed) retainError(`Owned process output exceeded the ${settings.maxOutputBytes}-byte capture limit.`)
  if (terminal.signal !== null && processError === null) retainError(`Owned process terminated by ${terminal.signal}.`)

  const ownedPidsAfterExit = await cleanupOwnedProcess(child.pid, {
    terminate,
    requestTermination,
    terminationRequested: () => terminationRequested,
  }, settings)
  if (terminationTimer !== null) clearTimeout(terminationTimer)
  if (ownedPidsAfterExit.length > 0) retainError('Owned process group retained processes after bounded cleanup.')
  return Object.freeze({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    outputOverflowed: stdout.overflowed || stderr.overflowed,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    timedOut,
    processError,
    observationResults,
    observationErrors,
    ownedPidsAfterExit,
    descendantsAfterExit: ownedPidsAfterExit,
    zeroDescendantsAfterRun: ownedPidsAfterExit.length === 0,
  })
}

/** Enumerate descendants and same-process-group members of an owned process. */
export async function listOwnedProcessPids(rootPid) {
  if (process.platform === 'win32' || !Number.isInteger(rootPid) || rootPid <= 0) return []
  const processes = await readProcessTable()
  const root = processes.find((entry) => entry.pid === rootPid)
  const processGroup = root?.processGroup ?? rootPid
  const owned = new Set(root === undefined ? [] : [rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const item of processes) {
      if (owned.has(item.parent) && !owned.has(item.pid)) {
        owned.add(item.pid)
        changed = true
      }
    }
  }
  for (const item of processes) if (item.processGroup === processGroup) owned.add(item.pid)
  return [...owned].sort((left, right) => left - right)
}

/** Validate the private bounded options accepted by reviewed callers. */
function validateOptions(options) {
  if (options === null || typeof options !== 'object') throw new Error('Owned process options are required.')
  if (typeof options.file !== 'string' || !path.isAbsolute(options.file)) throw new Error('Owned process file must be absolute.')
  if (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== 'string')) throw new Error('Owned process args must be fixed strings.')
  if (typeof options.cwd !== 'string' || !path.isAbsolute(options.cwd)) throw new Error('Owned process cwd must be absolute.')
  const positiveInteger = (value, fallback) => value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : null
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
  const cleanupTimeoutMs = positiveInteger(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS)
  const terminationGraceMs = positiveInteger(options.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS)
  const observeIntervalMs = positiveInteger(options.observeIntervalMs, DEFAULT_OBSERVE_INTERVAL_MS)
  if ([timeoutMs, maxOutputBytes, cleanupTimeoutMs, terminationGraceMs, observeIntervalMs].some((value) => value === null)) {
    throw new Error('Owned process bounds must be positive safe integers.')
  }
  return {
    file: options.file,
    args: [...options.args],
    cwd: options.cwd,
    env: { ...(options.env ?? process.env) },
    timeoutMs,
    maxOutputBytes,
    cleanupTimeoutMs,
    terminationGraceMs,
    observeIntervalMs,
    observe: options.observe,
  }
}

/** Retain at most the configured number of output bytes while continuing to drain the pipe. */
function boundedOutput(maxBytes) {
  let bytes = 0
  let overflowed = false
  const chunks = []
  return {
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxBytes - bytes
      if (bytes < maxBytes) {
        const retained = value.subarray(0, remaining)
        chunks.push(retained)
        bytes += retained.byteLength
      }
      if (value.byteLength > remaining) overflowed = true
      return overflowed
    },
    toString() { return Buffer.concat(chunks, bytes).toString('utf8') },
    get overflowed() { return overflowed },
  }
}

/** Remove every process still belonging to the owned group after parent exit. */
async function cleanupOwnedProcess(rootPid, controls, settings) {
  const cleanupDeadline = Date.now() + settings.cleanupTimeoutMs
  let owned = await listOwnedProcessPids(rootPid)
  if (owned.length === 0) return owned
  if (!controls.terminationRequested()) controls.requestTermination()
  const graceDeadline = Date.now() + settings.terminationGraceMs
  while (owned.length > 0 && Date.now() < graceDeadline && Date.now() < cleanupDeadline) {
    await delay(Math.min(50, settings.terminationGraceMs))
    owned = await listOwnedProcessPids(rootPid)
  }
  if (owned.length > 0) controls.terminate('SIGKILL')
  while (owned.length > 0 && Date.now() < cleanupDeadline) {
    await delay(Math.min(50, settings.terminationGraceMs))
    owned = await listOwnedProcessPids(rootPid)
  }
  return owned
}

/** Read the small process table fields needed for ancestry and group ownership. */
async function readProcessTable() {
  if (process.platform === 'darwin') {
    const { stdout } = await execFile('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    return stdout.split('\n').map((line) => line.trim().split(/\s+/u).map(Number))
      .filter((fields) => fields.length === 3 && fields.every((value) => Number.isInteger(value) && value > 0))
      .map(([pid, parent, processGroup]) => ({ pid, parent, processGroup }))
  }
  const processes = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/u.test(name)) continue
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8')
      const closing = stat.lastIndexOf(')')
      const fields = stat.slice(closing + 2).trim().split(' ')
      processes.push({ pid: Number(name), parent: Number(fields[1]), processGroup: Number(fields[2]) })
    } catch {
      // A process may exit between procfs enumeration and stat read.
    }
  }
  return processes
}

/** Wait without blocking beyond a bounded process interval. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
