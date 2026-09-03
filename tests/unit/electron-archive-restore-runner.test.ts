import { EventEmitter } from 'node:events'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startArchiveRestore } = require(
  '../../electron/archive-restore-runner.cjs',
) as {
  readonly startArchiveRestore: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly secret: string
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
    readonly watchdogMs?: number
    readonly cancelGraceMs?: number
    readonly workerPath?: string
    readonly WorkerClass?: new (
      workerPath: string,
      options: { readonly workerData: Readonly<Record<string, unknown>> },
    ) => FakeWorker
  }) => ArchiveRestoreOperation
}

type ArchiveRestoreOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const CREATION_OPERATION_ID = '73e9012a-a911-4c25-9b26-c94ff5ae23af'
const REQUEST_EVENT_ID = '81df865d-1aaa-4561-8cae-02d1e17a1212'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)
const HEADER_SHA256 = 'b'.repeat(64)
const SECRET = 'Correct Horse Battery Staple 9!'
const DATABASE_IDENTITY = Object.freeze({
  dev: 73,
  ino: 7_301,
  sizeBytes: 610_304,
})

type FakeDatabaseFileHandle = Readonly<{
  fd: number
  close: ReturnType<typeof vi.fn>
}>

let databaseFileHandle: FakeDatabaseFileHandle

/** Returns a harmless FileHandle-shaped double that never owns a process descriptor. */
function createFakeDatabaseFileHandle(): FakeDatabaseFileHandle {
  return {
    fd: 9_001,
    close: vi.fn(async () => undefined),
  }
}

/** Returns one full trusted internal restore identity. */
function restoreRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archiveId: ARCHIVE_ID,
    archiveKind: 'finalized',
    archiveDirectory: path.resolve('/tmp/sartracker-archive-review/archives'),
    archiveRelativePath: `${ARCHIVE_ID}.sararch`,
    reviewRoot: path.resolve('/tmp/sartracker-archive-review/review'),
    missionId: 'mission-review-fixed',
    requestEventRowid: 42,
    requestEventId: REQUEST_EVENT_ID,
    creationOperationId: CREATION_OPERATION_ID,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-30T08:00:00.000Z',
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: CIPHERTEXT_SHA256,
    headerSha256: HEADER_SHA256,
    sizeBytes: 4096,
    frameCount: 8,
    manifestSha256: 'c'.repeat(64),
    entryCount: 4,
    tableCount: 49,
    slotType: 'passphrase',
    previousArchiveSha256: null,
    ...overrides,
  }
}

/** Returns one exact internal restore result, including paths hidden by the session manager. */
function restoreResult(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archiveId: ARCHIVE_ID,
    missionId: 'mission-review-fixed',
    sessionDirectory: path.resolve('/tmp/sartracker-archive-review/review', SESSION_ID),
    databasePath: path.resolve(
      '/tmp/sartracker-archive-review/review',
      SESSION_ID,
      'mission-store.sqlite',
    ),
    databaseIdentity: DATABASE_IDENTITY,
    databaseSha256: 'd'.repeat(64),
    databaseFileHandle,
    attachmentMappings: [],
    ...overrides,
  }
}

/** Returns one complete worker message for the internal restore result. */
function restoreComplete(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    ...restoreResult(overrides),
  }
}

/** Minimal worker-thread double retaining the constructed and transferred envelopes. */
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = []
  static failPost = false

  readonly workerPath: string
  readonly workerData: Readonly<Record<string, unknown>>
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly transferLists: Array<readonly ArrayBuffer[]> = []
  readonly terminate = vi.fn(async () => {
    queueMicrotask(() => this.emit('exit', 1))
    return 1
  })
  failedSecretView: Uint8Array | null = null

  constructor(
    workerPath: string,
    options: { readonly workerData: Readonly<Record<string, unknown>> },
  ) {
    super()
    this.workerPath = workerPath
    this.workerData = options.workerData
    FakeWorker.instances.push(this)
  }

  postMessage(
    message: Readonly<Record<string, unknown>>,
    transferList?: readonly ArrayBuffer[],
  ) {
    if (FakeWorker.failPost) {
      if (message.secretBytes instanceof ArrayBuffer) {
        this.failedSecretView = new Uint8Array(message.secretBytes)
      }
      throw new Error('message port closed')
    }
    const transferred = transferList === undefined ? [] : [...transferList]
    this.transferLists.push(transferred)
    this.posted.push(structuredClone(message, { transfer: transferred }))
  }
}

/** Returns the sole worker created by the operation under test. */
function worker() {
  expect(FakeWorker.instances).toHaveLength(1)
  return FakeWorker.instances[0]
}

describe('archive restore runner', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    FakeWorker.failPost = false
    databaseFileHandle = createFakeDatabaseFileHandle()
  })

  it('transfers exactly the selected secret outside workerData and zeroes failed transfers', async () => {
    const operation = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()

    expect(JSON.stringify(activeWorker.workerData)).not.toContain(SECRET)
    expect(activeWorker.posted).toHaveLength(1)
    expect(activeWorker.posted[0]).toMatchObject({
      type: 'credential',
      operationId: OPERATION_ID,
    })
    expect(Object.prototype.toString.call(activeWorker.posted[0].secretBytes))
      .toBe('[object ArrayBuffer]')
    expect(Buffer.from(activeWorker.posted[0].secretBytes as ArrayBuffer).toString('utf8'))
      .toBe(SECRET)
    expect(activeWorker.posted[0]).not.toHaveProperty('passphraseBytes')
    expect(activeWorker.posted[0]).not.toHaveProperty('recoveryCodeBytes')
    expect(activeWorker.transferLists[0]).toHaveLength(1)

    activeWorker.emit('message', restoreComplete())
    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(restoreResult())

    FakeWorker.instances = []
    FakeWorker.failPost = true
    const failed = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      cancelGraceMs: 0,
      WorkerClass: FakeWorker,
    })
    const failedWorker = worker()
    await expect(failed).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })
    expect([...failedWorker.failedSecretView ?? []].every((byte) => byte === 0)).toBe(true)
    await expect(failed.workerExited).resolves.toBeUndefined()
  })

  it('does not report success until matching terminal output is followed by physical exit', async () => {
    const operation = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    activeWorker.emit('message', restoreComplete())
    let settled = false
    void operation.then(
      () => { settled = true },
      () => { settled = true },
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(restoreResult())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('does not report physical exit until a rejected transferred database handle is closed', async () => {
    let releaseClose = () => undefined
    const closeSettled = new Promise<void>((resolve) => { releaseClose = resolve })
    databaseFileHandle = {
      fd: 9_002,
      close: vi.fn(() => closeSettled),
    }
    const operation = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      cancelGraceMs: 30_000,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    activeWorker.emit('message', restoreComplete({ extra: 'rejected-envelope' }))
    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })

    activeWorker.emit('exit', 1)
    let physicalExitSettled = false
    void operation.workerExited.then(() => { physicalExitSettled = true })
    await Promise.resolve()
    expect(physicalExitSettled).toBe(false)

    releaseClose()
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(databaseFileHandle.close).toHaveBeenCalledOnce()
  })

  it('retries a transient rejected transferred handle close before reporting worker exit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'archive-restore-runner-handle-'))
    const databasePath = path.join(root, 'mission-store.sqlite')
    await writeFile(databasePath, 'TRANSFERRED-PLAINTEXT', { mode: 0o600 })
    const actualHandle = await open(databasePath, 'r+')
    const close = actualHandle.close.bind(actualHandle)
    let closeCalls = 0
    databaseFileHandle = {
      fd: actualHandle.fd,
      close: vi.fn(async () => {
        closeCalls += 1
        if (closeCalls === 1) throw new Error('transient transferred close failure')
        await close()
      }),
    }
    try {
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 30_000,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      activeWorker.emit('message', restoreComplete({ extra: 'rejected-envelope' }))
      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })
      activeWorker.emit('exit', 1)

      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(databaseFileHandle.close).toHaveBeenCalledTimes(2)
    } finally {
      await actualHandle.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects substituted operation, archive, session, mission, path, and attachment envelopes', async () => {
    const substitutions = [
      { operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { archiveId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { missionId: 'another-mission' },
      { databasePath: path.resolve('/tmp/substituted.sqlite') },
      { sessionDirectory: path.resolve('/tmp/substituted-session') },
      { databaseIdentity: { ...DATABASE_IDENTITY, ino: 0 } },
      { databaseIdentity: { ...DATABASE_IDENTITY, extra: true } },
      { databaseFileHandle: { fd: -1, close: vi.fn(async () => undefined) } },
      { databaseFileHandle: null },
      { attachmentMappings: 'not-an-array' },
      { extra: 'not-allowed' },
    ]
    for (const substitution of substitutions) {
      FakeWorker.instances = []
      databaseFileHandle = createFakeDatabaseFileHandle()
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      const message = restoreComplete(substitution)
      const sentHandle = message.databaseFileHandle as FakeDatabaseFileHandle | null
      activeWorker.emit('message', message)
      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })
      await expect(operation.workerExited).resolves.toBeUndefined()
      if (sentHandle !== null && typeof sentHandle?.close === 'function') {
        expect(sentHandle.close).toHaveBeenCalledOnce()
      }
    }
  })

  it('preserves closed wrong-key, corruption, disk-full, newer-format, and schema failures', async () => {
    const codes = [
      'ARCHIVE_RESTORE_WRONG_KEY',
      'ARCHIVE_RESTORE_AUTHENTICATION_FAILED',
      'ARCHIVE_RESTORE_DISK_FULL',
      'ARCHIVE_RESTORE_UNSUPPORTED_FORMAT',
    ]
    for (const code of codes) {
      FakeWorker.instances = []
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      activeWorker.emit('message', {
        type: 'error',
        operationId: OPERATION_ID,
        code,
        message: `${SECRET} must never be reflected`,
        databasePath: '/tmp/must-not-leak.sqlite',
      })
      await expect(operation).rejects.toMatchObject({ code })
      const failure = await operation.catch((error: unknown) => error) as Error
      expect(failure.message).not.toContain(SECRET)
      expect(failure.message).not.toContain('/tmp/must-not-leak.sqlite')
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('makes cancellation immediate while retaining physical worker-exit ownership', async () => {
    const operation = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      cancelGraceMs: 1_000,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    const cancellationFlag = new Int32Array(
      activeWorker.workerData.cancellationBuffer as SharedArrayBuffer,
    )
    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })

    operation.cancel()
    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    expect(Atomics.load(cancellationFlag, 0)).toBe(1)
    expect(activeWorker.posted.at(-1)).toEqual({
      type: 'cancel',
      operationId: OPERATION_ID,
    })
    expect(physicallyExited).toBe(false)

    activeWorker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(physicallyExited).toBe(true)
  })

  it('closes a real transferred handle from a late complete after public cancellation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'archive-restore-late-complete-'))
    const databasePath = path.join(root, 'mission-store.sqlite')
    await writeFile(databasePath, 'LATE-TRANSFERRED-PLAINTEXT', { mode: 0o600 })
    const actualHandle = await open(databasePath, 'r+')
    databaseFileHandle = {
      fd: actualHandle.fd,
      close: vi.fn(() => actualHandle.close()),
    }
    try {
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 30_000,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      operation.cancel()
      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })

      activeWorker.emit('message', restoreComplete())
      activeWorker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()

      expect(databaseFileHandle.close).toHaveBeenCalledOnce()
      await expect(actualHandle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    } finally {
      await actualHandle.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('forces bounded termination while workerExited remains the physical-exit authority', async () => {
    vi.useFakeTimers()
    try {
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 25,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      operation.cancel()
      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(activeWorker.terminate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(25)
      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(activeWorker.terminate).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let sequence-only no-op progress postpone the watchdog', async () => {
    vi.useFakeTimers()
    try {
      const operation = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        watchdogMs: 20,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      let rejected = false
      void operation.catch(() => { rejected = true })
      activeWorker.emit('message', {
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'preflight', unit: 'files', completed: 1, total: 2,
        detail: 'pinned-ciphertext',
      })
      await vi.advanceTimersByTimeAsync(15)
      activeWorker.emit('message', {
        type: 'progress', operationId: OPERATION_ID, sequence: 2,
        phase: 'preflight', unit: 'files', completed: 1, total: 2,
        detail: 'pinned-ciphertext',
      })
      await vi.advanceTimersByTimeAsync(5)
      expect(rejected).toBe(true)
      await vi.runOnlyPendingTimersAsync()

      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })
      await expect(operation.workerExited).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a size-bounded deadline for a real large SQLite validation phase', async () => {
    vi.useFakeTimers()
    try {
      const sizeBytes = 2 * 1024 * 1024 * 1024 + 17
      const operation = startArchiveRestore({
        request: restoreRequest({ sizeBytes }),
        secret: SECRET,
        watchdogMs: 20,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      let rejected = false
      void operation.catch(() => { rejected = true })
      activeWorker.emit('message', {
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'validate', unit: 'bytes', completed: 0, total: sizeBytes,
        detail: 'sqlite-integrity-check',
      })

      await vi.advanceTimersByTimeAsync(20)
      expect(rejected).toBe(false)
      expect(activeWorker.terminate).not.toHaveBeenCalled()
      activeWorker.emit('message', {
        type: 'progress', operationId: OPERATION_ID, sequence: 2,
        phase: 'validate', unit: 'bytes', completed: sizeBytes, total: sizeBytes,
        detail: 'sqlite-integrity-checked',
      })
      activeWorker.emit('message', restoreComplete())
      activeWorker.emit('exit', 0)
      await expect(operation).resolves.toEqual(restoreResult())
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails safely on pre-abort, observer failure, and a sixty-second progress stall', async () => {
    const controller = new AbortController()
    controller.abort()
    const preAborted = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      signal: controller.signal,
      WorkerClass: FakeWorker,
    })
    await expect(preAborted).rejects.toMatchObject({ name: 'AbortError' })
    await expect(preAborted.workerExited).resolves.toBeUndefined()
    expect(FakeWorker.instances).toHaveLength(0)

    const observerFailure = startArchiveRestore({
      request: restoreRequest(),
      secret: SECRET,
      cancelGraceMs: 0,
      onProgress: () => { throw new Error('observer secret') },
      WorkerClass: FakeWorker,
    })
    worker().emit('message', {
      type: 'progress',
      operationId: OPERATION_ID,
      sequence: 1,
      phase: 'preflight',
      unit: 'bytes',
      completed: 1,
      total: 4096,
    })
    await expect(observerFailure).rejects.toMatchObject({
      code: 'ARCHIVE_RESTORE_FAILED',
    })
    await expect(observerFailure.workerExited).resolves.toBeUndefined()

    vi.useFakeTimers()
    try {
      FakeWorker.instances = []
      const stalled = startArchiveRestore({
        request: restoreRequest(),
        secret: SECRET,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const stalledWorker = worker()
      let rejected = false
      void stalled.catch(() => { rejected = true })
      await vi.advanceTimersByTimeAsync(59_999)
      expect(rejected).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(rejected).toBe(true)
      await vi.runOnlyPendingTimersAsync()
      await expect(stalled).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_FAILED' })
      await expect(stalled.workerExited).resolves.toBeUndefined()
      expect(stalledWorker.terminate).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
