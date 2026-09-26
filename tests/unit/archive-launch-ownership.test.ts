import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanupArchiveLifecycleResources } from '../../scripts/electron-archive-lifecycle-smoke.mjs'
import { startArchiveLaunch } from '../../scripts/qualification/archive-launch.mjs'

/** Waits for the disposable descendant handshake, never a timing assumption. */
async function readHandshake(file: string): Promise<number[]> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')) as number[] } catch {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new Error('Disposable descendant handshake timed out.')
}

/** Signals only a test-created process; missing processes are already stopped. */
function killFixture(pid: number | undefined): void {
  if (pid === undefined) return
  try { process.kill(pid, 'SIGKILL') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

describe('archive launch ownership', () => {
  it('rejects wrapper-only cleanup while child and grandchild survive, preserving an unrelated sentinel', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sar-owned-launch-'))
    const handshake = path.join(root, 'pids.json')
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    let wrapper: ChildProcess | undefined
    let descendants: number[] = []
    try {
      const childCode = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(handshake)},JSON.stringify([process.pid,c.pid])); setInterval(()=>{},1000)`
      wrapper = spawn(process.execPath, ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); setInterval(()=>{},1000)`], { stdio: 'ignore' })
      descendants = await readHandshake(handshake)
      const exited = once(wrapper, 'exit')
      wrapper.kill('SIGKILL')
      await exited
      for (const pid of descendants) expect(() => process.kill(pid, 0)).not.toThrow()
      let profileRemoved = false
      const cleanup = await cleanupArchiveLifecycleResources({
        failure: null,
        profilePath: root,
        removeProfile: async () => { profileRemoved = true },
        steps: [{
          name: 'initial_launch_stop', blocksProfileCleanup: true,
          // This is the old stopLaunch result: wrapper exit without descendant proof.
          run: async () => ({ code: null, signal: 'SIGKILL' }),
        }],
      })
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow()
      expect(cleanup.processCleanupCompleted).toBe(false)
      expect(profileRemoved).toBe(false)
    } finally {
      for (const pid of descendants.reverse()) killFixture(pid)
      if (wrapper?.exitCode === null && wrapper.signalCode === null) killFixture(wrapper.pid)
      killFixture(sentinel.pid)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds and SIGKILLs the actual direct main, with positive cleanup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sar-direct-launch-'))
    const handshake = path.join(root, 'pids.json')
    const launch = startArchiveLaunch(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(handshake)},JSON.stringify([process.pid]));setInterval(()=>{},1000)`], { cwd: process.cwd(), env: process.env })
    try {
      const [pid] = await readHandshake(handshake)
      await launch.bindMain(pid)
      const result = await launch.interrupt()
      expect(result.signal).toBe('SIGKILL')
      expect(result.cleanupVerified).toBe(true)
    } finally {
      await launch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans a partially ready launch without requiring main binding', async () => {
    const launch = startArchiveLaunch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: process.cwd(), env: process.env })
    try {
      // Discarded app diagnostics must not create an inherited controller pipe
      // that an externally launched viewer could hold open after owned exit.
      expect(launch.process.stderr).toBe(null)
    } finally {
      expect((await launch.stop()).cleanupVerified).toBe(true)
    }
  })

  it('runs the platform-independent supervisor identity controls', async () => {
    const child = spawn('python3', ['-B', 'tests/unit/archive-launch-supervisor-regression.py'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const [code] = await once(child, 'close')
    expect(stderr).toContain('OK')
    expect(code).toBe(0)
  })

  it.skipIf(process.platform !== 'darwin')('rejects a wrapper main on macOS and cleans its dedicated group', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sar-mac-wrapper-'))
    const handshake = path.join(root, 'pids.json')
    const mainCode = `require('node:fs').writeFileSync(${JSON.stringify(handshake)},JSON.stringify([process.pid]));setInterval(()=>{},1000)`
    const launch = startArchiveLaunch(process.execPath, ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(mainCode)}],{stdio:'ignore'});setInterval(()=>{},1000)`], { cwd: process.cwd(), env: process.env })
    try {
      const [pid] = await readHandshake(handshake)
      await expect(launch.bindMain(pid)).rejects.toThrow(/did not match/)
      expect((await launch.stop()).cleanupVerified).toBe(true)
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await launch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never binds an unrelated sentinel as the main process', async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    const launch = startArchiveLaunch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: process.cwd(), env: process.env })
    try {
      await expect(launch.bindMain(sentinel.pid)).rejects.toThrow()
      if (process.platform === 'linux') await expect(launch.stop()).rejects.toThrow(/cleanup/)
      else await launch.stop()
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow()
    } finally {
      try { await launch.stop() } catch { /* Rejected binding retains an invalid proof. */ }
      killFixture(sentinel.pid)
    }
  })

  it.skipIf(process.platform !== 'linux')('interrupts the bound child main through its wrapper and removes its grandchild', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sar-linux-wrapper-'))
    const handshake = path.join(root, 'pids.json')
    const mainCode = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(handshake)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`
    const launch = startArchiveLaunch(process.execPath, ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(mainCode)}],{stdio:'ignore'});setInterval(()=>{},1000)`], { cwd: process.cwd(), env: process.env })
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    try {
      const [main, grandchild] = await readHandshake(handshake)
      await launch.bindMain(main)
      const result = await launch.interrupt()
      expect(result.signal).toBe('SIGKILL')
      expect(result.cleanupVerified).toBe(true)
      for (const pid of [main, grandchild]) expect(() => process.kill(pid, 0)).toThrow()
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow()
    } finally {
      await launch.stop()
      killFixture(sentinel.pid)
      await rm(root, { recursive: true, force: true })
    }
  })
})
