import { EventEmitter } from 'node:events'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type SweepResult = Readonly<{
  status: 'clean'
  removedEntryCount: number
}>

type SweepOperation = Promise<SweepResult> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

type WorkerInput = Readonly<{
  workerData: Readonly<Record<string, unknown>>
  workerPath: string
}>

const { startArchivePlaintextSweep } = require(
  '../../electron/archive-plaintext-sweep-runner.cjs',
) as {
  readonly startArchivePlaintextSweep: (input: {
    readonly archiveDirectory: string
    readonly signal?: AbortSignal
    readonly workerPath?: string
    readonly createWorker?: (input: WorkerInput) => FakeWorker
  }) => SweepOperation
}

const { sweepArchivePlaintext } = require(
  '../../electron/archive-plaintext-sweep-worker.cjs',
) as {
  readonly sweepArchivePlaintext: (input: {
    readonly archiveDirectory: string
    readonly cancellationFlag: Int32Array
    readonly onProgress: (removedEntryCount: number) => void
  }) => SweepResult
}

/** Minimal worker double for lifecycle and closed-envelope attacks. */
class FakeWorker extends EventEmitter {
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly terminate = vi.fn(async () => 1)

  postMessage(message: Readonly<Record<string, unknown>>) {
    this.posted.push(structuredClone(message))
  }
}

const temporaryRoots = new Set<string>()

/** Creates an isolated resolved archive directory. */
function createArchiveDirectory() {
  const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-plaintext-sweep-'))
  temporaryRoots.add(archiveDirectory)
  return archiveDirectory
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
  temporaryRoots.clear()
})

describe('archive plaintext startup sweep runner', () => {
  it('rejects non-absolute and unresolved archive-directory inputs before worker creation', () => {
    const createWorker = vi.fn()

    expect(() => startArchivePlaintextSweep({
      archiveDirectory: 'relative/archive',
      createWorker,
    })).toThrow(/archive directory/iu)
    expect(() => startArchivePlaintextSweep({
      archiveDirectory: `${tmpdir()}${path.sep}one${path.sep}..${path.sep}two`,
      createWorker,
    })).toThrow(/archive directory/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('returns a closed result only after a clean physical worker exit', async () => {
    const archiveDirectory = createArchiveDirectory()
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchivePlaintextSweep({
      archiveDirectory,
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })

    expect(workerData).toEqual(expect.objectContaining({ archiveDirectory }))
    worker.emit('message', { type: 'complete', status: 'clean', removedEntryCount: 0 })
    let settled = false
    void operation.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual({ status: 'clean', removedEntryCount: 0 })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('fails closed on substituted terminal output without reflecting worker-controlled data', async () => {
    const archiveDirectory = createArchiveDirectory()
    const worker = new FakeWorker()
    const secret = 'SECRET-MISSION-PATH'
    const operation = startArchivePlaintextSweep({
      archiveDirectory,
      createWorker: () => worker,
    })

    worker.emit('message', {
      type: 'complete',
      status: 'clean',
      removedEntryCount: 0,
      reflectedPath: `${archiveDirectory}/${secret}`,
    })
    const error = await operation.catch((reason: unknown) => reason as Error)
    expect(error.message).toMatch(/invalid/iu)
    expect(error.message).not.toContain(archiveDirectory)
    expect(error.message).not.toContain(secret)
    expect(worker.posted).toEqual([{ type: 'cancel' }])

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('does not reflect a substituted physical-exit value in its closed error', async () => {
    const archiveDirectory = createArchiveDirectory()
    const worker = new FakeWorker()
    const secret = `${archiveDirectory}/SECRET-EXIT-VALUE`
    const operation = startArchivePlaintextSweep({
      archiveDirectory,
      createWorker: () => worker,
    })

    worker.emit('exit', secret)
    const error = await operation.catch((reason: unknown) => reason as Error)

    expect(error.message).toMatch(/without valid completion/iu)
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain(archiveDirectory)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('uses a fixed sixty-second progress watchdog and retains physical-exit ownership', async () => {
    vi.useFakeTimers()
    const archiveDirectory = createArchiveDirectory()
    const worker = new FakeWorker()
    const operation = startArchivePlaintextSweep({
      archiveDirectory,
      createWorker: () => worker,
    })
    const failure = operation.catch((reason: unknown) => reason as Error)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(worker.posted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await expect(failure).resolves.toEqual(expect.objectContaining({
      message: expect.stringMatching(/progress/iu),
    }))
    expect(worker.posted).toEqual([{ type: 'cancel' }])

    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })
    await Promise.resolve()
    expect(physicallyExited).toBe(false)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('does not lose a synchronous abort during worker construction', async () => {
    const archiveDirectory = createArchiveDirectory()
    const worker = new FakeWorker()
    const controller = new AbortController()
    const operation = startArchivePlaintextSweep({
      archiveDirectory,
      signal: controller.signal,
      createWorker: () => {
        controller.abort()
        return worker
      },
    })

    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    expect(worker.posted).toEqual([{ type: 'cancel' }])
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })
})

describe('archive plaintext startup sweep worker', () => {
  it('treats a missing fixed verification root as clean without creating it', async () => {
    const archiveDirectory = createArchiveDirectory()

    const operation = startArchivePlaintextSweep({ archiveDirectory })
    const result = await operation

    expect(result).toEqual({ status: 'clean', removedEntryCount: 0 })
    expect(existsSync(path.join(archiveDirectory, '.verification'))).toBe(false)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('fully removes nested SIGKILL residue', async () => {
    const archiveDirectory = createArchiveDirectory()
    const verificationRoot = path.join(archiveDirectory, '.verification')
    const nested = path.join(verificationRoot, 'operation-a', 'entries', 'attachments')
    mkdirSync(nested, { recursive: true, mode: 0o755 })
    writeFileSync(path.join(verificationRoot, 'operation-a', 'mission-store.sqlite'), 'plaintext')
    writeFileSync(path.join(nested, 'clue.jpg'), 'plaintext attachment')
    chmodSync(verificationRoot, 0o755)

    const result = await startArchivePlaintextSweep({ archiveDirectory })

    expect(result.status).toBe('clean')
    expect(result.removedEntryCount).toBeGreaterThanOrEqual(6)
    expect(existsSync(verificationRoot)).toBe(false)
  })

  it('durably fsyncs the archive parent after removing the fixed root', () => {
    const archiveDirectory = createArchiveDirectory()
    const verificationRoot = path.join(archiveDirectory, '.verification')
    mkdirSync(verificationRoot, { mode: 0o700 })
    writeFileSync(path.join(verificationRoot, 'residue'), 'plaintext')
    const fs = require('node:fs') as typeof import('node:fs')
    const fsync = vi.spyOn(fs, 'fsyncSync')

    const result = sweepArchivePlaintext({
      archiveDirectory,
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
      onProgress: () => undefined,
    })

    expect(result).toEqual({ status: 'clean', removedEntryCount: 2 })
    expect(fsync).toHaveBeenCalledTimes(1)
    expect(existsSync(verificationRoot)).toBe(false)
  })

  it('unlinks nested symlinks without following them or touching their targets', async () => {
    const archiveDirectory = createArchiveDirectory()
    const externalDirectory = createArchiveDirectory()
    const externalFile = path.join(externalDirectory, 'must-survive.txt')
    writeFileSync(externalFile, 'do not delete')
    const verificationRoot = path.join(archiveDirectory, '.verification')
    mkdirSync(path.join(verificationRoot, 'operation-a'), { recursive: true })
    symlinkSync(externalDirectory, path.join(verificationRoot, 'operation-a', 'escape'))

    const result = await startArchivePlaintextSweep({ archiveDirectory })

    expect(result.status).toBe('clean')
    expect(existsSync(verificationRoot)).toBe(false)
    expect(readFileSync(externalFile, 'utf8')).toBe('do not delete')
  })

  it.each(['symlink', 'file'] as const)(
    'fails closed and preserves an unsafe %s verification root',
    async (rootKind) => {
      const archiveDirectory = createArchiveDirectory()
      const externalDirectory = createArchiveDirectory()
      const verificationRoot = path.join(archiveDirectory, '.verification')
      const secret = 'SECRET-RESIDUE-NAME'
      if (rootKind === 'symlink') {
        writeFileSync(path.join(externalDirectory, secret), 'must survive')
        symlinkSync(externalDirectory, verificationRoot)
      } else {
        writeFileSync(verificationRoot, secret)
      }

      const error = await startArchivePlaintextSweep({ archiveDirectory })
        .catch((reason: unknown) => reason as Error)

      expect(error.message).toMatch(/failed safely/iu)
      expect(error.message).not.toContain(archiveDirectory)
      expect(error.message).not.toContain(secret)
      expect(lstatSync(verificationRoot).isSymbolicLink()).toBe(rootKind === 'symlink')
      if (rootKind === 'symlink') {
        expect(readFileSync(path.join(externalDirectory, secret), 'utf8')).toBe('must survive')
        unlinkSync(verificationRoot)
      } else {
        expect(readFileSync(verificationRoot, 'utf8')).toBe(secret)
      }
    },
  )

  it('sets an existing root to owner-only before cancellation leaves residue for retry', () => {
    const archiveDirectory = createArchiveDirectory()
    const verificationRoot = path.join(archiveDirectory, '.verification')
    mkdirSync(verificationRoot, { mode: 0o755 })
    writeFileSync(path.join(verificationRoot, 'first'), 'one')
    writeFileSync(path.join(verificationRoot, 'second'), 'two')
    const cancellationFlag = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    )

    expect(() => sweepArchivePlaintext({
      archiveDirectory,
      cancellationFlag,
      onProgress: () => Atomics.store(cancellationFlag, 0, 1),
    })).toThrow(/cancelled/iu)

    expect(lstatSync(verificationRoot).mode & 0o777).toBe(0o700)
  })
})
