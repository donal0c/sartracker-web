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
