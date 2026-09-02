import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { startArchiveCorrectionWorker } from '../../electron/archive-correction-runner.cjs'

describe('archive correction worker runner', () => {
  it('does not turn cancellation after durable completion into a false failure', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: () => Promise<number>
    }
    worker.postMessage = () => undefined
    worker.terminate = async () => 0
    const controller = new AbortController()
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    controller.abort()
    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual({
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
  })

  it('keeps the durable completion when the worker reports a late error or exits nonzero', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: () => Promise<number>
    }
    worker.postMessage = () => undefined
    worker.terminate = async () => 1
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    worker.emit('error', new Error('late worker error'))
    worker.emit('exit', 1)
    await expect(operation).resolves.toMatchObject({ missionId: 'mission-1' })
  })

  it('terminates a worker after completion when shutdown cancellation arrives before exit', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: ReturnType<typeof vi.fn>
    }
    worker.postMessage = vi.fn()
    worker.terminate = vi.fn(async () => 0)
    const controller = new AbortController()
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    controller.abort()
    expect(worker.terminate).toHaveBeenCalledOnce()
    worker.emit('exit', 1)
    await expect(operation).resolves.toMatchObject({ archiveId: '11111111-1111-4111-8111-111111111111' })
  })
})
