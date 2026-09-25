import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createStartupWatchdog } = require('../../electron/startup-watchdog.cjs') as {
  readonly createStartupWatchdog: (options: {
    readonly timeoutMs: number
    readonly now: () => number
  }) => {
    readonly run: <T>(stage: string, operation: () => T | Promise<T>) => Promise<Awaited<T>>
    readonly runParallel: <T extends readonly {
      readonly stage: string
      readonly operation: () => unknown | Promise<unknown>
    }[]>(stages: T) => Promise<{
      readonly [K in keyof T]: T[K] extends { readonly operation: () => infer R }
        ? Awaited<R>
        : never
    }>
    readonly dispose: () => void
  }
}

describe('electron startup watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses one deadline across stages and reports the stage still pending at expiry', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    const watchdog = createStartupWatchdog({ timeoutMs: 10_000, now: () => monotonicNow })
    let releaseFirst: (() => void) | undefined
    const firstStage = watchdog.run('startup state inspection', () => new Promise<void>((resolve) => {
      releaseFirst = resolve
    }))

    await Promise.resolve()
    monotonicNow = 6_000
    await vi.advanceTimersByTimeAsync(6_000)
    releaseFirst?.()
    await firstStage

    const secondStage = watchdog.run('active mission lookup', () => new Promise<never>(() => {}))
    const timedOut = expect(secondStage).rejects.toMatchObject({
      name: 'StartupTimeoutError',
      stage: 'active mission lookup',
      timeoutMs: 10_000,
      elapsedMs: 10_000,
    })
    monotonicNow = 9_999
    await vi.advanceTimersByTimeAsync(3_999)
    monotonicNow = 10_000
    await vi.advanceTimersByTimeAsync(1)
    await timedOut
    watchdog.dispose()
  })

  it('rejects a stage that returns after the deadline even if the timer could not run', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    const watchdog = createStartupWatchdog({ timeoutMs: 10_000, now: () => monotonicNow })
    const lateResult = watchdog.run('synchronous store open', () => {
      monotonicNow = 10_001
      return 'opened'
    })

    await expect(lateResult).rejects.toMatchObject({
      name: 'StartupTimeoutError',
      stage: 'synchronous store open',
      elapsedMs: 10_001,
    })
    watchdog.dispose()
  })

  it('reports the unresolved operation when independent startup reads run in parallel', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    const watchdog = createStartupWatchdog({ timeoutMs: 10_000, now: () => monotonicNow })
    const pendingReads = watchdog.runParallel([
      { stage: 'storage diagnostics initialization', operation: async () => undefined },
      { stage: 'previous crash-state inspection', operation: () => new Promise<never>(() => {}) },
    ] as const)
    const timedOut = expect(pendingReads).rejects.toMatchObject({
      name: 'StartupTimeoutError',
      stage: 'previous crash-state inspection',
      timeoutMs: 10_000,
      elapsedMs: 10_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    monotonicNow = 10_000
    await vi.advanceTimersByTimeAsync(10_000)

    await timedOut
    watchdog.dispose()
  })
})
