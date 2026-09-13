import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
type Session = { manifest: object; read: (sequence: number) => Promise<object>
  finish: () => Promise<void>; cancel: () => Promise<void>; completion: Promise<void> }
type Registry = { start: (missionId: string, limit: number, id: string) => Promise<object>
  read: (id: string, sequence: number) => Promise<object>; finish: (id: string) => Promise<void>
  cancel: (id: string) => Promise<boolean>; completion: (id: string) => Promise<void>
  shutdown: () => Promise<void>; readonly activeCount: number }
const { createBreadcrumbQuerySessionRegistry } = require('../../electron/breadcrumb-query-session-registry.cjs') as {
  createBreadcrumbQuerySessionRegistry(input: { databasePath: string
    startSession: (input: { signal: AbortSignal; missionId: string }) => Promise<Session> }): Registry
}

/** Creates a controllable worker whose cancellation is not complete until exit. */
function worker() {
  let exit!: () => void
  const completion = new Promise<void>((resolve) => { exit = resolve })
  return { session: { manifest: { version: 1 }, read: vi.fn(async (sequence: number) => ({ sequence, payload: 'fragment', done: true })),
    finish: vi.fn(() => completion), cancel: vi.fn(() => completion), completion }, exit }
}

describe('breadcrumb query session ownership and shutdown', () => {
  it('registers completion synchronously, brokers frames without aggregation and retains ownership until worker exit', async () => {
    const w = worker()
    const startSession = vi.fn(async () => w.session)
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })
    const start = registry.start('mission-a', 5000, '41:query')
    const terminal = registry.completion('41:query')
    const startedManifest = await start
    expect(startedManifest).toEqual({ version: 1, missionId: 'mission-a' })
    expect(Object.isFrozen(startedManifest)).toBe(true)
    await expect(registry.start('mission-a', 5000, '41:query')).rejects.toThrow(/already active/i)
    const frame = await registry.read('41:query', 0)
    expect(frame).toBe(await w.session.read.mock.results[0].value)
    await expect(registry.read('42:query', 0)).rejects.toThrow(/not active/i)
    await expect(registry.cancel('42:query')).resolves.toBe(false)
    expect(registry.activeCount).toBe(1)
    const finish = registry.finish('41:query')
    w.exit()
    await finish
    await terminal
    expect(registry.activeCount).toBe(0)
  })

  it('joins cancellation before allowing a replacement worker and cancels queued queries without launching them', async () => {
    const first = worker()
    let signal: AbortSignal | undefined
    const startSession = vi.fn(async (input: { signal: AbortSignal }) => { signal = input.signal; return first.session })
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })
    await registry.start('mission-a', 5000, '41:first')
    const queued = registry.start('mission-a', 5000, '41:queued')
    const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await expect(registry.cancel('41:queued')).resolves.toBe(true)
    await rejection
    expect(startSession).toHaveBeenCalledTimes(1)
    let cancelled = false
    const cancellation = registry.cancel('41:first').then(() => { cancelled = true })
    await Promise.resolve()
    expect(signal?.aborted).toBe(true)
    expect(cancelled).toBe(false)
    first.exit()
    await cancellation
    expect(registry.activeCount).toBe(0)
  })

  it('shutdown blocks new admission immediately and waits for an in-flight start and its worker exit', async () => {
    const w = worker()
    let supply!: (session: Session) => void
    const startSession = vi.fn(() => new Promise<Session>((resolve) => { supply = resolve }))
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })
    const start = registry.start('mission-a', 5000, '41:pending')
    const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1))
    let stopped = false
    const shutdown = registry.shutdown().then(() => { stopped = true })
    await expect(registry.start('mission-a', 5000, '41:new')).rejects.toMatchObject({ name: 'AbortError' })
    supply(w.session)
    await Promise.resolve()
    expect(stopped).toBe(false)
    w.exit()
    await rejected
    await shutdown
    expect(w.session.cancel).toHaveBeenCalledOnce()
    expect(registry.activeCount).toBe(0)
  })

  it('releases failed starts and forwards terminal worker failures without publishing success', async () => {
    const startSession = vi.fn().mockRejectedValue(new Error('read snapshot failed'))
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })
    const start = registry.start('mission-a', 5000, '41:failed')
    const terminal = registry.completion('41:failed')
    await expect(start).rejects.toThrow('read snapshot failed')
    await expect(terminal).rejects.toThrow('read snapshot failed')
    expect(registry.activeCount).toBe(0)
  })

  it('settles the captured session promise when startup fails after cancellation', async () => {
    let rejectStart!: (error: Error) => void
    const startSession = vi.fn(() => new Promise<Session>((_resolve, reject) => {
      rejectStart = reject
    }))
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })
    const start = registry.start('mission-a', 5_000, '41:failed-cancel')
    const terminal = registry.completion('41:failed-cancel')
    const cancellation = registry.cancel('41:failed-cancel')

    rejectStart(new Error('worker failed during startup'))
    await expect(start).rejects.toMatchObject({ name: 'AbortError' })
    await expect(cancellation).resolves.toBe(true)
    await expect(terminal).rejects.toMatchObject({ name: 'AbortError' })
    expect(registry.activeCount).toBe(0)
  })

  it('starts queued workers strictly after the prior session reaches terminal completion', async () => {
    const first = worker()
    const second = worker()
    const startSession = vi.fn()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session)
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })

    const scopedRequestId = `41:${'x'.repeat(217)}`
    await registry.start('mission-a', 5_000, scopedRequestId)
    const queued = registry.start('mission-a', 5_000, '41:second')
    await Promise.resolve()
    expect(startSession).toHaveBeenCalledOnce()

    first.exit()
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(2))
    await expect(queued).resolves.toEqual({ version: 1, missionId: 'mission-a' })
    expect(startSession.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      databasePath: '/fixture', missionId: 'mission-a', perDeviceLimit: 5_000,
    }))

    second.exit()
    await registry.shutdown()
  })

  it('rejects admission once the finite waiting queue is full', async () => {
    const first = worker()
    const startSession = vi.fn().mockResolvedValue(first.session)
    const registry = createBreadcrumbQuerySessionRegistry({ databasePath: '/fixture', startSession })

    await registry.start('mission-a', 5_000, '41:active')
    const queued = Array.from({ length: 8 }, (_, index) =>
      registry.start('mission-a', 5_000, `41:queued-${index}`))
    await expect(registry.start('mission-a', 5_000, '41:overflow')).rejects.toThrow(/queue is full/i)

    const shutdown = registry.shutdown()
    first.exit()
    await shutdown
    await expect(Promise.allSettled(queued)).resolves.toHaveLength(8)
    expect(registry.activeCount).toBe(0)
  })
})
