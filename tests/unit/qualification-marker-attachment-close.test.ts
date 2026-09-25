import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { closeMarkerAttachmentApplication } from '../../scripts/qualification/marker-attachment-close.mjs'
import { runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'

describe('C12 attachment handoff teardown', () => {
  it('finishes after Electron exits even when an external viewer retains its output pipes', async () => {
    const child = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const viewer = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], {
        stdio: ['ignore', 1, 2],
      });
      viewer.unref();
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    const exited = once(child, 'exit')
    const app = { process: () => child, close: async () => { await closed } }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const closing = closeMarkerAttachmentApplication(app).then(() => 'closed')
      await exited
      const outcome = await Promise.race([
        closing,
        new Promise((resolve) => { timer = setTimeout(() => resolve('still waiting for viewer pipes'), 1_000) }),
      ])
      expect(child.exitCode).toBe(0)
      expect(outcome).toBe('closed')
    } finally {
      clearTimeout(timer)
      await closed
    }
  })

  it('rejects an abnormal application exit even when Playwright close resolves', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    const app = { process: () => child, close: async () => { await closed } }
    await expect(closeMarkerAttachmentApplication(app)).rejects.toThrow(/exit.*7/iu)
  })

  it('does not release output pipes while the application is still running and preserves close errors', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null, signalCode: null,
      stdout: { destroy: vi.fn() }, stderr: { destroy: vi.fn() },
    })
    const failure = new Error('real app close failure')
    const app = { process: () => child, close: vi.fn().mockRejectedValue(failure) }
    await expect(closeMarkerAttachmentApplication(app)).rejects.toBe(failure)
    expect(child.stdout.destroy).not.toHaveBeenCalled()
    expect(child.stderr.destroy).not.toHaveBeenCalled()
    expect(child.listenerCount('exit')).toBe(1)
    Object.assign(child, { exitCode: 0 })
    child.emit('exit', 0, null)
    expect(child.stdout.destroy).toHaveBeenCalledOnce()
    expect(child.stderr.destroy).toHaveBeenCalledOnce()
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('rejects a resolved close without an observed process exit', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
    await expect(closeMarkerAttachmentApplication({ process: () => child, close: async () => {} }))
      .rejects.toThrow(/exit/iu)
  })

  it('rejects signal termination and handles an exit that precedes teardown registration', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null, signalCode: 'SIGTERM',
      stdout: { destroy: vi.fn() }, stderr: { destroy: vi.fn() },
    })
    await expect(closeMarkerAttachmentApplication({ process: () => child, close: async () => {} }))
      .rejects.toThrow(/SIGTERM/u)
    expect(child.stdout.destroy).toHaveBeenCalledOnce()
    expect(child.stderr.destroy).toHaveBeenCalledOnce()
    expect(child.listenerCount('exit')).toBe(0)
  })

  it.skipIf(process.platform !== 'linux')('lets the supervisor clean a persistent viewer after orderly application exit', async () => {
    const helper = pathToFileURL(path.resolve('scripts/qualification/marker-attachment-close.mjs')).href
    const applicationSource = `
      const { spawn } = require('node:child_process');
      const viewer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 1, 2],
      });
      viewer.unref();
    `
    const producerSource = `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { closeMarkerAttachmentApplication } from ${JSON.stringify(helper)};
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(applicationSource)}], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closed = once(child, 'close');
      await closeMarkerAttachmentApplication({ process: () => child, close: async () => { await closed; } });
    `
    const result = await runOwnedProcess({
      file: process.execPath, args: ['--input-type=module', '-e', producerSource],
      cwd: process.cwd(), env: process.env, timeoutMs: 5_000,
      terminationGraceMs: 100, cleanupTimeoutMs: 1_000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.processError).toBeNull()
    expect(result.zeroDescendantsAfterRun).toBe(true)
  }, 10_000)
})
