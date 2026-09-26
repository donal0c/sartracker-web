import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runMissionReplayInWorker } = require('../../electron/mission-replay-runner.cjs') as {
  runMissionReplayInWorker(input: Readonly<Record<string, unknown>>): Promise<unknown> & {
    readonly workerExited: Promise<void>
  }
}

describe('mission replay worker runner [DON-278]', () => {
  it.each([true, false])('keeps paging failure unchanged with diagnostics enabled=%s', async enabled => {
    vi.stubEnv('SARTRACKER_REPLAY_PAGING_DIAGNOSTICS', enabled ? '1' : '')
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
      worker.terminate = vi.fn(async () => {
        if (enabled) expect(stderr).toHaveBeenCalledOnce()
        return 0
      })
      const pending = runMissionReplayInWorker({
        databasePath: '/tmp/unused.sqlite', kind: 'state',
        query: { missionId: 'mission-1', selectedTime: '2026-08-27T08:00:00Z', trackLimit: 1 },
        createWorker: () => worker,
      })
      worker.emit('message', {
        type: 'error', message: 'Mission replay evidence changed while paging. Re-seek the selected time.',
        replayPagingDiagnostic: { guard: 'generation', expected: 1, observed: 2 },
      })
      await expect(pending).rejects.toThrow('Mission replay worker failed: Mission replay evidence changed while paging. Re-seek the selected time.')
      expect(worker.terminate).toHaveBeenCalledOnce()
      if (enabled) expect(stderr).toHaveBeenCalledWith('sartracker-replay-paging-guard={"guard":"generation","expected":1,"observed":2}\n')
      else expect(stderr).not.toHaveBeenCalled()
    } finally { stderr.mockRestore(); vi.unstubAllEnvs() }
  })

  it.each([true, false])('drops unrelated worker diagnostics, including private fields=%s', async privateField => {
    vi.stubEnv('SARTRACKER_REPLAY_PAGING_DIAGNOSTICS', '1')
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
      worker.terminate = vi.fn(async () => 0)
      const pending = runMissionReplayInWorker({
        databasePath: '/tmp/unused.sqlite', kind: 'state',
        query: { missionId: 'mission-1', selectedTime: '2026-08-27T08:00:00Z', trackLimit: 1 },
        createWorker: () => worker,
      })
      worker.emit('message', { type: 'error', message: 'unchanged failure',
        replayPagingDiagnostic: { guard: 'generation', expected: 1, observed: 2, ...(privateField ? { missionId: 'private-canary' } : {}) } })
      await expect(pending).rejects.toThrow('Mission replay worker failed: unchanged failure')
      expect(stderr).not.toHaveBeenCalled()
    } finally { stderr.mockRestore(); vi.unstubAllEnvs() }
  })

  it('carries the trusted archive memory policy outside the renderer query [DON-252]', async () => {
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    worker.terminate = vi.fn(async () => 0)
    const createWorker = vi.fn(() => worker)
    const pending = runMissionReplayInWorker({
      databasePath: '/tmp/unused.sqlite',
      kind: 'state',
      archiveReview: true,
      query: {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 1,
        archiveReview: false,
      },
      createWorker,
    })
    const observed = createWorker.mock.calls[0]?.[0]
    worker.emit('exit', 1)
    await expect(pending).rejects.toThrow(/exited with code 1/u)
    expect(observed).toMatchObject({ workerData: { archiveReview: true } })
    expect(observed).not.toHaveProperty('workerData.query.archiveReview')
  })

  it('sends only the closed bounded query envelope to the worker', async () => {
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    worker.terminate = vi.fn(async () => 0)
    const createWorker = vi.fn(() => worker)
    const query = runMissionReplayInWorker({
      databasePath: '/tmp/unused.sqlite',
      kind: 'state',
      query: {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 100,
        unusedRendererPayload: 'x'.repeat(64 * 1024 * 1024),
      },
      createWorker,
    })

    expect(createWorker).toHaveBeenCalledWith(expect.objectContaining({
      workerData: {
        databasePath: '/tmp/unused.sqlite',
        kind: 'state',
        query: {
          missionId: 'mission-1',
          selectedTime: '2026-08-27T08:00:00.000Z',
          trackLimit: 100,
          objectLimit: 100,
          deviceIds: null,
          outingIds: null,
          timezone: 'Europe/Dublin',
        },
      },
    }))
    expect(createWorker.mock.calls[0]?.[0]).not.toHaveProperty(
      'workerData.query.unusedRendererPayload',
    )
    worker.emit('exit', 1)
    await expect(query).rejects.toThrow(/exited with code 1/u)
  })

  it('rejects an oversized selected time and unsupported timezone before creating a worker', async () => {
    const createWorker = vi.fn()
    for (const query of [
      {
        missionId: 'mission-1',
        selectedTime: '2'.repeat(65),
        trackLimit: 100,
      },
      {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 100,
        timezone: 'UTC',
      },
    ]) {
      expect(() => runMissionReplayInWorker({
        databasePath: '/tmp/unused.sqlite',
        kind: 'state',
        query,
        createWorker,
      })).toThrow(/selected time|timezone/i)
    }
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('terminates a superseded seek and rejects with a stable cancellation error', async () => {
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    const terminate = vi.fn(async () => {
      queueMicrotask(() => worker.emit('exit', 1))
      return 1
    })
    worker.terminate = terminate
    const controller = new AbortController()
    const query = runMissionReplayInWorker({
      databasePath: '/tmp/unused.sqlite',
      kind: 'state',
      query: {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 100,
      },
      signal: controller.signal,
      createWorker: () => worker,
    })

    controller.abort()
    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('settles workerExited when Worker construction throws synchronously', async () => {
    const constructionError = new Error('worker constructor unavailable')
    const query = runMissionReplayInWorker({
      databasePath: '/tmp/unused.sqlite',
      kind: 'state',
      query: {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 100,
      },
      createWorker: () => { throw constructionError },
    })

    await expect(query).rejects.toBe(constructionError)
    await expect(Promise.race([
      query.workerExited.then(() => 'exited'),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ])).resolves.toBe('exited')
  })

  it('surfaces a safe bounded-result violation instead of an unknown worker error [DON-278]', async () => {
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    worker.terminate = vi.fn(async () => {
      queueMicrotask(() => worker.emit('exit', 1))
      return 1
    })
    const query = runMissionReplayInWorker({
      databasePath: '/tmp/unused.sqlite',
      kind: 'state',
      query: {
        missionId: 'mission-1',
        selectedTime: '2026-08-27T08:00:00Z',
        trackLimit: 1,
      },
      createWorker: () => worker,
    })

    worker.emit('message', {
      type: 'complete',
      workerThreadId: 7,
      result: { tracks: [{}, {}] },
    })

    await expect(query).rejects.toThrow(/tracks exceed the bounded message limit/u)
  })
})
