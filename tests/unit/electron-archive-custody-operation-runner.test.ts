import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startArchiveCustodyOperation } = require('../../electron/archive-custody-operation-runner.cjs') as {
  startArchiveCustodyOperation: (input: Record<string, unknown>) => Promise<Record<string, unknown>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
    readonly prepareClose: () => Promise<void>
  }
}

const CREATION_OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const MAINTENANCE_OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const ARCHIVE_ID = '33333333-3333-4333-8333-333333333333'
const SHA256 = 'ab'.repeat(32)

const identity = Object.freeze({
  changedTimeNanoseconds: '100',
  device: '1',
  inode: '2',
  linkCount: 1,
  modifiedTimeNanoseconds: '90',
  sizeBytes: 128,
})

function createTicket(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    maintenanceOperationId: MAINTENANCE_OPERATION_ID,
    creationOperationId: CREATION_OPERATION_ID,
    journalRevision: 2,
    action: 'publish',
    archiveDirectory: '/tmp/sartracker-custody',
    sourceRelativePath: `.staging/${CREATION_OPERATION_ID}/${ARCHIVE_ID}.sararch.tmp`,
    targetRelativePath: `${ARCHIVE_ID}.sararch`,
    stagingRelativePath: `.staging/${CREATION_OPERATION_ID}/${ARCHIVE_ID}.sararch.tmp`,
    finalRelativePath: `${ARCHIVE_ID}.sararch`,
    expectedSizeBytes: 128,
    expectedCiphertextSha256: SHA256,
    expectedFileIdentity: identity,
    ...overrides,
  }
}

function createComplete(ticket = createTicket()) {
  return {
    type: 'complete',
    protocolVersion: ticket.protocolVersion,
    maintenanceOperationId: ticket.maintenanceOperationId,
    creationOperationId: ticket.creationOperationId,
    journalRevision: ticket.journalRevision,
    action: ticket.action,
    sourceRelativePath: ticket.sourceRelativePath,
    targetRelativePath: ticket.targetRelativePath,
    outcome: 'moved',
    sourceIdentity: null,
    targetIdentity: identity,
    directoriesSynced: true,
  }
}

class FakeWorker extends EventEmitter {
  readonly posted: unknown[] = []
  terminateCalls = 0

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  terminate() {
    this.terminateCalls += 1
    queueMicrotask(() => this.emit('exit', 1))
    return Promise.resolve(1)
  }
}

describe('archive custody operation runner', () => {
  it('validates a closed ticket before creating a worker', async () => {
    let created = false
    expect(() => startArchiveCustodyOperation({
      ticket: createTicket({ sourceRelativePath: '../outside.sararch' }),
      createWorker: () => {
        created = true
        return new FakeWorker()
      },
    })).toThrow(/path|ticket/i)
    expect(created).toBe(false)
  })

  it('returns only a matching terminal result after physical worker exit', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveCustodyOperation({
      ticket: createTicket(),
      createWorker: ({ workerData }: { workerData: Record<string, unknown> }) => {
        expect(workerData.ticket).toEqual(createTicket())
        expect(workerData.cancellationBuffer).toBeInstanceOf(SharedArrayBuffer)
        queueMicrotask(() => {
          worker.emit('message', createComplete())
          worker.emit('exit', 0)
        })
        return worker
      },
    })

    await expect(operation).resolves.toEqual(createComplete())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects a pre-aborted request without creating a worker', async () => {
    const controller = new AbortController()
    controller.abort()
    let created = false
    const operation = startArchiveCustodyOperation({
      ticket: createTicket(),
      signal: controller.signal,
      createWorker: () => {
        created = true
        return new FakeWorker()
      },
    })

    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
    await expect(operation.prepareClose()).resolves.toBeUndefined()
    expect(created).toBe(false)
  })

  it('sets cooperative cancellation immediately and exposes physical exit separately', async () => {
    const worker = new FakeWorker()
    let cancellationFlag: Int32Array | null = null
    const operation = startArchiveCustodyOperation({
      ticket: createTicket(),
      cancelGraceMs: 1_000,
      createWorker: ({ workerData }: { workerData: Record<string, unknown> }) => {
        cancellationFlag = new Int32Array(workerData.cancellationBuffer as SharedArrayBuffer)
        return worker
      },
    })
    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })

    operation.cancel()
    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    expect(Atomics.load(cancellationFlag!, 0)).toBe(1)
    expect(worker.posted).toEqual([{
      type: 'cancel',
      maintenanceOperationId: MAINTENANCE_OPERATION_ID,
    }])
    expect(physicallyExited).toBe(false)

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(physicallyExited).toBe(true)
  })

  it('forces termination after the grace period and prepareClose awaits exit', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const operation = startArchiveCustodyOperation({
        ticket: createTicket(),
        cancelGraceMs: 25,
        createWorker: () => worker,
      })
      const closed = operation.prepareClose()
      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(worker.terminateCalls).toBe(0)
      await vi.advanceTimersByTimeAsync(25)
      await expect(closed).resolves.toBeUndefined()
      expect(worker.terminateCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets its watchdog only for valid monotonic forward progress', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const observed: unknown[] = []
      const operation = startArchiveCustodyOperation({
        ticket: createTicket(),
        watchdogMs: 20,
        cancelGraceMs: 1,
        onProgress: (progress: unknown) => observed.push(progress),
        createWorker: () => worker,
      })
      worker.emit('message', {
        type: 'progress',
        maintenanceOperationId: MAINTENANCE_OPERATION_ID,
        sequence: 1,
        phase: 'inspect',
        unit: 'files',
        completed: 1,
        total: 1,
      })
      await vi.advanceTimersByTimeAsync(15)
      worker.emit('message', {
        type: 'progress',
        maintenanceOperationId: MAINTENANCE_OPERATION_ID,
        sequence: 2,
        phase: 'hash',
        unit: 'bytes',
        completed: 64,
        total: 128,
      })
      await vi.advanceTimersByTimeAsync(15)
      expect(worker.terminateCalls).toBe(0)
      worker.emit('message', createComplete())
      worker.emit('exit', 0)
      await expect(operation).resolves.toEqual(createComplete())
      expect(observed).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects progress regression and substituted terminal output', async () => {
    const regressedWorker = new FakeWorker()
    const regressed = startArchiveCustodyOperation({
      ticket: createTicket(),
      cancelGraceMs: 0,
      createWorker: () => regressedWorker,
    })
    regressedWorker.emit('message', {
      type: 'progress', maintenanceOperationId: MAINTENANCE_OPERATION_ID,
      sequence: 2, phase: 'hash', unit: 'bytes', completed: 64, total: 128,
    })
    regressedWorker.emit('message', {
      type: 'progress', maintenanceOperationId: MAINTENANCE_OPERATION_ID,
      sequence: 3, phase: 'inspect', unit: 'files', completed: 1, total: 1,
    })
    await expect(regressed).rejects.toThrow(/invalid progress/i)
    await expect(regressed.workerExited).resolves.toBeUndefined()

    const substitutedWorker = new FakeWorker()
    const substituted = startArchiveCustodyOperation({
      ticket: createTicket(),
      cancelGraceMs: 0,
      createWorker: () => substitutedWorker,
    })
    substitutedWorker.emit('message', {
      ...createComplete(),
      journalRevision: 99,
    })
    await expect(substituted).rejects.toThrow(/invalid or substituted result/i)
    await expect(substituted.workerExited).resolves.toBeUndefined()
  })

  it('rejects a same-size substituted successful target identity', async () => {
    const cases = [
      { inode: '999' },
      { device: '999' },
      { modifiedTimeNanoseconds: '999' },
      { changedTimeNanoseconds: '99' },
    ]
    for (const identityOverride of cases) {
      const worker = new FakeWorker()
      const operation = startArchiveCustodyOperation({
        ticket: createTicket(),
        cancelGraceMs: 0,
        createWorker: () => worker,
      })
      worker.emit('message', {
        ...createComplete(),
        targetIdentity: { ...identity, ...identityOverride },
      })
      worker.emit('exit', 0)
      await expect(operation).rejects.toThrow(/invalid or substituted result/i)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('uses the frozen 60-second default lack-of-progress watchdog', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const operation = startArchiveCustodyOperation({
        ticket: createTicket(),
        cancelGraceMs: 0,
        createWorker: () => worker,
      })
      let rejected = false
      void operation.catch(() => { rejected = true })
      await vi.advanceTimersByTimeAsync(59_999)
      expect(rejected).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(rejected).toBe(true)
      await vi.runOnlyPendingTimersAsync()
      await expect(operation).rejects.toThrow(/bounded progress/i)
      await expect(operation.workerExited).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
