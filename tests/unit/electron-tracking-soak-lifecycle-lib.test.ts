import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  requestGracefulElectronQuit,
  runCleanupStep,
  startTrackingSoakSleepGuard,
  stopOwnedProcess,
} from '../../build/electron-tracking-soak-lifecycle-lib.js'

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kills: NodeJS.Signals[] = []
  onKill?: (signal: NodeJS.Signals) => void

  kill(signal: NodeJS.Signals) {
    this.kills.push(signal)
    this.onKill?.(signal)
    return true
  }
}

describe('tracking soak owned lifecycle [DON-260]', () => {
  it('requests Electron quit and proves a normal process exit', async () => {
    const child = new FakeChild()
    const expressions: string[] = []
    let closeCount = 0
    const mainInspector = {
      evaluate: async (expression: string) => {
        expressions.push(expression)
      },
      close: () => {
        closeCount += 1
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit', 0, null))
      },
    }

    await expect(requestGracefulElectronQuit(mainInspector, child, 50))
      .resolves.toEqual({
        exited: true,
        exitKind: 'code',
        forced: false,
        graceful: true,
      })
    expect(expressions).toHaveLength(1)
    expect(expressions[0]).toContain("require('electron').app.quit()")
    expect(closeCount).toBe(1)
    expect(child.kills).toEqual([])
  })

  it('fails closed when Electron does not complete graceful quit', async () => {
    const child = new FakeChild()
    let closeCount = 0
    const mainInspector = {
      evaluate: () => new Promise(() => undefined),
      close: () => {
        closeCount += 1
      },
    }

    await expect(requestGracefulElectronQuit(mainInspector, child, 1))
      .rejects.toMatchObject({
        trackingSoakLifecycleFailure: {
          failureClass: 'graceful_app_quit_failed',
        },
      })
    expect(closeCount).toBe(1)
    expect(child.kills).toEqual([])
  }, 100)

  it('starts a run-scoped Darwin sleep guard with the harness pid', async () => {
    const child = new FakeChild()
    const calls: unknown[][] = []
    const start = startTrackingSoakSleepGuard({
      platform: 'darwin',
      parentPid: 12345,
      spawnProcess: (...args: unknown[]) => {
        calls.push(args)
        queueMicrotask(() => child.emit('spawn'))
        return child
      },
      startupTimeoutMs: 50,
    })
    const guard = await start

    expect(calls[0]).toEqual([
      '/usr/bin/caffeinate',
      ['-dimsu', '-w', '12345'],
      { stdio: 'ignore' },
    ])
    expect(guard.snapshot()).toEqual({
      required: true,
      started: true,
      active: true,
      earlyExit: false,
      stopped: false,
      forced: false,
    })
    child.onKill = (signal) => {
      child.signalCode = signal
      queueMicrotask(() => child.emit('exit', null, signal))
    }
    const firstStop = guard.stop()
    const repeatedStop = guard.stop()
    expect(repeatedStop).toBe(firstStop)
    await firstStop
    expect(child.kills).toEqual(['SIGTERM'])
  })

  it('fails closed if the Darwin guard cannot spawn or exits early', async () => {
    const failed = new FakeChild()
    failed.onKill = (signal) => {
      failed.signalCode = signal
      queueMicrotask(() => failed.emit('exit', null, signal))
    }
    const startup = startTrackingSoakSleepGuard({
      platform: 'darwin',
      parentPid: 12345,
      spawnProcess: () => {
        queueMicrotask(() => failed.emit('error', new Error('raw spawn error')))
        return failed
      },
      startupTimeoutMs: 50,
    })
    await expect(startup).rejects.toThrow(/sleep guard/iu)
    expect(failed.kills).toEqual(['SIGTERM'])

    const exited = new FakeChild()
    const guardPromise = startTrackingSoakSleepGuard({
      platform: 'darwin',
      parentPid: 12345,
      spawnProcess: () => {
        queueMicrotask(() => exited.emit('spawn'))
        return exited
      },
      startupTimeoutMs: 50,
    })
    const guard = await guardPromise
    exited.exitCode = 1
    exited.emit('exit', 1, null)
    expect(() => guard.assertHealthy()).toThrow(/sleep guard/iu)
    expect(guard.snapshot()).toMatchObject({ active: false, earlyExit: true })
    await expect(guard.stop()).rejects.toThrow(/sleep guard/iu)

    const unkillable = new FakeChild()
    const unkillableStartup = startTrackingSoakSleepGuard({
      platform: 'darwin',
      parentPid: 12345,
      spawnProcess: () => {
        queueMicrotask(() => unkillable.emit('error', new Error('raw failure')))
        return unkillable
      },
      startupTimeoutMs: 50,
    })
    await expect(unkillableStartup).rejects.toMatchObject({
      trackingSoakLifecycleFailure: {
        failureClass: 'owned_process_cleanup_failed',
      },
    })
    expect(unkillable.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('treats signalCode as exited and shares repeated cleanup completion', async () => {
    const child = new FakeChild()
    child.onKill = (signal) => {
      child.signalCode = signal
      queueMicrotask(() => child.emit('exit', null, signal))
    }

    const first = stopOwnedProcess(child, {
      termTimeoutMs: 50,
      killTimeoutMs: 50,
    })
    const second = stopOwnedProcess(child, {
      termTimeoutMs: 50,
      killTimeoutMs: 50,
    })

    expect(second).toBe(first)
    await expect(first).resolves.toMatchObject({
      exited: true,
      exitKind: 'signal',
      forced: false,
    })
    expect(child.kills).toEqual(['SIGTERM'])
  })

  it('escalates TERM to KILL inside bounded waits', async () => {
    const child = new FakeChild()
    child.onKill = (signal) => {
      if (signal !== 'SIGKILL') return
      child.signalCode = signal
      queueMicrotask(() => child.emit('exit', null, signal))
    }

    await expect(stopOwnedProcess(child, {
      termTimeoutMs: 1,
      killTimeoutMs: 50,
    })).resolves.toMatchObject({
      exited: true,
      exitKind: 'signal',
      forced: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('fails closed when an owned process remains alive after KILL', async () => {
    const child = new FakeChild()

    await expect(stopOwnedProcess(child, {
      termTimeoutMs: 1,
      killTimeoutMs: 1,
    })).rejects.toThrow(/owned process/iu)
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('reports whether a best-effort cleanup step settled inside its deadline', async () => {
    await expect(runCleanupStep(async () => undefined, 50)).resolves.toBe(true)
    await expect(runCleanupStep(async () => {
      throw new Error('raw cleanup failure')
    }, 50)).resolves.toBe(false)
    await expect(runCleanupStep(() => new Promise(() => undefined), 1))
      .resolves.toBe(false)
  })
})
