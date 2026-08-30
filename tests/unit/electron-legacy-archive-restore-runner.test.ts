import { EventEmitter } from 'node:events'
import { access, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startLegacyArchiveRestore } = require(
  '../../electron/legacy-archive-restore-runner.cjs',
) as {
  readonly startLegacyArchiveRestore: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
    readonly watchdogMs?: number
    readonly cancelGraceMs?: number
    readonly workerPath?: string
    readonly WorkerClass?: new (
      workerPath: string,
      options: { readonly workerData: Readonly<Record<string, unknown>> },
    ) => FakeWorker
  }) => LegacyArchiveRestoreOperation
}
const { mapFailureCode } = require(
  '../../electron/legacy-archive-restore-worker.cjs',
) as {
  readonly mapFailureCode: (error: unknown) => string
}

type LegacyArchiveRestoreOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
  readonly prepareClose: () => Promise<void>
}

type AttachmentMapping = Readonly<{
  entryName: string
  sourceRelativePath: string
  sha256: string
  sizeBytes: number
  references: readonly Readonly<{
    referenceKind: string
    referenceId: string
  }>[]
}>

const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const MISSION_ID = 'mission-review-fixed'
const SECRET = 'legacy archives do not accept a credential'
const DATABASE_IDENTITY = Object.freeze({
  dev: 73,
  ino: 7_302,
  sizeBytes: 610_304,
})
const temporaryRoots: string[] = []

type FakeDatabaseFileHandle = Readonly<{
  fd: number
  close: ReturnType<typeof vi.fn>
}>

let databaseFileHandle: FakeDatabaseFileHandle

/** Returns a harmless FileHandle-shaped double that never owns a process descriptor. */
function createFakeDatabaseFileHandle(): FakeDatabaseFileHandle {
  return {
    fd: 9_002,
    close: vi.fn(async () => undefined),
  }
}

/** Returns valid unique and creator-disambiguated legacy attachment mappings. */
function validAttachmentMappings(): AttachmentMapping[] {
  return [
    {
      entryName: 'attachments/briefing.pdf',
      sourceRelativePath: 'briefing.pdf',
      sha256: '1'.repeat(64),
      sizeBytes: 1_024,
      references: [
        { referenceKind: 'marker', referenceId: 'marker-current' },
        { referenceKind: 'marker_version', referenceId: 'marker-version-2' },
      ],
    },
    {
      entryName: 'attachments/0123456789ab-briefing.pdf',
      sourceRelativePath: 'briefing.pdf',
      sha256: '2'.repeat(64),
      sizeBytes: 2_048,
      references: [
        {
          referenceKind: 'marker_attachment_ingested',
          referenceId: 'attachment-ingested-event',
        },
        { referenceKind: 'marker_created', referenceId: 'marker-created-event' },
        { referenceKind: 'marker_deleted', referenceId: 'marker-deleted-event' },
        { referenceKind: 'marker_updated', referenceId: 'marker-updated-event' },
      ],
    },
  ]
}

/** Removes one property to exercise a genuinely missing result-envelope key. */
function withoutKey(
  input: Readonly<Record<string, unknown>>,
  omittedKey: string,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== omittedKey))
}

/** Removes only roots created by this test file. */
afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ))
})

/** Creates one canonical legacy runner request under a test-owned root. */
async function createRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-legacy-review-runner-'))
  temporaryRoots.push(root)
  const archivePath = path.join(root, 'archives', 'legacy-mission.zip')
  const sessionDirectory = path.join(root, 'review', SESSION_ID)
  await mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 })
  await mkdir(path.dirname(sessionDirectory), { recursive: true, mode: 0o700 })
  await writeFile(archivePath, 'LEGACY-ZIP-CUSTODY-BYTES', { mode: 0o600 })
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archivePath,
    sessionDirectory,
    expectedMissionId: MISSION_ID,
    ...overrides,
  }
}

/** Returns the exact path-free terminal metadata emitted by the legacy worker. */
function completeMessage(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archiveKind: 'legacy_unencrypted',
    containerVersion: 1,
    encrypted: false,
    immutable: true,
    missionId: MISSION_ID,
    databaseFileName: 'mission-store.sqlite',
    databaseIdentity: DATABASE_IDENTITY,
    databaseFileHandle,
    schemaVersion: 13,
    entryCount: 3,
    attachmentCount: 0,
    attachmentMappings: [],
    ...overrides,
  }
}

/** Returns the exact trusted internal result expected from the runner. */
function expectedResult(
  request: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const sessionDirectory = request.sessionDirectory as string
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archiveKind: 'legacy_unencrypted',
    containerVersion: 1,
    encrypted: false,
    immutable: true,
    missionId: MISSION_ID,
    databaseFileName: 'mission-store.sqlite',
    databaseIdentity: DATABASE_IDENTITY,
    databaseFileHandle,
    schemaVersion: 13,
    entryCount: 3,
    attachmentCount: 0,
    attachmentMappings: [],
    sessionDirectory,
    databasePath: path.join(sessionDirectory, 'mission-store.sqlite'),
    ...overrides,
  }
}

/** Minimal worker-thread double retaining lifecycle and protocol state. */
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = []

  readonly workerPath: string
  readonly workerData: Readonly<Record<string, unknown>>
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly terminate = vi.fn(async () => 1)

  constructor(
    workerPath: string,
    options: { readonly workerData: Readonly<Record<string, unknown>> },
  ) {
    super()
    this.workerPath = workerPath
    this.workerData = options.workerData
    FakeWorker.instances.push(this)
  }

  postMessage(message: Readonly<Record<string, unknown>>) {
    this.posted.push(structuredClone(message))
  }
}

/** Returns the sole worker created by the current operation. */
function worker() {
  expect(FakeWorker.instances).toHaveLength(1)
  return FakeWorker.instances[0]
}

/** Returns true when a promise has settled without consuming its rejection. */
async function hasSettled(promise: Promise<unknown>) {
  let settled = false
  void promise.then(
    () => { settled = true },
    () => { settled = true },
  )
  await Promise.resolve()
  return settled
}

/** Creates app-addressable plaintext residue owned by one restore attempt. */
async function writePlaintextResidue(sessionDirectory: string) {
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(sessionDirectory, 'mission-store.sqlite'),
    'APP-ADDRESSABLE-PLAINTEXT',
    { mode: 0o600 },
  )
}

describe('legacy archive restore runner and worker', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    databaseFileHandle = createFakeDatabaseFileHandle()
  })

  it('shape-closes the exact internal request before starting an off-main worker', async () => {
    const request = await createRequest()
    const operation = startLegacyArchiveRestore({ request, WorkerClass: FakeWorker })
    const activeWorker = worker()

    expect(Object.keys(activeWorker.workerData).sort()).toEqual([
      'cancellationBuffer',
      'request',
    ])
    expect(activeWorker.workerData.request).toEqual(request)
    expect(Object.isFrozen(activeWorker.workerData.request)).toBe(true)
    expect(activeWorker.workerData.cancellationBuffer).toBeInstanceOf(SharedArrayBuffer)
    expect(JSON.stringify(activeWorker.workerData)).not.toContain(SECRET)
    expect(activeWorker.posted).toEqual([])

    activeWorker.emit('message', completeMessage())
    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(expectedResult(request))

    const invalidRequests = [
      { ...request, secret: SECRET },
      { ...request, archiveId: 'not-part-of-the-legacy-runner-contract' },
      { ...request, operationId: 'not-a-uuid' },
      { ...request, sessionId: 'not-a-uuid' },
      { ...request, archivePath: 'relative/archive.zip' },
      { ...request, sessionDirectory: 'relative/review' },
      { ...request, sessionDirectory: path.dirname(request.sessionDirectory as string) },
      { ...request, expectedMissionId: '' },
    ]
    for (const invalidRequest of invalidRequests) {
      FakeWorker.instances = []
      expect(() => startLegacyArchiveRestore({
        request: invalidRequest,
        WorkerClass: FakeWorker,
      })).toThrow(/invalid|request|session/iu)
      expect(FakeWorker.instances).toHaveLength(0)
    }
  })

  it('accepts only one exact result envelope and resolves after physical worker exit', async () => {
    const request = await createRequest()
    const operation = startLegacyArchiveRestore({ request, WorkerClass: FakeWorker })
    const activeWorker = worker()
    activeWorker.emit('message', completeMessage())

    expect(await hasSettled(operation)).toBe(false)
    expect(await hasSettled(operation.workerExited)).toBe(false)

    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(expectedResult(request))
    await expect(operation.workerExited).resolves.toBeUndefined()

    const substitutions = [
      { extra: 'not-allowed' },
      { operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { missionId: 'another-mission' },
      { archiveKind: 'finalized' },
      { containerVersion: 2 },
      { encrypted: true },
      { immutable: false },
      { databaseFileName: '../live.sqlite' },
      { databaseIdentity: { ...DATABASE_IDENTITY, ino: 0 } },
      { databaseIdentity: { ...DATABASE_IDENTITY, extra: true } },
      { databaseFileHandle: { fd: -1, close: vi.fn(async () => undefined) } },
      { databaseFileHandle: null },
      { schemaVersion: 14 },
      { entryCount: -1 },
      { attachmentCount: Number.MAX_SAFE_INTEGER + 1 },
      { archivePath: request.archivePath },
      { sessionDirectory: request.sessionDirectory },
    ]
    for (const substitution of substitutions) {
      FakeWorker.instances = []
      databaseFileHandle = createFakeDatabaseFileHandle()
      const rejected = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const rejectedWorker = worker()
      const message = completeMessage(substitution)
      const sentHandle = message.databaseFileHandle as FakeDatabaseFileHandle | null
      rejectedWorker.emit('message', message)
      rejectedWorker.emit('exit', 1)
      await expect(rejected).rejects.toMatchObject({
        code: 'LEGACY_ARCHIVE_RESTORE_FAILED',
      })
      await expect(rejected.workerExited).resolves.toBeUndefined()
      if (sentHandle !== null && typeof sentHandle?.close === 'function') {
        expect(sentHandle.close).toHaveBeenCalledOnce()
      }
    }
  })

  it('does not report physical exit until a rejected transferred database handle is closed', async () => {
    const request = await createRequest()
    let releaseClose = () => undefined
    const closeSettled = new Promise<void>((resolve) => { releaseClose = resolve })
    databaseFileHandle = {
      fd: 9_002,
      close: vi.fn(() => closeSettled),
    }
    const operation = startLegacyArchiveRestore({
      request,
      cancelGraceMs: 30_000,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    activeWorker.emit('message', completeMessage({ extra: 'rejected-envelope' }))
    await expect(operation).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_RESTORE_FAILED' })

    activeWorker.emit('exit', 1)
    expect(await hasSettled(operation.workerExited)).toBe(false)

    releaseClose()
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(databaseFileHandle.close).toHaveBeenCalledOnce()
  })

  it('retries a transient rejected transferred handle close before reporting worker exit', async () => {
    const request = await createRequest()
    const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-restore-runner-handle-'))
    temporaryRoots.push(root)
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
      const operation = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 30_000,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      activeWorker.emit('message', completeMessage({ extra: 'rejected-envelope' }))
      await expect(operation).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_RESTORE_FAILED' })
      activeWorker.emit('exit', 1)

      await expect(operation.workerExited).resolves.toBeUndefined()
      expect(databaseFileHandle.close).toHaveBeenCalledTimes(2)
    } finally {
      await actualHandle.close().catch(() => undefined)
    }
  })

  it('shape-closes exact attachment mappings and deep-freezes the trusted result', async () => {
    const request = await createRequest()
    const attachmentMappings = validAttachmentMappings()
    const operation = startLegacyArchiveRestore({ request, WorkerClass: FakeWorker })
    const activeWorker = worker()
    activeWorker.emit('message', completeMessage({
      entryCount: 5,
      attachmentCount: 2,
      attachmentMappings,
    }))
    activeWorker.emit('exit', 0)

    const result = await operation
    expect(result).toEqual(expectedResult(request, {
      entryCount: 5,
      attachmentCount: 2,
      attachmentMappings,
    }))
    expect(Object.keys(result).sort()).toEqual([
      'archiveKind',
      'attachmentCount',
      'attachmentMappings',
      'containerVersion',
      'databaseFileHandle',
      'databaseFileName',
      'databaseIdentity',
      'databasePath',
      'encrypted',
      'entryCount',
      'immutable',
      'missionId',
      'operationId',
      'schemaVersion',
      'sessionDirectory',
      'sessionId',
    ])
    expect(Object.isFrozen(result)).toBe(true)
    const normalizedMappings = result.attachmentMappings as readonly AttachmentMapping[]
    expect(Object.isFrozen(normalizedMappings)).toBe(true)
    expect(normalizedMappings.every((mapping) => Object.isFrozen(mapping))).toBe(true)
    expect(normalizedMappings.every((mapping) => Object.isFrozen(mapping.references))).toBe(true)
    expect(normalizedMappings.flatMap((mapping) => mapping.references)
      .every((reference) => Object.isFrozen(reference))).toBe(true)
  })

  it('rejects missing, malformed, host-path, or substituted attachment mappings', async () => {
    const request = await createRequest()
    const validMapping = validAttachmentMappings()[0]!
    const attacks: readonly Readonly<Record<string, unknown>>[] = [
      withoutKey(completeMessage(), 'attachmentMappings'),
      completeMessage({ attachmentMappings: null }),
      completeMessage({ attachmentMappings: {} }),
      completeMessage({ entryCount: 4, attachmentCount: 1, attachmentMappings: [] }),
      completeMessage({ entryCount: 4, attachmentCount: 0, attachmentMappings: [validMapping] }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, extra: 'not-allowed' }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [withoutKey(validMapping, 'references')],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [withoutKey(validMapping, 'sha256')],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [withoutKey(validMapping, 'sizeBytes')],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, sha256: 'A'.repeat(64) }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, sha256: '0'.repeat(63) }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, sha256: `${'0'.repeat(63)}z` }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, sizeBytes: 0 }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, sizeBytes: 1.5 }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          sizeBytes: 8 * 1024 * 1024 * 1024 + 1,
        }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, entryName: '/tmp/briefing.pdf' }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, entryName: 'attachments/../briefing.pdf' }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, entryName: 'attachments/nested/briefing.pdf' }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, entryName: 'attachments\\briefing.pdf' }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          sourceRelativePath: '/original-host/missions/mission/attachments/briefing.pdf',
        }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          entryName: 'attachments/substituted.pdf',
        }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{ ...validMapping, references: [] }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          references: [{ referenceKind: 'marker', referenceId: 'marker-current', extra: true }],
        }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          references: [{ referenceKind: 'marker' }],
        }],
      }),
      completeMessage({
        entryCount: 4,
        attachmentCount: 1,
        attachmentMappings: [{
          ...validMapping,
          references: [{ referenceKind: 'gpx_import', referenceId: 'substituted-source' }],
        }],
      }),
      completeMessage({
        entryCount: 5,
        attachmentCount: 2,
        attachmentMappings: [validMapping, validMapping],
      }),
    ]
    for (const attack of attacks) {
      FakeWorker.instances = []
      const operation = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      activeWorker.emit('message', attack)
      activeWorker.emit('exit', 1)
      await expect(operation).rejects.toMatchObject({
        code: 'LEGACY_ARCHIVE_RESTORE_FAILED',
      })
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('projects only closed monotonic path-free progress to the caller', async () => {
    const request = await createRequest()
    const observed: Array<Readonly<Record<string, unknown>>> = []
    const operation = startLegacyArchiveRestore({
      request,
      onProgress: (progress) => observed.push(progress),
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    const messages = [
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'preflight', unit: 'files', completed: 1, total: 5,
        detail: 'archive-pinned',
      },
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 2,
        phase: 'metadata', unit: 'files', completed: 2, total: 5,
        detail: 'metadata-validated',
      },
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 3,
        phase: 'database', unit: 'files', completed: 3, total: 5,
        detail: 'database-validated',
      },
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 4,
        phase: 'attachments', unit: 'files', completed: 4, total: 5,
        detail: 'attachments-restored',
      },
      {
        type: 'progress', operationId: OPERATION_ID, sequence: 5,
        phase: 'ready', unit: 'files', completed: 5, total: 5,
        detail: 'session-ready',
      },
    ]
    for (const message of messages) activeWorker.emit('message', message)

    expect(observed).toEqual(messages.map((message) => ({
      sequence: message.sequence,
      phase: message.phase,
      unit: message.unit,
      completed: message.completed,
      total: message.total,
      detail: message.detail,
    })))
    expect(JSON.stringify(observed)).not.toContain(request.archivePath as string)
    expect(JSON.stringify(observed)).not.toContain(request.sessionDirectory as string)
    expect(JSON.stringify(observed)).not.toContain(SECRET)
    activeWorker.emit('message', completeMessage())
    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(expectedResult(request))
  })

  it('rejects regressing, out-of-bounds, path-bearing, or post-terminal progress', async () => {
    const request = await createRequest()
    const attacks: Array<readonly Readonly<Record<string, unknown>>[]> = [
      [{
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'preflight', unit: 'files', completed: 6, total: 5,
        detail: 'archive-pinned',
      }],
      [{
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'preflight', unit: 'files', completed: 1, total: 5,
        detail: request.archivePath,
      }],
      [{
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'database', unit: 'files', completed: 3, total: 5,
        detail: 'database-validated',
      }, {
        type: 'progress', operationId: OPERATION_ID, sequence: 2,
        phase: 'metadata', unit: 'files', completed: 3, total: 5,
        detail: 'metadata-validated',
      }],
      [completeMessage(), {
        type: 'progress', operationId: OPERATION_ID, sequence: 1,
        phase: 'ready', unit: 'files', completed: 5, total: 5,
        detail: 'session-ready',
      }],
    ]
    for (const attack of attacks) {
      FakeWorker.instances = []
      const operation = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      for (const message of attack) activeWorker.emit('message', message)
      activeWorker.emit('exit', 1)
      await expect(operation).rejects.toMatchObject({
        code: 'LEGACY_ARCHIVE_RESTORE_FAILED',
      })
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('does not let sequence-only no-op progress postpone the watchdog', async () => {
    vi.useFakeTimers()
    const request = await createRequest()
    const operation = startLegacyArchiveRestore({
      request,
      watchdogMs: 20,
      cancelGraceMs: 0,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    activeWorker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 1,
      phase: 'preflight', unit: 'files', completed: 1, total: 5,
      detail: 'archive-pinned',
    })
    await vi.advanceTimersByTimeAsync(15)
    activeWorker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 2,
      phase: 'preflight', unit: 'files', completed: 1, total: 5,
      detail: 'archive-pinned',
    })
    await vi.advanceTimersByTimeAsync(5)

    await expect(operation).rejects.toMatchObject({
      code: 'LEGACY_ARCHIVE_RESTORE_FAILED',
    })
    expect(activeWorker.terminate).toHaveBeenCalledOnce()
    expect(await hasSettled(operation.workerExited)).toBe(false)
    activeWorker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('uses a finite deadline that covers the maximum accepted legacy validation workload', async () => {
    vi.useFakeTimers()
    const request = await createRequest()
    const sizeBytes = 24 * 1024 * 1024 * 1024
    const expectedDeadlineMs = 60_000 + (sizeBytes / (4 * 1024 * 1024)) * 1_000
    const operation = startLegacyArchiveRestore({
      request,
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

    await vi.advanceTimersByTimeAsync(expectedDeadlineMs - 1)
    expect(rejected).toBe(false)
    expect(activeWorker.terminate).not.toHaveBeenCalled()
    activeWorker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 2,
      phase: 'validate', unit: 'bytes', completed: sizeBytes, total: sizeBytes,
      detail: 'sqlite-integrity-checked',
    })
    activeWorker.emit('message', completeMessage())
    activeWorker.emit('exit', 0)
    await expect(operation).resolves.toEqual(expectedResult(request))

    FakeWorker.instances = []
    const stalled = startLegacyArchiveRestore({
      request,
      watchdogMs: 20,
      cancelGraceMs: 0,
      WorkerClass: FakeWorker,
    })
    const stalledWorker = worker()
    stalledWorker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 1,
      phase: 'validate', unit: 'bytes', completed: 0, total: sizeBytes,
      detail: 'sqlite-integrity-check',
    })
    await vi.advanceTimersByTimeAsync(expectedDeadlineMs)
    await expect(stalled).rejects.toMatchObject({
      code: 'LEGACY_ARCHIVE_RESTORE_FAILED',
    })
    stalledWorker.emit('exit', 1)
    await expect(stalled.workerExited).resolves.toBeUndefined()
  })

  it('cancels immediately, joins physical exit, and leaves cleanup to the main owner', async () => {
    const request = await createRequest()
    const sessionDirectory = request.sessionDirectory as string
    const operation = startLegacyArchiveRestore({
      request,
      cancelGraceMs: 1_000,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    const cancellationFlag = new Int32Array(
      activeWorker.workerData.cancellationBuffer as SharedArrayBuffer,
    )
    await writePlaintextResidue(sessionDirectory)

    operation.cancel()
    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    expect(Atomics.load(cancellationFlag, 0)).toBe(1)
    expect(activeWorker.posted).toEqual([{
      type: 'cancel',
      operationId: OPERATION_ID,
    }])
    expect(await hasSettled(operation.workerExited)).toBe(false)

    activeWorker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    await expect(access(sessionDirectory)).resolves.toBeUndefined()
  })

  it('closes a real transferred handle from a late complete after public cancellation', async () => {
    const request = await createRequest()
    const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-restore-late-complete-'))
    temporaryRoots.push(root)
    const databasePath = path.join(root, 'mission-store.sqlite')
    await writeFile(databasePath, 'LATE-TRANSFERRED-PLAINTEXT', { mode: 0o600 })
    const actualHandle = await open(databasePath, 'r+')
    databaseFileHandle = {
      fd: actualHandle.fd,
      close: vi.fn(() => actualHandle.close()),
    }
    try {
      const operation = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 30_000,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      operation.cancel()
      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })

      activeWorker.emit('message', completeMessage())
      activeWorker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()

      expect(databaseFileHandle.close).toHaveBeenCalledOnce()
      await expect(actualHandle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    } finally {
      await actualHandle.close().catch(() => undefined)
    }
  })

  it('forces a stalled worker while prepareClose waits for physical exit without deleting paths', async () => {
    vi.useFakeTimers()
    const request = await createRequest()
    const sessionDirectory = request.sessionDirectory as string
    const operation = startLegacyArchiveRestore({
      request,
      cancelGraceMs: 25,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    await writePlaintextResidue(sessionDirectory)

    const prepared = operation.prepareClose()
    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    await vi.advanceTimersByTimeAsync(25)
    expect(activeWorker.terminate).toHaveBeenCalledOnce()
    expect(await hasSettled(prepared)).toBe(false)
    expect(await hasSettled(operation.workerExited)).toBe(false)

    activeWorker.emit('exit', 143)
    await expect(prepared).resolves.toBeUndefined()
    await expect(operation.workerExited).resolves.toBeUndefined()
    await expect(access(sessionDirectory)).resolves.toBeUndefined()
  })

  it('maps disk-full, corruption, and newer-schema worker failures to a closed vocabulary', async () => {
    expect(mapFailureCode({ code: 'ENOSPC' })).toBe('LEGACY_ARCHIVE_DISK_FULL')
    expect(mapFailureCode({ code: 'LEGACY_ARCHIVE_CORRUPT_ENTRY' }))
      .toBe('LEGACY_ARCHIVE_CORRUPT_ENTRY')
    expect(mapFailureCode({ code: 'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA' }))
      .toBe('LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA')
    expect(mapFailureCode({
      code: 'UNTRUSTED',
      message: `${SECRET} at /tmp/plaintext/mission-store.sqlite`,
    })).toBe('LEGACY_ARCHIVE_RESTORE_FAILED')

    const request = await createRequest()
    const codes = [
      'LEGACY_ARCHIVE_DISK_FULL',
      'LEGACY_ARCHIVE_CORRUPT_ENTRY',
      'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA',
    ]
    for (const code of codes) {
      FakeWorker.instances = []
      const operation = startLegacyArchiveRestore({
        request,
        cancelGraceMs: 0,
        WorkerClass: FakeWorker,
      })
      const activeWorker = worker()
      activeWorker.emit('message', {
        type: 'error',
        operationId: OPERATION_ID,
        code,
        message: `${SECRET} at ${request.sessionDirectory as string}`,
        archivePath: request.archivePath,
      })
      activeWorker.emit('exit', 1)
      const failure = await operation.catch((error: unknown) => error) as Error & { code?: string }
      expect(failure.code).toBe(code)
      expect(failure.message).not.toContain(SECRET)
      expect(failure.message).not.toContain(request.archivePath as string)
      expect(failure.message).not.toContain(request.sessionDirectory as string)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('reports failed-worker exit while retaining residue for the main identity-pinned sweep', async () => {
    const request = await createRequest()
    const sessionDirectory = request.sessionDirectory as string
    const operation = startLegacyArchiveRestore({
      request,
      cancelGraceMs: 0,
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    await writePlaintextResidue(sessionDirectory)
    activeWorker.emit('message', {
      type: 'error',
      operationId: OPERATION_ID,
      code: 'LEGACY_ARCHIVE_CORRUPT_ENTRY',
    })
    activeWorker.emit('exit', 1)

    await expect(operation).rejects.toMatchObject({
      code: 'LEGACY_ARCHIVE_CORRUPT_ENTRY',
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
    await expect(access(sessionDirectory)).resolves.toBeUndefined()
  })

  it('fails pre-abort and observer exceptions without starting or leaking work', async () => {
    const request = await createRequest()
    const controller = new AbortController()
    controller.abort()
    const preAborted = startLegacyArchiveRestore({
      request,
      signal: controller.signal,
      WorkerClass: FakeWorker,
    })
    await expect(preAborted).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    await expect(preAborted.workerExited).resolves.toBeUndefined()
    expect(FakeWorker.instances).toHaveLength(0)

    const observerFailure = startLegacyArchiveRestore({
      request,
      cancelGraceMs: 0,
      onProgress: () => { throw new Error(`${SECRET} observer`) },
      WorkerClass: FakeWorker,
    })
    const activeWorker = worker()
    activeWorker.emit('message', {
      type: 'progress', operationId: OPERATION_ID, sequence: 1,
      phase: 'preflight', unit: 'files', completed: 1, total: 5,
      detail: 'archive-pinned',
    })
    activeWorker.emit('exit', 1)
    const failure = await observerFailure.catch((error: unknown) => error) as Error & { code?: string }
    expect(failure.code).toBe('LEGACY_ARCHIVE_RESTORE_FAILED')
    expect(failure.message).not.toContain(SECRET)
    await expect(observerFailure.workerExited).resolves.toBeUndefined()
  })
})
