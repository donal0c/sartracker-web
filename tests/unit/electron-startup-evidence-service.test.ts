import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createStartupEvidenceService } = require('../../electron/startup-evidence-service.cjs') as {
  readonly createStartupEvidenceService: (options: Record<string, unknown>) => StartupEvidenceService
}

type StartupEvidenceService = {
  readonly runtimeLog: {
    readonly append: (input: Record<string, unknown>) => Promise<void>
    readonly appendDurable: (input: Record<string, unknown>) => Promise<void>
    readonly readRecent: (limit?: number) => Promise<readonly unknown[]>
  }
  readonly crashLog: {
    readonly record: (input: Record<string, unknown>) => Promise<void>
    readonly recordDurably: (input: Record<string, unknown>) => Promise<void>
    readonly hadUncleanShutdown: () => Promise<boolean>
    readonly readRecent: (limit?: number) => Promise<readonly unknown[]>
    readonly markSessionStart: () => Promise<void>
    readonly markCleanExit: () => Promise<void>
  }
  readonly ready: Promise<void>
  readonly close: (options?: { readonly timeoutMs?: number }) => Promise<void>
  readonly terminate: () => Promise<void>
}

describe('Electron startup evidence service', () => {
  it('routes runtime and crash evidence through one utility process and drains it on close', async () => {
    const utility = createUtilityProcess()
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => utility.child) },
      workerPath: '/app/electron/startup-evidence-worker.cjs',
      killProcess: vi.fn(),
    }) as StartupEvidenceService

    await service.ready
    await service.runtimeLog.appendDurable({ event: 'startup_failure', fields: { stage: 'boot' } })
    await service.crashLog.record({ kind: 'startupFailure', summary: 'startup fault' })
    await service.crashLog.recordDurably({ kind: 'uncaughtException', summary: 'fatal fault' })
    await service.close({ timeoutMs: 100 })

    expect(utility.messages).toEqual([
      { id: 0, type: 'initialize', userDataPath: '/profile' },
      { id: 1, type: 'runtime.appendDurable', input: { event: 'startup_failure', fields: { stage: 'boot' } } },
      { id: 2, type: 'crash.record', input: { kind: 'startupFailure', summary: 'startup fault' } },
      { id: 3, type: 'crash.recordDurable', input: { kind: 'uncaughtException', summary: 'fatal fault' } },
      { id: 4, type: 'shutdown' },
    ])
    expect(utility.child.kill).not.toHaveBeenCalled()
    expect(utility.exited).toBe(true)
  })

  it('terminates and reaps a utility process when a write remains pending', async () => {
    const utility = createUtilityProcess({ holdType: 'runtime.appendDurable' })
    const killProcess = vi.fn()
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => utility.child) },
      workerPath: '/app/electron/startup-evidence-worker.cjs',
      killProcess,
    }) as StartupEvidenceService

    await service.ready
    const pendingWrite = service.runtimeLog.appendDurable({ event: 'blocked' })
    await vi.waitFor(() => expect(utility.messages).toContainEqual(
      { id: 1, type: 'runtime.appendDurable', input: { event: 'blocked' } },
    ))
    const termination = service.terminate()

    await expect(pendingWrite).rejects.toMatchObject({ code: 'ERR_SARTRACKER_EVIDENCE_WORKER' })
    await termination

    expect(utility.child.kill).toHaveBeenCalledOnce()
    expect(utility.exited).toBe(true)
    expect(killProcess).not.toHaveBeenCalled()
  })

  it('rejects readiness immediately when utility-process initialization fails', async () => {
    vi.useFakeTimers()
    try {
      const utility = createUtilityProcess({ initializationError: 'could not open evidence directory' })
      const service = createStartupEvidenceService({
        enabled: true,
        userDataPath: '/profile',
        utilityProcess: { fork: vi.fn(() => utility.child) },
        workerPath: '/app/electron/startup-evidence-worker.cjs',
      }) as StartupEvidenceService
      const readyOutcome = service.ready.then(() => 'ready', () => 'rejected')

      await vi.advanceTimersByTimeAsync(0)

      expect(await Promise.race([readyOutcome, Promise.resolve('pending')])).toBe('rejected')
      const termination = service.terminate()
      await vi.advanceTimersByTimeAsync(0)
      await termination
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows utility-process readiness to use the full ten-second startup budget', async () => {
    vi.useFakeTimers()
    try {
      const utility = createUtilityProcess({ holdReady: true })
      const service = createStartupEvidenceService({
        enabled: true,
        userDataPath: '/profile',
        utilityProcess: { fork: vi.fn(() => utility.child) },
        workerPath: '/app/electron/startup-evidence-worker.cjs',
      }) as StartupEvidenceService
      const readyOutcome = service.ready.then(() => 'ready', () => 'rejected')

      await vi.advanceTimersByTimeAsync(9_999)

      expect(await Promise.race([readyOutcome, Promise.resolve('pending')])).toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      expect(await Promise.race([readyOutcome, Promise.resolve('pending')])).toBe('rejected')
      const termination = service.terminate()
      await vi.advanceTimersByTimeAsync(0)
      await termination
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a failed service when the utility process cannot be forked', async () => {
    const forkError = new Error('utility process unavailable')
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => { throw forkError }) },
    }) as StartupEvidenceService

    await expect(service.ready).rejects.toMatchObject({
      code: 'ERR_SARTRACKER_EVIDENCE_WORKER',
    })
    await expect(service.crashLog.record({ kind: 'startupFailure' })).resolves.toBeUndefined()
    await expect(service.crashLog.recordDurably({ kind: 'startupFailure' })).rejects.toMatchObject({
      code: 'ERR_SARTRACKER_EVIDENCE_WORKER',
    })
    await expect(service.runtimeLog.append({ event: 'startup_failure' })).resolves.toBeUndefined()
    await expect(service.terminate()).resolves.toBeUndefined()
  })

  it('reaps a forked utility process when initialization cannot be sent', async () => {
    const utility = createUtilityProcess()
    utility.child.postMessage.mockImplementationOnce(() => {
      throw new Error('message port closed')
    })
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => utility.child) },
      workerPath: '/app/electron/startup-evidence-worker.cjs',
    }) as StartupEvidenceService

    await expect(service.ready).rejects.toMatchObject({
      code: 'ERR_SARTRACKER_EVIDENCE_WORKER',
    })
    await service.terminate()

    expect(utility.child.kill).toHaveBeenCalledOnce()
    expect(utility.exited).toBe(true)
  })

  it('rejects new operations after the utility process reports a failure', async () => {
    const utility = createUtilityProcess()
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => utility.child) },
      workerPath: '/app/electron/startup-evidence-worker.cjs',
    }) as StartupEvidenceService

    await service.ready
    utility.child.emit('error', new Error('worker transport failed'))

    await expect(service.crashLog.readRecent(10)).rejects.toMatchObject({
      code: 'ERR_SARTRACKER_EVIDENCE_WORKER',
    })
    await service.terminate()
  })

  it('keeps best-effort crash records non-throwing after the helper exits unexpectedly', async () => {
    const utility = createUtilityProcess()
    const service = createStartupEvidenceService({
      enabled: true,
      userDataPath: '/profile',
      utilityProcess: { fork: vi.fn(() => utility.child) },
      workerPath: '/app/electron/startup-evidence-worker.cjs',
    }) as StartupEvidenceService

    await service.ready
    utility.child.emit('exit', 1)

    // Matches the in-process crash-log contract: record is best effort, while
    // the durable variant still reports that nothing was saved.
    await expect(service.crashLog.record({ kind: 'render-process-gone', summary: 'oom' }))
      .resolves.toBeUndefined()
    await expect(service.crashLog.recordDurably({ kind: 'uncaughtException', summary: 'fault' }))
      .rejects.toMatchObject({ code: 'ERR_SARTRACKER_EVIDENCE_WORKER' })
  })

  it('escalates to SIGKILL and settles pending writes when the helper cannot be reaped', async () => {
    vi.useFakeTimers()
    try {
      const utility = createUtilityProcess({ holdType: 'crash.recordDurable', ignoresKill: true })
      const killProcess = vi.fn()
      const service = createStartupEvidenceService({
        enabled: true,
        userDataPath: '/profile',
        utilityProcess: { fork: vi.fn(() => utility.child) },
        workerPath: '/app/electron/startup-evidence-worker.cjs',
        killProcess,
      }) as StartupEvidenceService

      await vi.advanceTimersByTimeAsync(0)
      await service.ready
      const pendingWrite = service.crashLog.recordDurably({ kind: 'uncaughtException', summary: 'x' })
      const pendingOutcome = pendingWrite.then(() => 'resolved', (error) => error)
      await vi.advanceTimersByTimeAsync(0)
      const termination = service.terminate().then(() => 'reaped', (error) => error)

      await vi.advanceTimersByTimeAsync(1_500)

      expect(utility.child.kill).toHaveBeenCalledOnce()
      expect(killProcess).toHaveBeenCalledWith(2718, 'SIGKILL')
      await expect(termination).resolves.toMatchObject({
        message: 'Startup evidence utility process could not be reaped.',
      })
      await expect(pendingOutcome).resolves.toMatchObject({ code: 'ERR_SARTRACKER_EVIDENCE_WORKER' })
      expect(utility.exited).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to termination when close cannot drain a held write', async () => {
    vi.useFakeTimers()
    try {
      const utility = createUtilityProcess({ holdType: 'runtime.appendDurable', holdShutdown: true })
      const service = createStartupEvidenceService({
        enabled: true,
        userDataPath: '/profile',
        utilityProcess: { fork: vi.fn(() => utility.child) },
        workerPath: '/app/electron/startup-evidence-worker.cjs',
        killProcess: vi.fn(),
      }) as StartupEvidenceService

      await vi.advanceTimersByTimeAsync(0)
      await service.ready
      const pendingOutcome = service.runtimeLog.appendDurable({ event: 'blocked' })
        .then(() => 'resolved', () => 'rejected')
      const closing = service.close({ timeoutMs: 100 })

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(1_000)
      await closing

      expect(utility.messages).toContainEqual({ id: 2, type: 'shutdown' })
      expect(utility.child.kill).toHaveBeenCalledOnce()
      expect(utility.exited).toBe(true)
      await expect(pendingOutcome).resolves.toBe('rejected')
    } finally {
      vi.useRealTimers()
    }
  })
})

function createUtilityProcess(options: {
  readonly holdType?: string
  readonly initializationError?: string
  readonly holdReady?: boolean
  readonly holdShutdown?: boolean
  readonly ignoresKill?: boolean
} = {}) {
  const child = new EventEmitter() as EventEmitter & {
    readonly pid: number
    readonly kill: ReturnType<typeof vi.fn>
    readonly postMessage: ReturnType<typeof vi.fn>
  }
  const messages: Record<string, unknown>[] = []
  let exited = false
  child.pid = 2718
  child.kill = vi.fn(() => {
    if (options.ignoresKill === true) return true
    setImmediate(() => {
      exited = true
      child.emit('exit', 143)
    })
    return true
  })
  child.postMessage = vi.fn((message: Record<string, unknown>) => {
    messages.push(message)
    if (message.type === 'initialize') {
      if (options.holdReady === true) return
      setImmediate(() => {
        if (options.initializationError === undefined) {
          child.emit('message', { id: 0, type: 'ready' })
        } else {
          child.emit('message', {
            id: 0,
            type: 'response',
            ok: false,
            error: { message: options.initializationError },
          })
        }
      })
      return
    }
    if (message.type === options.holdType) return
    if (message.type === 'shutdown') {
      if (options.holdShutdown === true) return
      setImmediate(() => {
        child.emit('message', { id: message.id, ok: true, value: true })
        setImmediate(() => {
          exited = true
          child.emit('exit', 0)
        })
      })
      return
    }
    setImmediate(() => child.emit('message', { id: message.id, ok: true, value: true }))
  })
  return {
    child,
    messages,
    get exited() { return exited },
  }
}
