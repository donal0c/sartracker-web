import { EventEmitter } from 'node:events'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startMissionArchiveCreateWorker } = require(
  '../../electron/mission-archive-runner.cjs',
) as {
  readonly startMissionArchiveCreateWorker: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
    readonly watchdogMs?: number
    readonly cancelGraceMs?: number
    readonly createWorker?: (input: {
      readonly workerData: Readonly<Record<string, unknown>>
      readonly workerPath: string
    }) => FakeWorker
  }) => Promise<Readonly<Record<string, unknown>>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
  }
}

const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const passphrase = 'Four calm words 2026!'
const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'

/** Minimal structured-clone-faithful worker double. */
class FakeWorker extends EventEmitter {
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly terminate = vi.fn(async () => 1)

  postMessage(message: Readonly<Record<string, unknown>>, transferList?: readonly ArrayBuffer[]) {
    this.posted.push(structuredClone(message, {
      transfer: transferList === undefined ? [] : [...transferList],
    }))
  }
}

/** Returns one closed create request. */
function createRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    databasePath: path.resolve('/tmp/sartracker-runner/mission-store.sqlite'),
    archiveDirectory: path.resolve('/tmp/sartracker-runner/archives'),
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    fenceRequestedAt: '2026-08-29T18:59:59.000Z',
    requestEventId,
    archiveKind: 'finalized',
    createdAt: '2026-08-29T19:00:00.000Z',
    schemaVersion: 13,
    inventoryVersion: 1,
    previousArchiveSha256: null,
    protectedFinalizationEpoch: null,
    passphrase,
    recoveryCode,
    ...overrides,
  }
}

/** Returns one valid bounded worker completion. */
function createResult(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    operationId,
    archiveId,
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    requestEventId,
    protectedFinalizationEpoch: null,
    archiveKind: 'finalized',
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    temporaryRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp`,
    finalRelativePath: `${archiveId}.sararch`,
    ciphertextSha256: 'a'.repeat(64),
    sizeBytes: 4096,
    temporaryFileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4096,
    },
    frameCount: 8,
    headerSha256: 'd'.repeat(64),
    plaintextSweepConfirmed: true,
    slots: [
      { slotType: 'passphrase', slotId: 'passphrase-main' },
      { slotType: 'recovery', slotId: 'recovery-main' },
    ],
    manifestSummary: {
      entryCount: 4,
      tableCount: 49,
      inventorySha256: 'b'.repeat(64),
      manifestSha256: 'e'.repeat(64),
    },
    kdfDurationMs: 250,
    ...overrides,
  }
}

describe('mission archive create worker runner', () => {
  it('rejects an invalid envelope before constructing a worker', () => {
    const createWorker = vi.fn()

    expect(() => startMissionArchiveCreateWorker({
      request: createRequest({ missionId: `bad\u0000mission` }),
      createWorker,
    })).toThrow(/mission identity/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('transfers credentials separately and never places secrets in workerData', async () => {
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startMissionArchiveCreateWorker({
      request: createRequest(),
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })

    expect(JSON.stringify(workerData)).not.toContain(passphrase)
    expect(JSON.stringify(workerData)).not.toContain(recoveryCode)
    expect(worker.posted).toHaveLength(1)
    const credentialMessage = worker.posted[0] as {
      readonly type: string
      readonly operationId: string
      readonly passphraseBytes: ArrayBuffer
      readonly recoveryCodeBytes: ArrayBuffer
    }
    expect(credentialMessage.type).toBe('credentials')
    expect(credentialMessage.operationId).toBe(operationId)
    expect(Buffer.from(credentialMessage.passphraseBytes).toString('utf8')).toBe(passphrase)
    expect(Buffer.from(credentialMessage.recoveryCodeBytes).toString('utf8')).toBe(recoveryCode)

    operation.cancel()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('accepts completion only after a clean physical worker exit', async () => {
    const worker = new FakeWorker()
    const operation = startMissionArchiveCreateWorker({
      request: createRequest(),
      createWorker: () => worker,
    })
    let settled = false
    void operation.finally(() => { settled = true })

    worker.emit('message', createResult())
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual(createResult())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('fails closed on substituted completion, duplicate terminal data, and exit without completion', async () => {
    for (const emitFailure of [
      (worker: FakeWorker) => {
        worker.emit('message', createResult({ missionId: 'mission-bravo' }))
      },
      (worker: FakeWorker) => {
        worker.emit('message', createResult())
        worker.emit('message', createResult())
      },
      (worker: FakeWorker) => {
        worker.emit('exit', 0)
      },
    ]) {
      const worker = new FakeWorker()
      const operation = startMissionArchiveCreateWorker({
        request: createRequest(),
        createWorker: () => worker,
      })
      emitFailure(worker)
      await expect(operation).rejects.toThrow(/archive worker/iu)
    }
  })

  it('validates monotonic progress and cancels through the shared flag before termination', async () => {
    const worker = new FakeWorker()
    const progress = vi.fn()
    const controller = new AbortController()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startMissionArchiveCreateWorker({
      request: createRequest(),
      signal: controller.signal,
      cancelGraceMs: 1,
      onProgress: progress,
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })
    worker.emit('message', {
      type: 'progress', operationId, sequence: 1, phase: 'extract', unit: 'rows',
      completed: 1, total: 2, detail: 'positions',
    })
    worker.emit('message', {
      type: 'progress', operationId, sequence: 2, phase: 'extract', unit: 'rows',
      completed: 2, total: 2, detail: 'positions',
    })
    expect(progress).toHaveBeenCalledTimes(2)

    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    const cancelFlag = (workerData?.cancellationBuffer as SharedArrayBuffer)
    expect(Atomics.load(new Int32Array(cancelFlag), 0)).toBe(1)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', operationId })
  })

  it('does not lose cancellation raised synchronously while the worker is constructed', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const operation = startMissionArchiveCreateWorker({
      request: createRequest(),
      signal: controller.signal,
      cancelGraceMs: 1,
      createWorker: () => {
        controller.abort()
        return worker
      },
    })

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('contains a throwing progress observer instead of escaping the worker event boundary', async () => {
    const worker = new FakeWorker()
    const operation = startMissionArchiveCreateWorker({
      request: createRequest(),
      cancelGraceMs: 1,
      onProgress: () => { throw new Error('renderer observer failed') },
      createWorker: () => worker,
    })

    expect(() => worker.emit('message', {
      type: 'progress', operationId, sequence: 1, phase: 'extract', unit: 'rows',
      completed: 1, total: 2, detail: 'positions',
    })).not.toThrow()
    await expect(operation).rejects.toThrow(/progress observer/iu)
  })

  it('uses a finite exact-byte deadline for non-instrumentable SQLite rebuild work', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const operation = startMissionArchiveCreateWorker({
        request: createRequest(),
        watchdogMs: 20,
        createWorker: () => worker,
      })
      const sqliteBytes = 4 * 1024 * 1024
      worker.emit('message', {
        type: 'progress', operationId, sequence: 1, phase: 'sqlite', unit: 'bytes',
        completed: 0, total: sqliteBytes, detail: 'rebuild-and-integrity',
      })

      await vi.advanceTimersByTimeAsync(60_999)
      expect(worker.terminate).not.toHaveBeenCalled()
      worker.emit('message', {
        type: 'progress', operationId, sequence: 2, phase: 'sqlite', unit: 'bytes',
        completed: sqliteBytes, total: sqliteBytes, detail: 'rebuild-and-integrity',
      })
      worker.emit('message', createResult())
      worker.emit('exit', 0)
      await expect(operation).resolves.toEqual(createResult())
    } finally {
      vi.useRealTimers()
    }
  })
})
