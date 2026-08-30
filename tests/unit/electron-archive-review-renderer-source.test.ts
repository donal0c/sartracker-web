import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElectronArchiveReviewSource } from '../../src/infrastructure/archive-review/electron-archive-review-source'

const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const MISSION_ID = 'mission-review-fixed'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)
const OPENED_AT = '2026-08-30T09:00:00.000Z'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const ARCHIVE_REVIEW_SOURCE_METHODS = [
  'cancelMissionReplay',
  'cancelMissionReviewRead',
  'info',
  'listArchiveAttachmentPage',
  'listDevices',
  'listDrawings',
  'listGpxImportPage',
  'listGpxImports',
  'listHelicopters',
  'listLayerCatalogMetadata',
  'listMarkers',
  'listMissions',
  'listOutings',
  'listSearchOperationPage',
  'openAttachment',
  'readMissionReplay',
  'readMissionReplayFilterPage',
  'readMissionReplayObjectChunk',
  'readMissionReplayTrackChunk',
  'readMissionReview',
] as const

const ARCHIVE_SESSION = Object.freeze({
  sessionId: SESSION_ID,
  archiveId: ARCHIVE_ID,
  missionId: MISSION_ID,
  containerVersion: 2 as const,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: CIPHERTEXT_SHA256,
  previousArchiveId: null,
  openedAt: OPENED_AT,
  plaintextResidual: 'permission_restricted_session_open' as const,
})

type ArchiveReviewReadInput = {
  readonly sessionId: string
  readonly requestId: string
  readonly method: string
  readonly input: Readonly<Record<string, unknown>>
}

/** Installs the narrow renderer bridge used by the real Electron adapter. */
function installArchiveReviewBridge(read: (input: ArchiveReviewReadInput) => Promise<unknown>): void {
  Object.defineProperty(window, 'sartrackerElectron', {
    configurable: true,
    value: { archiveReview: { read: vi.fn(read) } },
  })
}

/** Reads the archive-review bridge double without widening the production interface. */
function archiveReviewReadMock() {
  return window.sartrackerElectron?.archiveReview.read as ReturnType<typeof vi.fn>
}

describe('Electron archive-review renderer source [DON-253]', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
    vi.restoreAllMocks()
  })

  it('exposes exactly the fixed read-only facade and no mission mutation capability', () => {
    installArchiveReviewBridge(async () => undefined)

    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)

    expect(Object.keys(source).sort()).toEqual(ARCHIVE_REVIEW_SOURCE_METHODS)
    for (const mutation of [
      'createMission',
      'updateMission',
      'upsertMarker',
      'deleteDrawing',
      'upsertSearchAssignment',
      'upsertSearchPass',
      'finalizeMission',
    ]) {
      expect(Object.hasOwn(source, mutation)).toBe(false)
    }
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('maps no-argument, mission, page, layer and attachment reads to exact session-bound IPC', async () => {
    installArchiveReviewBridge(async (request) => ({ method: request.method }))
    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)

    await source.info()
    await source.listMissions()
    await source.listMarkers(MISSION_ID)
    await source.listGpxImportPage({ missionId: MISSION_ID, cursor: 'gpx-page-2', limit: 25 })
    await source.listLayerCatalogMetadata(MISSION_ID)
    await source.listArchiveAttachmentPage({ missionId: MISSION_ID, cursor: null, limit: 25 })
    await source.openAttachment({
      missionId: MISSION_ID,
      attachmentPath: '/historical/marker/photo.jpg',
      referenceKind: 'marker',
      referenceId: 'marker-1',
    })

    const calls = archiveReviewReadMock().mock.calls.map(([input]) => input)
    expect(calls.map((input) => ({
      sessionId: input.sessionId,
      requestIdIsUuid: UUID_V4.test(input.requestId),
      method: input.method,
      input: input.input,
    }))).toEqual([
      { sessionId: SESSION_ID, requestIdIsUuid: true, method: 'info', input: {} },
      { sessionId: SESSION_ID, requestIdIsUuid: true, method: 'listMissions', input: {} },
      {
        sessionId: SESSION_ID,
        requestIdIsUuid: true,
        method: 'listMarkers',
        input: { missionId: MISSION_ID },
      },
      {
        sessionId: SESSION_ID,
        requestIdIsUuid: true,
        method: 'listGpxImportPage',
        input: { missionId: MISSION_ID, cursor: 'gpx-page-2', limit: 25 },
      },
      {
        sessionId: SESSION_ID,
        requestIdIsUuid: true,
        method: 'listLayerCatalogMetadata',
        input: { missionId: MISSION_ID },
      },
      {
        sessionId: SESSION_ID,
        requestIdIsUuid: true,
        method: 'listArchiveAttachmentPage',
        input: { missionId: MISSION_ID, cursor: null, limit: 25 },
      },
      {
        sessionId: SESSION_ID,
        requestIdIsUuid: true,
        method: 'openAttachment',
        input: {
          missionId: MISSION_ID,
          attachmentPath: '/historical/marker/photo.jpg',
          referenceKind: 'marker',
          referenceId: 'marker-1',
        },
      },
    ])
    expect(new Set(calls.map((input) => input.requestId)).size).toBe(calls.length)
  })

  it('rejects every representative mission substitution before it reaches IPC', async () => {
    installArchiveReviewBridge(async () => undefined)
    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)
    const wrongMission = 'mission-outside-restored-session'

    const substitutions = [
      () => source.listMarkers(wrongMission),
      () => source.listGpxImportPage({ missionId: wrongMission, limit: 25 }),
      () => source.readMissionReview({
        missionId: wrongMission,
        includeTelemetry: false,
        auditLimit: 101,
      }, 'logical-review-request'),
      () => source.openAttachment({
        missionId: wrongMission,
        attachmentPath: '/historical/marker/photo.jpg',
        referenceKind: 'marker',
        referenceId: 'marker-1',
      }),
    ]

    for (const substitute of substitutions) {
      await expect(Promise.resolve().then(substitute)).rejects.toThrow(
        /archive.*mission|mission.*archive|fixed.*mission/iu,
      )
    }
    expect(archiveReviewReadMock()).not.toHaveBeenCalled()
  })

  it('owns request UUIDs and cancels only the matching in-flight logical Review read', async () => {
    let settleReview: ((value: unknown) => void) | undefined
    const pendingReview = new Promise((resolve) => { settleReview = resolve })
    installArchiveReviewBridge(async (request) => {
      if (request.method === 'readMissionReview') return await pendingReview
      if (request.method === 'cancelMissionReviewRead') return true
      return undefined
    })
    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)
    const logicalRequestId = 'mission-review-renderer-owned-1'

    const review = source.readMissionReview({
      missionId: MISSION_ID,
      includeTelemetry: false,
      auditLimit: 101,
    }, logicalRequestId)
    await vi.waitFor(() => expect(archiveReviewReadMock()).toHaveBeenCalledTimes(1))
    const ownedRequest = archiveReviewReadMock().mock.calls[0]?.[0] as ArchiveReviewReadInput
    expect(ownedRequest.requestId).toMatch(UUID_V4)
    expect(ownedRequest.requestId).not.toBe(logicalRequestId)

    await expect(source.readMissionReview({
      missionId: MISSION_ID,
      includeTelemetry: false,
      auditLimit: 101,
    }, logicalRequestId)).rejects.toThrow(/request.*active|active.*request/iu)

    await expect(source.cancelMissionReviewRead(logicalRequestId)).resolves.toBe(true)
    const cancellation = archiveReviewReadMock().mock.calls[1]?.[0] as ArchiveReviewReadInput
    expect(cancellation).toMatchObject({
      sessionId: SESSION_ID,
      method: 'cancelMissionReviewRead',
      input: { requestId: ownedRequest.requestId },
    })
    expect(cancellation.requestId).toMatch(UUID_V4)

    settleReview?.({ auditEvents: [], breadcrumbCount: 0 })
    await expect(review).resolves.toEqual({ auditEvents: [], breadcrumbCount: 0 })
    const callCount = archiveReviewReadMock().mock.calls.length
    await expect(source.cancelMissionReviewRead(logicalRequestId)).resolves.toBe(false)
    expect(archiveReviewReadMock()).toHaveBeenCalledTimes(callCount)
  })

  it('keeps Replay cancellation ownership separate from Review request ownership', async () => {
    let settleReplay: ((value: unknown) => void) | undefined
    const pendingReplay = new Promise((resolve) => { settleReplay = resolve })
    installArchiveReviewBridge(async (request) => {
      if (request.method === 'readMissionReplay') return await pendingReplay
      if (request.method === 'cancelMissionReplay') return true
      return undefined
    })
    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)

    const replay = source.readMissionReplay({
      missionId: MISSION_ID,
      selectedTime: '2026-08-29T10:00:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 500,
      objectLimit: 100,
    }, 'logical-replay-request')
    await vi.waitFor(() => expect(archiveReviewReadMock()).toHaveBeenCalledTimes(1))
    const replayRequest = archiveReviewReadMock().mock.calls[0]?.[0] as ArchiveReviewReadInput

    await expect(source.cancelMissionReviewRead('logical-replay-request')).resolves.toBe(false)
    await expect(source.cancelMissionReplay('logical-replay-request')).resolves.toBe(true)
    expect(archiveReviewReadMock().mock.calls[1]?.[0]).toMatchObject({
      method: 'cancelMissionReplay',
      input: { requestId: replayRequest.requestId },
    })

    settleReplay?.({ selectedTime: '2026-08-29T10:00:00.000Z' })
    await replay
  })

  it('surfaces synchronous denial-audit transport failure instead of claiming an audited denial', () => {
    installArchiveReviewBridge(() => {
      throw new Error('transport unavailable')
    })
    const source = createElectronArchiveReviewSource(ARCHIVE_SESSION)
    const mutation = source as unknown as {
      readonly updateMission: (input: Readonly<Record<string, unknown>>) => unknown
    }

    expect(() => mutation.updateMission({ missionId: MISSION_ID })).toThrow(
      /mutation denial audit.*failed safely|audit.*failed safely/iu,
    )
  })

  it('fails closed before reads when the archive-review preload bridge is unavailable', () => {
    expect(() => createElectronArchiveReviewSource(ARCHIVE_SESSION)).toThrow(
      'Electron archive review bridge is not available.',
    )
  })
})
