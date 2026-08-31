import { EventEmitter } from 'node:events'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
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

const { startArchiveReviewSweep } = require(
  '../../electron/archive-review-sweep-runner.cjs',
) as {
  readonly startArchiveReviewSweep: (input: Readonly<Record<string, unknown>>) => SweepOperation
}

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

/** Minimal controllable worker double for runner protocol attacks. */
class FakeWorker extends EventEmitter {
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly terminate = vi.fn(async () => 1)

  postMessage(message: Readonly<Record<string, unknown>>) {
    this.posted.push(structuredClone(message))
  }
}

const temporaryRoots = new Set<string>()

/** Creates one real, custody-separated review sweep ticket. */
function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sartracker-review-sweep-runner-'))
  temporaryRoots.add(root)
  const reviewRoot = path.join(root, 'review')
  const archiveDirectory = path.join(root, 'archives')
  const quarantineDirectory = path.join(reviewRoot, `.sweep-${SESSION_ID}`)
  mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(archiveDirectory, { mode: 0o700 })
  const reviewStat = lstatSync(reviewRoot)
  const quarantineStat = lstatSync(quarantineDirectory)
  const archiveStat = lstatSync(archiveDirectory)
  return {
    root,
    reviewRoot,
    archiveDirectory,
    quarantineDirectory,
    ticket: {
      operationId: OPERATION_ID,
      reviewRoot,
      rootIdentity: { dev: reviewStat.dev, ino: reviewStat.ino },
      quarantineDirectory,
      quarantineIdentity: { dev: quarantineStat.dev, ino: quarantineStat.ino },
      archiveDirectory,
      archiveDirectoryIdentity: {
        dev: archiveStat.dev,
        ino: archiveStat.ino,
        realPath: realpathSync(archiveDirectory),
      },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
  temporaryRoots.clear()
})

describe('archive review plaintext sweep runner', () => {
  it('validates an exact ticket before creating a worker', () => {
    const fixture = createFixture()
    const createWorker = vi.fn()

    expect(() => startArchiveReviewSweep({
      ...fixture.ticket,
      rootIdentity: { ...fixture.ticket.rootIdentity, reflectedPath: '/private/secret' },
      createWorker,
    })).toThrow(/identity|scope|invalid/iu)
    expect(() => startArchiveReviewSweep({
      ...fixture.ticket,
      quarantineDirectory: path.join(fixture.root, `.sweep-${SESSION_ID}`),
      createWorker,
    })).toThrow(/scope|invalid/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('returns only the exact matching result and waits for physical worker exit', async () => {
    const fixture = createFixture()
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveReviewSweep({
      ...fixture.ticket,
      createWorker: (input: WorkerInput) => {
        workerData = input.workerData
        return worker
      },
    })

    expect(workerData?.ticket).toEqual(fixture.ticket)
    expect(workerData?.cancellationBuffer).toBeInstanceOf(SharedArrayBuffer)
    worker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 1, removedEntryCount: 2,
    })
    worker.emit('message', {
      type: 'complete', operationId: OPERATION_ID, status: 'clean', removedEntryCount: 2,
    })
    let settled = false
    void operation.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual({ status: 'clean', removedEntryCount: 2 })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('fails closed on substituted progress and terminal results without reflecting data', async () => {
    const fixture = createFixture()
    const secret = `${fixture.root}/SECRET-PLAINTEXT`

    for (const message of [
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        removedEntryCount: 1, reflectedPath: secret,
      },
      {
        type: 'complete', operationId: OPERATION_ID, status: 'clean',
        removedEntryCount: 1, reflectedPath: secret,
      },
      {
        type: 'complete', operationId: SESSION_ID, status: 'clean', removedEntryCount: 1,
      },
    ]) {
      const worker = new FakeWorker()
      const operation = startArchiveReviewSweep({
        ...fixture.ticket,
        cancelGraceMs: 30_000,
        createWorker: () => worker,
      })
      worker.emit('message', message)
      const error = await operation.catch((reason: unknown) => reason as Error & { code?: string })
      expect(error.code).toBe('ARCHIVE_REVIEW_SWEEP_FAILED')
      expect(error.message).not.toContain(secret)
      expect(error.message).not.toContain(fixture.root)
      expect(worker.posted).toEqual([{ type: 'cancel', operationId: OPERATION_ID }])
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('accepts only one exact error envelope and treats a second terminal as substitution', async () => {
    const fixture = createFixture()
    const malformedWorker = new FakeWorker()
    const malformed = startArchiveReviewSweep({
      ...fixture.ticket,
      cancelGraceMs: 30_000,
      createWorker: () => malformedWorker,
    })
    malformedWorker.emit('message', {
      type: 'error',
      operationId: OPERATION_ID,
      code: 'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
      reflectedPath: `${fixture.root}/SECRET`,
    })
    await expect(malformed).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_SWEEP_FAILED' })
    malformedWorker.emit('exit', 1)
    await expect(malformed.workerExited).resolves.toBeUndefined()

    const duplicatedWorker = new FakeWorker()
    const duplicated = startArchiveReviewSweep({
      ...fixture.ticket,
      cancelGraceMs: 30_000,
      createWorker: () => duplicatedWorker,
    })
    duplicatedWorker.emit('message', {
      type: 'complete', operationId: OPERATION_ID, status: 'clean', removedEntryCount: 1,
    })
    duplicatedWorker.emit('message', {
      type: 'error', operationId: OPERATION_ID, code: 'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
    })
    await expect(duplicated).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_SWEEP_FAILED' })
    duplicatedWorker.emit('exit', 1)
    await expect(duplicated.workerExited).resolves.toBeUndefined()
  })

  it('uses cooperative cancellation and retains physical-exit ownership', async () => {
    const fixture = createFixture()
    const worker = new FakeWorker()
    let cancellationFlag: Int32Array | undefined
    const operation = startArchiveReviewSweep({
      ...fixture.ticket,
      cancelGraceMs: 30_000,
      createWorker: ({ workerData }: WorkerInput) => {
        cancellationFlag = new Int32Array(
          workerData.cancellationBuffer as SharedArrayBuffer,
        )
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
    expect(worker.posted).toEqual([{ type: 'cancel', operationId: OPERATION_ID }])
    await Promise.resolve()
    expect(physicallyExited).toBe(false)

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(physicallyExited).toBe(true)
  })

  it('watchdogs stalled work, forces termination, and joins the eventual exit', async () => {
    vi.useFakeTimers()
    const fixture = createFixture()
    const worker = new FakeWorker()
    const operation = startArchiveReviewSweep({
      ...fixture.ticket,
      watchdogMs: 25,
      cancelGraceMs: 10,
      createWorker: () => worker,
    })
    const failure = operation.catch((reason: unknown) => reason as Error & { code?: string })

    await vi.advanceTimersByTimeAsync(24)
    expect(worker.posted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await expect(failure).resolves.toMatchObject({ code: 'ARCHIVE_REVIEW_SWEEP_FAILED' })
    expect(worker.posted).toEqual([{ type: 'cancel', operationId: OPERATION_ID }])
    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })
    await Promise.resolve()
    expect(physicallyExited).toBe(false)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('runs the real worker to completion without leaving plaintext behind', async () => {
    const fixture = createFixture()
    writeFileSync(path.join(fixture.quarantineDirectory, 'mission-store.sqlite'), 'plaintext')

    const operation = startArchiveReviewSweep(fixture.ticket)

    await expect(operation).resolves.toEqual({ status: 'clean', removedEntryCount: 2 })
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(() => lstatSync(fixture.quarantineDirectory)).toThrow()
  })
})
