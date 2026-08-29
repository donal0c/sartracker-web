import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startLegacyEvidenceBackfillWorker } = require(
  '../../electron/legacy-evidence-backfill-runner.cjs',
) as {
  startLegacyEvidenceBackfillWorker(input: Readonly<Record<string, unknown>>): {
    readonly completion: Promise<Readonly<Record<string, unknown>>>
    terminate(): Promise<void>
  }
}

type FakeWorker = EventEmitter & { terminate(): Promise<number> }

function createFakeWorker(): FakeWorker {
  const worker = new EventEmitter() as FakeWorker
  worker.terminate = vi.fn(async () => {
    queueMicrotask(() => worker.emit('exit', 1))
    return 1
  })
  return worker
}

describe('legacy evidence backfill worker runner [DON-277][DON-278]', () => {
  it('passes only the closed migration envelope to the worker', async () => {
    const worker = createFakeWorker()
    const createWorker = vi.fn(() => worker)
    const execution = startLegacyEvidenceBackfillWorker({
      databasePath: '/tmp/mission-store.sqlite',
      eventPending: true,
      objectPending: false,
      gpxPending: true,
      untrustedExtra: 'not forwarded',
      createWorker,
    })

    expect(createWorker).toHaveBeenCalledWith({
      workerData: {
        databasePath: '/tmp/mission-store.sqlite',
        eventPending: true,
        objectPending: false,
        gpxPending: true,
      },
    })
    worker.emit('message', { type: 'complete', workerThreadId: 17 })
    let settled = false
    void execution.completion.finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(execution.completion).resolves.toEqual({ workerThreadId: 17 })
  })

  it('rejects malformed completion and bounds worker failure text', async () => {
    const malformedWorker = createFakeWorker()
    const malformed = startLegacyEvidenceBackfillWorker({
      databasePath: '/tmp/mission-store.sqlite',
      eventPending: true,
      createWorker: () => malformedWorker,
    })
    malformedWorker.emit('message', { type: 'complete', workerThreadId: 'not-an-integer' })
    malformedWorker.emit('exit', 0)
    await expect(malformed.completion).rejects.toThrow(/exited.*without.*valid completion/iu)

    const failedWorker = createFakeWorker()
    const failed = startLegacyEvidenceBackfillWorker({
      databasePath: '/tmp/mission-store.sqlite',
      objectPending: true,
      createWorker: () => failedWorker,
    })
    failedWorker.emit('message', { type: 'error', message: `unsafe\n${'x'.repeat(1_000)}` })
    failedWorker.emit('exit', 0)
    await expect(failed.completion).rejects.toSatisfy((error: unknown) =>
      error instanceof Error
        && !error.message.includes('\n')
        && error.message.length <= 560,
    )
  })

  it('joins a requested termination without reporting it as migration failure', async () => {
    const worker = createFakeWorker()
    const execution = startLegacyEvidenceBackfillWorker({
      databasePath: '/tmp/mission-store.sqlite',
      gpxPending: true,
      createWorker: () => worker,
    })

    await expect(execution.terminate()).resolves.toBeUndefined()
    await expect(execution.completion).resolves.toEqual({ stopped: true })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
