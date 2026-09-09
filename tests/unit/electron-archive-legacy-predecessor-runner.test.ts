import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { readArchiveCustodyFileIdentity } = require(
  '../../electron/archive-custody-file.cjs',
) as {
  readonly readArchiveCustodyFileIdentity: (input: {
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
  }) => CustodyIdentity
}
const { startArchiveLegacyPredecessorHash } = require(
  '../../electron/archive-legacy-predecessor-runner.cjs',
) as {
  readonly startArchiveLegacyPredecessorHash: (input: {
    readonly ticket: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly watchdogMs?: number
    readonly cancelGraceMs?: number
    readonly createWorker?: (input: {
      readonly workerData: Readonly<Record<string, unknown>>
      readonly workerPath: string
    }) => FakeWorker | Worker
  }) => Promise<Readonly<Record<string, unknown>>> & {
    readonly cancel: () => void
    readonly workerExited: Promise<void>
  }
}

type CustodyIdentity = Readonly<{
  changedTimeNanoseconds: string
  device: string
  inode: string
  linkCount: number
  modifiedTimeNanoseconds: string
  sizeBytes: number
}>

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn(async () => 1)
}

const temporaryDirectories = new Set<string>()
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const archiveId = `legacy-v1-${'b'.repeat(64)}`

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates one exact legacy-predecessor hash ticket. */
function ticket(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    missionId: 'mission-legacy-predecessor',
    archiveDirectory: path.resolve('/tmp/sartracker-legacy-predecessor/archives'),
    archiveRelativePath: 'mission-legacy-predecessor.zip',
    expectedFileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4_096,
    },
    ...overrides,
  }
}

/** Creates one exact worker progress message. */
function progress(completedBytes = 4_096, totalBytes = 4_096) {
  return { type: 'progress', operationId, completedBytes, totalBytes }
}

/** Creates one exact worker terminal result. */
function result(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    operationId,
    archiveId,
    missionId: 'mission-legacy-predecessor',
    archiveRelativePath: 'mission-legacy-predecessor.zip',
    sha256: 'c'.repeat(64),
    sizeBytes: 4_096,
    fileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4_096,
    },
    ...overrides,
  }
}

describe('legacy archive predecessor hash runner', () => {
  it('accepts an exact complete progress/result sequence only after physical exit', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveLegacyPredecessorHash({
      ticket: ticket(),
      createWorker: () => worker,
    })
    worker.emit('message', progress())
    worker.emit('message', result())
    let settled = false
    void operation.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual(result())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects a terminal result without the worker final-progress proof', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveLegacyPredecessorHash({
      ticket: ticket(),
      cancelGraceMs: 1_000,
      createWorker: () => worker,
    })
    worker.emit('message', result())
    worker.emit('exit', 0)

    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_LEGACY_PREDECESSOR_FAILED',
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects substituted results and non-exact progress or error envelopes', async () => {
    for (const message of [
      result({ archiveRelativePath: 'substituted.zip' }),
      { ...progress(), extra: true },
      {
        type: 'error', operationId,
        code: 'ARCHIVE_LEGACY_PREDECESSOR_MISSING',
        privatePath: '/private/archive.zip',
      },
    ]) {
      const worker = new FakeWorker()
      const operation = startArchiveLegacyPredecessorHash({
        ticket: ticket(),
        cancelGraceMs: 1_000,
        createWorker: () => worker,
      })
      worker.emit('message', message)
      const rejection = expect(operation).rejects.toMatchObject({
        code: 'ARCHIVE_LEGACY_PREDECESSOR_FAILED',
      })
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })
      worker.emit('exit', 1)
      await rejection
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('rejects replayed, backward, changed-total, and post-terminal progress', async () => {
    const invalidSequences = [
      [progress(1, 4_096), progress(1, 4_096)],
      [progress(2, 4_096), progress(1, 4_096)],
      [progress(1, 4_096), progress(2, 4_095)],
      [progress(), result(), progress()],
    ]
    for (const messages of invalidSequences) {
      const worker = new FakeWorker()
      const operation = startArchiveLegacyPredecessorHash({
        ticket: ticket(),
        cancelGraceMs: 1_000,
        createWorker: () => worker,
      })
      for (const message of messages) worker.emit('message', message)
      worker.emit('exit', 1)
      await expect(operation).rejects.toMatchObject({
        code: 'ARCHIVE_LEGACY_PREDECESSOR_FAILED',
      })
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('cancels cooperatively and does not claim physical exit before the exit event', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveLegacyPredecessorHash({
      ticket: ticket(),
      cancelGraceMs: 25,
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    operation.cancel()
    await rejection
    expect(Atomics.load(
      new Int32Array(workerData?.cancellationBuffer as SharedArrayBuffer),
      0,
    )).toBe(1)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })

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
  })

  it('enforces the sixty-second default lack-of-progress watchdog', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const operation = startArchiveLegacyPredecessorHash({
      ticket: ticket(),
      cancelGraceMs: 1_000,
      createWorker: () => worker,
    })
    let rejection: Error | undefined
    void operation.catch((error: Error) => { rejection = error })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(rejection).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(rejection).toMatchObject({ code: 'ARCHIVE_LEGACY_PREDECESSOR_FAILED' })
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', operationId })
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('runs the real worker outside the caller isolate with exact bounded envelopes', async () => {
    const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-runner-'))
    temporaryDirectories.add(archiveDirectory)
    const archiveRelativePath = 'mission-legacy-predecessor.zip'
    const archivePath = path.join(archiveDirectory, archiveRelativePath)
    const bytes = Buffer.alloc(9 * 1024 * 1024 + 29, 0x6d)
    bytes.set(Buffer.from('every-byte-counts'), bytes.byteLength - 17)
    writeFileSync(archivePath, bytes, { mode: 0o600 })
    const expectedFileIdentity = readArchiveCustodyFileIdentity({
      archiveDirectory,
      archiveRelativePath,
    })
    const rawMessages: Array<Readonly<Record<string, unknown>>> = []
    let heartbeatTicks = 0
    const heartbeat = setInterval(() => { heartbeatTicks += 1 }, 5)
    try {
      const operation = startArchiveLegacyPredecessorHash({
        ticket: ticket({ archiveDirectory, archiveRelativePath, expectedFileIdentity }),
        createWorker: (input) => {
          const worker = new Worker(input.workerPath, { workerData: input.workerData })
          worker.on('message', (message) => rawMessages.push(message))
          return worker
        },
      })
      await expect(operation).resolves.toMatchObject({
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.byteLength,
        fileIdentity: expectedFileIdentity,
      })
      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(heartbeatTicks).toBeGreaterThan(0)
      expect(rawMessages.filter((message) => message.type === 'progress')).toEqual([
        { type: 'progress', operationId, completedBytes: 8 * 1024 * 1024,
          totalBytes: bytes.byteLength },
        { type: 'progress', operationId, completedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength },
      ])
      expect(rawMessages.at(-1)).toEqual(expect.objectContaining({
        type: 'complete', operationId,
      }))
    } finally {
      clearInterval(heartbeat)
    }
  })

  it('returns exact closed missing and unsafe failures from the real worker', async () => {
    for (const scenario of ['missing', 'unsafe'] as const) {
      const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-failure-'))
      temporaryDirectories.add(archiveDirectory)
      const archiveRelativePath = 'mission-legacy-predecessor.zip'
      const archivePath = path.join(archiveDirectory, archiveRelativePath)
      writeFileSync(archivePath, Buffer.alloc(4_096, 0x4c), { mode: 0o600 })
      const expectedFileIdentity = readArchiveCustodyFileIdentity({
        archiveDirectory,
        archiveRelativePath,
      })
      if (scenario === 'missing') {
        unlinkSync(archivePath)
      } else {
        const targetPath = path.join(archiveDirectory, 'retained-target.zip')
        renameSync(archivePath, targetPath)
        symlinkSync(targetPath, archivePath)
      }
      const expectedCode = scenario === 'missing'
        ? 'ARCHIVE_LEGACY_PREDECESSOR_MISSING'
        : 'ARCHIVE_LEGACY_PREDECESSOR_UNSAFE'
      const rawMessages: Array<Readonly<Record<string, unknown>>> = []
      const operation = startArchiveLegacyPredecessorHash({
        ticket: ticket({ archiveDirectory, archiveRelativePath, expectedFileIdentity }),
        createWorker: (input) => {
          const worker = new Worker(input.workerPath, { workerData: input.workerData })
          worker.on('message', (message) => rawMessages.push(message))
          return worker
        },
      })

      await expect(operation).rejects.toMatchObject({ code: expectedCode })
      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(rawMessages).toEqual([{ type: 'error', operationId, code: expectedCode }])
    }
  })
})
