import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runMissionReplayInWorker } = require('../../electron/mission-replay-runner.cjs') as {
  runMissionReplayInWorker(input: Readonly<Record<string, unknown>>): Promise<unknown>
}

describe('mission replay worker runner [DON-278]', () => {
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
})
