import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

const CHECKPOINT = { busy: 0, log: 12, checkpointed: 12, completed: true }

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
    const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-runner-'))
    const databasePath = path.join(directory, 'mission-store.sqlite')
    await writeFile(`${databasePath}-wal`, Buffer.alloc(64))
    const worker = createFakeWorker()
    const createWorker = vi.fn(() => worker)
    const execution = startLegacyEvidenceBackfillWorker({
      databasePath,
      eventPending: true,
      objectPending: false,
      gpxPending: true,
      untrustedExtra: 'not forwarded',
      createWorker,
    })

    expect(createWorker).toHaveBeenCalledWith({
      workerData: {
        databasePath,
        eventPending: true,
        objectPending: false,
        gpxPending: true,
      },
    })
    worker.emit('message', { type: 'complete', workerThreadId: 17, checkpoint: CHECKPOINT })
    let settled = false
    void execution.completion.finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(execution.completion).resolves.toEqual({
      workerThreadId: 17,
      checkpoint: { ...CHECKPOINT, walSidecarBytes: 64 },
    })
    await rm(directory, { recursive: true, force: true })
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

    const missingCheckpointWorker = createFakeWorker()
    const missingCheckpoint = startLegacyEvidenceBackfillWorker({
      databasePath: '/tmp/mission-store.sqlite',
      objectPending: true,
      createWorker: () => missingCheckpointWorker,
    })
    missingCheckpointWorker.emit('message', { type: 'complete', workerThreadId: 17 })
    missingCheckpointWorker.emit('exit', 0)
    await expect(missingCheckpoint.completion).rejects.toThrow(/checkpoint receipt|exited.*without.*valid completion/iu)

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

  it('rejects a self-attested empty receipt while the parent observes a non-empty WAL sidecar', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-runner-proof-'))
    const databasePath = path.join(directory, 'mission-store.sqlite')
    await writeFile(`${databasePath}-wal`, Buffer.alloc(64))
    const worker = createFakeWorker()
    const execution = startLegacyEvidenceBackfillWorker({
      databasePath,
      objectPending: true,
      createWorker: () => worker,
    })

    worker.emit('message', {
      type: 'complete',
      workerThreadId: 17,
      checkpoint: { busy: 0, log: 0, checkpointed: 0, completed: true },
    })
    worker.emit('exit', 0)
    await expect(execution.completion).rejects.toThrow(/WAL sidecar|receipt|corroborat/iu)
    await rm(directory, { recursive: true, force: true })
  })

  it('settles a contended checkpoint as a non-fatal completion with telemetry', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-runner-warning-'))
    const databasePath = path.join(directory, 'mission-store.sqlite')
    await writeFile(`${databasePath}-wal`, Buffer.alloc(64))
    const worker = createFakeWorker()
    const execution = startLegacyEvidenceBackfillWorker({
      databasePath,
      objectPending: true,
      createWorker: () => worker,
    })

    worker.emit('message', {
      type: 'complete',
      workerThreadId: 17,
      checkpoint: {
        busy: 0,
        log: 12,
        checkpointed: 4,
        completed: false,
        warning: 'reader checkpoint boundary remained active',
      },
    })
    worker.emit('exit', 0)
    await expect(execution.completion).resolves.toEqual({
      workerThreadId: 17,
      checkpoint: {
        busy: 0,
        log: 12,
        checkpointed: 4,
        completed: false,
        warning: 'reader checkpoint boundary remained active',
        walSidecarBytes: 64,
      },
    })
    await rm(directory, { recursive: true, force: true })
  })
})
