import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000
const DEFAULT_TERMINATION_GRACE_MS = 5_000
const DEFAULT_OBSERVE_INTERVAL_MS = 250
const MAX_PROTOCOL_BYTES = 128 * 1024
export const MAX_OWNED_PROCESS_STDIN_BYTES = 16 * 1024 * 1024
const SUPERVISOR_SCHEMA = 'sartracker-owned-process-v1'
const SUPERVISOR_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'owned-process-supervisor.py')

/**
 * Run a reviewed direct command behind the Linux subreaper supervisor.
 *
 * The returned cleanup proof is positive only when the supervisor's private
 * fd3 protocol reports a complete cleanup after the producer has exited. The
 * old process-table polling path is intentionally not used for qualification.
 *
 * @param {object} options bounded process options
 * @returns {Promise<object>} retained process result and cleanup evidence
 */
export async function runOwnedProcess(options) {
  const settings = validateOptions(options)
  const unavailable = ownedProcessUnavailableReason({ platform: process.platform, environment: settings.env })
  if (unavailable !== null) return unavailableResult(unavailable)

  const child = spawn('python3', [
    SUPERVISOR_PATH,
    '--cwd', settings.cwd,
    '--termination-grace-ms', String(settings.terminationGraceMs),
    '--cleanup-timeout-ms', String(settings.cleanupTimeoutMs),
    '--runtime-timeout-ms', String(settings.timeoutMs),
    '--controller-pid', String(process.pid),
    '--', settings.file, ...settings.args,
  ], {
    cwd: settings.cwd,
    env: settings.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  })
  const stdout = boundedOutput(settings.maxOutputBytes)
  const stderr = boundedOutput(settings.maxOutputBytes)
  const protocol = createProtocolState()
  const observationResults = []
  const observationErrors = []
  let observationFailed = false
  let processError = null
  let timedOut = false
  let terminationRequested = false
  let hardTimedOut = false
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
      process.kill(child.pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') retainError(error)
    }
  }
  const requestTermination = (reason) => {
    if (reason !== undefined) retainError(reason)
    if (terminationRequested) return
    terminationRequested = true
    terminate('SIGTERM')
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
  child.once('error', (error) => {
    retainError(`Owned supervisor launch failed: ${error.message}`)
    requestTermination()
  })
  child.stdin?.end(settings.stdinBytes, (error) => {
    if (error) {
      retainError(`Owned process input failed: ${error.message}`)
      requestTermination()
    }
  })
  child.stdio[3]?.on('data', (chunk) => {
    if (!protocol.append(chunk)) {
      retainError('Owned supervisor protocol exceeded its bounded capture limit.')
      requestTermination()
    }
  })
  child.stdio[3]?.once('error', (error) => {
    protocol.errors.push(`Owned supervisor protocol failed: ${error.message}`)
    retainError(protocol.errors.at(-1))
    requestTermination()
  })

  const startObservation = () => {
    if (typeof settings.observe !== 'function' || protocol.producerPid === null || observationFailed || processExited || observeBusy || runFinished) return
    observeBusy = true
    void (async () => {
      try {
        const value = await settings.observe({ pid: protocol.producerPid })
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
    resolveClose({ exitCode, signal, hardTimeout: false })
  })
  let resolveHardTimeout
  const hardTimeoutPromise = new Promise((resolve) => { resolveHardTimeout = resolve })
  timeoutTimer = setTimeout(() => {
    timedOut = true
    requestTermination(`Owned process exceeded the ${settings.timeoutMs}-ms timeout.`)
  }, settings.timeoutMs)
  hardTimer = setTimeout(() => {
    timedOut = true
    hardTimedOut = true
    requestTermination(`Owned process exceeded the ${settings.timeoutMs}-ms timeout and bounded supervisor cleanup did not complete.`)
    terminate('SIGKILL')
    resolveHardTimeout({ exitCode: null, signal: 'SIGKILL', hardTimeout: true })
  }, settings.timeoutMs + settings.terminationGraceMs + settings.cleanupTimeoutMs)
  const observeTimer = typeof settings.observe === 'function'
    ? setInterval(startObservation, settings.observeIntervalMs)
    : null
  const controllerSignals = ['SIGTERM', 'SIGINT'].map((signalName) => {
    const handler = () => requestTermination(`Owned process controller received ${signalName}.`)
    process.once(signalName, handler)
    return [signalName, handler]
  })
  startObservation()
  const terminal = await Promise.race([closePromise, hardTimeoutPromise])
  if (timeoutTimer !== null) clearTimeout(timeoutTimer)
  if (hardTimer !== null) clearTimeout(hardTimer)
  if (observeTimer !== null) clearInterval(observeTimer)
  for (const [signalName, handler] of controllerSignals) process.removeListener(signalName, handler)
  if (observeBusy) {
    observationFailed = true
    observationErrors.push('Owned process observation did not complete before process exit.')
  }
  runFinished = true
  protocol.finish()
  const supervisorDeadlineExceeded = protocol.complete?.deadlineExceeded === true || protocol.complete?.timedOut === true
  if (supervisorDeadlineExceeded) timedOut = true
  if (observationErrors.length > 0) retainError(`Owned process observation failed: ${observationErrors[0]}`)
  if (timedOut) retainError(hardTimedOut
    ? `Owned process exceeded the ${settings.timeoutMs}-ms timeout and bounded supervisor cleanup did not complete.`
    : `Owned process exceeded the ${settings.timeoutMs}-ms timeout.`)
  if (stdout.overflowed || stderr.overflowed) retainError(`Owned process output exceeded the ${settings.maxOutputBytes}-byte capture limit.`)
  if (terminal.signal !== null && processError === null) retainError(`Owned supervisor terminated by ${terminal.signal}.`)

  if (protocol.errors.length > 0) retainError(protocol.errors[0])
  if (protocol.complete === null) retainError('Owned supervisor did not provide a complete cleanup protocol result.')
  if (protocol.complete !== null && protocol.complete.cleanupVerified !== true) retainError(protocol.complete.error ?? 'Owned supervisor could not positively verify descendant cleanup.')
  if (protocol.complete !== null && protocol.complete.remainingPids.length > 0) retainError('Owned supervisor retained processes after bounded cleanup.')
  if (protocol.complete?.signal !== null && processError === null) retainError(`Owned producer terminated by ${protocol.complete.signal}.`)
  if (hardTimedOut) retainError('Owned supervisor hard timeout prevented a positive cleanup proof.')

  const ownedPidsAfterExit = protocol.complete?.remainingPids ?? []
  const cleanupVerified = terminal.hardTimeout !== true && protocol.complete?.cleanupVerified === true
  return Object.freeze({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    outputOverflowed: stdout.overflowed || stderr.overflowed,
    exitCode: protocol.complete?.exitCode ?? null,
    signal: protocol.complete?.signal ?? terminal.signal,
    timedOut,
    processError,
    observationResults,
    observationErrors,
    ownedPidsAfterExit,
    descendantsAfterExit: ownedPidsAfterExit,
    cleanupVerified,
    zeroDescendantsAfterRun: cleanupVerified && ownedPidsAfterExit.length === 0,
    producerPid: protocol.producerPid,
    supervisorPid: child.pid ?? null,
  })
}

/** Return whether the strict Linux supervisor can be launched. */
export function ownedProcessUnavailableReason({ platform = process.platform, environment = process.env } = {}) {
  if (platform !== 'linux') return `Owned process supervisor unavailable on ${platform}; strict qualification requires Linux subreaper support.`
  if (!hasCommand('python3', environment?.PATH)) return 'Owned process supervisor unavailable: python3 is required for Linux subreaper ownership proof.'
  return null
}

/** Enumerate process-table descendants for diagnostics only; qualification uses the supervisor proof. */
export async function listOwnedProcessPids(rootPid) {
  if (process.platform === 'win32' || !Number.isInteger(rootPid) || rootPid <= 0) return []
  const processes = await readProcessTable()
  const owned = new Set(processes.filter((entry) => entry.parent === rootPid).map((entry) => entry.pid))
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
  return [...owned].sort((left, right) => left - right)
}

/** Validate the private bounded options accepted by reviewed callers. */
function validateOptions(options) {
  if (options === null || typeof options !== 'object') throw new Error('Owned process options are required.')
  if (typeof options.file !== 'string' || !path.isAbsolute(options.file)) throw new Error('Owned process file must be absolute.')
  if (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== 'string')) throw new Error('Owned process args must be fixed strings.')
  if (typeof options.cwd !== 'string' || !path.isAbsolute(options.cwd)) throw new Error('Owned process cwd must be absolute.')
  if (options.stdinBytes !== undefined && typeof options.stdinBytes !== 'string' && !Buffer.isBuffer(options.stdinBytes)) throw new Error('Owned process stdinBytes must be a string or Buffer.')
  const stdinBytes = options.stdinBytes === undefined ? Buffer.alloc(0) : Buffer.from(options.stdinBytes)
  if (stdinBytes.byteLength > MAX_OWNED_PROCESS_STDIN_BYTES) throw new Error(`Owned process stdinBytes exceeds the ${MAX_OWNED_PROCESS_STDIN_BYTES}-byte limit.`)
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
    stdinBytes,
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

/** Track and validate the bounded fd3 protocol. */
function createProtocolState() {
  return {
    buffer: '',
    bytes: 0,
    producerPid: null,
    complete: null,
    errors: [],
    ended: false,
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      this.bytes += Buffer.byteLength(value)
      if (this.bytes > MAX_PROTOCOL_BYTES) return false
      this.buffer += value
      let newline
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (!this.parse(line)) return false
      }
      return true
    },
    parse(line) {
      if (Buffer.byteLength(line) > MAX_PROTOCOL_BYTES) return false
      let record
      try { record = JSON.parse(line) } catch { this.errors.push('Owned supervisor protocol contained malformed JSON.'); return false }
      if (!record || record.schema !== SUPERVISOR_SCHEMA || typeof record.event !== 'string') {
        this.errors.push('Owned supervisor protocol schema is invalid.')
        return false
      }
      if (record.event === 'started') {
        if (this.producerPid !== null || !Number.isSafeInteger(record.producerPid) || record.producerPid <= 0 || !Number.isSafeInteger(record.producerStartTicks) || record.producerStartTicks <= 0) {
          this.errors.push('Owned supervisor started protocol is invalid.')
          return false
        }
        this.producerPid = record.producerPid
        return true
      }
      if (record.event === 'error') {
        this.errors.push(typeof record.message === 'string' ? record.message.slice(0, 512) : 'Owned supervisor failed before completion.')
        return true
      }
      if (record.event === 'complete') {
        if (this.complete !== null || !Array.isArray(record.remainingPids) || record.remainingPids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
            || typeof record.cleanupVerified !== 'boolean'
            || typeof record.timedOut !== 'boolean'
            || typeof record.deadlineExceeded !== 'boolean'
            || (record.exitCode !== null && !Number.isSafeInteger(record.exitCode))
            || (record.signal !== null && typeof record.signal !== 'string')) {
          this.errors.push('Owned supervisor completion protocol is invalid.')
          return false
        }
        this.complete = {
          exitCode: record.exitCode,
          signal: record.signal,
          cleanupVerified: record.cleanupVerified,
          timedOut: record.timedOut,
          deadlineExceeded: record.deadlineExceeded,
          remainingPids: [...record.remainingPids],
          error: typeof record.error === 'string' ? record.error.slice(0, 512) : null,
        }
        return true
      }
      this.errors.push(`Owned supervisor emitted unknown protocol event ${record.event}.`)
      return false
    },
    finish() {
      this.ended = true
      if (this.buffer.length > 0) this.errors.push('Owned supervisor protocol ended with an unterminated line.')
    },
  }
}

/** Return a no-launch result when strict ownership is unavailable. */
function unavailableResult(reason) {
  return Object.freeze({
    stdout: '', stderr: '', outputOverflowed: false, exitCode: null, signal: null, timedOut: false,
    processError: reason, observationResults: [], observationErrors: [], ownedPidsAfterExit: [],
    descendantsAfterExit: [], cleanupVerified: false, zeroDescendantsAfterRun: false,
    producerPid: null, supervisorPid: null,
  })
}

/** Check executable PATH entries without launching the candidate. */
function hasCommand(command, environmentPath = process.env.PATH) {
  for (const directory of String(environmentPath ?? '').split(path.delimiter).filter(Boolean)) {
    try { accessSync(path.join(directory, command), constants.X_OK); return true } catch { /* Try the next PATH entry. */ }
  }
  return false
}

/** Read the small process table fields needed by the diagnostic helper. */
async function readProcessTable() {
  if (process.platform === 'darwin') return []
  const processes = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/u.test(name)) continue
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8')
      const closing = stat.lastIndexOf(')')
      const fields = stat.slice(closing + 2).trim().split(/\s+/u)
      processes.push({ pid: Number(name), parent: Number(fields[1]) })
    } catch {
      // A process may exit between procfs enumeration and stat read.
    }
  }
  return processes
}
