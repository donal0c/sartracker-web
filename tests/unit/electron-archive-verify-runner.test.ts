import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startArchiveVerifyWorker } = require(
  '../../electron/archive-verify-runner.cjs',
) as {
  readonly startArchiveVerifyWorker: (input: {
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
const { canonicalJson } = require('../../electron/archive-container.cjs') as {
  readonly canonicalJson: (value: unknown) => string
}
const { listArchiveInventoryForSchema } = require('../../electron/archive-inventory.cjs') as {
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
  ) => readonly { readonly tableName: string }[]
}

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const creationOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const passphrase = 'Four calm words 2026!'
const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'

/** Returns one bounded exhaustive table ledger for the worker boundary. */
function verificationTables() {
  return listArchiveInventoryForSchema(13).map((declaration, index) => ({
    tableName: declaration.tableName,
    rowCount: index,
    contentSha256: createHash('sha256').update(declaration.tableName).digest('hex'),
  }))
}

/** Returns a canonical one-sample Replay proof for worker-envelope tests. */
function verificationReplaySemantic() {
  const sample = {
    selectedTime: '2026-08-29T19:00:00.000Z',
    semanticSha256: createHash('sha256').update('replay').digest('hex'),
    sampledOutingFilterCount: 0,
    totalOutingFilterCount: 0,
    sampledObjectCount: 1,
    totalObjectCount: 1,
    sampledTrackCount: 2,
    totalTrackCount: 2,
  }
  const rawProof = {
    proof_version: 3,
    sample_count: 1,
    sample_strategy: 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3',
    samples: [{
      selected_time: sample.selectedTime,
      semantic_sha256: sample.semanticSha256,
      sampled_outing_filter_count: sample.sampledOutingFilterCount,
      sampled_object_count: sample.sampledObjectCount,
      sampled_track_count: sample.sampledTrackCount,
      total_outing_filter_count: sample.totalOutingFilterCount,
      total_object_count: sample.totalObjectCount,
      total_track_count: sample.totalTrackCount,
    }],
  }
  return {
    sampled: true,
    matched: true,
    sampleCount: 1,
    sampleStrategy: rawProof.sample_strategy,
    baselineSha256: createHash('sha256').update(canonicalJson(rawProof)).digest('hex'),
    samples: [sample],
  }
}

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

/** Returns one closed secret-bearing verify request. */
function verifyRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    archiveKind: 'finalized',
    archiveDirectory: path.resolve('/tmp/sartracker-verify-runner/archives'),
    archiveRelativePath: `${archiveId}.sararch`,
    databasePath: path.resolve('/tmp/sartracker-verify-runner/mission-store.sqlite'),
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    requestEventId,
    creationOperationId,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-29T19:00:00.000Z',
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: 'a'.repeat(64),
    previousArchiveSha256: null,
    sizeBytes: 4096,
    frameCount: 8,
    headerSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
    entryCount: 4,
    tableCount: 49,
    passphrase,
    recoveryCode,
    ...overrides,
  }
}

/** Returns one exact exhaustive worker proof. */
function verificationProof(overrides: Readonly<Record<string, unknown>> = {}) {
  const tables = verificationTables()
  return {
    proofVersion: 1,
    exhaustive: true,
    archiveId,
    archiveKind: 'finalized',
    archiveRelativePath: `${archiveId}.sararch`,
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    requestEventId,
    creationOperationId,
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
    custodyFileIdentity: {
      changedTimeNanoseconds: '200', device: '1', inode: '2', linkCount: 1,
      modifiedTimeNanoseconds: '100', sizeBytes: 4096,
    },
    layers: {
      ciphertext: { exhaustive: true, matched: true },
      authenticatedFrames: { exhaustive: true, matched: true },
      entries: { exhaustive: true, matched: true, count: 4 },
      inventory: { exhaustive: true, matched: true, tableCount: 49 },
      gpxSourceBytes: {
        exhaustive: true, matched: true, recordCount: 0, exactBytesCount: 0,
        legacyHashOnlyCount: 0, legacyUnavailableCount: 0, failureUnavailableCount: 0,
        exactSourceCustodyComplete: true,
      },
      attachments: { exhaustive: true, matched: true, count: 0 },
    },
    tables,
    tableLedgerSha256: createHash('sha256').update(canonicalJson(tables)).digest('hex'),
    replaySemantic: verificationReplaySemantic(),
    durationMs: 500,
    plaintextSweepConfirmed: true,
    ...overrides,
  }
}

describe('archive verify worker runner', () => {
  it('transfers both secrets outside workerData and resolves only after clean physical exit', async () => {
    const worker = new FakeWorker()
    let workerData: Readonly<Record<string, unknown>> | undefined
    const operation = startArchiveVerifyWorker({
      request: verifyRequest(),
      createWorker: (input) => {
        workerData = input.workerData
        return worker
      },
    })

    expect(JSON.stringify(workerData)).not.toContain(passphrase)
    expect(JSON.stringify(workerData)).not.toContain(recoveryCode)
    expect(worker.posted).toHaveLength(1)
    expect(Buffer.from(worker.posted[0].passphraseBytes as ArrayBuffer).toString('utf8'))
      .toBe(passphrase)
    worker.emit('message', { type: 'complete', operationId, proof: verificationProof() })
    let settled = false
    void operation.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual(verificationProof())
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects substituted proof identity and cancels the physical worker safely', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveVerifyWorker({
      request: verifyRequest(),
      cancelGraceMs: 1,
      createWorker: () => worker,
    })

    worker.emit('message', {
      type: 'complete',
      operationId,
      proof: verificationProof({ missionId: 'mission-bravo' }),
    })
    await expect(operation).rejects.toThrow(/substituted/iu)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', operationId })
  })

  it('requires monotonic progress and contains a throwing observer', async () => {
    const worker = new FakeWorker()
    const operation = startArchiveVerifyWorker({
      request: verifyRequest(),
      cancelGraceMs: 1,
      onProgress: () => { throw new Error('observer failed') },
      createWorker: () => worker,
    })

    expect(() => worker.emit('message', {
      type: 'progress', operationId, sequence: 1, phase: 'decrypt', unit: 'bytes',
      completed: 1, total: null, detail: 'authenticated-stream',
    })).not.toThrow()
    await expect(operation).rejects.toThrow(/observer/iu)
  })

  it('does not lose synchronous abort during worker construction', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const operation = startArchiveVerifyWorker({
      request: verifyRequest(),
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

  it('uses the frozen sixty-second default progress watchdog', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const operation = startArchiveVerifyWorker({
        request: verifyRequest(),
        createWorker: () => worker,
      })
      const failure = operation.catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(59_999)
      expect(worker.posted).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(worker.posted.at(-1)).toEqual({ type: 'cancel', operationId })
      await expect(failure).resolves.toEqual(expect.objectContaining({
        message: expect.stringMatching(/progress/iu),
      }))
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a finite exact-byte deadline for restored SQLite integrity work', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const operation = startArchiveVerifyWorker({
        request: verifyRequest(),
        watchdogMs: 20,
        createWorker: () => worker,
      })
      const sqliteBytes = 4 * 1024 * 1024
      worker.emit('message', {
        type: 'progress', operationId, sequence: 1, phase: 'sqlite', unit: 'bytes',
        completed: 0, total: sqliteBytes, detail: 'restored-integrity',
      })

      await vi.advanceTimersByTimeAsync(60_999)
      expect(worker.terminate).not.toHaveBeenCalled()
      worker.emit('message', {
        type: 'progress', operationId, sequence: 2, phase: 'sqlite', unit: 'bytes',
        completed: sqliteBytes, total: sqliteBytes, detail: 'restored-integrity',
      })
      worker.emit('message', { type: 'complete', operationId, proof: verificationProof() })
      worker.emit('exit', 0)
      await expect(operation).resolves.toEqual(verificationProof())
    } finally {
      vi.useRealTimers()
    }
  })
})
