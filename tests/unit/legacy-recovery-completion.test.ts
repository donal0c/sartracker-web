import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeLegacyRecoveryCompletion } from '../support/legacy-recovery-completion'

describe('legacy recovery completion observation [DON-254]', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('waits for real completion rather than an intermediate row count', async () => {
    vi.useFakeTimers()
    let complete!: (value: unknown) => void
    let settled = false
    const result = observeLegacyRecoveryCompletion(new Promise((resolve) => { complete = resolve }))
    void result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(20)
    expect(settled).toBe(false)
    complete({
      workerThreadId: 7,
      checkpoint: { busy: 0, log: 0, checkpointed: 0, completed: true, walSidecarBytes: 0 },
    })
    expect(await result).toMatchObject({ outcome: { value: { workerThreadId: 7, checkpoint: { busy: 0 } } } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('includes a blocked final partial interval even before the first timer callback', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const result = observeLegacyRecoveryCompletion(Promise.resolve({
      workerThreadId: 7,
      checkpoint: { busy: 0, log: 0, checkpointed: 0, completed: true, walSidecarBytes: 0 },
    }))
    now = 250
    const report = await result
    expect(report.maximumHeartbeatGapMs).toBe(250)
    expect(() => expect(report.maximumHeartbeatGapMs).toBeLessThan(200)).toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains the exact worker failure and removes both timers', async () => {
    vi.useFakeTimers()
    const failure = new Error('native recovery failed')
    const report = await observeLegacyRecoveryCompletion(Promise.reject(failure))
    expect(report.outcome).toEqual({ error: failure })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([{ stopped: true }, {}, { workerThreadId: -1 }, { workerThreadId: 1.5 }])(
    'rejects stopped or invalid completion %j', async (completion) => {
      const report = await observeLegacyRecoveryCompletion(Promise.resolve(completion))
    expect(report.outcome).toEqual({ error: expect.objectContaining({ message: expect.stringMatching(/valid worker completion|WAL checkpoint receipt/iu) }) })
    },
  )

  it('rejects malformed checkpoint values instead of coercing them to zero', async () => {
    vi.useFakeTimers()
    const report = await observeLegacyRecoveryCompletion(Promise.resolve({
      workerThreadId: 7,
      checkpoint: { busy: false, log: null, checkpointed: null, completed: true, walSidecarBytes: 0 },
    }))
    expect(report.outcome).toEqual({ error: expect.objectContaining({ message: expect.stringMatching(/checkpoint|invalid/iu) }) })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a named deadline without waiting indefinitely for native exit', async () => {
    vi.useFakeTimers()
    const result = observeLegacyRecoveryCompletion(new Promise(() => undefined), 100)
    await vi.advanceTimersByTimeAsync(100)
    expect((await result).outcome).toEqual({ error: expect.objectContaining({ message: 'Legacy recovery completion timed out after 100ms.' }) })
    expect(vi.getTimerCount()).toBe(0)
  })
})
