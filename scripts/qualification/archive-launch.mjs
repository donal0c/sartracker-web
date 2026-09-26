import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const supervisorPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'archive-launch-supervisor.py')

/** Apply a cleanup/control deadline without leaving a live timeout behind. */
async function bounded(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

/** Retain one launch's custody synchronously, before any readiness await. */
export function startArchiveLaunch(file, args, options) {
  if (process.platform === 'darwin') return startDirectMacLaunch(file, args, options)
  if (process.platform !== 'linux') throw new Error('Archive launch ownership is unsupported on this platform.')
  const child = spawn('python3', ['-B', supervisorPath,
    '--cwd', options.cwd, '--controller-pid', String(process.pid),
    '--runtime-timeout-ms', String(24 * 60 * 60 * 1000),
    '--termination-grace-ms', '5000', '--cleanup-timeout-ms', '10000',
    '--', file, ...args], { ...options, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  let launchError = null
  let protocolError = null
  let buffer = ''
  let bytes = 0
  let terminal = null
  let launcherIdentity = null
  let verifiedResult = null
  let mainIdentity = null
  let resolveBound
  const bound = new Promise(resolve => { resolveBound = resolve })
  let resolveExit
  const exit = new Promise(resolve => { resolveExit = resolve })
  child.once('error', error => { launchError = error })
  child.stdio[4].on('error', () => { protocolError = new Error('Archive ownership control pipe failed.') })
  child.stdio[3].on('data', chunk => {
    bytes += chunk.length
    if (bytes > 16384) { protocolError = new Error('Archive ownership evidence exceeded its bound.'); return }
    buffer += String(chunk)
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n')
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      try {
        const record = JSON.parse(line)
        if (record.schema !== 'sartracker-owned-process-v1') throw new Error('Invalid schema')
        if (record.event === 'started') {
          if (launcherIdentity !== null || !Number.isSafeInteger(record.producerPid) || record.producerPid <= 0
            || !Number.isSafeInteger(record.producerStartTicks) || record.producerStartTicks <= 0) throw new Error('Invalid launcher identity')
          launcherIdentity = Object.freeze({ pid: record.producerPid, startTicks: record.producerStartTicks })
        } else if (record.event === 'bound') {
          if (mainIdentity !== null || !Number.isSafeInteger(record.pid) || record.pid <= 0
            || !Number.isSafeInteger(record.startTicks) || record.startTicks <= 0) throw new Error('Invalid main identity')
          mainIdentity = Object.freeze({ pid: record.pid, startTicks: record.startTicks })
          resolveBound(mainIdentity)
        } else if (record.event === 'complete') {
          if (terminal !== null || !Array.isArray(record.remainingPids)) throw new Error('Invalid terminal evidence')
          terminal = record
        } else throw new Error('Supervisor failed')
      } catch { protocolError = new Error('Archive ownership evidence is invalid.') }
    }
  })
  child.once('close', (code, signal) => {
    if (buffer !== '') protocolError = new Error('Archive ownership evidence is incomplete.')
    resolveExit({ code, signal, terminal })
  })
  /** Send only the private, fixed command vocabulary to this launch. */
  function command(value) {
    if (launchError !== null) throw launchError
    if (protocolError !== null) throw protocolError
    if (child.exitCode !== null || child.signalCode !== null) return
    child.stdio[4].write(`${JSON.stringify(value)}\n`)
  }
  /** Require supervisor completion, not merely a wrapper exit event. */
  async function finish(interrupted) {
    const result = await bounded(exit, interrupted ? 30000 : 10000, 'Archive owned process cleanup timed out.')
    if (launchError !== null || protocolError !== null || result.signal !== null
      || terminal?.cleanupVerified !== true || terminal.remainingPids.length !== 0
      || terminal.error !== null) {
      throw new Error('Archive owned process cleanup could not be verified; retain the profile.')
    }
    if (interrupted && (terminal.error !== null || terminal.interrupted !== true
      || terminal.mainExit?.signal !== 'SIGKILL' || mainIdentity === null
      || terminal.mainIdentity?.pid !== mainIdentity.pid
      || terminal.mainIdentity?.startTicks !== mainIdentity.startTicks)) {
      throw new Error('Archive real-main SIGKILL was not verified.')
    }
    verifiedResult = Object.freeze({ code: terminal.mainExit?.code ?? null,
      signal: terminal.mainExit?.signal ?? null, cleanupVerified: true, mainIdentity })
    return verifiedResult
  }
  return {
    process: child,
    snapshot: () => ({ platform: 'linux', launcherIdentity, mainIdentity,
      cleanupVerified: verifiedResult?.cleanupVerified === true,
      mainExit: terminal?.mainExit ?? null, interrupted: terminal?.interrupted === true }),
    readLaunchError: () => launchError ?? protocolError,
    bindMain: async pid => {
      command({ command: 'bind', pid })
      const identity = await bounded(Promise.race([bound, exit.then(() => { throw new Error('Archive launch exited before main binding.') })]), 10000, 'Archive main binding timed out.')
      if (identity.pid !== pid) throw new Error('Archive main binding mismatched the inspector.')
      return identity
    },
    interrupt: async () => { command({ command: 'interrupt' }); return finish(true) },
    stop: async () => {
      // EOF still requests supervisor cleanup when an invalid reply makes the
      // result unusable. Never abandon a live child because proof parsing failed.
      if (protocolError !== null) child.stdio[4].end()
      else command({ command: 'stop' })
      return finish(false)
    },
  }
}

/** Keep macOS direct-executable proof separate from Linux subreaper proof. */
function startDirectMacLaunch(file, args, options) {
  const child = spawn(file, args, { ...options, detached: true, stdio: ['ignore', 'ignore', 'ignore'] })
  let launchError = null
  let mainBound = false
  let cleaned = null
  child.once('error', error => { launchError = error })
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  /** A dedicated group is never shared with the controller or another launch. */
  function groupExists() {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('Archive launch group identity unavailable.')
    try { process.kill(-child.pid, 0); return true } catch (error) {
      if (error.code === 'ESRCH') return false
      throw error
    }
  }
  /** Stop the dedicated native group, then require its disappearance. */
  async function stop() {
    if (cleaned !== null) return cleaned
    if (launchError !== null && child.pid === undefined) return { cleanupVerified: true, code: null, signal: null }
    const started = Date.now()
    while (groupExists()) {
      try { process.kill(-child.pid, Date.now() - started < 5000 ? 'SIGTERM' : 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
      if (Date.now() - started >= 10000) throw new Error('Archive native process group cleanup timed out.')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const result = await bounded(exit, 10000, 'Archive native main exit was not observed.')
    cleaned = Object.freeze({ ...result, cleanupVerified: true })
    return cleaned
  }
  return {
    process: child,
    snapshot: () => ({ platform: 'darwin', launcherIdentity: { pid: child.pid ?? null, directChild: true },
      mainIdentity: mainBound ? { pid: child.pid, directChild: true } : null,
      cleanupVerified: cleaned?.cleanupVerified === true,
      mainExit: cleaned === null ? null : { code: cleaned.code, signal: cleaned.signal } }),
    readLaunchError: () => launchError,
    bindMain: async pid => {
      if (pid !== child.pid || child.exitCode !== null || child.signalCode !== null) {
        throw new Error('Archive native inspector main did not match the owned executable.')
      }
      mainBound = true
      return { pid, directChild: true }
    },
    interrupt: async () => {
      if (!mainBound || !child.kill('SIGKILL')) throw new Error('Archive native main SIGKILL could not be requested.')
      const result = await bounded(exit, 30000, 'Archive native main SIGKILL exit was not observed.')
      await stop()
      if (result.signal !== 'SIGKILL') throw new Error('Archive native main did not exit with SIGKILL.')
      return cleaned
    },
    stop,
  }
}
