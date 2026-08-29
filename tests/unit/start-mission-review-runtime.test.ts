import { describe, expect, it, vi } from 'vitest'

import type {
  Device,
  Drawing,
  Marker,
  Mission,
  MissionEvent,
  MissionReplayObjectChunkResult,
  MissionStoreInfo,
  Position,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionReviewRuntime } from '../../src/features/mission-review/start-mission-review-runtime'

describe('startMissionReviewRuntime', () => {
  it('loads the preferred mission review snapshot', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([SECOND_MISSION, FIRST_MISSION]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedMissionId: FIRST_MISSION.id,
        snapshot: expect.objectContaining({
          mission: FIRST_MISSION,
        }),
      }),
    )
  })

  it('keeps one review GPX projection page in renderer state and replaces it on demand [DON-274]', async () => {
    const listGpxImports = vi.fn().mockRejectedValue(new Error('unbounded API must not be called'))
    const listGpxImportPage = vi
      .fn()
      .mockResolvedValueOnce({ entries: [{
        id: 'gpx-1',
        mission_id: FIRST_MISSION.id,
        source_path: '/field/gpx-1.gpx',
        file_name: 'gpx-1.gpx',
        display_name: 'Team track',
        geometry_json: '{"type":"MultiLineString","coordinates":[]}',
        metadata_json: null,
        imported_at: '2026-04-10T08:00:00.000Z',
        updated_at: '2026-04-10T08:00:00.000Z',
      }], nextCursor: null })
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ listGpxImports, listGpxImportPage }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(listGpxImports).not.toHaveBeenCalled()
    expect(listGpxImportPage).toHaveBeenCalledWith({
      missionId: FIRST_MISSION.id, limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      gpxImports: expect.objectContaining({
        pageNumber: 1,
        visibleCount: 1,
        hasMore: false,
        loading: false,
      }),
      snapshot: expect.objectContaining({
        summary: expect.objectContaining({ gpxImportCount: 1 }),
      }),
    }))
  })

  it('makes additional review GPX evidence explicit without accumulating renderer pages [DON-274]', async () => {
    const firstPage = [{
      id: 'gpx-1', mission_id: FIRST_MISSION.id, source_path: '/field/gpx-1.gpx',
      file_name: 'gpx-1.gpx', display_name: 'Alpha track',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}', metadata_json: null,
      imported_at: '2026-04-10T08:00:00.000Z', updated_at: '2026-04-10T08:00:00.000Z',
    }]
    const secondPage = [{ ...firstPage[0], id: 'gpx-2', display_name: 'Bravo track' }]
    const listGpxImportPage = vi.fn()
      .mockResolvedValueOnce({ entries: firstPage, nextCursor: 'page-2' })
      .mockResolvedValueOnce({ entries: secondPage, nextCursor: null })
      .mockResolvedValueOnce({ entries: firstPage, nextCursor: 'page-2' })
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ listGpxImportPage }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)
    expect(listGpxImportPage).toHaveBeenCalledTimes(1)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      gpxImports: expect.objectContaining({ pageNumber: 1, visibleCount: 1, hasMore: true }),
    }))

    await runtime.loadNextGpxImports()
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      gpxImports: expect.objectContaining({ pageNumber: 2, visibleCount: 1, hasMore: false }),
      snapshot: expect.objectContaining({
        summary: expect.objectContaining({ gpxImportCount: 1 }),
      }),
    }))

    await runtime.returnToFirstGpxImports()
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      gpxImports: expect.objectContaining({ pageNumber: 1, visibleCount: 1, hasMore: true }),
    }))
  })

  it('keeps one bounded Search Pass page and replaces it through explicit continuation [DON-279]', async () => {
    const pass = (id: string) => ({
      id, mission_id: FIRST_MISSION.id, search_area_id: 'area-1',
      assignment_id: 'assignment-1', started_at: '2026-04-10T08:10:00.000Z',
      ended_at: '2026-04-10T08:20:00.000Z', outcome: 'partial' as const,
      coordinator_name: 'Coordinator', version_sequence: 1,
      created_at: '2026-04-10T08:20:00.000Z', updated_at: '2026-04-10T08:20:00.000Z',
      participant_count: 0, clue_count: 0, track_evidence_count: 0,
    })
    const listSearchOperationPage = vi.fn().mockImplementation(async (input: {
      readonly kind: string; readonly cursor?: string; readonly search?: string
    }) => {
      if (input.kind !== 'passes') {
        return { kind: input.kind, search: input.search ?? '', entries: [], totalCount: 0, nextCursor: null }
      }
      return input.cursor === undefined
        ? { kind: 'passes', search: input.search ?? '', entries: [pass('pass-1')], totalCount: 2, nextCursor: 'pass-page-2' }
        : { kind: 'passes', search: input.search ?? '', entries: [pass('pass-2')], totalCount: 2, nextCursor: null }
    })
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ listSearchOperationPage }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)
    expect(listSearchOperationPage).toHaveBeenCalledWith({
      missionId: FIRST_MISSION.id, kind: 'passes', limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      searchOperations: expect.objectContaining({
        passes: [expect.objectContaining({ id: 'pass-1' })],
        pages: expect.objectContaining({
          passes: expect.objectContaining({ totalCount: 2, hasMore: true, pageNumber: 1 }),
        }),
      }),
    }))

    await runtime.loadNextSearchOperations('passes')
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      searchOperations: expect.objectContaining({
        passes: [expect.objectContaining({ id: 'pass-2' })],
        pages: expect.objectContaining({
          passes: expect.objectContaining({ totalCount: 2, hasMore: false, pageNumber: 2 }),
        }),
      }),
    }))
    await runtime.searchSearchOperations('passes', 'Alpha')
    expect(listSearchOperationPage).toHaveBeenLastCalledWith({
      missionId: FIRST_MISSION.id, kind: 'passes', search: 'Alpha', limit: 25,
    })
  })

  it('replaces Replay outing filter pages without accumulating renderer choices [DON-278]', async () => {
    const firstReplay = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      availableOutingIds: ['outing-1'],
      availableOutingTotalCount: 2,
      availableOutingNextCursor: 'outing-page-2',
    }
    const readMissionReplayFilterPage = vi.fn().mockResolvedValue({
      filterKind: 'outing', search: '', entries: ['outing-2'], totalCount: 2, nextCursor: null,
    })
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReplay: vi.fn().mockResolvedValue(firstReplay),
        readMissionReplayFilterPage,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })
    await runtime.load(FIRST_MISSION.id)
    await runtime.seekReplay(firstReplay.selectedTime)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        result: expect.objectContaining({ availableOutingIds: ['outing-1'] }),
        outingFilters: expect.objectContaining({ totalCount: 2, hasMore: true, pageNumber: 1 }),
      }),
    }))

    await runtime.loadNextReplayOutingFilters()
    expect(readMissionReplayFilterPage).toHaveBeenCalledWith(expect.objectContaining({
      missionId: FIRST_MISSION.id, filterKind: 'outing', filterCursor: 'outing-page-2',
    }), expect.any(String))
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        result: expect.objectContaining({ availableOutingIds: ['outing-2'] }),
        outingFilters: expect.objectContaining({ totalCount: 2, hasMore: false, pageNumber: 2 }),
      }),
    }))
  })

  it('cancels superseded replay seeks and publishes only the newest data-known-at-T result [DON-278]', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    const readMissionReplay = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(replayResult('2026-04-10T08:20:00.000Z', 'newest-fix'))
    const cancelMissionReplay = vi.fn().mockResolvedValue(true)
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ readMissionReplay, cancelMissionReplay }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })
    await runtime.load(FIRST_MISSION.id)

    const first = runtime.seekReplay('2026-04-10T08:10:00.000Z')
    await vi.waitFor(() => expect(readMissionReplay).toHaveBeenCalledOnce())
    const firstRequestId = readMissionReplay.mock.calls[0]?.[1] as string
    const second = runtime.seekReplay('2026-04-10T08:20:00.000Z')
    await second
    resolveFirst?.(replayResult('2026-04-10T08:10:00.000Z', 'obsolete-fix'))
    await first

    expect(cancelMissionReplay).toHaveBeenCalledWith(firstRequestId)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        mode: 'replay',
        selectedTime: '2026-04-10T08:20:00.000Z',
        result: expect.objectContaining({
          tracks: [expect.objectContaining({ evidence_id: 'newest-fix' })],
        }),
      }),
    }))
  })

  it('keeps display-only device and outing filters on exact-track continuation reads [DON-278]', async () => {
    const firstResult = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      nextCursor: 'opaque-keyset-cursor',
      deviceFilterIds: ['device-7'],
      outingFilterIds: ['outing-3'],
    }
    const readMissionReplay = vi.fn().mockResolvedValue(firstResult)
    const readMissionReplayTrackChunk = vi.fn().mockResolvedValue({
      missionId: FIRST_MISSION.id,
      selectedTime: firstResult.selectedTime,
      tracks: [],
      trackCursor: '1',
      previousCursor: 'opaque-previous',
      totalTrackCount: 1,
      nextCursor: null,
      progress: 1,
    })
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ readMissionReplay, readMissionReplayTrackChunk }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    await runtime.load(FIRST_MISSION.id)

    await runtime.seekReplay(firstResult.selectedTime, {
      deviceIds: ['device-7'], outingIds: ['outing-3'],
    })
    await runtime.loadNextReplayChunk()

    expect(readMissionReplay).toHaveBeenCalledWith(expect.objectContaining({
      deviceIds: ['device-7'], outingIds: ['outing-3'],
    }), expect.any(String))
    expect(readMissionReplayTrackChunk).toHaveBeenCalledWith(expect.objectContaining({
      cursor: 'opaque-keyset-cursor',
      deviceIds: ['device-7'],
      outingIds: ['outing-3'],
    }), expect.any(String))
  })

  it('cancels and failure-fences superseded replay pages [DON-278]', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const firstResult = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      nextCursor: 'page-one',
    }
    const readMissionReplay = vi.fn().mockResolvedValue(firstResult)
    const readMissionReplayTrackChunk = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce({
        missionId: FIRST_MISSION.id,
        selectedTime: firstResult.selectedTime,
        tracks: [{ ...firstResult.tracks[0], evidence_id: 'newest-page' }],
        trackCursor: '1', previousCursor: 'page-zero', totalTrackCount: 2,
        nextCursor: null, progress: 1,
      })
    const cancelMissionReplay = vi.fn().mockResolvedValue(true)
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReplay, readMissionReplayTrackChunk, cancelMissionReplay,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })
    await runtime.load(FIRST_MISSION.id)
    await runtime.seekReplay(firstResult.selectedTime)

    const obsolete = runtime.loadNextReplayChunk()
    await vi.waitFor(() => expect(readMissionReplayTrackChunk).toHaveBeenCalledOnce())
    const obsoleteRequestId = readMissionReplayTrackChunk.mock.calls[0]?.[1] as string
    const newest = runtime.loadNextReplayChunk()
    await newest
    rejectFirst?.(new Error('superseded page bound failure'))
    await obsolete

    expect(cancelMissionReplay).toHaveBeenCalledWith(obsoleteRequestId)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        error: null,
        loadingMore: false,
        result: expect.objectContaining({
          tracks: [expect.objectContaining({ evidence_id: 'newest-page' })],
        }),
      }),
    }))
  })

  it('replaces the large-state limitation when the displayed object page changes [DON-278]', async () => {
    const firstResult = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      nextObjectCursor: '100',
      totalObjectCount: 300,
      deviceFilterIds: ['device-7'],
      outingFilterIds: ['outing-3'],
      limitations: [{
        code: 'large_object_details_summarized',
        message: 'Large evidence states are represented by bounded summaries and retained-state hashes in this page.',
        count: 1,
      }],
    }
    const laterPage = {
      missionId: FIRST_MISSION.id,
      selectedTime: firstResult.selectedTime,
      objects: [],
      totalObjectCount: 300,
      objectCursor: '100',
      nextObjectCursor: '200',
      progress: 2 / 3,
      summarizedObjectCount: 0,
    } satisfies MissionReplayObjectChunkResult
    const finalPage = {
      ...laterPage,
      objectCursor: '200',
      nextObjectCursor: null,
      progress: 1,
      summarizedObjectCount: 2,
    } satisfies MissionReplayObjectChunkResult
    const readMissionReplay = vi.fn().mockResolvedValue(firstResult)
    const readMissionReplayObjectChunk = vi.fn()
      .mockResolvedValueOnce(laterPage)
      .mockResolvedValueOnce(finalPage)
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReplay,
        readMissionReplayObjectChunk,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })
    await runtime.load(FIRST_MISSION.id)
    await runtime.seekReplay(firstResult.selectedTime)

    await runtime.loadNextReplayObjects()

    expect(readMissionReplayObjectChunk).toHaveBeenLastCalledWith(expect.objectContaining({
      deviceIds: ['device-7'],
      outingIds: ['outing-3'],
    }), expect.any(String))

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        result: expect.objectContaining({
          objectCursor: '100',
          limitations: expect.not.arrayContaining([
            expect.objectContaining({ code: 'large_object_details_summarized' }),
          ]),
        }),
      }),
    }))

    await runtime.loadNextReplayObjects()

    expect(readMissionReplayObjectChunk).toHaveBeenLastCalledWith(expect.objectContaining({
      deviceIds: ['device-7'],
      outingIds: ['outing-3'],
    }), expect.any(String))

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      replay: expect.objectContaining({
        result: expect.objectContaining({
          objectCursor: '200',
          limitations: expect.arrayContaining([expect.objectContaining({
            code: 'large_object_details_summarized',
            count: 2,
          })]),
        }),
      }),
    }))
  })

  it('preserves omitted filters while paging the default all-mission object view [DON-278]', async () => {
    const firstResult = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      nextObjectCursor: 'opaque-object-cursor',
      totalObjectCount: 101,
    }
    const readMissionReplay = vi.fn().mockResolvedValue(firstResult)
    const readMissionReplayObjectChunk = vi.fn().mockResolvedValue({
      missionId: FIRST_MISSION.id,
      selectedTime: firstResult.selectedTime,
      objects: [],
      totalObjectCount: 101,
      objectCursor: 'opaque-object-cursor',
      nextObjectCursor: null,
      progress: 1,
      summarizedObjectCount: 0,
    } satisfies MissionReplayObjectChunkResult)
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReplay,
        readMissionReplayObjectChunk,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    await runtime.load(FIRST_MISSION.id)
    await runtime.seekReplay(firstResult.selectedTime)

    await runtime.loadNextReplayObjects()

    expect(readMissionReplayObjectChunk).toHaveBeenCalledWith({
      missionId: FIRST_MISSION.id,
      selectedTime: firstResult.selectedTime,
      timezone: 'Europe/Dublin',
      trackLimit: 500,
      objectLimit: 100,
      replayGeneration: 0,
      objectCursor: 'opaque-object-cursor',
    }, expect.any(String))
  })

  it('uses bound object cursor history when navigating to an earlier replay page [DON-278]', async () => {
    const firstPageCursor = 'eyJ2Ijo0LCJvZmZzZXQiOjEwMCwiY29udGV4dCI6ImZpcnN0In0'
    const secondPageCursor = 'eyJ2Ijo0LCJvZmZzZXQiOjIwMCwiY29udGV4dCI6InNlY29uZCJ9'
    const firstResult = {
      ...replayResult('2026-04-10T08:20:00.000Z', 'first-fix'),
      nextObjectCursor: firstPageCursor,
      totalObjectCount: 300,
    }
    const readMissionReplay = vi.fn().mockResolvedValue(firstResult)
    const readMissionReplayObjectChunk = vi.fn()
      .mockResolvedValueOnce({
        ...firstResult,
        objects: [],
        objectCursor: '100',
        nextObjectCursor: secondPageCursor,
        progress: 2 / 3,
        summarizedObjectCount: 0,
      } satisfies MissionReplayObjectChunkResult)
      .mockResolvedValueOnce({
        ...firstResult,
        objects: [],
        objectCursor: '200',
        nextObjectCursor: null,
        progress: 1,
        summarizedObjectCount: 0,
      } satisfies MissionReplayObjectChunkResult)
      .mockResolvedValueOnce({
        ...firstResult,
        objects: [],
        objectCursor: '100',
        nextObjectCursor: secondPageCursor,
        progress: 2 / 3,
        summarizedObjectCount: 0,
      } satisfies MissionReplayObjectChunkResult)
      .mockResolvedValueOnce({
        ...firstResult,
        objects: [],
        objectCursor: '0',
        nextObjectCursor: firstPageCursor,
        progress: 1 / 3,
        summarizedObjectCount: 0,
      } satisfies MissionReplayObjectChunkResult)
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReplay,
        readMissionReplayObjectChunk,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    await runtime.load(FIRST_MISSION.id)
    await runtime.seekReplay(firstResult.selectedTime)

    await runtime.loadNextReplayObjects()
    await runtime.loadNextReplayObjects()
    await runtime.loadPreviousReplayObjects()
    await runtime.loadPreviousReplayObjects()

    expect(readMissionReplayObjectChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      objectCursor: firstPageCursor,
    }), expect.any(String))
    expect(readMissionReplayObjectChunk).toHaveBeenNthCalledWith(2, expect.objectContaining({
      objectCursor: secondPageCursor,
    }), expect.any(String))
    expect(readMissionReplayObjectChunk).toHaveBeenNthCalledWith(3, expect.objectContaining({
      objectCursor: firstPageCursor,
    }), expect.any(String))
    expect(readMissionReplayObjectChunk).toHaveBeenNthCalledWith(4, expect.not.objectContaining({
      objectCursor: expect.anything(),
    }), expect.any(String))
  })

  it('cancels and fences replay when the selected mission changes [DON-278]', async () => {
    let resolveReplay: ((value: ReturnType<typeof replayResult>) => void) | undefined
    const readMissionReplay = vi.fn().mockImplementation(
      () => new Promise<ReturnType<typeof replayResult>>((resolve) => { resolveReplay = resolve }),
    )
    const cancelMissionReplay = vi.fn().mockResolvedValue(true)
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION, SECOND_MISSION]),
        readMissionReplay,
        cancelMissionReplay,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })
    await runtime.load(FIRST_MISSION.id)

    const pendingReplay = runtime.seekReplay('2026-04-10T08:20:00.000Z')
    await vi.waitFor(() => expect(readMissionReplay).toHaveBeenCalledOnce())
    const replayRequestId = readMissionReplay.mock.calls[0]?.[1] as string
    await runtime.selectMission(SECOND_MISSION.id)
    resolveReplay?.(replayResult('2026-04-10T08:20:00.000Z', 'mission-a-fix'))
    await pendingReplay

    expect(cancelMissionReplay).toHaveBeenCalledWith(replayRequestId)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedMissionId: SECOND_MISSION.id,
      replay: expect.objectContaining({ mode: 'live', result: null }),
    }))
  })

  it('loads audit and exact breadcrumb count through one bounded Review query [DON-251]', async () => {
    const readMissionReview = vi.fn().mockResolvedValue({
      auditEvents: [],
      breadcrumbCount: 12_345,
    })
    const listAuditEvents = vi.fn().mockRejectedValue(
      new Error('legacy main-isolate audit query must not run'),
    )
    const countPositions = vi.fn().mockRejectedValue(
      new Error('legacy main-isolate count query must not run'),
    )
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        readMissionReview,
        listAuditEvents,
        countPositions,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })

    await runtime.load(FIRST_MISSION.id)

    expect(readMissionReview).toHaveBeenCalledWith(
      {
        missionId: FIRST_MISSION.id,
        includeTelemetry: false,
        auditLimit: 501,
      },
      expect.stringMatching(/^mission-review-/u),
    )
    expect(listAuditEvents).not.toHaveBeenCalled()
    expect(countPositions).not.toHaveBeenCalled()
  })

  it('uses a unique request namespace across renderer runtime generations [DON-251]', async () => {
    const firstRead = vi.fn().mockResolvedValue({ auditEvents: [], breadcrumbCount: 0 })
    const secondRead = vi.fn().mockResolvedValue({ auditEvents: [], breadcrumbCount: 0 })
    const first = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ readMissionReview: firstRead }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })
    const second = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({ readMissionReview: secondRead }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })

    await first.load(FIRST_MISSION.id)
    await second.load(FIRST_MISSION.id)

    expect(firstRead.mock.calls[0]?.[1]).not.toBe(secondRead.mock.calls[0]?.[1])
  })

  it('cancels an obsolete Review read and fences its late failure [DON-251]', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const readMissionReview = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce({ auditEvents: [], breadcrumbCount: 2 })
    const cancelMissionReviewRead = vi.fn().mockResolvedValue(true)
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([SECOND_MISSION, FIRST_MISSION]),
        readMissionReview,
        cancelMissionReviewRead,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    const firstLoad = runtime.load(FIRST_MISSION.id)
    await vi.waitFor(() => expect(readMissionReview).toHaveBeenCalledOnce())
    const firstRequestId = readMissionReview.mock.calls[0]?.[1] as string
    const secondLoad = runtime.load(SECOND_MISSION.id)
    await vi.waitFor(() => expect(readMissionReview).toHaveBeenCalledTimes(2))

    expect(cancelMissionReviewRead).toHaveBeenCalledWith(firstRequestId)
    const abort = new Error('obsolete worker terminated')
    abort.name = 'AbortError'
    rejectFirst?.(abort)
    await Promise.all([firstLoad, secondLoad])

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedMissionId: SECOND_MISSION.id,
        error: null,
        snapshot: expect.objectContaining({
          summary: expect.objectContaining({ breadcrumbCount: 2 }),
        }),
      }),
    )
  })

  it('requests a bounded, telemetry-free audit log by default', async () => {
    const applyRuntime = vi.fn()
    const readMissionReview = vi.fn().mockResolvedValue({
      auditEvents: [],
      breadcrumbCount: 1,
    })
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        readMissionReview,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(readMissionReview).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: FIRST_MISSION.id,
        includeTelemetry: false,
      }),
      expect.any(String),
    )
    const query = readMissionReview.mock.calls[0]?.[0] as { readonly auditLimit: number }
    expect(query.auditLimit).toBeGreaterThan(0)
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeTelemetry: false, auditLogTruncated: false }),
    )
  })

  it('reloads with telemetry included when the toggle is enabled', async () => {
    const applyRuntime = vi.fn()
    const readMissionReview = vi.fn().mockResolvedValue({
      auditEvents: [],
      breadcrumbCount: 1,
    })
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        readMissionReview,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)
    await runtime.setIncludeTelemetry(true)

    expect(readMissionReview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        missionId: FIRST_MISSION.id,
        includeTelemetry: true,
      }),
      expect.any(String),
    )
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeTelemetry: true }),
    )
  })

  it('flags the audit log as truncated when more events exist than the page size', async () => {
    const applyRuntime = vi.fn()
    // Return one more event than the runtime's page size to trigger the truncation flag.
    const overflowEvents = Array.from({ length: 501 }, (_unused, index) => ({
      id: `event-${index}`,
      mission_id: FIRST_MISSION.id,
      event_type: 'marker_created',
      timestamp: `2026-04-10T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
      details_json: '{"name":"Marker"}',
    }))
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        readMissionReview: vi.fn().mockResolvedValue({
          auditEvents: overflowEvents,
          breadcrumbCount: 1,
        }),
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    const lastCall = applyRuntime.mock.calls.at(-1)?.[0]
    expect(lastCall?.auditLogTruncated).toBe(true)
    // The snapshot must not render more than the page size.
    expect(lastCall?.snapshot?.eventRows.length).toBe(500)
  })

  it('uses an exact scalar count without loading every breadcrumb row [DON-202, DON-251]', async () => {
    const applyRuntime = vi.fn()
    const listPositions = vi.fn().mockRejectedValue(new Error('Review must not load all positions'))
    const readMissionReview = vi.fn().mockResolvedValue({
      auditEvents: [],
      breadcrumbCount: 50_000,
    })
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        listPositions,
        readMissionReview,
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(readMissionReview).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: FIRST_MISSION.id }),
      expect.any(String),
    )
    expect(listPositions).not.toHaveBeenCalled()
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          summary: expect.objectContaining({
            breadcrumbCount: 50_000,
          }),
        }),
      }),
    )
  })

  it('keeps the latest refresh result when requests resolve out of order', async () => {
    const applyRuntime = vi.fn()
    let resolveFirstMission: ((value: {
      readonly auditEvents: readonly MissionEvent[]
      readonly breadcrumbCount: number
    }) => void) | null = null
    const readMissionReview = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{
            readonly auditEvents: readonly MissionEvent[]
            readonly breadcrumbCount: number
          }>((resolve) => {
            resolveFirstMission = resolve
          }),
      )
      .mockResolvedValueOnce({
        breadcrumbCount: 2,
        auditEvents: [{
          id: 'event-second',
          mission_id: SECOND_MISSION.id,
          event_type: 'mission_created',
          timestamp: '2026-04-10T09:00:00.000Z',
          details_json: '{"name":"Second Mission"}',
        }],
      })

    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([SECOND_MISSION, FIRST_MISSION]),
        readMissionReview,
        cancelMissionReviewRead: vi.fn().mockResolvedValue(true),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    const firstLoad = runtime.load(FIRST_MISSION.id)
    const secondLoad = runtime.load(SECOND_MISSION.id)
    await Promise.resolve()

    resolveFirstMission?.({
      breadcrumbCount: 1,
      auditEvents: [{
        id: 'event-first',
        mission_id: FIRST_MISSION.id,
        event_type: 'mission_created',
        timestamp: '2026-04-10T08:00:00.000Z',
        details_json: '{"name":"First Mission"}',
      }],
    })

    await Promise.all([firstLoad, secondLoad])

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedMissionId: SECOND_MISSION.id,
        snapshot: expect.objectContaining({
          mission: SECOND_MISSION,
        }),
      }),
    )
  })

  it('surfaces an error when a store query fails during load', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        listMarkers: vi.fn().mockRejectedValue(new Error('markers table corrupt')),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        loading: false,
        error: 'markers table corrupt',
      }),
    )
  })

  it('cancels the Review worker when a parallel snapshot read fails [DON-251]', async () => {
    const readMissionReview = vi.fn().mockReturnValue(new Promise(() => undefined))
    const cancelMissionReviewRead = vi.fn().mockResolvedValue(true)
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        readMissionReview,
        cancelMissionReviewRead,
        listMarkers: vi.fn().mockRejectedValue(new Error('markers table corrupt')),
      }),
      layerCatalogStore: { listMetadata: vi.fn().mockResolvedValue([]) },
      applyRuntime: vi.fn(),
    })

    await runtime.load(FIRST_MISSION.id)

    const requestId = readMissionReview.mock.calls[0]?.[1] as string
    expect(cancelMissionReviewRead).toHaveBeenCalledWith(requestId)
  })

  it('refreshes the currently selected mission', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)
    await runtime.refreshSelectedMission()

    const lastCall = applyRuntime.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({
      selectedMissionId: FIRST_MISSION.id,
      loading: false,
      refreshing: false,
    })
    expect(lastCall?.snapshot).not.toBeNull()
  })

  it('handles an empty mission list without crashing', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(null)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        missions: [],
        selectedMissionId: null,
        snapshot: null,
        loading: false,
        error: null,
      }),
    )
  })
})

const FIRST_MISSION: Mission = {
  id: 'mission-1',
  name: 'First Mission',
  status: 'finished',
  start_time: '2026-04-10T08:00:00.000Z',
  pause_time: null,
  finish_time: '2026-04-10T09:00:00.000Z',
  paused_seconds: 0,
  notes: null,
  schema_version: 1,
}

const SECOND_MISSION: Mission = {
  ...FIRST_MISSION,
  id: 'mission-2',
  name: 'Second Mission',
  start_time: '2026-04-10T10:00:00.000Z',
  finish_time: '2026-04-10T11:00:00.000Z',
}

function createMissionReviewStoreStub(overrides: Record<string, unknown> = {}) {
  const info: MissionStoreInfo = {
    schema_version: 1,
    database_path: '/tmp/mission-store.sqlite',
    backup_path: '/tmp/mission-store.backup.sqlite',
  }
  const marker: Marker = {
    id: 'marker-1',
    mission_id: FIRST_MISSION.id,
    type: 'clue',
    name: 'Boot Print',
    description: null,
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-10T08:15:00.000Z',
    updated_at: '2026-04-10T08:15:00.000Z',
    display_order: 1,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
  }
  const device: Device = {
    id: 'device-1',
    mission_id: FIRST_MISSION.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    color: '#38bdf8',
    last_seen: '2026-04-10T08:20:00.000Z',
    status: 'online',
  }
  const position: Position = {
    id: 'position-1',
    mission_id: FIRST_MISSION.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    lat: 52.0599,
    lon: -9.5045,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    source: null,
    timestamp: '2026-04-10T08:20:00.000Z',
    data_origin: 'live',
  }
  const drawing: Drawing = {
    id: 'drawing-1',
    mission_id: FIRST_MISSION.id,
    type: 'line',
    name: 'Track Line',
    description: null,
    color: '#38bdf8',
    width: 2,
    distance_m: 1200,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: '{"type":"LineString","coordinates":[[-9.5,52.0],[-9.4,52.1]]}',
    metadata_json: null,
    created_at: '2026-04-10T08:30:00.000Z',
    updated_at: '2026-04-10T08:35:00.000Z',
  }

  return {
    info: vi.fn().mockResolvedValue(info),
    listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
    readMissionReview: vi.fn().mockResolvedValue({
      auditEvents: [],
      breadcrumbCount: 1,
    }),
    cancelMissionReviewRead: vi.fn().mockResolvedValue(false),
    listAuditEvents: vi.fn().mockResolvedValue([]),
    listMarkers: vi.fn().mockResolvedValue([marker]),
    listDevices: vi.fn().mockResolvedValue([device]),
    listPositions: vi.fn().mockResolvedValue([position]),
    countPositions: vi.fn().mockResolvedValue(1),
    listDrawings: vi.fn().mockResolvedValue([drawing]),
    listGpxImports: vi.fn().mockResolvedValue([]),
    listOutings: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function replayResult(selectedTime: string, evidenceId: string) {
  return {
    missionId: FIRST_MISSION.id,
    selectedTime,
    timezone: 'Europe/Dublin',
    objects: [],
    totalObjectCount: 0,
    objectTypeCounts: {},
    objectCursor: '0',
    nextObjectCursor: null,
    tracks: [{
      evidence_id: evidenceId,
      source_type: 'traccar_fix',
      track_id: 'alpha',
      effective_at: selectedTime,
      recorded_at: selectedTime,
      lat: 52,
      lon: -9.7,
      elevation: null,
      accuracy: 5,
      time_authority: 'fixTime',
      completeness: 'complete',
    }],
    trackCursor: '0',
    previousCursor: null,
    totalTrackCount: 1,
    staticGpxPointCount: 0,
    availableDeviceIds: ['alpha'],
    availableOutingIds: [],
    deviceFilterIds: [],
    outingFilterIds: [],
    staticGpxEvidence: [],
    nextCursor: null,
    progress: 1,
    limitations: [],
  }
}
