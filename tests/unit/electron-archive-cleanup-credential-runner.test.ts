import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  startArchiveCleanupCredentialCheck,
} = require('../../electron/archive-cleanup-credential-runner.cjs') as {
  readonly startArchiveCleanupCredentialCheck: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly secret: string
    readonly signal?: AbortSignal
    readonly createWorker?: (input: Readonly<Record<string, unknown>>) => FakeWorker
  }) => CleanupCredentialOperation
}

type CleanupCredentialOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly cancel: () => void
  readonly workerExited: Promise<void>
}

class FakeWorker extends EventEmitter {
  readonly posted: Array<{ readonly message: Readonly<Record<string, unknown>>; readonly transfer: unknown }>
    = []
  readonly terminate = vi.fn(async () => 1)

  postMessage(message: Readonly<Record<string, unknown>>, transfer?: unknown) {
    this.posted.push({ message, transfer })
  }
}

const request = Object.freeze({
  operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  archiveId: '22222222-2222-4222-8222-222222222222',
  archiveKind: 'finalized',
  archiveDirectory: path.resolve('/tmp/sartracker-cleanup-archives'),
  archiveRelativePath: '22222222-2222-4222-8222-222222222222.sararch',
  missionId: 'mission-a',
  requestEventRowid: 42,
  requestEventId: '33333333-3333-4333-8333-333333333333',
  creationOperationId: '11111111-1111-4111-8111-111111111111',
  protectedFinalizationEpoch: null,
  createdAt: '2026-08-29T19:00:00.000Z',
  previousArchiveSha256: null,
  containerVersion: 2,
  schemaVersion: 13,
  inventoryVersion: 1,
  ciphertextSha256: 'a'.repeat(64),
  sizeBytes: 4096,
  frameCount: 8,
  headerSha256: 'b'.repeat(64),
  manifestSha256: 'c'.repeat(64),
  entryCount: 4,
  tableCount: 49,
  slotType: 'passphrase',
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('archive cleanup credential worker ownership [DON-253]', () => {
  it('drops the caller input before asynchronous ownership and zeroes the worker secret before hashing', () => {
    const runnerSource = readFileSync('electron/archive-cleanup-credential-runner.cjs', 'utf8')
    const runnerStart = runnerSource.indexOf('function startArchiveCleanupCredentialCheck')
    const runnerEnd = runnerSource.indexOf('\n/** Creates an unpooled secret buffer', runnerStart)
    const runnerBody = runnerSource.slice(runnerStart, runnerEnd)
    expect(runnerBody).toContain('takeArchiveCleanupCredentialOwnership')
    expect(runnerBody).not.toMatch(/input\.(?:signal|secret|workerPath|createWorker)/u)

    const workerSource = readFileSync('electron/archive-cleanup-credential.cjs', 'utf8')
    const workerStart = workerSource.indexOf('async function authenticateArchiveCleanupCredential')
    const workerEnd = workerSource.indexOf('\n/** Throws at every bounded I/O', workerStart)
    const workerBody = workerSource.slice(workerStart, workerEnd)
    expect(workerBody.indexOf('readPinnedPreamble')).toBeLessThan(
      workerBody.indexOf('digestPinnedArchive'),
    )
    expect(workerBody.indexOf('zeroBuffer(secretBytes)')).toBeLessThan(
      workerBody.indexOf('digestPinnedArchive'),
    )
  })

  it('transfers the secret outside workerData and resolves only after physical exit', async () => {
    const worker = new FakeWorker()
    let workerInput: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveCleanupCredentialCheck({
      request,
      secret: 'Four calm words 2026!',
      createWorker: (input) => {
        workerInput = input
        return worker
      },
    })
    expect(JSON.stringify(workerInput)).not.toContain('Four calm words 2026!')
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0]?.message).toMatchObject({
      type: 'credential',
      operationId: request.operationId,
    })
    expect(Object.prototype.toString.call(worker.posted[0]?.message.secretBytes))
      .toBe('[object ArrayBuffer]')
    expect((worker.posted[0]?.message.secretBytes as ArrayBuffer).byteLength).toBeGreaterThan(0)
    expect(worker.posted[0]?.transfer).toEqual([
      worker.posted[0]?.message.secretBytes,
    ])

    worker.emit('message', {
      type: 'progress',
      operationId: request.operationId,
      phase: 'ciphertext',
      unit: 'bytes',
      completed: request.sizeBytes,
      total: request.sizeBytes,
    })
    worker.emit('message', {
      type: 'complete',
      operationId: request.operationId,
      archiveId: request.archiveId,
      missionId: request.missionId,
      slotType: 'passphrase',
      ciphertextSha256: request.ciphertextSha256,
      sizeBytes: request.sizeBytes,
      fileIdentity: {
        device: '1', inode: '2', sizeBytes: 4096, linkCount: 1,
        modifiedTimeNanoseconds: '3', changedTimeNanoseconds: '4',
      },
      custodyReconciled: true,
    })
    let settled = false
    void operation.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit('exit', 0)
    await expect(operation).resolves.toMatchObject({
      archiveId: request.archiveId,
      slotType: 'passphrase',
      custodyReconciled: true,
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('maps wrong-key and hostile terminal output to closed errors without secret reflection', async () => {
    const worker = new FakeWorker()
    const secret = 'Never reflect this 2026!'
    const operation = startArchiveCleanupCredentialCheck({
      request,
      secret,
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'error',
      operationId: request.operationId,
      code: 'ARCHIVE_CLEANUP_WRONG_KEY',
      reflectedSecret: secret,
    })
    const error = await operation.catch((reason: unknown) => reason as Error & { readonly code: string })
    expect(error.code).toBe('ARCHIVE_CLEANUP_CREDENTIAL_FAILED')
    expect(error.message).not.toContain(secret)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()

    const exactWorker = new FakeWorker()
    const exact = startArchiveCleanupCredentialCheck({
      request,
      secret,
      createWorker: () => exactWorker,
    })
    exactWorker.emit('message', {
      type: 'error',
      operationId: request.operationId,
      code: 'ARCHIVE_CLEANUP_WRONG_KEY',
    })
    await expect(exact).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_WRONG_KEY' })
    exactWorker.emit('exit', 1)
  })

  it('cancels cooperatively while retaining physical-exit ownership', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const operation = startArchiveCleanupCredentialCheck({
      request,
      secret: 'Four calm words 2026!',
      signal: controller.signal,
      createWorker: () => worker,
    })
    controller.abort()
    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_CANCELLED' })
    expect(worker.posted.at(-1)?.message).toEqual({
      type: 'cancel',
      operationId: request.operationId,
    })
    let exited = false
    void operation.workerExited.then(() => { exited = true })
    await Promise.resolve()
    expect(exited).toBe(false)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects replayed or backward progress instead of extending the watchdog', async () => {
    for (const sequence of [[1, 1], [2, 1]]) {
      const worker = new FakeWorker()
      const operation = startArchiveCleanupCredentialCheck({
        request,
        secret: 'Four calm words 2026!',
        createWorker: () => worker,
      })
      for (const completed of sequence) {
        worker.emit('message', {
          type: 'progress',
          operationId: request.operationId,
          phase: 'ciphertext',
          unit: 'bytes',
          completed,
          total: request.sizeBytes,
        })
      }
      await expect(operation).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_CREDENTIAL_FAILED',
      })
      expect(worker.posted.at(-1)?.message).toEqual({
        type: 'cancel',
        operationId: request.operationId,
      })
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })
})
