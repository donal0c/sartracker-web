import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const CHANNELS = Object.freeze({
  open: 'sartracker:archive-review:open',
  close: 'sartracker:archive-review:close',
  cancel: 'sartracker:archive-review:cancel',
  read: 'sartracker:archive-review:read',
})
const PROGRESS_CHANNEL = 'sartracker:archive-review:progress'
const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const REQUEST_ID = '5ca652f8-f624-4da2-bb6c-a80525d9ed44'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const MISSION_ID = 'mission-review-fixed'
const SECRET = 'Correct Horse Battery Staple 9!'
const OPENED_AT = '2026-08-30T09:00:00.000Z'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)

interface ArchiveReviewBridge {
  readonly open: (input: unknown) => Promise<Readonly<Record<string, unknown>>>
  readonly close: (input: unknown) => Promise<boolean>
  readonly cancel: (input: unknown) => Promise<boolean>
  readonly read: (input: unknown) => Promise<unknown>
  readonly onProgress: (listener: (progress: unknown) => void) => () => void
}

/** Runs the real sandbox preload and captures the projected renderer bridge. */
function createHarness() {
  const preload = readFileSync('electron/preload.cjs', 'utf8')
  const invoke = vi.fn().mockResolvedValue(undefined)
  const sendSync = vi.fn(() => ({ ok: true }))
  const listeners = new Map<string, (_event: unknown, input: unknown) => void>()
  const removeListener = vi.fn()
  let exposedBridge: Readonly<Record<string, unknown>> | undefined
  expect(() => runInNewContext(preload, {
    TextEncoder,
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Unexpected preload require: ${specifier}`)
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, bridge: Readonly<Record<string, unknown>>) => {
            exposedBridge = bridge
          },
        },
        ipcRenderer: {
          invoke,
          sendSync,
          on: vi.fn((channel, listener) => listeners.set(channel, listener)),
          removeListener,
          send: vi.fn(),
        },
      }
    },
    window: { addEventListener: vi.fn() },
  })).not.toThrow()
  const archiveReview = exposedBridge?.archiveReview as ArchiveReviewBridge | undefined
  return { archiveReview, invoke, sendSync, listeners, removeListener }
}

/** Returns one complete main-to-preload v2 session result with optional hostile extras. */
function v2Result(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId: OPERATION_ID,
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

describe('archive review sandbox preload containment [DON-253]', () => {
  it('exposes one closed archiveReview namespace and no generic invocation escape hatch', () => {
    const { archiveReview } = createHarness()

    expect(archiveReview).toBeDefined()
    expect(Object.keys(archiveReview ?? {}).sort()).toEqual([
      'cancel',
      'close',
      'onProgress',
      'open',
      'read',
    ])
    expect(archiveReview).not.toHaveProperty('invoke')
    expect(archiveReview).not.toHaveProperty('call')
    expect(archiveReview).not.toHaveProperty('write')
  })

  it('durably records a session-bound facade denial synchronously before returning', async () => {
    const { archiveReview, invoke, sendSync } = createHarness()
    expect(archiveReview).toBeDefined()

    await expect(archiveReview?.read({
      sessionId: SESSION_ID,
      requestId: OPERATION_ID,
      method: 'recordMutationDenied',
      input: { attemptedMethod: 'updateMission' },
    })).resolves.toBe(true)

    expect(sendSync).toHaveBeenCalledWith(
      'sartracker:archive-review:mutation-denied',
      {
        sessionId: SESSION_ID,
        requestId: OPERATION_ID,
        attemptedMethod: 'updateMission',
      },
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('projects the exact v2 request and exact path-free request-bound result', async () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    invoke.mockResolvedValueOnce(v2Result({
      databasePath: '/private/archive-review/session/mission-store.sqlite',
      sessionDirectory: '/private/archive-review/session',
      secret: SECRET,
      unknownWorkerState: { scratchPath: '/private/archive-review/session' },
    }))

    const publicResult = await archiveReview?.open({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
      unknownRendererField: 'discard me',
    })
    expect(publicResult).toEqual(v2Result())
    expect(invoke).toHaveBeenCalledWith(CHANNELS.open, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    expect(JSON.stringify(publicResult)).not.toMatch(
      /databasePath|sessionDirectory|scratchPath|unknownWorkerState/iu,
    )
    expect(JSON.stringify(publicResult)).not.toContain(SECRET)
  })

  it('uses an exact legacy-v1 open variant with no credential field at all', async () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    invoke.mockResolvedValueOnce({
      ...v2Result(),
      containerVersion: 1,
      encrypted: false,
      verified: false,
      ciphertextSha256: null,
    })

    await expect(archiveReview?.open({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      ignoredRendererField: 'discard me',
    })).resolves.toMatchObject({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      encrypted: false,
      verified: false,
      immutable: true,
      ciphertextSha256: null,
    })
    expect(invoke).toHaveBeenCalledWith(CHANNELS.open, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
    })
    expect(JSON.stringify(invoke.mock.calls[0])).not.toContain(SECRET)

    const callsBefore = invoke.mock.calls.length
    expect(() => archiveReview?.open({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      slotType: 'passphrase',
      secret: SECRET,
    })).toThrow(/archive review|legacy|credential/iu)
    expect(invoke).toHaveBeenCalledTimes(callsBefore)
  })

  it('rejects weak passphrases and non-canonical recovery codes synchronously before invoke', () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()

    for (const secret of [
      'short-A1!',
      'alllowercaseletters',
      'ALLUPPERCASELETTERS',
      'Valid-Looking9!\n',
    ]) {
      expect(() => archiveReview?.open({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret,
      })).toThrow(/archive review|passphrase|credential/iu)
    }

    const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
    for (const secret of [
      recoveryCode.toLowerCase(),
      recoveryCode.replace('A', 'I'),
      recoveryCode.slice(0, -1),
      `${recoveryCode}\t`,
    ]) {
      expect(() => archiveReview?.open({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'recovery',
        secret,
      })).toThrow(/archive review|recovery|credential/iu)
    }

    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects newer container versions and every known hostile 64 MiB field before invoke', () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    const huge = 'x'.repeat(64 * 1024 * 1024)
    const invalidCalls = [
      () => archiveReview?.open({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 3,
      }),
      () => archiveReview?.open({
        operationId: OPERATION_ID,
        archiveId: huge,
        containerVersion: 1,
      }),
      () => archiveReview?.open({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: huge,
      }),
      () => archiveReview?.close({ sessionId: huge }),
      () => archiveReview?.cancel({ operationId: huge }),
      () => archiveReview?.read({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: huge,
        input: {},
      }),
      () => archiveReview?.read({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: 'readMissionReplay',
        input: { missionId: MISSION_ID, selectedTime: huge },
      }),
    ]

    for (const call of invalidCalls) expect(call).toThrow(/archive review/iu)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects wrong-typed declared read fields synchronously before invoke', () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    invoke.mockImplementation(() => new Promise<never>(() => undefined))
    const invalidInputs = [
      {
        method: 'readMissionReview',
        input: { missionId: 42, includeTelemetry: false, auditLimit: 100 },
      },
      {
        method: 'readMissionReview',
        input: { missionId: MISSION_ID, includeTelemetry: 'false', auditLimit: 100 },
      },
      {
        method: 'readMissionReview',
        input: { missionId: MISSION_ID, includeTelemetry: false, auditLimit: '100' },
      },
      {
        method: 'cancelMissionReviewRead',
        input: { requestId: 42 },
      },
      {
        method: 'readMissionReplay',
        input: {
          missionId: MISSION_ID,
          selectedTime: '2026-08-30T09:00:00.000Z',
          timezone: 'Europe/Dublin',
          trackLimit: 500,
          objectLimit: 100,
          deviceIds: 'device-1',
        },
      },
      {
        method: 'listMarkers',
        input: { missionId: true },
      },
      {
        method: 'listGpxImportPage',
        input: { missionId: MISSION_ID, cursor: null, limit: '25' },
      },
      {
        method: 'listArchiveAttachmentPage',
        input: { missionId: MISSION_ID, cursor: null, limit: '25' },
      },
      {
        method: 'openAttachment',
        input: {
          missionId: MISSION_ID,
          attachmentPath: '/historical/marker/photo.jpg',
          referenceKind: 'marker',
          referenceId: 1,
        },
      },
    ]

    for (const { method, input } of invalidInputs) {
      expect(() => archiveReview?.read({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method,
        input,
      })).toThrow(/archive review/iu)
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects cloneable 64 MiB binary views synchronously before invoke', () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    invoke.mockImplementation(() => new Promise<never>(() => undefined))
    const backingBuffer = new ArrayBuffer(64 * 1024 * 1024)
    const hostileValues = [
      backingBuffer,
      new Uint8Array(backingBuffer, 0, 0),
      new DataView(backingBuffer, 0, 0),
    ]

    for (const missionId of hostileValues) {
      expect(() => archiveReview?.read({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: 'listMarkers',
        input: { missionId },
      })).toThrow(/archive review/iu)
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('discards unknown hostile getters and binary views without traversing them', async () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    invoke.mockResolvedValueOnce({ items: [] })
    const backingBuffer = new ArrayBuffer(64 * 1024 * 1024)
    const input = { missionId: MISSION_ID }
    Object.defineProperty(input, 'unknownHostileGetter', {
      enumerable: true,
      get: () => {
        throw new Error('Unknown archive-review fields must not be traversed.')
      },
    })

    await expect(archiveReview?.read({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listMarkers',
      input,
      unknownArrayBuffer: backingBuffer,
      unknownTypedArray: new Uint8Array(backingBuffer, 0, 0),
      unknownDataView: new DataView(backingBuffer, 0, 0),
    })).resolves.toEqual({ items: [] })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(CHANNELS.read, {
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
    })
  })

  it('drops unknown hostile input fields without cloning them and forwards only closed shapes', async () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    const huge = 'x'.repeat(64 * 1024 * 1024)
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.open) return v2Result()
      if (channel === CHANNELS.read) return { items: [] }
      return true
    })

    await archiveReview?.open({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
      hostileBlob: huge,
    })
    await archiveReview?.close({ sessionId: SESSION_ID, hostileBlob: huge })
    await archiveReview?.cancel({ operationId: OPERATION_ID, hostileBlob: huge })
    await archiveReview?.read({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
      hostileBlob: huge,
    })

    expect(invoke.mock.calls).toEqual([
      [CHANNELS.open, {
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: SECRET,
      }],
      [CHANNELS.close, { sessionId: SESSION_ID }],
      [CHANNELS.cancel, { operationId: OPERATION_ID }],
      [CHANNELS.read, {
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method: 'listMarkers',
        input: { missionId: MISSION_ID },
      }],
    ])
  })

  it('blocks mutation vocabulary and bounds both read request and result bytes', async () => {
    const { archiveReview, invoke } = createHarness()
    expect(archiveReview).toBeDefined()
    for (const method of ['close', 'upsertMarker', 'deleteDrawing', 'constructor', '__proto__']) {
      expect(() => archiveReview?.read({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        method,
        input: {},
      })).toThrow(/read-only|archive review/iu)
    }
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce({ items: [{ notes: 'x'.repeat(9 * 1024 * 1024) }] })
    await expect(archiveReview?.read({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
    })).rejects.toThrow(/archive review.*result|result.*archive review/iu)

    invoke.mockResolvedValueOnce({
      databasePath: '/private/archive-review/session/mission-store.sqlite',
    })
    await expect(archiveReview?.read({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      method: 'info',
      input: {},
    })).rejects.toThrow(/archive review.*result|result.*archive review/iu)
  })

  it('projects progress before listeners and never publishes path, secret or unknown fields', () => {
    const { archiveReview, listeners, removeListener } = createHarness()
    expect(archiveReview).toBeDefined()
    const listener = vi.fn()
    const unsubscribe = archiveReview?.onProgress(listener)
    const push = listeners.get(PROGRESS_CHANNEL)
    expect(push).toBeDefined()

    push?.({}, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 1,
      phase: 'decrypt',
      unit: 'bytes',
      completed: 256,
      total: 1_024,
      detail: 'Restoring verified archive',
      databasePath: '/private/archive-review/session/mission-store.sqlite',
      sessionDirectory: '/private/archive-review/session',
      secret: SECRET,
    })
    expect(listener).toHaveBeenCalledWith({
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
    expect(JSON.stringify(listener.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(listener.mock.calls)).not.toMatch(/path|directory|scratch/iu)

    push?.({}, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      sequence: 2,
      phase: 'attachments',
      unit: 'files',
      completed: 4,
      total: 5,
      detail: 'attachments-restored',
    })
    expect(listener).toHaveBeenLastCalledWith({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 1,
      sequence: 2,
      phase: 'attachments',
      unit: 'files',
      completed: 4,
      total: 5,
      detail: 'attachments-restored',
    })

    push?.({}, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 3,
      phase: 'validate',
      unit: 'bytes',
      completed: 4_096,
      total: 4_096,
      detail: 'sqlite-validated',
    })
    expect(listener).toHaveBeenLastCalledWith({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 3,
      phase: 'validate',
      unit: 'bytes',
      completed: 4_096,
      total: 4_096,
      detail: 'sqlite-validated',
    })

    expect(() => push?.({}, {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      sequence: 2,
      phase: 'ready',
      unit: 'files',
      completed: 1,
      total: 1,
      detail: 'x'.repeat(64 * 1024 * 1024),
    })).toThrow(/archive review.*progress|progress.*archive review/iu)
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe?.()
    expect(removeListener).toHaveBeenCalledWith(PROGRESS_CHANNEL, push)
  })
})
