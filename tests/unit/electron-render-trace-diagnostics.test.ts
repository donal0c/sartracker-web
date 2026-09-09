import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderTraceCollector, startRenderTraceDiagnostics } from '../../build/electron-render-trace-diagnostics.js'
import { attachRenderTraceDiagnostic } from '../../scripts/electron-archive-lifecycle-smoke.mjs'

/** Provides only the browser CDP operations owned by the diagnostic collector. */
function sessionFixture() {
  const session = new EventEmitter()
  return Object.assign(session, {
    send: vi.fn(async (method: string) => {
      if (method === 'Tracing.end') {
        session.emit('Tracing.dataCollected', { value: [
          { ph: 'M', name: 'thread_name', pid: 3, tid: 4, args: { name: 'CrGpuMain' } },
          { ph: 'X', name: 'Scheduler::RunTask', pid: 3, tid: 4, ts: 1000, dur: 250000, tdur: 80000, args: { secret: 'never-export' } },
        ] })
        session.emit('Tracing.tracingComplete')
      }
      return {}
    }),
    detach: vi.fn(async () => undefined),
  })
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('bounded rendering trace diagnostics [DON-252]', () => {
  it('does not start the optional profiler in the normal CI timing lane [DON-254]', async () => {
    const workflow = load(readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')) as {
      jobs: { build: { steps: { name: string; env?: Record<string, string> }[] } }
    }
    const step = workflow.jobs.build.steps.find(candidate => candidate.name === 'Packaged archive lifecycle smoke')
    expect(step).toBeDefined()
    vi.stubEnv('SARTRACKER_ARCHIVE_RENDER_TRACE', step?.env?.SARTRACKER_ARCHIVE_RENDER_TRACE)
    const session = sessionFixture()
    const newCDPSession = vi.fn(async () => session)
    const launch = {
      browser: { contexts: () => [{ newCDPSession }] }, page: {},
      rendererTrace: undefined as undefined | { stop: () => Promise<unknown> },
    }
    try {
      await attachRenderTraceDiagnostic(launch, 'a'.repeat(40))
      expect(newCDPSession).not.toHaveBeenCalled()
      expect(launch.rendererTrace).toBeUndefined()
    } finally {
      await launch.rendererTrace?.stop()
    }
  })

  it('retains task timing and known thread roles without copying arbitrary trace data', () => {
    const collector = createRenderTraceCollector()
    collector.accept([
      { ph: 'M', name: 'thread_name', pid: 3, tid: 4, args: { name: 'CrGpuMain' } },
      { ph: 'X', name: 'Scheduler::RunTask', pid: 3, tid: 4, ts: 1000, dur: 250000, tdur: 80000, args: { secret: 'never-export' } },
      { ph: 'X', name: 'never-export', pid: 3, tid: 4, ts: 1000, dur: 250000 },
      { ph: 'X', name: 'Scheduler::RunTask', pid: 3, tid: 4, ts: NaN, dur: 250000 },
    ])
    const result = collector.snapshot()
    expect(result.events).toEqual([{ role: 'CrGpuMain', name: 'Scheduler::RunTask', timestampUs: 1000, durationUs: 250000, threadDurationUs: 80000 }])
    expect(JSON.stringify(result)).not.toContain('never-export')
  })

  it('retains a bounded recent window rather than only the longest tasks', () => {
    const collector = createRenderTraceCollector({ capacity: 3 })
    collector.accept(Array.from({ length: 5 }, (_, i) => ({
      ph: 'X', name: 'Scheduler::RunTask', pid: 1, tid: 1, ts: i * 1000, dur: (5 - i) * 1000,
    })))
    const result = collector.snapshot()
    expect(result.events.map((event: { timestampUs: number }) => event.timestampUs)).toEqual([2000, 3000, 4000])
    expect(result.droppedEventCount).toBe(2)
    expect(result.truncated).toBe(true)
  })

  it('drains before detaching and stops only once', async () => {
    const session = sessionFixture()
    const diagnostic = await startRenderTraceDiagnostics(session)
    const [first, second] = await Promise.all([diagnostic.stop(), diagnostic.stop()])
    expect(first).toEqual(second)
    expect(first.status).toBe('captured')
    expect(first.events).toHaveLength(1)
    expect(session.send.mock.calls.map(call => call[0])).toEqual(['Tracing.start', 'Tracing.end'])
    expect(session.detach).toHaveBeenCalledOnce()
    expect(session.listenerCount('Tracing.dataCollected')).toBe(0)
  })

  it('retains a long task that overlaps the recent window even if it started earlier', () => {
    const collector = createRenderTraceCollector({ capacity: 2 })
    collector.accept([
      { ph: 'X', name: 'Scheduler::RunTask', pid: 1, tid: 1, ts: 1000, dur: 10000 },
      { ph: 'X', name: 'Scheduler::RunTask', pid: 1, tid: 1, ts: 2000, dur: 1000 },
      { ph: 'X', name: 'Scheduler::RunTask', pid: 1, tid: 1, ts: 4000, dur: 1000 },
    ])
    expect(collector.snapshot().events.map((event: { timestampUs: number }) => event.timestampUs)).toEqual([1000, 4000])
  })

  it('can freeze tracing at failure before later publication and detach', async () => {
    const session = sessionFixture()
    const diagnostic = await startRenderTraceDiagnostics(session)
    await diagnostic.end()
    expect(session.send).toHaveBeenCalledWith('Tracing.end')
    expect(session.detach).not.toHaveBeenCalled()
    expect((await diagnostic.stop()).status).toBe('captured')
    expect(session.send.mock.calls.filter(call => call[0] === 'Tracing.end')).toHaveLength(1)
  })

  it('reports browser-side trace loss instead of claiming complete capture', async () => {
    const session = sessionFixture()
    const diagnostic = await startRenderTraceDiagnostics(session)
    session.send.mockImplementation(async () => {
      session.emit('Tracing.tracingComplete', { dataLossOccurred: true })
      return {}
    })
    expect(await diagnostic.stop()).toMatchObject({ status: 'incomplete', dataLossOccurred: true })
  })

  it('bounds a missing completion without exposing transport errors', async () => {
    vi.useFakeTimers()
    const session = sessionFixture()
    const diagnostic = await startRenderTraceDiagnostics(session, { timeoutMs: 100 })
    session.send.mockImplementation(async () => ({}))
    const pending = diagnostic.stop()
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending
    expect(result.status).toBe('incomplete')
    expect(session.detach).toHaveBeenCalledOnce()
    expect(session.listenerCount('Tracing.tracingComplete')).toBe(0)
  })

  it('keeps optional setup rejection outside the lifecycle verdict', async () => {
    vi.stubEnv('SARTRACKER_ARCHIVE_RENDER_TRACE', '1')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const launch = {
      browser: { contexts: () => [{ newCDPSession: async () => { throw new Error('never-export') } }] },
      page: {}, rendererTrace: undefined as undefined | { stop: () => Promise<{ status: string }> },
    }
    await expect(attachRenderTraceDiagnostic(launch, 'a'.repeat(40))).resolves.toBeUndefined()
    expect((await launch.rendererTrace?.stop())?.status).toBe('incomplete')
    expect(JSON.stringify(log.mock.calls)).not.toContain('never-export')
  })

  it('owns a CDP session arriving after the optional setup deadline', async () => {
    vi.useFakeTimers()
    vi.stubEnv('SARTRACKER_ARCHIVE_RENDER_TRACE', '1')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = sessionFixture()
    let resolveSession: (session: ReturnType<typeof sessionFixture>) => void = () => undefined
    const pendingSession = new Promise(resolve => { resolveSession = resolve })
    const launch = { browser: { contexts: () => [{ newCDPSession: () => pendingSession }] }, page: {} }
    const attaching = attachRenderTraceDiagnostic(launch, 'a'.repeat(40))
    await vi.advanceTimersByTimeAsync(10000)
    await attaching
    resolveSession(session)
    await vi.advanceTimersByTimeAsync(0)
    expect(session.detach).toHaveBeenCalledOnce()
    expect(session.send).not.toHaveBeenCalled()
  })
})
