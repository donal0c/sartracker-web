import { randomUUID } from 'node:crypto'
import fsSync from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createArchiveReviewSessionManager, removeOwnedSessionDirectory } = require(
  '../../electron/archive-review-sessions.cjs',
) as {
  readonly createArchiveReviewSessionManager: (
    input: Readonly<Record<string, unknown>>,
  ) => ArchiveReviewSessionManager
  readonly removeOwnedSessionDirectory: (
    reviewRoot: string,
    sessionDirectory: string,
    rootIdentity: { readonly dev: number; readonly ino: number },
    archiveDirectory: string,
    archiveDirectoryIdentity: {
      readonly dev: number
      readonly ino: number
      readonly realPath: string
    },
    dependencies?: {
      readonly beforeQuarantine?: () => Promise<void>
      readonly startReviewSweep?: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
    },
  ) => Promise<void>
}

interface ArchiveReviewSessionManager {
  readonly acquireCleanupLease: (missionId: string) => {
    readonly missionId: string
    readonly release: () => void
  }
  readonly hasReviewActivity: () => boolean
  readonly open: (input: {
    readonly senderId: number
    readonly request: Readonly<Record<string, unknown>>
    readonly secret?: string
  }) => Promise<Readonly<Record<string, unknown>>>
  readonly close: (input: {
    readonly senderId: number
    readonly sessionId: string
  }) => Promise<void>
  readonly cancel: (input: {
    readonly senderId: number
    readonly operationId: string
  }) => Promise<boolean>
  readonly closeForSender: (senderId: number) => Promise<void>
  readonly read: (input: {
    readonly senderId: number
    readonly sessionId: string
    readonly method: string
    readonly args?: readonly unknown[]
  }) => Promise<unknown>
  readonly recordMutationDenied: (input: {
    readonly senderId: number
    readonly sessionId: string
    readonly attemptedMethod: string
    readonly boundary: 'facade' | 'ipc'
  }) => boolean
  readonly sweepStartup: () => Promise<void>
  readonly prepareClose: () => Promise<void>
}

interface RestoreOperation extends Promise<Readonly<Record<string, unknown>>> {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
  readonly prepareClose: () => Promise<void>
}

const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const SECOND_OPERATION_ID = '5ca652f8-f624-4da2-bb6c-a80525d9ed44'
const THIRD_OPERATION_ID = '65eed745-b8b7-433f-a6a7-35214aa87cc5'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const CREATION_OPERATION_ID = '73e9012a-a911-4c25-9b26-c94ff5ae23af'
const REQUEST_EVENT_ID = '81df865d-1aaa-4561-8cae-02d1e17a1212'
const MISSION_ID = 'mission-review-fixed'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)
const HEADER_SHA256 = 'b'.repeat(64)
const SECRET = 'Correct Horse Battery Staple 9!'
const OPENED_AT = '2026-08-30T09:00:00.000Z'
const SENDER_ID = 71
const OTHER_SENDER_ID = 72
const DATABASE_IDENTITY = Object.freeze({
  dev: 73,
  ino: 7_303,
  sizeBytes: 18,
})

const temporaryRoots: string[] = []

type FakeDatabaseFileHandle = Readonly<{
  fd: number
  close: ReturnType<typeof vi.fn>
}>

/** Returns a harmless FileHandle-shaped double that never owns a process descriptor. */
function createFakeDatabaseFileHandle(): FakeDatabaseFileHandle {
  return {
    fd: 9_003,
    close: vi.fn(async () => undefined),
  }
}

/** Removes test-owned session roots after each attack case. */
afterEach(async () => {
  await Promise.allSettled(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ))
})

/** Returns one exact public open request; secrets remain a separate argument. */
function openRequest(
  operationId = OPERATION_ID,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    operationId,
    archiveId: ARCHIVE_ID,
    slotType: 'passphrase',
    ...overrides,
  }
}

/** Returns one trusted registry review ticket. */
function reviewTicket(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    archiveId: ARCHIVE_ID,
    archiveKind: 'finalized',
    archiveRelativePath: `${ARCHIVE_ID}.sararch`,
    missionId: MISSION_ID,
    requestEventRowid: 42,
    requestEventId: REQUEST_EVENT_ID,
    creationOperationId: CREATION_OPERATION_ID,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-30T08:00:00.000Z',
    status: 'verified',
    availability: 'present',
    verifiedAt: '2026-08-30T08:00:00.000Z',
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
    previousArchiveId: null,
    previousArchiveSha256: null,
    slots: [
      { slotType: 'passphrase', slotId: 'passphrase-main' },
      { slotType: 'recovery', slotId: 'recovery-main' },
    ],
    ...overrides,
  }
}

/** Returns one exact internal restore result with paths that must stay main-process-only. */
function internalRestoreResult(
  reviewRoot: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const sessionDirectory = path.join(reviewRoot, SESSION_ID)
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    archiveId: ARCHIVE_ID,
    missionId: MISSION_ID,
    containerVersion: 2,
    schemaVersion: 13,
    encrypted: true,
    verified: true,
    ciphertextSha256: CIPHERTEXT_SHA256,
    headerSha256: HEADER_SHA256,
    previousArchiveId: null,
    sessionDirectory,
    databasePath: path.join(sessionDirectory, 'mission-store.sqlite'),
    databaseIdentity: DATABASE_IDENTITY,
    databaseFileHandle: createFakeDatabaseFileHandle(),
    attachmentMappings: [],
    ...overrides,
  }
}

/** Decorates a restore promise with the runner's physical-lifecycle controls. */
function decorateRestoreOperation(
  completion: Promise<Readonly<Record<string, unknown>>>,
  input: {
    readonly workerExited?: Promise<void>
    readonly cancel?: () => void
  } = {},
) {
  const workerExited = input.workerExited ?? completion.then(
    () => undefined,
    () => undefined,
  )
  const cancel = input.cancel ?? (() => undefined)
  Object.defineProperties(completion, {
    workerExited: { value: workerExited },
    cancel: { value: cancel },
    prepareClose: {
      value: async () => {
        cancel()
        await workerExited
      },
    },
  })
  return completion as RestoreOperation
}

/** Creates one externally controlled promise. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Creates one temporary review fixture and dependency-injected manager. */
async function createHarness(input: {
  readonly ticket?: Readonly<Record<string, unknown>>
  readonly startRestore?: (
    input: Readonly<Record<string, unknown>>,
  ) => RestoreOperation
  readonly restoreLegacy?: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
  readonly removeSessionDirectory?: (sessionDirectory: string) => Promise<void>
  readonly useDefaultRemoveSessionDirectory?: boolean
  readonly createSource?: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>
  readonly openRestoredAttachment?: (restoredPath: string) => Promise<boolean>
  readonly recordMutationDenied?: (input: {
    readonly senderId: number
    readonly sessionId: string
    readonly attemptedMethod: string
    readonly boundary: 'facade' | 'ipc'
    readonly deniedAt: string
  }) => void
  readonly recordReviewClosed?: (input: Readonly<Record<string, unknown>>) => void
  readonly recordReviewOpened?: (input: Readonly<Record<string, unknown>>) => void
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-archive-review-sessions-'))
  temporaryRoots.push(root)
  const archiveDirectory = path.join(root, 'archives')
  const reviewRoot = path.join(root, 'review')
  const liveDatabasePath = path.join(root, 'mission-store.sqlite')
  const archivePath = path.join(archiveDirectory, `${ARCHIVE_ID}.sararch`)
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
  await mkdir(reviewRoot, { recursive: true, mode: 0o700 })
  await writeFile(liveDatabasePath, 'LIVE-MISSION-BYTES', { mode: 0o600 })
  await writeFile(archivePath, 'SEALED-CIPHERTEXT-BYTES', { mode: 0o600 })

  let ticket = input.ticket ?? reviewTicket()
  const registry = {
    issueReviewTicket: vi.fn(() => ticket),
    recordReviewOpened: vi.fn(input.recordReviewOpened ?? (() => undefined)),
    recordReviewClosed: vi.fn(input.recordReviewClosed ?? (() => undefined)),
    recordReviewMutationDenied: vi.fn(() => undefined),
  }
  const sourceClose = vi.fn(async () => undefined)
  const defaultCreateSource = (sourceInput: Readonly<Record<string, unknown>>) => ({
    close: async () => {
      await sourceClose()
      await (sourceInput.databaseFileHandle as FakeDatabaseFileHandle).close()
    },
  })
  const createSource = vi.fn(input.createSource ?? defaultCreateSource)
  const defaultStartRestore = (restoreInput: Readonly<Record<string, unknown>>) => {
    const request = restoreInput.request as Readonly<Record<string, unknown>>
    const sessionId = request.sessionId as string
    const sessionDirectory = path.join(reviewRoot, sessionId)
    const databasePath = path.join(sessionDirectory, 'mission-store.sqlite')
    const completion = (async () => {
      await mkdir(sessionDirectory, { recursive: false, mode: 0o700 })
      await writeFile(databasePath, 'RESTORED-PLAINTEXT', { mode: 0o600 })
      return internalRestoreResult(reviewRoot, { sessionDirectory, databasePath })
    })()
    return decorateRestoreOperation(completion)
  }
  const startRestore = vi.fn(input.startRestore ?? defaultStartRestore)
  const restoreLegacy = vi.fn(input.restoreLegacy ?? (async (restoreInput) => {
    const request = restoreInput.request as Readonly<Record<string, unknown>>
    const sessionDirectory = request.sessionDirectory as string
    const databasePath = path.join(sessionDirectory, 'mission-store.sqlite')
    await mkdir(sessionDirectory, { recursive: false, mode: 0o700 })
    await writeFile(databasePath, 'RESTORED-LEGACY-PLAINTEXT', { mode: 0o600 })
    const databaseFileHandle = createFakeDatabaseFileHandle()
    return {
      operationId: request.operationId,
      sessionId: request.sessionId,
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
      databasePath,
    }
  }))
  const removeSessionDirectory = input.useDefaultRemoveSessionDirectory
    ? undefined
    : vi.fn(input.removeSessionDirectory ?? (async (directory) => {
        await rm(directory, { recursive: true, force: true })
      }))
  const manager = createArchiveReviewSessionManager({
    reviewRoot,
    archiveDirectory,
    liveDatabasePath,
    registry,
    startRestore,
    restoreLegacy,
    createSource,
    ...(input.openRestoredAttachment === undefined
      ? {}
      : { openRestoredAttachment: input.openRestoredAttachment }),
    ...(input.recordMutationDenied === undefined
      ? {}
      : { recordMutationDenied: input.recordMutationDenied }),
    ...(removeSessionDirectory === undefined ? {} : { removeSessionDirectory }),
    randomUUID: () => SESSION_ID,
    now: () => OPENED_AT,
  })

  return {
    root,
    reviewRoot,
    archiveDirectory,
    liveDatabasePath,
    archivePath,
    manager,
    registry,
    startRestore,
    restoreLegacy,
    createSource,
    sourceClose,
    removeSessionDirectory,
    setTicket: (next: Readonly<Record<string, unknown>>) => { ticket = next },
  }
}

/** Opens one session through the public sender-owned boundary. */
function openSession(
  harness: Awaited<ReturnType<typeof createHarness>>,
  input: {
    readonly senderId?: number
    readonly operationId?: string
    readonly slotType?: 'passphrase' | 'recovery'
    readonly secret?: string
  } = {},
) {
  return harness.manager.open({
    senderId: input.senderId ?? SENDER_ID,
    request: openRequest(input.operationId ?? OPERATION_ID, {
      containerVersion: 2,
      slotType: input.slotType ?? 'passphrase',
    }),
    secret: input.secret ?? SECRET,
  })
}

/** Opens one credential-free legacy v1 review session. */
function openLegacySession(
  harness: Awaited<ReturnType<typeof createHarness>>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return harness.manager.open({
    senderId: SENDER_ID,
    request: {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      ...overrides,
    },
  })
}

describe('archive review session manager', () => {
  it('makes archive review and live-store cleanup mutually exclusive across every session phase', async () => {
    const harness = await createHarness()
    expect(harness.manager.hasReviewActivity()).toBe(false)

    const lease = harness.manager.acquireCleanupLease(MISSION_ID)
    expect(lease.missionId).toBe(MISSION_ID)
    expect(() => harness.manager.acquireCleanupLease(MISSION_ID)).toThrow(/cleanup|active/iu)
    await expect(openSession(harness)).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_CLEANUP_ACTIVE',
    })

    lease.release()
    expect(() => lease.release()).toThrow(/lease|released/iu)
    await expect(openSession(harness)).resolves.toMatchObject({ missionId: MISSION_ID })
    expect(harness.manager.hasReviewActivity()).toBe(true)
    expect(() => harness.manager.acquireCleanupLease(MISSION_ID)).toThrow(/review|active/iu)

    await harness.manager.close({ senderId: SENDER_ID, sessionId: SESSION_ID })
    expect(harness.manager.hasReviewActivity()).toBe(false)
    expect(() => harness.manager.acquireCleanupLease('')).toThrow(/mission|invalid/iu)
  })

  it('opens only an exact verified archive, exposes the residual, and never publishes a path', async () => {
    const harness = await createHarness()
    const publicSession = await openSession(harness)

    expect(publicSession).toEqual({
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      containerVersion: 2,
      encrypted: true,
      verified: true,
      immutable: true,
      ciphertextSha256: CIPHERTEXT_SHA256,
      previousArchiveId: null,
      openedAt: OPENED_AT,
      plaintextResidual: 'permission_restricted_session_open',
    })
    expect(JSON.stringify(publicSession)).not.toMatch(/path|directory|scratch|database/iu)
    expect(harness.registry.issueReviewTicket).toHaveBeenCalledWith(ARCHIVE_ID)
    expect(harness.registry.recordReviewOpened).toHaveBeenCalledOnce()
    expect(JSON.stringify(harness.registry.recordReviewOpened.mock.calls)).not.toContain(SECRET)

    const restoreInput = harness.startRestore.mock.calls[0][0] as Readonly<Record<string, unknown>>
    expect(restoreInput.secret).toBe(SECRET)
    expect(restoreInput.request).toMatchObject({
      operationId: OPERATION_ID,
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      slotType: 'passphrase',
      archiveDirectory: harness.archiveDirectory,
      reviewRoot: harness.reviewRoot,
    })
    expect(JSON.stringify(restoreInput.request)).not.toContain(SECRET)
    expect(restoreInput.request).not.toHaveProperty('passphrase')
    expect(restoreInput.request).not.toHaveProperty('recoveryCode')

    const sessionDirectory = path.join(harness.reviewRoot, SESSION_ID)
    const databasePath = path.join(sessionDirectory, 'mission-store.sqlite')
    expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600)
  })

  it('rejects weak or non-canonical credentials before ticket issuance or restore', async () => {
    const harness = await createHarness()
    const attacks = [
      { slotType: 'passphrase' as const, secret: 'short-A1!' },
      { slotType: 'passphrase' as const, secret: 'alllowercaseletters' },
      { slotType: 'passphrase' as const, secret: 'Valid-Looking9!\n' },
      {
        slotType: 'recovery' as const,
        secret: '01234-56789-abcde-FGHJK-MNPQR-STVWX-YZ012-34567',
      },
    ]

    for (const attack of attacks) {
      await expect(openSession(harness, attack)).rejects.toThrow(/credential|invalid/iu)
    }
    expect(harness.registry.issueReviewTicket).not.toHaveBeenCalled()
    expect(harness.startRestore).not.toHaveBeenCalled()
  })

  it('passes the main-owned restored-attachment opener only to the internal read source', async () => {
    const openRestoredAttachment = vi.fn(async () => true)
    const harness = await createHarness({ openRestoredAttachment })

    const publicSession = await openSession(harness)

    expect(harness.createSource).toHaveBeenCalledWith(expect.objectContaining({
      expectedDatabaseIdentity: DATABASE_IDENTITY,
      databaseFileHandle: expect.objectContaining({ fd: 9_003 }),
      openRestoredAttachment,
    }))
    expect(JSON.stringify(publicSession)).not.toMatch(/attachment|openRestored|path/iu)
  })

  it('accepts a superseded verified revision but rejects every untrusted registry state before restore', async () => {
    const superseded = await createHarness({
      ticket: reviewTicket({ status: 'superseded' }),
    })
    await expect(openSession(superseded)).resolves.toMatchObject({
      archiveId: ARCHIVE_ID,
      verified: true,
    })
    await superseded.manager.close({ senderId: SENDER_ID, sessionId: SESSION_ID })

    const harness = await createHarness()
    const invalidTickets = [
      reviewTicket({ status: 'sealed', verifiedAt: null }),
      reviewTicket({ availability: 'missing' }),
      reviewTicket({ containerVersion: 3 }),
      reviewTicket({ schemaVersion: 14 }),
      reviewTicket({ slots: [{ slotType: 'recovery', slotId: 'recovery-main' }] }),
    ]
    const operationIds = [
      OPERATION_ID,
      SECOND_OPERATION_ID,
      THIRD_OPERATION_ID,
      randomUUID(),
      randomUUID(),
    ]
    for (const [index, invalidTicket] of invalidTickets.entries()) {
      harness.setTicket(invalidTicket)
      const callsBefore = harness.startRestore.mock.calls.length
      await expect(openSession(harness, { operationId: operationIds[index] })).rejects.toThrow()
      expect(harness.startRestore).toHaveBeenCalledTimes(callsBefore)
      expect(await readFile(harness.liveDatabasePath, 'utf8')).toBe('LIVE-MISSION-BYTES')
      expect(await readFile(harness.archivePath, 'utf8')).toBe('SEALED-CIPHERTEXT-BYTES')
    }
  })

  it('opens a present legacy v1 archive without accepting a credential or claiming encryption', async () => {
    const harness = await createHarness({
      ticket: {
        archiveId: ARCHIVE_ID,
        archiveKind: 'finalized',
        archiveRelativePath: 'legacy-review.zip',
        missionId: MISSION_ID,
        containerVersion: 1,
        status: 'sealed',
        availability: 'present',
        createdAt: '2026-08-30T08:00:00.000Z',
        verifiedAt: null,
        previousArchiveId: null,
        encrypted: false,
        immutable: true,
        slots: [],
      },
    })

    await expect(openLegacySession(harness)).resolves.toEqual({
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      containerVersion: 1,
      encrypted: false,
      verified: false,
      immutable: true,
      ciphertextSha256: null,
      previousArchiveId: null,
      openedAt: OPENED_AT,
      plaintextResidual: 'permission_restricted_session_open',
    })
    expect(harness.startRestore).not.toHaveBeenCalled()
    expect(harness.restoreLegacy).toHaveBeenCalledWith({
      request: {
        operationId: OPERATION_ID,
        sessionId: SESSION_ID,
        archivePath: path.join(harness.archiveDirectory, 'legacy-review.zip'),
        sessionDirectory: path.join(harness.reviewRoot, SESSION_ID),
        expectedMissionId: MISSION_ID,
      },
    })
    expect(JSON.stringify(harness.restoreLegacy.mock.calls)).not.toContain(SECRET)

    await harness.manager.close({ senderId: SENDER_ID, sessionId: SESSION_ID })
    expect(await readdir(harness.reviewRoot)).toEqual([])

    const credentialAttacks = [
      { secret: SECRET },
      { request: { slotType: 'passphrase' } },
      { request: { slotType: 'recovery' } },
    ]
    for (const [index, attack] of credentialAttacks.entries()) {
      const attackHarness = await createHarness({ ticket: harness.registry.issueReviewTicket() })
      const input = {
        senderId: SENDER_ID,
        request: {
          operationId: [SECOND_OPERATION_ID, THIRD_OPERATION_ID, randomUUID()][index],
          archiveId: ARCHIVE_ID,
          containerVersion: 1,
          ...(attack.request ?? {}),
        },
        ...(attack.secret === undefined ? {} : { secret: attack.secret }),
      }
      await expect(attackHarness.manager.open(input)).rejects.toThrow(/invalid|unsupported/iu)
      expect(attackHarness.startRestore).not.toHaveBeenCalled()
      expect(attackHarness.restoreLegacy).not.toHaveBeenCalled()
    }
  })

  it('rejects restored identity or path substitution, sweeps plaintext, and never opens a source', async () => {
    const cases: Array<Readonly<Record<string, unknown>>> = [
      { operationId: SECOND_OPERATION_ID },
      { archiveId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { missionId: 'another-mission' },
      { sessionDirectory: path.resolve('/tmp/not-the-owned-review-session') },
      { databasePath: path.resolve('/tmp/not-the-owned-review-session/mission.sqlite') },
      { databaseIdentity: { ...DATABASE_IDENTITY, ino: 0 } },
      { databaseIdentity: { ...DATABASE_IDENTITY, extra: true } },
      { databaseFileHandle: { fd: -1, close: vi.fn(async () => undefined) } },
    ]
    for (const substitution of cases) {
      const databaseFileHandle = createFakeDatabaseFileHandle()
      const restoreResult = internalRestoreResult(
        path.join(os.tmpdir(), 'unused-review-root'),
        { databaseFileHandle, ...substitution },
      )
      const sentHandle = restoreResult.databaseFileHandle as FakeDatabaseFileHandle
      const harness = await createHarness({
        startRestore: () => decorateRestoreOperation(Promise.resolve(
          restoreResult,
        )),
      })
      await expect(openSession(harness)).rejects.toThrow(/identity|path|session|restore/iu)
      expect(sentHandle.close).toHaveBeenCalledOnce()
      expect(harness.createSource).not.toHaveBeenCalled()
      expect(await readdir(harness.reviewRoot)).toEqual([])
      expect(await readFile(harness.liveDatabasePath, 'utf8')).toBe('LIVE-MISSION-BYTES')
      expect(await readFile(harness.archivePath, 'utf8')).toBe('SEALED-CIPHERTEXT-BYTES')
    }
  })

  it('contains wrong-key, corruption, disk-full, newer-format, and newer-schema failures', async () => {
    const codes = [
      'ARCHIVE_RESTORE_WRONG_KEY',
      'ARCHIVE_RESTORE_AUTHENTICATION_FAILED',
      'ARCHIVE_RESTORE_DISK_FULL',
      'ARCHIVE_RESTORE_UNSUPPORTED_FORMAT',
    ]
    for (const code of codes) {
      const failure = Object.assign(new Error('closed restore failure'), { code })
      const harness = await createHarness({
        startRestore: () => {
          const completion = (async () => {
            const sessionDirectory = path.join(harness.reviewRoot, SESSION_ID)
            await mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
            await writeFile(path.join(sessionDirectory, 'partial.sqlite'), 'PARTIAL', {
              mode: 0o600,
            })
            throw failure
          })()
          return decorateRestoreOperation(completion)
        },
      })
      await expect(openSession(harness)).rejects.toMatchObject({ code })
      expect(await readdir(harness.reviewRoot)).toEqual([])
      expect(await readFile(harness.liveDatabasePath, 'utf8')).toBe('LIVE-MISSION-BYTES')
      expect(await readFile(harness.archivePath, 'utf8')).toBe('SEALED-CIPHERTEXT-BYTES')
      expect(harness.registry.recordReviewOpened).not.toHaveBeenCalled()
    }
  })

  it('enforces one sender-owned active session and sweeps on explicit or renderer close', async () => {
    const harness = await createHarness()
    await openSession(harness)

    await expect(openSession(harness, {
      senderId: OTHER_SENDER_ID,
      operationId: SECOND_OPERATION_ID,
    })).rejects.toThrow(/active|session/iu)
    await expect(harness.manager.close({
      senderId: OTHER_SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toThrow(/owner|sender|session/iu)
    expect(await readdir(harness.reviewRoot)).toEqual([SESSION_ID])

    await harness.manager.closeForSender(SENDER_ID)
    expect(harness.sourceClose).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([])
    expect(harness.registry.recordReviewClosed).toHaveBeenCalledOnce()

    await expect(openSession(harness, {
      senderId: OTHER_SENDER_ID,
      operationId: THIRD_OPERATION_ID,
    })).resolves.toMatchObject({ sessionId: SESSION_ID })
    await harness.manager.close({ senderId: OTHER_SENDER_ID, sessionId: SESSION_ID })
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })

  it('serializes concurrent close requests to one source close, plaintext sweep, and close audit', async () => {
    const sourceCloseGate = deferred<void>()
    const sourceClose = vi.fn(async () => sourceCloseGate.promise)
    const removeSessionDirectory = vi.fn(async (sessionDirectory: string) => {
      await rm(sessionDirectory, { recursive: true, force: true })
    })
    const harness = await createHarness({
      createSource: () => ({ close: sourceClose }),
      removeSessionDirectory,
    })
    await openSession(harness)

    const firstClose = harness.manager.close({ senderId: SENDER_ID, sessionId: SESSION_ID })
    const secondClose = harness.manager.close({ senderId: SENDER_ID, sessionId: SESSION_ID })
    await vi.waitFor(() => expect(sourceClose).toHaveBeenCalled())
    const sourceCloseCallsBeforeRelease = sourceClose.mock.calls.length
    sourceCloseGate.resolve()
    const results = await Promise.allSettled([firstClose, secondClose])

    expect(sourceCloseCallsBeforeRelease).toBe(1)
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(removeSessionDirectory).toHaveBeenCalledOnce()
    expect(harness.registry.recordReviewClosed).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })

  it('retains retryable manager ownership when the close audit fails after a confirmed sweep', async () => {
    const sourceClose = vi.fn(async () => undefined)
    const removeSessionDirectory = vi.fn(async (sessionDirectory: string) => {
      await rm(sessionDirectory, { recursive: true, force: true })
    })
    const harness = await createHarness({
      createSource: () => ({ close: sourceClose }),
      removeSessionDirectory,
    })
    harness.registry.recordReviewClosed
      .mockImplementationOnce(() => { throw new Error('close audit unavailable') })
      .mockImplementationOnce(() => undefined)
    await openSession(harness)

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toThrow(/audit/iu)
    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).resolves.toBeUndefined()

    expect(sourceClose).toHaveBeenCalledOnce()
    expect(removeSessionDirectory).toHaveBeenCalledOnce()
    expect(harness.registry.recordReviewClosed).toHaveBeenCalledTimes(2)
    await expect(openSession(harness, {
      operationId: SECOND_OPERATION_ID,
    })).resolves.toMatchObject({ sessionId: SESSION_ID })
  })

  it('denies and audits an undeclared session mutation without invoking source write capability', async () => {
    const attemptedWrite = vi.fn(async () => ({ updated: true }))
    const sourceClose = vi.fn(async () => undefined)
    const recordMutationDenied = vi.fn(() => undefined)
    const harness = await createHarness({
      createSource: () => ({
        close: sourceClose,
        updateMission: attemptedWrite,
      }),
      recordMutationDenied,
    })
    await openSession(harness)

    await expect(harness.manager.read({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
      method: 'updateMission',
      args: [{ missionId: MISSION_ID, secret: SECRET, notes: 'must-not-write' }],
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_READ_ONLY' })

    expect(attemptedWrite).not.toHaveBeenCalled()
    expect(recordMutationDenied).toHaveBeenCalledOnce()
    expect(recordMutationDenied).toHaveBeenCalledWith({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
      attemptedMethod: 'updateMission',
      boundary: 'ipc',
      deniedAt: OPENED_AT,
    })
    expect(JSON.stringify(recordMutationDenied.mock.calls)).not.toContain(SECRET)
    expect(Buffer.byteLength(JSON.stringify(recordMutationDenied.mock.calls), 'utf8'))
      .toBeLessThan(256)
    expect(await readFile(harness.liveDatabasePath, 'utf8')).toBe('LIVE-MISSION-BYTES')
    expect(await readFile(harness.archivePath, 'utf8')).toBe('SEALED-CIPHERTEXT-BYTES')
  })

  it('binds facade denial audit to the exact active session and rejects stale identities', async () => {
    const recordMutationDenied = vi.fn(() => undefined)
    const harness = await createHarness({ recordMutationDenied })
    await openSession(harness)

    expect(() => harness.manager.recordMutationDenied({
      senderId: SENDER_ID,
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptedMethod: 'updateMission',
      boundary: 'facade',
    })).toThrow(expect.objectContaining({ code: 'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH' }))

    expect(recordMutationDenied).not.toHaveBeenCalled()
  })

  it('sweeps plaintext before retrying a failed mutation audit and does not resweep on retry', async () => {
    const auditFailure = Object.assign(new Error('audit storage unavailable'), {
      code: 'SQLITE_FULL',
    })
    const order: string[] = []
    const recordMutationDenied = vi.fn()
      .mockImplementationOnce(() => { order.push('audit-initial'); throw auditFailure })
      .mockImplementationOnce(() => { order.push('audit-retry-failed'); throw auditFailure })
      .mockImplementationOnce(() => { order.push('audit-retry-passed') })
    const sourceClose = vi.fn(async () => { order.push('source-close') })
    const removeSessionDirectory = vi.fn(async (sessionDirectory: string) => {
      order.push('plaintext-sweep')
      await rm(sessionDirectory, { recursive: true, force: true })
    })
    const harness = await createHarness({
      createSource: () => ({ close: sourceClose }),
      recordMutationDenied,
      removeSessionDirectory,
    })
    await openSession(harness)

    expect(() => harness.manager.recordMutationDenied({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
      attemptedMethod: 'updateMission',
      boundary: 'facade',
    })).toThrow(expect.objectContaining({ code: 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED' }))
    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED' })
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(removeSessionDirectory).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([])
    expect(order).toEqual([
      'audit-initial',
      'source-close',
      'plaintext-sweep',
      'audit-retry-failed',
    ])

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).resolves.toBeUndefined()
    expect(recordMutationDenied).toHaveBeenCalledTimes(3)
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(removeSessionDirectory).toHaveBeenCalledOnce()
    expect(order.at(-1)).toBe('audit-retry-passed')
  })

  it('queues every unaudited mutation denial in order with its original timestamp', async () => {
    const auditFailure = Object.assign(new Error('audit storage unavailable'), {
      code: 'SQLITE_FULL',
    })
    const recordMutationDenied = vi.fn()
      .mockImplementationOnce(() => { throw auditFailure })
      .mockImplementationOnce(() => { throw auditFailure })
      .mockImplementation(() => undefined)
    const harness = await createHarness({ recordMutationDenied })
    await openSession(harness)

    for (const attemptedMethod of ['updateMission', 'deleteMission']) {
      expect(() => harness.manager.recordMutationDenied({
        senderId: SENDER_ID,
        sessionId: SESSION_ID,
        attemptedMethod,
        boundary: 'facade',
      })).toThrow(expect.objectContaining({ code: 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED' }))
    }

    expect(recordMutationDenied).toHaveBeenCalledTimes(2)
    expect(recordMutationDenied.mock.calls.map(([denial]) => denial.attemptedMethod))
      .toEqual(['updateMission', 'updateMission'])

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).resolves.toBeUndefined()

    expect(recordMutationDenied).toHaveBeenCalledTimes(4)
    expect(recordMutationDenied.mock.calls.slice(2).map(([denial]) => denial)).toEqual([
      {
        senderId: SENDER_ID,
        sessionId: SESSION_ID,
        attemptedMethod: 'updateMission',
        boundary: 'facade',
        deniedAt: OPENED_AT,
      },
      {
        senderId: SENDER_ID,
        sessionId: SESSION_ID,
        attemptedMethod: 'deleteMission',
        boundary: 'facade',
        deniedAt: OPENED_AT,
      },
    ])
  })

  it('sweeps stale sessions on startup without following a hostile symlink', async () => {
    const harness = await createHarness()
    const staleSession = path.join(harness.reviewRoot, randomUUID())
    const outsideDirectory = path.join(harness.root, 'outside-must-survive')
    const hostileLink = path.join(harness.reviewRoot, randomUUID())
    await mkdir(staleSession, { recursive: true, mode: 0o700 })
    await writeFile(path.join(staleSession, 'mission-store.sqlite'), 'PLAINTEXT', { mode: 0o600 })
    await mkdir(outsideDirectory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(outsideDirectory, 'keep.txt'), 'KEEP', { mode: 0o600 })
    await symlink(outsideDirectory, hostileLink)

    await harness.manager.sweepStartup()

    expect(await readdir(harness.reviewRoot)).toEqual([])
    expect(await readFile(path.join(outsideDirectory, 'keep.txt'), 'utf8')).toBe('KEEP')
  })

  it('keeps a large review-session plaintext sweep off the caller event loop', async () => {
    const harness = await createHarness({ useDefaultRemoveSessionDirectory: true })
    const sessionDirectory = path.join(harness.reviewRoot, SESSION_ID)
    const attachmentDirectory = path.join(sessionDirectory, 'attachments')
    await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 })
    for (let offset = 0; offset < 5_000; offset += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(
        path.join(attachmentDirectory, `attachment-${offset + index}.txt`),
        'REVIEW-PLAINTEXT',
        { mode: 0o600 },
      )))
    }
    const [rootStat, archiveStat, archiveRealPath] = await Promise.all([
      stat(harness.reviewRoot),
      stat(harness.archiveDirectory),
      realpath(harness.archiveDirectory),
    ])
    let heartbeatObserved = false
    const heartbeat = new Promise<'heartbeat'>((resolve) => {
      setImmediate(() => {
        heartbeatObserved = true
        resolve('heartbeat')
      })
    })

    const cleanup = removeOwnedSessionDirectory(
      harness.reviewRoot,
      sessionDirectory,
      { dev: rootStat.dev, ino: rootStat.ino },
      harness.archiveDirectory,
      { dev: archiveStat.dev, ino: archiveStat.ino, realPath: archiveRealPath },
    )
    expect(heartbeatObserved).toBe(false)
    await expect(Promise.race([
      heartbeat,
      cleanup.then(() => 'cleanup' as const),
    ])).resolves.toBe('heartbeat')
    await expect(cleanup).resolves.toBeUndefined()
    await expect(readdir(harness.reviewRoot)).resolves.toEqual([])
  }, 30_000)

  it('rejects ciphertext custody nested beneath the destructive review root before sweeping', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-review-containment-'))
    temporaryRoots.push(root)
    const reviewRoot = path.join(root, 'archive-review')
    const archiveDirectory = path.join(reviewRoot, 'archives')
    const archivePath = path.join(archiveDirectory, 'irreplaceable.sararch')
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
    await writeFile(archivePath, 'SEALED-CIPHERTEXT-MUST-SURVIVE', { mode: 0o600 })

    expect(() => createArchiveReviewSessionManager({
      reviewRoot,
      archiveDirectory,
      registry: {
        issueReviewTicket: vi.fn(),
        recordReviewOpened: vi.fn(),
        recordReviewClosed: vi.fn(),
        recordReviewMutationDenied: vi.fn(),
      },
      startRestore: vi.fn(),
      restoreLegacy: vi.fn(),
      createSource: vi.fn(),
    })).toThrow(/separate.*ciphertext|ciphertext.*separate/iu)

    await expect(readFile(archivePath, 'utf8'))
      .resolves.toBe('SEALED-CIPHERTEXT-MUST-SURVIVE')
  })

  it('rejects a symlinked parent that aliases the review root onto ciphertext custody', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-review-alias-'))
    temporaryRoots.push(root)
    const realUserData = path.join(root, 'real-user-data')
    const archiveDirectory = path.join(realUserData, 'archives')
    const archivePath = path.join(archiveDirectory, 'irreplaceable.sararch')
    const aliasUserData = path.join(root, 'alias-user-data')
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
    await writeFile(archivePath, 'SEALED-CIPHERTEXT-MUST-SURVIVE', { mode: 0o600 })
    await symlink(realUserData, aliasUserData)

    expect(() => createArchiveReviewSessionManager({
      reviewRoot: path.join(aliasUserData, 'archives'),
      archiveDirectory,
      registry: {
        issueReviewTicket: vi.fn(),
        recordReviewOpened: vi.fn(),
        recordReviewClosed: vi.fn(),
      },
      startRestore: vi.fn(),
      restoreLegacy: vi.fn(),
      createSource: vi.fn(),
    })).toThrow(/separate.*ciphertext|ciphertext.*separate/iu)

    await expect(readFile(archivePath, 'utf8'))
      .resolves.toBe('SEALED-CIPHERTEXT-MUST-SURVIVE')
  })

  it('rejects custody moved onto the review root after construction and before startup sweep', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-review-rebind-'))
    temporaryRoots.push(root)
    const archiveDirectory = path.join(root, 'archives')
    const reviewRoot = path.join(root, 'archive-review')
    const originalArchivePath = path.join(archiveDirectory, 'irreplaceable.sararch')
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
    await writeFile(originalArchivePath, 'SEALED-CIPHERTEXT-MUST-SURVIVE', { mode: 0o600 })
    const manager = createArchiveReviewSessionManager({
      reviewRoot,
      archiveDirectory,
      registry: {
        issueReviewTicket: vi.fn(),
        recordReviewOpened: vi.fn(),
        recordReviewClosed: vi.fn(),
        recordReviewMutationDenied: vi.fn(),
      },
      startRestore: vi.fn(),
      restoreLegacy: vi.fn(),
      createSource: vi.fn(),
    })
    await rename(archiveDirectory, reviewRoot)

    await expect(manager.sweepStartup()).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    await expect(readFile(path.join(reviewRoot, 'irreplaceable.sararch'), 'utf8'))
      .resolves.toBe('SEALED-CIPHERTEXT-MUST-SURVIVE')
  })

  it('fails closed when the app-owned review root itself is replaced by a symlink', async () => {
    const harness = await createHarness()
    const outsideDirectory = path.join(harness.root, 'outside-root-must-survive')
    await mkdir(outsideDirectory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(outsideDirectory, 'keep.txt'), 'KEEP', { mode: 0o600 })
    await rm(harness.reviewRoot, { recursive: true, force: true })
    await symlink(outsideDirectory, harness.reviewRoot)

    await expect(harness.manager.sweepStartup()).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    await expect(readFile(path.join(outsideDirectory, 'keep.txt'), 'utf8')).resolves.toBe('KEEP')
  })

  it('never unlinks a live file swapped over a stale startup symlink path', async () => {
    const harness = await createHarness()
    const hostileLink = path.join(harness.reviewRoot, randomUUID())
    const displacedLink = path.join(harness.root, 'displaced-startup-link')
    const protectedFile = path.join(harness.root, 'protected-live.sqlite')
    const outsideDirectory = path.join(harness.root, 'outside-startup-target')
    await mkdir(outsideDirectory, { mode: 0o700 })
    await writeFile(protectedFile, 'LIVE-BYTES-MUST-SURVIVE', { mode: 0o600 })
    await symlink(outsideDirectory, hostileLink)
    const originalUnlink = fsSync.unlinkSync
    const unlinkSpy = vi.spyOn(fsSync, 'unlinkSync').mockImplementation((target) => {
      if (target === hostileLink) {
        fsSync.renameSync(hostileLink, displacedLink)
        fsSync.renameSync(protectedFile, hostileLink)
      }
      return originalUnlink(target)
    })

    try {
      await harness.manager.sweepStartup()
    } finally {
      unlinkSpy.mockRestore()
    }

    await expect(readFile(protectedFile, 'utf8')).resolves.toBe('LIVE-BYTES-MUST-SURVIVE')
  })

  it('does not sweep through a review-root symlink introduced after a session opens', async () => {
    const harness = await createHarness({ useDefaultRemoveSessionDirectory: true })
    await openSession(harness)
    const outsideDirectory = path.join(harness.root, 'outside-close-root-must-survive')
    const outsideSession = path.join(outsideDirectory, SESSION_ID)
    await mkdir(outsideSession, { recursive: true, mode: 0o700 })
    await writeFile(path.join(outsideSession, 'keep.txt'), 'KEEP', { mode: 0o600 })
    await rm(harness.reviewRoot, { recursive: true, force: true })
    await symlink(outsideDirectory, harness.reviewRoot)

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' })
    await expect(readFile(path.join(outsideSession, 'keep.txt'), 'utf8')).resolves.toBe('KEEP')
  })

  it('never recursively deletes ciphertext if custody is rebound onto the session path at cleanup', async () => {
    const harness = await createHarness({ useDefaultRemoveSessionDirectory: true })
    const sessionDirectory = path.join(harness.reviewRoot, SESSION_ID)
    const displacedSession = path.join(harness.root, 'displaced-review-session')
    await mkdir(sessionDirectory, { recursive: false, mode: 0o700 })
    await writeFile(path.join(sessionDirectory, 'mission-store.sqlite'), 'PLAINTEXT', { mode: 0o600 })
    const [rootStat, archiveStat, archiveRealPath] = await Promise.all([
      stat(harness.reviewRoot),
      stat(harness.archiveDirectory),
      realpath(harness.archiveDirectory),
    ])

    await expect(removeOwnedSessionDirectory(
      harness.reviewRoot,
      sessionDirectory,
      { dev: rootStat.dev, ino: rootStat.ino },
      harness.archiveDirectory,
      { dev: archiveStat.dev, ino: archiveStat.ino, realPath: archiveRealPath },
      {
        beforeQuarantine: async () => {
          await rename(sessionDirectory, displacedSession)
          await rename(harness.archiveDirectory, sessionDirectory)
        },
      },
    )).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' })

    await expect(readFile(
      path.join(sessionDirectory, path.basename(harness.archivePath)),
      'utf8',
    )).resolves.toBe('SEALED-CIPHERTEXT-BYTES')
    await expect(readFile(path.join(displacedSession, 'mission-store.sqlite'), 'utf8'))
      .resolves.toBe('PLAINTEXT')
  })

  it('blocks future opens when plaintext cleanup fails and reports the failure explicitly', async () => {
    const cleanupFailure = Object.assign(new Error('simulated cleanup failure'), {
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    const harness = await createHarness({
      removeSessionDirectory: async () => { throw cleanupFailure },
    })
    await openSession(harness)

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    await expect(openSession(harness, {
      operationId: SECOND_OPERATION_ID,
    })).rejects.toThrow(/cleanup|plaintext|blocked/iu)
    expect(await readdir(harness.reviewRoot)).toEqual([SESSION_ID])
  })

  it('clears a transient cleanup blocker only after retry confirms the plaintext sweep', async () => {
    const cleanupFailure = Object.assign(new Error('transient cleanup failure'), {
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    const removeSessionDirectory = vi.fn()
      .mockImplementationOnce(async () => { throw cleanupFailure })
      .mockImplementation(async (sessionDirectory: string) => {
        await rm(sessionDirectory, { recursive: true, force: true })
      })
    const harness = await createHarness({ removeSessionDirectory })
    await openSession(harness)

    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' })
    await expect(harness.manager.close({
      senderId: SENDER_ID,
      sessionId: SESSION_ID,
    })).resolves.toBeUndefined()
    await expect(openSession(harness, {
      operationId: SECOND_OPERATION_ID,
    })).resolves.toMatchObject({ sessionId: SESSION_ID })

    expect(removeSessionDirectory).toHaveBeenCalledTimes(2)
  })

  it('retries a failed opening-session sweep without reusing the rejected cleanup promise', async () => {
    const cleanupFailure = Object.assign(new Error('transient opening cleanup failure'), {
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    const removeSessionDirectory = vi.fn()
      .mockImplementationOnce(async () => { throw cleanupFailure })
      .mockImplementation(async (sessionDirectory: string) => {
        await rm(sessionDirectory, { recursive: true, force: true })
      })
    const restoreFailure = Object.assign(new Error('restore failed after partial plaintext'), {
      code: 'ARCHIVE_RESTORE_FAILED',
    })
    let restoreAttempt = 0
    const harness = await createHarness({
      removeSessionDirectory,
      startRestore: (restoreInput) => {
        restoreAttempt += 1
        const request = restoreInput.request as Readonly<Record<string, unknown>>
        const sessionDirectory = path.join(harness.reviewRoot, request.sessionId as string)
        const completion = (async () => {
          await mkdir(sessionDirectory, { recursive: false, mode: 0o700 })
          const databasePath = path.join(sessionDirectory, 'mission-store.sqlite')
          await writeFile(databasePath, 'PLAINTEXT', { mode: 0o600 })
          if (restoreAttempt === 1) throw restoreFailure
          return internalRestoreResult(harness.reviewRoot, { sessionDirectory, databasePath })
        })()
        return decorateRestoreOperation(completion)
      },
    })

    await expect(openSession(harness)).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    await expect(harness.manager.cancel({
      senderId: SENDER_ID,
      operationId: OPERATION_ID,
    })).resolves.toBe(true)
    await expect(openSession(harness, { operationId: SECOND_OPERATION_ID }))
      .resolves.toMatchObject({ sessionId: SESSION_ID })

    expect(removeSessionDirectory).toHaveBeenCalledTimes(2)
  })

  it('retains source-close ownership when the review-open audit fails before session publication', async () => {
    const sourceClose = vi.fn()
      .mockRejectedValueOnce(new Error('transient transferred descriptor close failure'))
      .mockResolvedValueOnce(undefined)
    const recordReviewOpened = vi.fn()
      .mockImplementationOnce(() => { throw new Error('review open audit unavailable') })
      .mockImplementationOnce(() => undefined)
    const harness = await createHarness({
      createSource: () => ({ close: sourceClose }),
      recordReviewOpened,
    })

    await expect(openSession(harness)).rejects.toThrow(/descriptor close failure/iu)
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([SESSION_ID])

    await expect(harness.manager.cancel({
      senderId: SENDER_ID,
      operationId: OPERATION_ID,
    })).resolves.toBe(true)
    expect(sourceClose).toHaveBeenCalledTimes(2)
    expect(await readdir(harness.reviewRoot)).toEqual([])
    await expect(openSession(harness, { operationId: SECOND_OPERATION_ID }))
      .resolves.toMatchObject({ sessionId: SESSION_ID })
  })

  it('retains an unadopted transferred handle when invalid restore identity cleanup fails once', async () => {
    const databaseFileHandle = createFakeDatabaseFileHandle()
    databaseFileHandle.close
      .mockRejectedValueOnce(new Error('transient unadopted descriptor close failure'))
      .mockResolvedValueOnce(undefined)
    const harness = await createHarness({
      startRestore: (restoreInput) => {
        const request = restoreInput.request as Readonly<Record<string, unknown>>
        const sessionDirectory = path.join(harness.reviewRoot, request.sessionId as string)
        const completion = (async () => {
          await mkdir(sessionDirectory, { recursive: false, mode: 0o700 })
          await writeFile(path.join(sessionDirectory, 'mission-store.sqlite'), 'PLAINTEXT', {
            mode: 0o600,
          })
          return internalRestoreResult(harness.reviewRoot, {
            databaseFileHandle,
            missionId: 'wrong-mission',
          })
        })()
        return decorateRestoreOperation(completion)
      },
    })

    await expect(openSession(harness)).rejects.toThrow(/descriptor close failure/iu)
    expect(databaseFileHandle.close).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([SESSION_ID])

    await expect(harness.manager.cancel({
      senderId: SENDER_ID,
      operationId: OPERATION_ID,
    })).resolves.toBe(true)
    expect(databaseFileHandle.close).toHaveBeenCalledTimes(2)
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })

  it('cancels an opening session by sender and prepareClose waits for physical worker exit', async () => {
    const completion = deferred<Readonly<Record<string, unknown>>>()
    const physicalExit = deferred<void>()
    const cancel = vi.fn(() => {
      completion.reject(Object.assign(new Error('cancelled'), {
        name: 'AbortError',
        code: 'ARCHIVE_RESTORE_CANCELLED',
      }))
    })
    const restoreOperation = decorateRestoreOperation(completion.promise, {
      workerExited: physicalExit.promise,
      cancel,
    })
    const harness = await createHarness({ startRestore: () => restoreOperation })
    const opening = openSession(harness)
    await Promise.resolve()

    expect(() => harness.manager.cancel({
      senderId: OTHER_SENDER_ID,
      operationId: OPERATION_ID,
    })).toThrow(/owner|sender|operation/iu)
    const shutdown = harness.manager.prepareClose()
    let shutdownSettled = false
    void shutdown.then(
      () => { shutdownSettled = true },
      () => { shutdownSettled = true },
    )
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(shutdownSettled).toBe(false)

    physicalExit.resolve()
    await expect(shutdown).resolves.toBeUndefined()
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })

  it('lets the opening operation identity retry cleanup of its already-established session', async () => {
    const harness = await createHarness()
    await openSession(harness)

    await expect(harness.manager.cancel({
      senderId: SENDER_ID,
      operationId: OPERATION_ID,
    })).resolves.toBe(true)

    expect(harness.sourceClose).toHaveBeenCalledOnce()
    expect(harness.registry.recordReviewClosed).toHaveBeenCalledOnce()
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })

  it('uses a registry-supported explicit-close audit when cancellation reaches an established session', async () => {
    const recordReviewClosed = vi.fn((input: Readonly<Record<string, unknown>>) => {
      if (!['explicit_close', 'renderer_destroyed', 'app_shutdown'].includes(String(input.reason))) {
        throw new Error('registry rejected archive review close reason')
      }
    })
    const harness = await createHarness({ recordReviewClosed })
    await openSession(harness)

    await expect(harness.manager.cancel({
      senderId: SENDER_ID,
      operationId: OPERATION_ID,
    })).resolves.toBe(true)

    expect(recordReviewClosed).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'explicit_close',
      plaintextSweepConfirmed: true,
    }))
    await expect(openSession(harness, {
      operationId: SECOND_OPERATION_ID,
    })).resolves.toMatchObject({ sessionId: SESSION_ID })
  })

  it('closes the read source before sweeping plaintext during app shutdown', async () => {
    const order: string[] = []
    const sourceClosed = deferred<void>()
    const harness = await createHarness({
      createSource: () => ({
        close: vi.fn(async () => {
          order.push('source-close-start')
          await sourceClosed.promise
          order.push('source-close-finish')
        }),
      }),
      removeSessionDirectory: async (sessionDirectory) => {
        order.push('sweep')
        await rm(sessionDirectory, { recursive: true, force: true })
      },
    })
    await openSession(harness)

    const shutdown = harness.manager.prepareClose()
    await Promise.resolve()
    expect(order).toEqual(['source-close-start'])
    sourceClosed.resolve()
    await expect(shutdown).resolves.toBeUndefined()
    expect(order).toEqual(['source-close-start', 'source-close-finish', 'sweep'])
    expect(await readdir(harness.reviewRoot)).toEqual([])
  })
})
