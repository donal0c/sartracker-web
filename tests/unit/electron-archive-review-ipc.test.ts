import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

interface ArchiveReviewIpcModule {
  readonly ARCHIVE_REVIEW_PROGRESS_CHANNEL: string
  readonly registerArchiveReviewIpcHandlers: (
    input: Readonly<Record<string, unknown>>,
  ) => void
}

interface ArchiveReviewManager {
  readonly open: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
  readonly read: ReturnType<typeof vi.fn>
  readonly recordMutationDenied: ReturnType<typeof vi.fn>
  readonly closeForSender: ReturnType<typeof vi.fn>
}

const CHANNELS = Object.freeze({
  open: 'sartracker:archive-review:open',
  close: 'sartracker:archive-review:close',
  cancel: 'sartracker:archive-review:cancel',
  read: 'sartracker:archive-review:read',
  mutationDenied: 'sartracker:archive-review:mutation-denied',
})
const EXPECTED_PROGRESS_CHANNEL = 'sartracker:archive-review:progress'
const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const REQUEST_ID = '5ca652f8-f624-4da2-bb6c-a80525d9ed44'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const MISSION_ID = 'mission-review-fixed'
const SECRET = 'Correct Horse Battery Staple 9!'
const RECOVERY_SECRET = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const OPENED_AT = '2026-08-30T09:00:00.000Z'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)

/** Loads the production registrar lazily so its absent-module state is a visible red test. */
function loadIpcModule(): ArchiveReviewIpcModule {
  return require('../../electron/archive-review-ipc.cjs') as ArchiveReviewIpcModule
}

/** Creates one Electron sender double with a real destruction event. */
function createSender(id: number) {
  return Object.assign(new EventEmitter(), {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  })
}

/** Returns the exact path-free session metadata expected from a v2 restore. */
function v2Session(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  }
}

/** Returns the visibly unencrypted legacy-v1 review classification. */
function v1Session(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  }
}

/** Registers the main boundary and captures its explicit invoke and synchronous audit handlers. */
function createHarness(input: {
  readonly sessionManager?: Partial<ArchiveReviewManager>
} = {}) {
  const handlers = new Map<string, (event: unknown, request: unknown) => unknown>()
  const syncHandlers = new Map<string, (event: unknown, request: unknown) => void>()
  const sessionManager: ArchiveReviewManager = {
    open: vi.fn(async () => v2Session()),
    close: vi.fn(async () => undefined),
    cancel: vi.fn(async () => true),
    read: vi.fn(async () => ({ items: [] })),
    recordMutationDenied: vi.fn(() => true),
    closeForSender: vi.fn(async () => undefined),
    ...input.sessionManager,
  }
  const validateIpcSender = vi.fn()
  const ipc = loadIpcModule()
  ipc.registerArchiveReviewIpcHandlers({
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, request: unknown) => unknown) => {
        handlers.set(channel, handler)
      },
      on: (channel: string, handler: (event: unknown, request: unknown) => void) => {
        syncHandlers.set(channel, handler)
      },
    },
    channels: CHANNELS,
    sessionManager,
    validateIpcSender,
  })
  return { handlers, syncHandlers, ipc, sessionManager, validateIpcSender }
}

describe('archive review IPC containment [DON-253]', () => {
  it('registers four invokes, one synchronous denial audit and one fixed push channel', () => {
    const { handlers, syncHandlers, ipc } = createHarness()

    expect([...handlers.keys()].sort()).toEqual([
      CHANNELS.cancel,
      CHANNELS.close,
      CHANNELS.open,
      CHANNELS.read,
    ].sort())
    expect(handlers.size).toBe(4)
    expect([...syncHandlers.keys()]).toEqual([CHANNELS.mutationDenied])
    expect(ipc.ARCHIVE_REVIEW_PROGRESS_CHANNEL).toBe(EXPECTED_PROGRESS_CHANNEL)
  })

  it('opens v2 with exactly one selected non-machine credential and request-bound progress', async () => {
    let openInput: Readonly<Record<string, unknown>> | undefined
    const { handlers, sessionManager, validateIpcSender } = createHarness({
      sessionManager: {
        open: vi.fn(async (input: Readonly<Record<string, unknown>>) => {
          openInput = input
          const onProgress = input.onProgress as (
            progress: Readonly<Record<string, unknown>>,
          ) => void
          onProgress({
            sequence: 1,
            phase: 'decrypt',
            unit: 'bytes',
            completed: 256,
            total: 1_024,
            detail: 'Restoring verified archive',
            databasePath: '/private/archive-review/session/mission-store.sqlite',
            secret: SECRET,
          })
          onProgress({
            sequence: 2,
            phase: 'validate',
            unit: 'bytes',
            completed: 4_096,
            total: 4_096,
            detail: 'sqlite-validated',
          })
          return v2Session()
        }),
      },
    })
    const sender = createSender(71)
    const event = { sender }
    const request = {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    }

    await expect(handlers.get(CHANNELS.open)?.(event, request)).resolves.toEqual({
      operationId: OPERATION_ID,
      ...v2Session(),
    })
    expect(validateIpcSender).toHaveBeenCalledWith(event)
    expect(sessionManager.open).toHaveBeenCalledOnce()
    expect(openInput).toMatchObject({
      senderId: 71,
      request: {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
      },
      secret: SECRET,
      onProgress: expect.any(Function),
    })
    expect(JSON.stringify(openInput?.request)).not.toContain(SECRET)
    expect(sender.send).toHaveBeenCalledWith(EXPECTED_PROGRESS_CHANNEL, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 1,
      phase: 'decrypt',
      unit: 'bytes',
      completed: 256,
      total: 1_024,
      detail: 'Restoring verified archive',
    })
    expect(JSON.stringify(sender.send.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(sender.send.mock.calls)).not.toMatch(/databasePath|archive-review\/session/iu)
    expect(sender.send).toHaveBeenLastCalledWith(EXPECTED_PROGRESS_CHANNEL, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 2,
      phase: 'validate',
      unit: 'bytes',
      completed: 4_096,
      total: 4_096,
      detail: 'sqlite-validated',
    })
  })

  it('opens legacy v1 without constructing or forwarding any credential path', async () => {
    let observedInput: Readonly<Record<string, unknown>> | undefined
    const { handlers, sessionManager } = createHarness({
      sessionManager: {
        open: vi.fn(async (input: Readonly<Record<string, unknown>>) => {
          observedInput = input
          const onProgress = input.onProgress as (
            progress: Readonly<Record<string, unknown>>,
          ) => void
          onProgress({
            sequence: 1,
            phase: 'metadata',
            unit: 'files',
            completed: 2,
            total: 5,
            detail: 'metadata-validated',
          })
          return v1Session()
        }),
      },
    })
    const event = { sender: createSender(71) }

    await expect(handlers.get(CHANNELS.open)?.(event, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
    })).resolves.toEqual({
      operationId: OPERATION_ID,
      ...v1Session(),
    })
    expect(sessionManager.open).toHaveBeenCalledOnce()
    expect(observedInput).toEqual({
      senderId: 71,
      request: {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 1,
      },
      onProgress: expect.any(Function),
    })
    expect(event.sender.send).toHaveBeenCalledWith(EXPECTED_PROGRESS_CHANNEL, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      sequence: 1,
      phase: 'metadata',
      unit: 'files',
      completed: 2,
      total: 5,
      detail: 'metadata-validated',
    })
    expect(observedInput).not.toHaveProperty('secret')

    await expect(handlers.get(CHANNELS.open)?.(event, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_INPUT_INVALID' })
    expect(sessionManager.open).toHaveBeenCalledOnce()
  })

  it('fails closed before session work for malformed unions and unsupported newer formats', async () => {
    const { handlers, sessionManager } = createHarness()
    const event = { sender: createSender(71) }
    const invalidRequests = [
      {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'machine',
        secret: SECRET,
      },
      {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
      },
      {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 3,
      },
      {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'recovery',
        secret: SECRET,
        scratchPath: '/tmp/renderer-selected-scratch',
      },
    ]

    for (const request of invalidRequests) {
      await expect(handlers.get(CHANNELS.open)?.(event, request)).rejects.toMatchObject({
        code: 'ARCHIVE_REVIEW_INPUT_INVALID',
      })
    }
    expect(sessionManager.open).not.toHaveBeenCalled()
  })

  it('binds close, cancel and every read to the validated Electron sender identity', async () => {
    const { handlers, sessionManager, validateIpcSender } = createHarness()
    const sender = createSender(71)
    const event = { sender }

    await expect(handlers.get(CHANNELS.close)?.(event, {
      sessionId: SESSION_ID,
    })).resolves.toBe(true)
    await expect(handlers.get(CHANNELS.cancel)?.(event, {
      operationId: OPERATION_ID,
    })).resolves.toBe(true)
    await expect(handlers.get(CHANNELS.read)?.(event, {
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'readMissionReplay',
      input: { missionId: MISSION_ID, selectedTime: OPENED_AT },
    })).resolves.toEqual({ items: [] })

    expect(validateIpcSender).toHaveBeenCalledTimes(3)
    expect(sessionManager.close).toHaveBeenCalledWith({
      senderId: 71,
      sessionId: SESSION_ID,
    })
    expect(sessionManager.cancel).toHaveBeenCalledWith({
      senderId: 71,
      operationId: OPERATION_ID,
    })
    expect(sessionManager.read).toHaveBeenCalledWith({
      senderId: 71,
      sessionId: SESSION_ID,
      method: 'readMissionReplay',
      args: [
        { missionId: MISSION_ID, selectedTime: OPENED_AT },
        REQUEST_ID,
      ],
    })

    await expect(handlers.get(CHANNELS.close)?.(event, {
      sessionId: SESSION_ID,
      senderId: 999,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_INPUT_INVALID' })
    expect(sessionManager.close).toHaveBeenCalledOnce()
  })

  it('propagates a manager cancellation miss instead of falsely confirming cleanup', async () => {
    const { handlers } = createHarness({
      sessionManager: { cancel: vi.fn(async () => false) },
    })

    await expect(handlers.get(CHANNELS.cancel)?.({ sender: createSender(71) }, {
      operationId: OPERATION_ID,
    })).resolves.toBe(false)
  })

  it('closes a sender session on renderer destruction and stops progress delivery', async () => {
    let onProgress: ((progress: Readonly<Record<string, unknown>>) => void) | undefined
    const { handlers, sessionManager } = createHarness({
      sessionManager: {
        open: vi.fn(async (input: Readonly<Record<string, unknown>>) => {
          onProgress = input.onProgress as typeof onProgress
          return v2Session()
        }),
      },
    })
    const sender = createSender(71)
    await handlers.get(CHANNELS.open)?.({ sender }, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'recovery',
      secret: RECOVERY_SECRET,
    })
    sender.isDestroyed.mockReturnValue(true)
    sender.emit('destroyed')
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledWith(71))

    onProgress?.({
      sequence: 2,
      phase: 'ready',
      unit: 'files',
      completed: 1,
      total: 1,
      detail: 'Archive review ready',
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('keeps read dispatch to the fixed closed allow-list and method-specific argument shape', async () => {
    const { handlers, sessionManager } = createHarness()
    const event = { sender: createSender(71) }
    const read = handlers.get(CHANNELS.read)

    await read?.(event, {
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
    })
    expect(sessionManager.read).toHaveBeenLastCalledWith({
      senderId: 71,
      sessionId: SESSION_ID,
      method: 'listMarkers',
      args: [MISSION_ID],
    })

    await read?.(event, {
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listArchiveAttachmentPage',
      input: { missionId: MISSION_ID, cursor: null, limit: 25 },
    })
    expect(sessionManager.read).toHaveBeenLastCalledWith({
      senderId: 71,
      sessionId: SESSION_ID,
      method: 'listArchiveAttachmentPage',
      args: [{ missionId: MISSION_ID, cursor: null, limit: 25 }],
    })

    const callsBefore = sessionManager.read.mock.calls.length
    for (const method of ['close', 'upsertMarker', 'deleteGpxImport', 'constructor', '__proto__']) {
      await expect(read?.(event, {
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method,
        input: {},
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_READ_ONLY' })
    }
    expect(sessionManager.read).toHaveBeenCalledTimes(callsBefore)
    expect(sessionManager.recordMutationDenied.mock.calls).toEqual(
      ['close', 'upsertMarker', 'deleteGpxImport', 'constructor', '__proto__'].map(
        (attemptedMethod) => [{
          senderId: 71,
          sessionId: SESSION_ID,
          attemptedMethod,
          boundary: 'ipc',
        }],
      ),
    )

    const { syncHandlers } = createHarness({ sessionManager })
    const denialEvent = { sender: event.sender, returnValue: undefined as unknown }
    syncHandlers.get(CHANNELS.mutationDenied)?.(denialEvent, {
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      attemptedMethod: 'updateMission',
    })
    expect(denialEvent.returnValue).toEqual({ ok: true })
    expect(sessionManager.recordMutationDenied).toHaveBeenLastCalledWith({
      senderId: 71,
      sessionId: SESSION_ID,
      attemptedMethod: 'updateMission',
      boundary: 'facade',
    })
    expect(sessionManager.read).toHaveBeenCalledTimes(callsBefore)
  })

  it('rejects substituted, path-bearing, secret-bearing and oversized results', async () => {
    const forbiddenResults = [
      v2Session({ archiveId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      v2Session({ containerVersion: 3 }),
      v2Session({ ciphertextSha256: null }),
      v1Session({ ciphertextSha256: 'a'.repeat(64) }),
      v2Session({ databasePath: '/private/archive-review/session/mission-store.sqlite' }),
      v2Session({ secret: SECRET }),
    ]
    for (const result of forbiddenResults) {
      const { handlers, sessionManager } = createHarness({
        sessionManager: { open: vi.fn(async () => result) },
      })
      await expect(handlers.get(CHANNELS.open)?.({ sender: createSender(71) }, {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: SECRET,
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_RESULT_INVALID' })
      expect(sessionManager.closeForSender).toHaveBeenCalledOnce()
      expect(sessionManager.closeForSender).toHaveBeenCalledWith(71)
    }

    const oversizedRead = createHarness({
      sessionManager: {
        read: vi.fn(async () => ({ items: [{ notes: 'x'.repeat(9 * 1024 * 1024) }] })),
      },
    })
    await expect(oversizedRead.handlers.get(CHANNELS.read)?.(
      { sender: createSender(71) },
      {
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: 'listMarkers',
        input: { missionId: MISSION_ID },
      },
    )).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_RESULT_INVALID' })

    const pathBearingRead = createHarness({
      sessionManager: {
        read: vi.fn(async () => ({
          databasePath: '/private/archive-review/session/mission-store.sqlite',
        })),
      },
    })
    await expect(pathBearingRead.handlers.get(CHANNELS.read)?.(
      { sender: createSender(71) },
      {
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: 'info',
        input: {},
      },
    )).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_RESULT_INVALID' })
  })

  it('surfaces cleanup failure when rejecting a manager-established malformed session', async () => {
    const cleanupFailure = Object.assign(new Error('plaintext sweep failed'), {
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    const { handlers, sessionManager } = createHarness({
      sessionManager: {
        open: vi.fn(async () => v2Session({
          databasePath: '/private/archive-review/session/mission-store.sqlite',
        })),
        closeForSender: vi.fn(async () => { throw cleanupFailure }),
      },
    })

    await expect(handlers.get(CHANNELS.open)?.({ sender: createSender(71) }, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' })
    expect(sessionManager.closeForSender).toHaveBeenCalledOnce()
  })

  it('closes internal failures without reflecting paths, credentials or worker text', async () => {
    const failure = Object.assign(new Error(
      `wrong key ${SECRET} /private/archive-review/session/mission-store.sqlite`,
    ), { code: 'ARCHIVE_RESTORE_WRONG_KEY' })
    const { handlers } = createHarness({
      sessionManager: { open: vi.fn(async () => { throw failure }) },
    })
    let received: unknown
    try {
      await handlers.get(CHANNELS.open)?.({ sender: createSender(71) }, {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: SECRET,
      })
    } catch (error) {
      received = error
    }

    expect(received).toMatchObject({
      code: 'ARCHIVE_RESTORE_WRONG_KEY',
      message: 'Archive review operation failed safely (ARCHIVE_RESTORE_WRONG_KEY).',
    })
    expect(JSON.stringify(received)).not.toContain(SECRET)
    expect(String((received as Error).message)).not.toMatch(/private|database|scratch|session\/mission/iu)
  })
})
