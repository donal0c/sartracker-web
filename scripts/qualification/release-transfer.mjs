import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { open, rm } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_TERMINATION_GRACE_MS = 5_000
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000

/**
 * Stream one fixed direct-child command into an exclusive file while hashing
 * and enforcing the exact expected byte count. The child is detached into an
 * owned process group so timeout, output and write failures terminate and reap
 * descendants before the file is removed.
 *
 * @param {object|string} options transfer options, or legacy command string
 * @param {string[]} legacyArgs legacy direct argument list
 * @param {string} legacyDestination legacy destination path
 * @param {number} legacyExpectedBytes legacy exact byte count
 * @returns {Promise<object>} exact transfer facts and cleanup evidence
 */
export async function streamCommandToFile(options, legacyArgs, legacyDestination, legacyExpectedBytes) {
  const settings = validateOptions(typeof options === 'string'
    ? { command: options, args: legacyArgs, destination: legacyDestination, expectedBytes: legacyExpectedBytes }
    : options)
  let handle
  let child
  let failure
  let result
  let destinationOwned = false
  try {
    handle = await open(settings.destination, 'wx', 0o600)
    destinationOwned = true
    child = spawn(settings.command, settings.args, {
      cwd: settings.cwd,
      env: settings.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    result = await runChildTransfer(child, handle, settings)
    if (result.error !== null) failure = result.error
    if (!result.zeroDescendantsAfterRun) failure ??= new Error('Release transfer producer cleanup failed.')
    if (failure === undefined && result.exitCode !== 0) failure = new Error('Release transfer producer exited unsuccessfully.')
    if (failure === undefined && result.bytes !== settings.expectedBytes) {
      failure = new Error(`Downloaded release asset has ${result.bytes} bytes; expected ${settings.expectedBytes}.`)
    }
    if (failure === undefined) await handle.sync()
  } catch (error) {
    failure = failure ?? error
  } finally {
    if (handle !== undefined) {
      try { await handle.close() } catch (error) { failure = failure ?? error }
    }
    if (failure !== undefined && destinationOwned) await rm(settings.destination, { force: true }).catch(() => undefined)
  }
  if (failure !== undefined) throw safeTransferError(failure)
  return Object.freeze({
    bytes: result.bytes,
    sha256: result.sha256,
    zeroDescendantsAfterRun: result.zeroDescendantsAfterRun,
    ownedPidsAfterExit: result.ownedPidsAfterExit,
  })
}

/** Run one producer with paused stdout writes and bounded owned-group cleanup. */
function runChildTransfer(child, handle, settings) {
  const digest = createHash('sha256')
  let bytes = 0
  let queue = Promise.resolve()
  let failure = null
  let closed = false
  let terminationRequested = false
  let forceTimer
  let timeoutTimer
  let closeResolve
  const closePromise = new Promise((resolve) => { closeResolve = resolve })

  const signalGroup = (signal) => {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        try { child.kill(signal) } catch { /* close/error will report the producer failure */ }
      }
    }
  }
  const requestTermination = (reason) => {
    if (failure === null) failure = reason instanceof Error ? reason : new Error(String(reason))
    if (terminationRequested) return
    terminationRequested = true
    signalGroup('SIGTERM')
    forceTimer = setTimeout(() => signalGroup('SIGKILL'), settings.terminationGraceMs)
  }
  const enqueue = (chunk) => {
    child.stdout.pause()
    queue = queue.then(async () => {
      if (failure !== null) return
      bytes += chunk.byteLength
      if (bytes > settings.expectedBytes) throw new Error('Release transfer exceeded its configured byte bound.')
      digest.update(chunk)
      await handle.writeFile(chunk)
    }).catch((error) => requestTermination(error)).finally(() => {
      if (!closed && failure === null) child.stdout.resume()
    })
  }
  child.stdout.on('data', enqueue)
  child.stdout.once('error', (error) => requestTermination(error))
  child.stderr.on('data', () => { /* Drain stderr without retaining command output or credentials. */ })
  child.once('error', (error) => requestTermination(error))
  child.once('close', (exitCode, signal) => {
    closed = true
    closeResolve({ exitCode, signal })
  })
  timeoutTimer = setTimeout(() => requestTermination(new Error('Release asset transfer exceeded its deadline.')), settings.timeoutMs)

  return (async () => {
    let closeInfo = await waitForClose(closePromise, settings.timeoutMs + settings.terminationGraceMs + settings.cleanupTimeoutMs)
    if (closeInfo === null) {
      requestTermination(new Error('Release asset transfer exceeded its cleanup deadline.'))
      signalGroup('SIGKILL')
      closeInfo = await waitForClose(closePromise, settings.cleanupTimeoutMs)
    }
    clearTimeout(timeoutTimer)
    if (forceTimer !== undefined) clearTimeout(forceTimer)
    await queue
    const cleanup = await cleanupProcessGroup(child.pid, signalGroup, settings)
    const finalError = failure
      ?? (closeInfo === null ? new Error('Release transfer producer did not terminate.') : null)
      ?? (closeInfo.signal !== null ? new Error('Release transfer producer was terminated.') : null)
    return {
      error: finalError,
      exitCode: closeInfo?.exitCode ?? null,
      bytes,
      sha256: digest.digest('hex'),
      zeroDescendantsAfterRun: cleanup.zeroDescendantsAfterRun,
      ownedPidsAfterExit: cleanup.ownedPidsAfterExit,
    }
  })()
}

/** Wait for an owned child close event without allowing an unbounded hang. */
async function waitForClose(closePromise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    closePromise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

/** Terminate any process left in the detached producer group, escalating once. */
async function cleanupProcessGroup(pid, signalGroup, settings) {
  if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) return { zeroDescendantsAfterRun: true, ownedPidsAfterExit: [] }
  if (!groupAlive(pid)) return { zeroDescendantsAfterRun: true, ownedPidsAfterExit: [] }
  signalGroup('SIGTERM')
  await waitForGroupExit(pid, settings.terminationGraceMs)
  if (groupAlive(pid)) signalGroup('SIGKILL')
  await waitForGroupExit(pid, settings.cleanupTimeoutMs)
  const alive = groupAlive(pid)
  return { zeroDescendantsAfterRun: !alive, ownedPidsAfterExit: alive ? [pid] : [] }
}

/** Wait for a process group to disappear. */
async function waitForGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (groupAlive(pid) && Date.now() < deadline) await delay(25)
}

/** Check a detached process group without inspecting its command or environment. */
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
}

/** Validate the fixed direct-process and destination bounds. */
function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Release transfer options are required.')
  if (typeof options.command !== 'string' || options.command.trim() === '') throw new Error('Release transfer command is required.')
  if (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== 'string')) throw new Error('Release transfer arguments must be fixed strings.')
  if (typeof options.destination !== 'string' || !path.isAbsolute(options.destination)) throw new Error('Release transfer destination must be absolute.')
  if (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes < 0) throw new Error('Release transfer expected bytes must be a non-negative safe integer.')
  const positive = (value, fallback) => value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : null
  const timeoutMs = positive(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const terminationGraceMs = positive(options.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS)
  const cleanupTimeoutMs = positive(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS)
  if ([timeoutMs, terminationGraceMs, cleanupTimeoutMs].some((value) => value === null)) throw new Error('Release transfer time bounds must be positive safe integers.')
  const cwd = options.cwd ?? process.cwd()
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Release transfer cwd must be absolute.')
  return {
    command: options.command,
    args: [...options.args],
    destination: path.resolve(options.destination),
    expectedBytes: options.expectedBytes,
    cwd,
    env: { ...(options.env ?? process.env) },
    timeoutMs,
    terminationGraceMs,
    cleanupTimeoutMs,
  }
}

/** Bound producer failures without echoing stderr or arbitrary command output. */
function safeTransferError(error) {
  const message = error instanceof Error ? error.message : ''
  if (/already exists|EEXIST|exclusive/iu.test(message)) return new Error('Release transfer destination already exists.')
  if (/configured byte bound/iu.test(message)) return new Error('Release transfer exceeded its configured byte bound.')
  if (/has \d+ bytes|expected \d+|bytes/iu.test(message)) return new Error(message.replace(/\d+/gu, '<count>').slice(0, 200))
  if (/deadline|timeout/iu.test(message)) return new Error('Release asset transfer exceeded its deadline.')
  if (/producer|terminated|cleanup/iu.test(message)) return new Error('Release transfer producer cleanup failed.')
  return new Error('Release transfer failed.')
}

/** Sleep without blocking the event loop. */
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
