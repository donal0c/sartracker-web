import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { startArchiveCorrectionAttachmentRecovery } from '../../electron/archive-correction-custody-recovery-runner.cjs'

type RecoveryOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

describe('archive correction custody recovery runner', () => {
  it('waits for a worker-owned recovery result and physical exit', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      readonly postMessage: ReturnType<typeof vi.fn>
      readonly terminate: ReturnType<typeof vi.fn>
    }
    worker.postMessage = vi.fn()
    worker.terminate = vi.fn(async () => 0)

    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath: '/tmp/mission-store.sqlite',
      createWorker: (input: Readonly<Record<string, unknown>>) => {
        expect(input.workerData).toMatchObject({ databasePath: '/tmp/mission-store.sqlite' })
        return worker
      },
    })
    worker.emit('message', { type: 'complete', recovered: 2 })
    let settled = false
    void operation.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit('exit', 0)

    await expect(operation).resolves.toEqual({ recovered: 2 })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('cancels an in-progress recovery cooperatively before termination', async () => {
    vi.useFakeTimers()
    try {
      const worker = new EventEmitter() as EventEmitter & {
        readonly postMessage: ReturnType<typeof vi.fn>
        readonly terminate: ReturnType<typeof vi.fn>
      }
      worker.postMessage = vi.fn()
      worker.terminate = vi.fn(async () => 1)
    const operation = startArchiveCorrectionAttachmentRecovery({
        databasePath: '/tmp/mission-store.sqlite',
        createWorker: () => worker,
      })

      const cancellable = operation as RecoveryOperation
      expect(cancellable.cancel).toBeTypeOf('function')
      cancellable.cancel()
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
      await expect(cancellable).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
      expect(worker.terminate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(worker.terminate).toHaveBeenCalledOnce()
      worker.emit('exit', 1)
      await expect(cancellable.workerExited).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
