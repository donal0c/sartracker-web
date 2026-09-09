import { describe, expect, it, vi } from 'vitest'

import type {
  Mission,
  SearchOperationPageKind,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  createMissionReviewRuntimeState,
  startMissionReviewRuntime,
} from '../../src/features/mission-review/start-mission-review-runtime'

const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const MISSION_ID = 'mission-review-fixed'
const OPENED_AT = '2026-08-30T09:00:00.000Z'

const ACTIVE_RESTORED_MISSION: Mission = {
  id: MISSION_ID,
  name: 'Restored Active-Looking Mission',
  status: 'active',
  start_time: '2026-08-29T08:00:00.000Z',
  pause_time: null,
  finish_time: null,
  paused_seconds: 0,
  notes: null,
  schema_version: 13,
}

const ARCHIVE_SESSION = Object.freeze({
  sessionId: SESSION_ID,
  archiveId: ARCHIVE_ID,
  missionId: MISSION_ID,
  containerVersion: 2 as const,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: 'b'.repeat(64),
  previousArchiveId: null,
  openedAt: OPENED_AT,
  plaintextResidual: 'permission_restricted_session_open' as const,
})

/** Builds the narrow fixed-mission read facade consumed by Mission Review. */
function createArchiveMissionReviewSource(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    info: vi.fn().mockResolvedValue({
      schema_version: 13,
      database_path: 'Archive review session (path hidden)',
      backup_path: 'Archive review session (read-only)',
    }),
    listMissions: vi.fn().mockResolvedValue([ACTIVE_RESTORED_MISSION]),
    readMissionReview: vi.fn().mockResolvedValue({ auditEvents: [], breadcrumbCount: 0 }),
    cancelMissionReviewRead: vi.fn().mockResolvedValue(false),
    readMissionReplay: vi.fn(),
    readMissionReplayTrackChunk: vi.fn(),
    readMissionReplayObjectChunk: vi.fn(),
    readMissionReplayFilterPage: vi.fn(),
    cancelMissionReplay: vi.fn().mockResolvedValue(false),
    listMarkers: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    listDrawings: vi.fn().mockResolvedValue([]),
    listHelicopters: vi.fn().mockResolvedValue([]),
    listGpxImports: vi.fn().mockResolvedValue([]),
    listGpxImportPage: vi.fn().mockResolvedValue({ entries: [], nextCursor: null }),
    listSearchOperationPage: vi.fn().mockImplementation(async (input: {
      readonly kind: SearchOperationPageKind
      readonly search?: string
    }) => ({
      kind: input.kind,
      search: input.search ?? '',
      generation: 1,
      entries: [],
      totalCount: 0,
      nextCursor: null,
    })),
    listOutings: vi.fn().mockResolvedValue([]),
    listArchiveAttachmentPage: vi.fn().mockResolvedValue({
      entries: [],
      nextCursor: null,
      totalCount: 0,
    }),
    openAttachment: vi.fn().mockResolvedValue(true),
    upsertSearchAssignment: vi.fn().mockResolvedValue({ id: 'must-not-be-written' }),
    upsertSearchPass: vi.fn().mockResolvedValue({ id: 'must-not-be-written' }),
    ...overrides,
  }
}

describe('archive-backed Mission Review runtime [DON-253]', () => {
  it('defaults ordinary Mission Review state to a live source with no archive metadata', () => {
    expect(createMissionReviewRuntimeState()).toMatchObject({
      source: 'live',
      archiveSession: null,
    })
  })

  it('publishes and preserves the exact archive source metadata through a Review load', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      missionStore: createArchiveMissionReviewSource(),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
    }))

    await runtime.load(MISSION_ID)

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      selectedMissionId: MISSION_ID,
      snapshot: expect.objectContaining({
        mission: expect.objectContaining({ id: MISSION_ID, status: 'active' }),
      }),
    }))
  })

  it('blocks every Search Operations write for an archive even if its restored row says active', async () => {
    const missionStore = createArchiveMissionReviewSource()
    const runtime = await startMissionReviewRuntime({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      missionStore,
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    await runtime.load(MISSION_ID)

    await expect(runtime.recordSearchAssignment({
      searchAreaId: 'area-1',
      outingId: 'outing-1',
      teamId: 'team-alpha',
      participantIds: ['participant-1'],
      notes: null,
      coordinatorName: 'Coordinator One',
    })).rejects.toThrow(/archive.*read-only|read-only.*archive/iu)
    await expect(runtime.recordSearchPass({
      searchAreaId: 'area-1',
      assignmentId: 'assignment-1',
      startedAt: '2026-08-29T08:15:00.000Z',
      endedAt: '2026-08-29T08:45:00.000Z',
      outcome: 'full',
      notes: null,
      coordinatorName: 'Coordinator One',
      participantIds: ['participant-1'],
      clueIds: ['clue-1'],
      trackEvidenceIds: ['track-1'],
    })).rejects.toThrow(/archive.*read-only|read-only.*archive/iu)

    expect(missionStore.upsertSearchAssignment).not.toHaveBeenCalled()
    expect(missionStore.upsertSearchPass).not.toHaveBeenCalled()
  })

  it('opens archived attachments only through the fixed-session facade, never the live path opener', async () => {
    const archiveOpenAttachment = vi.fn().mockResolvedValue(true)
    const liveOpenAttachment = vi.fn().mockResolvedValue(undefined)
    const missionStore = createArchiveMissionReviewSource({
      openAttachment: archiveOpenAttachment,
    })
    const runtime = await startMissionReviewRuntime({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      missionStore,
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      openLiveAttachment: liveOpenAttachment,
      applyRuntime: vi.fn(),
    })
    await runtime.load(MISSION_ID)

    await expect(runtime.openAttachment({
      attachmentPath: '/historical/marker/photo.jpg',
      referenceKind: 'marker',
      referenceId: 'marker-1',
    })).resolves.toBe(true)

    expect(archiveOpenAttachment).toHaveBeenCalledWith({
      missionId: MISSION_ID,
      attachmentPath: '/historical/marker/photo.jpg',
      referenceKind: 'marker',
      referenceId: 'marker-1',
    })
    expect(liveOpenAttachment).not.toHaveBeenCalled()
  })

  it('pages historical archive attachment references through the fixed mission', async () => {
    const listArchiveAttachmentPage = vi.fn().mockResolvedValue({
      entries: [{
        attachmentPath: 'retired-clue.jpg',
        referenceKind: 'marker_version',
        referenceId: 'marker-version-retired',
      }],
      nextCursor: null,
      totalCount: 1,
    })
    const runtime = await startMissionReviewRuntime({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      missionStore: createArchiveMissionReviewSource({ listArchiveAttachmentPage }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    await runtime.load(MISSION_ID)

    await expect(runtime.listArchiveAttachmentPage({ cursor: null, limit: 25 }))
      .resolves.toMatchObject({ totalCount: 1 })
    expect(listArchiveAttachmentPage).toHaveBeenCalledWith({
      missionId: MISSION_ID,
      cursor: null,
      limit: 25,
    })
  })

  it.each([
    ['archived', 'verified archive'],
    ['cleanup_in_progress', 'cleanup'],
  ] as const)(
    'never fans out ordinary live-store Review reads for a %s mission',
    async (storageState, expectedMessage) => {
      const applyRuntime = vi.fn()
      const missionStore = createArchiveMissionReviewSource({
        listMissions: vi.fn().mockResolvedValue([{
          ...ACTIVE_RESTORED_MISSION,
          status: 'finalized',
          storage_state: storageState,
        }]),
      })
      const layerCatalogStore = { listMetadata: vi.fn().mockResolvedValue([]) }
      const runtime = await startMissionReviewRuntime({
        source: 'live',
        missionStore,
        layerCatalogStore,
        applyRuntime,
      })

      await runtime.load(MISSION_ID)

      expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
        source: 'live',
        selectedMissionId: MISSION_ID,
        snapshot: null,
        loading: false,
        refreshing: false,
        error: expect.stringMatching(new RegExp(expectedMessage, 'iu')),
      }))
      expect(missionStore.readMissionReview).not.toHaveBeenCalled()
      expect(missionStore.info).not.toHaveBeenCalled()
      expect(missionStore.listMarkers).not.toHaveBeenCalled()
      expect(missionStore.listDevices).not.toHaveBeenCalled()
      expect(missionStore.listDrawings).not.toHaveBeenCalled()
      expect(missionStore.listGpxImportPage).not.toHaveBeenCalled()
      expect(missionStore.listSearchOperationPage).not.toHaveBeenCalled()
      expect(layerCatalogStore.listMetadata).not.toHaveBeenCalled()
    },
  )
})
