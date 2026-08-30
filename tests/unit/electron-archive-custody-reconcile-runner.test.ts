import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startArchiveCustodyReconciliation } = require(
  '../../electron/archive-custody-reconcile-runner.cjs',
) as {
  readonly startArchiveCustodyReconciliation: (input: {
    readonly ticket: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
    readonly watchdogMs?: number
    readonly cancelGraceMs?: number
    readonly createWorker?: (input: {
      readonly workerData: Readonly<Record<string, unknown>>
      readonly workerPath: string
    }) => FakeWorker | Worker
  }) => Promise<Readonly<Record<string, unknown>>> & {
    readonly cancel: () => void
    readonly prepareClose: () => Promise<void>
    readonly workerExited: Promise<void>
  }
}

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn(async () => 1)
}

const temporaryDirectories = new Set<string>()
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates one exact registry-issued reconciliation ticket. */
function ticket(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    registryRowid: 7,
    archiveId: '22222222-2222-4222-8222-222222222222',
    containerVersion: 2,
    archiveDirectory: path.resolve('/tmp/sartracker-reconcile/archives'),
    archiveRelativePath: '22222222-2222-4222-8222-222222222222-42.sararch',
    expectedSizeBytes: 4096,
    expectedCiphertextSha256: 'a'.repeat(64),
    ...overrides,
  }
}

/** Creates one exact available worker observation. */
function observation(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    operationId,
    registryRowid: 7,
    archiveId: '22222222-2222-4222-8222-222222222222',
    containerVersion: 2,
    archiveRelativePath: '22222222-2222-4222-8222-222222222222-42.sararch',
    expectedSizeBytes: 4096,
    expectedCiphertextSha256: 'a'.repeat(64),
    outcome: 'available',
    observedSizeBytes: 4096,
    observedCiphertextSha256: 'a'.repeat(64),
    fileIdentity: {
      changedTimeNanoseconds: '200', device: '1', inode: '2', linkCount: 1,
      modifiedTimeNanoseconds: '100', sizeBytes: 4096,
    },
    ...overrides,
  }
}

describe('archive custody reconciliation worker runner', () => {
  it('accepts only an exact identity-bound terminal result after physical worker exit', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      createWorker: () => worker,
    })
    worker.emit('message', observation())
    let settled = false
    void operation.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual(observation())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects substituted worker output and requests bounded cancellation', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      cancelGraceMs: 1,
      createWorker: () => worker,
    })
    worker.emit('message', observation({ archiveId: 'substituted' }))
    await expect(operation).rejects.toThrow(/identity|invalid/iu)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects explicit cancellation immediately, signals cooperatively, and forces termination only after the configured grace', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      cancelGraceMs: 25,
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })
    const cancellation = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
      message: 'Archive custody reconciliation was cancelled.',
    })

    operation.cancel()
    await cancellation
    expect(Atomics.load(
      new Int32Array(workerData?.cancellationBuffer as SharedArrayBuffer),
      0,
    )).toBe(1)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })
    expect(worker.terminate).not.toHaveBeenCalled()

    let physicalExitObserved = false
    void operation.workerExited.then(() => { physicalExitObserved = true })
    await vi.advanceTimersByTimeAsync(24)
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(physicalExitObserved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(physicalExitObserved).toBe(false)

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(physicalExitObserved).toBe(true)
  })

  it('prepareClose requests the stable cancellation and waits for physical worker exit', async () => {
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      cancelGraceMs: 1_000,
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })
    let completionError: Error | undefined
    void operation.catch((error: Error) => { completionError = error })
    let closeSettled = false

    try {
      const close = operation.prepareClose()
      expect(close).toBe(operation.workerExited)
      void close.then(() => { closeSettled = true })
      await Promise.resolve()
      expect(completionError).toMatchObject({
        name: 'AbortError',
        code: 'ARCHIVE_CANCELLED',
        message: 'Archive custody reconciliation was cancelled.',
      })
      expect(Atomics.load(
        new Int32Array(workerData?.cancellationBuffer as SharedArrayBuffer),
        0,
      )).toBe(1)
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })
      expect(closeSettled).toBe(false)
    } finally {
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
    expect(closeSettled).toBe(true)
  })

  it('uses a sixty-second default lack-of-progress watchdog', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      cancelGraceMs: 1_000,
      createWorker: () => worker,
    })
    let rejection: Error | undefined
    void operation.catch((error: Error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(59_999)
      expect(rejection).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(rejection?.message).toMatch(/stopped making bounded progress/iu)
    } finally {
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('does not lose an abort raised synchronously while constructing the worker', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      signal: controller.signal,
      cancelGraceMs: 1_000,
      createWorker: (input) => {
        workerData = input.workerData
        controller.abort()
        return worker
      },
    })

    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    expect(Atomics.load(
      new Int32Array(workerData?.cancellationBuffer as SharedArrayBuffer),
      0,
    )).toBe(1)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })

    let physicalExitObserved = false
    void operation.workerExited.then(() => { physicalExitObserved = true })
    await Promise.resolve()
    expect(physicalExitObserved).toBe(false)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects regressing byte progress and a changed total', async () => {
    vi.useFakeTimers()
    for (const invalidProgress of [
      { completedBytes: 0, totalBytes: 8 },
      { completedBytes: 2, totalBytes: 9 },
    ]) {
      const worker = new FakeWorker()
      const operation = startArchiveCustodyReconciliation({
        ticket: ticket(),
        watchdogMs: 5,
        cancelGraceMs: 1_000,
        createWorker: () => worker,
      })
      const outcome = operation.then(
        () => ({ error: null }),
        (error: Error) => ({ error }),
      )
      worker.emit('message', {
        type: 'progress', operationId, completedBytes: 1, totalBytes: 8,
      })
      worker.emit('message', { type: 'progress', operationId, ...invalidProgress })
      await vi.advanceTimersByTimeAsync(5)
      expect((await outcome).error?.message).toMatch(/invalid progress/iu)
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('resets the watchdog only for forward progress and rejects a later stall', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const progress = vi.fn()
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket(),
      watchdogMs: 100,
      cancelGraceMs: 1_000,
      onProgress: progress,
      createWorker: () => worker,
    })
    let rejection: Error | undefined
    void operation.catch((error: Error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(60)
      worker.emit('message', {
        type: 'progress', operationId, completedBytes: 1, totalBytes: 8,
      })
      await vi.advanceTimersByTimeAsync(60)
      expect(rejection).toBeUndefined()
      worker.emit('message', {
        type: 'progress', operationId, completedBytes: 1, totalBytes: 8,
      })
      await vi.advanceTimersByTimeAsync(39)
      expect(rejection).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(rejection?.message).toMatch(/stopped making bounded progress/iu)
      expect(progress).toHaveBeenCalledTimes(2)
    } finally {
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('surfaces cancellation from a real worker instead of an unreadable custody outcome', async () => {
    const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-reconcile-cancel-'))
    temporaryDirectories.add(archiveDirectory)
    const archiveRelativePath = '22222222-2222-4222-8222-222222222222-42.sararch'
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x7b)
    writeFileSync(path.join(archiveDirectory, archiveRelativePath), bytes, { mode: 0o600 })
    const expectedCiphertextSha256 = createHash('sha256').update(bytes).digest('hex')
    const rawMessages: Array<Readonly<Record<string, unknown>>> = []
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket({
        archiveDirectory,
        archiveRelativePath,
        expectedSizeBytes: bytes.byteLength,
        expectedCiphertextSha256,
      }),
      cancelGraceMs: 5_000,
      createWorker: (input) => {
        const worker = new Worker(input.workerPath, { workerData: input.workerData })
        worker.on('message', (message) => rawMessages.push(message))
        return worker
      },
    })

    operation.cancel()
    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(rawMessages).toContainEqual({
      type: 'error', operationId, code: 'ARCHIVE_CANCELLED',
    })
    expect(rawMessages).not.toContainEqual(expect.objectContaining({ outcome: 'unreadable' }))
  })

  it('hashes outside the main isolate and throttles raw progress for an eight-MiB file', async () => {
    const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-reconcile-worker-'))
    temporaryDirectories.add(archiveDirectory)
    const archiveRelativePath = '22222222-2222-4222-8222-222222222222-42.sararch'
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a)
    writeFileSync(path.join(archiveDirectory, archiveRelativePath), bytes, { mode: 0o600 })
    const expectedCiphertextSha256 = createHash('sha256').update(bytes).digest('hex')
    const rawProgress: Array<Readonly<Record<string, unknown>>> = []
    let heartbeatTicks = 0
    const heartbeat = setInterval(() => { heartbeatTicks += 1 }, 5)
    try {
      const operation = startArchiveCustodyReconciliation({
        ticket: ticket({
          archiveDirectory,
          archiveRelativePath,
          expectedSizeBytes: bytes.byteLength,
          expectedCiphertextSha256,
        }),
        createWorker: (input) => {
          const worker = new Worker(input.workerPath, { workerData: input.workerData })
          worker.on('message', (message) => {
            if (message?.type === 'progress') rawProgress.push(message)
          })
          return worker
        },
      })
      await expect(operation).resolves.toMatchObject({
        outcome: 'available',
        observedSizeBytes: bytes.byteLength,
        observedCiphertextSha256: expectedCiphertextSha256,
      })
      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(heartbeatTicks).toBeGreaterThan(0)
      expect(rawProgress.length).toBeGreaterThan(0)
      expect(rawProgress.length).toBeLessThanOrEqual(2)
      expect(rawProgress.at(-1)).toEqual({
        type: 'progress', operationId,
        completedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
      })
    } finally {
      clearInterval(heartbeat)
    }
  })

  it('checks a legacy null-hash archive by pinned identity without a full-file read', async () => {
    const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-reconcile-v1-'))
    temporaryDirectories.add(archiveDirectory)
    const archiveRelativePath = 'legacy-mission.zip'
    const bytes = Buffer.alloc(16 * 1024 * 1024, 0x4c)
    writeFileSync(path.join(archiveDirectory, archiveRelativePath), bytes, { mode: 0o600 })
    const rawProgress: Array<Readonly<Record<string, unknown>>> = []
    const operation = startArchiveCustodyReconciliation({
      ticket: ticket({
        archiveId: 'legacy-v1-archive',
        containerVersion: 1,
        archiveDirectory,
        archiveRelativePath,
        expectedSizeBytes: null,
        expectedCiphertextSha256: null,
      }),
      createWorker: (input) => {
        const worker = new Worker(input.workerPath, { workerData: input.workerData })
        worker.on('message', (message) => {
          if (message?.type === 'progress') rawProgress.push(message)
        })
        return worker
      },
    })

    await expect(operation).resolves.toMatchObject({
      outcome: 'available',
      observedSizeBytes: bytes.byteLength,
      observedCiphertextSha256: null,
      fileIdentity: { linkCount: 1, sizeBytes: bytes.byteLength },
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(rawProgress).toEqual([])
  })
})
