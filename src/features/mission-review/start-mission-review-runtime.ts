import type {
  Mission,
  MissionEvent,
  MissionStore,
  MissionStoreInfo,
  MissionReplayReadResult,
  SearchArea,
  SearchAssignment,
  SearchPass,
  Outing,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { buildMissionReviewSnapshot, type MissionReviewSnapshot } from './mission-review-model'
import { DEFAULT_AUDIT_EVENT_LIMIT } from './audit-events'

type MissionReviewStoreBoundary = Pick<
  MissionStore,
  | 'info'
  | 'listMissions'
  | 'readMissionReview'
  | 'cancelMissionReviewRead'
  | 'readMissionReplay'
  | 'readMissionReplayTrackChunk'
  | 'readMissionReplayObjectChunk'
  | 'cancelMissionReplay'
  | 'listMarkers'
  | 'listDevices'
  | 'listDrawings'
  | 'listHelicopters'
  | 'listGpxImports'
  | 'listGpxImportPage'
  | 'listSearchAreas'
  | 'listSearchAssignments'
  | 'listSearchPasses'
  | 'listOutings'
  | 'upsertSearchAssignment'
  | 'upsertSearchPass'
>

export type MissionReviewRuntimeState = {
  readonly missions: readonly Mission[]
  readonly selectedMissionId: string | null
  readonly snapshot: MissionReviewSnapshot | null
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error: string | null
  /** Whether high-volume tracking telemetry is included in the audit log. */
  readonly includeTelemetry: boolean
  /** True when the audit log was capped and older events are not shown. */
  readonly auditLogTruncated: boolean
  readonly gpxImports: {
    readonly pageNumber: number
    readonly visibleCount: number
    readonly hasMore: boolean
    readonly loading: boolean
    readonly nextCursor: string | null
  }
  readonly replay: MissionReplayRuntimeState
  readonly searchOperations: {
    readonly areas: readonly SearchArea[]
    readonly assignments: readonly SearchAssignment[]
    readonly passes: readonly SearchPass[]
    readonly outings: readonly Outing[]
  }
}

export type MissionReplayRuntimeState = {
  readonly mode: 'live' | 'replay'
  readonly selectedTime: string | null
  readonly result: MissionReplayReadResult | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: string | null
}

export type MissionReviewController = {
  readonly load: (preferredMissionId?: string | null) => Promise<void>
  readonly selectMission: (missionId: string) => Promise<void>
  readonly refreshSelectedMission: () => Promise<void>
  readonly loadNextGpxImports: () => Promise<void>
  readonly returnToFirstGpxImports: () => Promise<void>
  /** Reloads the selected mission with telemetry events shown or hidden. */
  readonly setIncludeTelemetry: (includeTelemetry: boolean) => Promise<void>
  readonly seekReplay: (selectedTime: string, filters?: {
    readonly deviceIds?: readonly string[]
    readonly outingIds?: readonly string[]
  }) => Promise<void>
  readonly loadNextReplayChunk: () => Promise<void>
  readonly loadPreviousReplayChunk: () => Promise<void>
  readonly loadNextReplayObjects: () => Promise<void>
  readonly loadPreviousReplayObjects: () => Promise<void>
  readonly returnToLive: () => void
  readonly recordSearchAssignment: (input: {
    readonly searchAreaId: string
    readonly outingId: string
    readonly teamId: string
    readonly participantIds: readonly string[]
    readonly notes: string | null
    readonly coordinatorName: string
  }) => Promise<void>
  readonly recordSearchPass: (input: {
    readonly searchAreaId: string
    readonly assignmentId: string
    readonly startedAt: string
    readonly endedAt: string | null
    readonly outcome: 'full' | 'partial' | 'aborted'
    readonly notes: string | null
    readonly coordinatorName: string
    readonly participantIds: readonly string[]
    readonly clueIds: readonly string[]
    readonly trackEvidenceIds: readonly string[]
  }) => Promise<void>
}

type StartMissionReviewRuntimeDependencies = {
  readonly missionStore: MissionReviewStoreBoundary
  readonly layerCatalogStore: Pick<LayerCatalogStore, 'listMetadata'>
  readonly applyRuntime: (runtime: MissionReviewRuntimeState) => void
}

const EMPTY_RUNTIME: MissionReviewRuntimeState = {
  missions: [],
  selectedMissionId: null,
  snapshot: null,
  loading: false,
  refreshing: false,
  error: null,
  includeTelemetry: false,
  auditLogTruncated: false,
  gpxImports: { pageNumber: 1, visibleCount: 0, hasMore: false, loading: false, nextCursor: null },
  replay: {
    mode: 'live',
    selectedTime: null,
    result: null,
    loading: false,
    loadingMore: false,
    error: null,
  },
  searchOperations: { areas: [], assignments: [], passes: [], outings: [] },
}

export async function startMissionReviewRuntime(
  dependencies: StartMissionReviewRuntimeDependencies,
): Promise<MissionReviewController> {
  let state: MissionReviewRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0
  let requestSequence = 0
  const requestNamespace = globalThis.crypto.randomUUID()
  let activeReviewRequestId: string | null = null
  let replayToken = 0
  let activeReplayRequestId: string | null = null
  let replayObjectPageCursors: readonly (string | null)[] = [null]
  let replayObjectPageIndex = 0

  publishRuntime()

  return {
    load: async (preferredMissionId) => {
      await loadMission(preferredMissionId ?? null, false)
    },
    selectMission: async (missionId) => {
      await loadMission(missionId, true)
    },
    refreshSelectedMission: async () => {
      await loadMission(state.selectedMissionId, true)
    },
    loadNextGpxImports: async () => {
      const cursor = state.gpxImports.nextCursor
      if (cursor === null || state.selectedMissionId === null || state.gpxImports.loading) return
      await loadMission(state.selectedMissionId, true, cursor, state.gpxImports.pageNumber + 1)
    },
    returnToFirstGpxImports: async () => {
      if (state.selectedMissionId === null || state.gpxImports.pageNumber === 1 || state.gpxImports.loading) return
      await loadMission(state.selectedMissionId, true, undefined, 1)
    },
    setIncludeTelemetry: async (includeTelemetry) => {
      state = { ...state, includeTelemetry }
      await loadMission(state.selectedMissionId, true)
    },
    seekReplay: async (selectedTime, filters) => {
      await seekReplay(selectedTime, filters)
    },
    loadNextReplayChunk: async () => {
      await loadNextReplayChunk()
    },
    loadPreviousReplayChunk: async () => {
      await loadReplayTrackChunk(state.replay.result?.previousCursor ?? null)
    },
    loadNextReplayObjects: async () => {
      const nextCursor = state.replay.result?.nextObjectCursor ?? null
      if (nextCursor === null) return
      await loadReplayObjectChunk(nextCursor, replayObjectPageIndex + 1)
    },
    loadPreviousReplayObjects: async () => {
      if (replayObjectPageIndex === 0) return
      const targetPageIndex = replayObjectPageIndex - 1
      await loadReplayObjectChunk(replayObjectPageCursors[targetPageIndex] ?? null, targetPageIndex)
    },
    returnToLive: () => {
      replayToken += 1
      cancelActiveReplayRead()
      resetReplayObjectPagination()
      state = { ...state, replay: { ...EMPTY_RUNTIME.replay } }
      publishRuntime()
    },
    recordSearchAssignment: async (input) => {
      if (state.selectedMissionId === null || dependencies.missionStore.upsertSearchAssignment === undefined) {
        throw new Error('Search assignment recording is unavailable in this runtime.')
      }
      await dependencies.missionStore.upsertSearchAssignment({
        mission_id: state.selectedMissionId,
        search_area_id: input.searchAreaId,
        outing_id: input.outingId,
        team_id: input.teamId,
        participant_ids: input.participantIds,
        notes: input.notes,
        updated_by: input.coordinatorName,
      })
      await loadMission(state.selectedMissionId, true)
    },
    recordSearchPass: async (input) => {
      if (state.selectedMissionId === null || dependencies.missionStore.upsertSearchPass === undefined) {
        throw new Error('Search pass recording is unavailable in this runtime.')
      }
      await dependencies.missionStore.upsertSearchPass({
        mission_id: state.selectedMissionId,
        search_area_id: input.searchAreaId,
        assignment_id: input.assignmentId,
        started_at: input.startedAt,
        ended_at: input.endedAt,
        outcome: input.outcome,
        notes: input.notes,
        coordinator_name: input.coordinatorName,
        participant_ids: input.participantIds,
        clue_ids: input.clueIds,
        track_evidence_ids: input.trackEvidenceIds,
      })
      await loadMission(state.selectedMissionId, true)
    },
  }

  async function loadMission(
    preferredMissionId: string | null,
    preserveSnapshot: boolean,
    gpxCursor?: string,
    gpxPageNumber: number = 1,
  ): Promise<void> {
    const currentToken = ++refreshToken
    let startedReviewRequestId: string | null = null
    cancelActiveReviewRead()
    if (preferredMissionId !== null && preferredMissionId !== state.selectedMissionId) {
      replayToken += 1
      cancelActiveReplayRead()
    }
    state = {
      ...state,
      loading: !preserveSnapshot || state.snapshot === null,
      refreshing: preserveSnapshot && state.snapshot !== null,
      error: null,
      gpxImports: {
        ...state.gpxImports,
        loading: gpxCursor !== undefined || gpxPageNumber !== state.gpxImports.pageNumber,
      },
    }
    publishRuntime()

    try {
      const missions = await dependencies.missionStore.listMissions()
      if (currentToken !== refreshToken) return
      const selectedMission =
        selectMissionFromList(missions, preferredMissionId ?? state.selectedMissionId) ?? null

      if (selectedMission?.id !== state.selectedMissionId) {
        replayToken += 1
        cancelActiveReplayRead()
        resetReplayObjectPagination()
      }

      if (selectedMission === null) {
        if (currentToken !== refreshToken) return
        state = {
          ...state,
          missions,
          selectedMissionId: null,
          snapshot: null,
          loading: false,
          refreshing: false,
          error: null,
          auditLogTruncated: false,
          gpxImports: { ...EMPTY_RUNTIME.gpxImports },
          replay: { ...EMPTY_RUNTIME.replay },
          searchOperations: { ...EMPTY_RUNTIME.searchOperations },
        }
        publishRuntime()
        return
      }

      // Request one extra event so a full page signals there is more history than shown.
      const auditEventLimit = DEFAULT_AUDIT_EVENT_LIMIT
      const reviewRequestId = `mission-review-${requestNamespace}-${++requestSequence}`
      startedReviewRequestId = reviewRequestId
      activeReviewRequestId = reviewRequestId
      const [
        reviewRead, info, markers, devices, drawings, helicopters, gpxPage, layerMetadata,
        searchAreas, searchAssignments, searchPasses, outings,
      ] =
        await Promise.all([
          dependencies.missionStore.readMissionReview({
            missionId: selectedMission.id,
            includeTelemetry: state.includeTelemetry,
            auditLimit: auditEventLimit + 1,
          }, reviewRequestId),
          dependencies.missionStore.info(),
          dependencies.missionStore.listMarkers(selectedMission.id),
          dependencies.missionStore.listDevices(selectedMission.id),
          dependencies.missionStore.listDrawings(selectedMission.id),
          'listHelicopters' in dependencies.missionStore
            ? dependencies.missionStore.listHelicopters(selectedMission.id)
            : Promise.resolve([]),
          readGpxImportProjectionPage(selectedMission.id, currentToken, gpxCursor),
          dependencies.layerCatalogStore.listMetadata(selectedMission.id),
          dependencies.missionStore.listSearchAreas?.(selectedMission.id) ?? Promise.resolve([]),
          dependencies.missionStore.listSearchAssignments?.(selectedMission.id) ?? Promise.resolve([]),
          dependencies.missionStore.listSearchPasses?.(selectedMission.id) ?? Promise.resolve([]),
          dependencies.missionStore.listOutings?.(selectedMission.id) ?? Promise.resolve([]),
        ])
      if (activeReviewRequestId === reviewRequestId) {
        activeReviewRequestId = null
      }
      if (currentToken !== refreshToken) return

      const auditLogTruncated = reviewRead.auditEvents.length > auditEventLimit
      // Stores return audit events newest-first and capped; the snapshot model expects
      // chronological order, so trim to the page size and reverse to ascending.
      const events = reviewRead.auditEvents.slice(0, auditEventLimit).slice().reverse()

      state = {
        ...state,
        missions,
        selectedMissionId: selectedMission.id,
        snapshot: buildMissionReviewSnapshot({
          mission: selectedMission,
          info,
          events,
          markers,
          devices,
          breadcrumbCount: reviewRead.breadcrumbCount,
          drawings,
          helicopters,
          gpxImports: gpxPage.entries,
          layerMetadata,
        }),
        loading: false,
        refreshing: false,
        error: null,
        auditLogTruncated,
        gpxImports: {
          pageNumber: gpxPageNumber,
          visibleCount: gpxPage.entries.length,
          hasMore: gpxPage.nextCursor !== null,
          loading: false,
          nextCursor: gpxPage.nextCursor,
        },
        replay: selectedMission.id === state.selectedMissionId
          ? state.replay
          : { ...EMPTY_RUNTIME.replay },
        searchOperations: {
          areas: searchAreas,
          assignments: searchAssignments,
          passes: searchPasses,
          outings,
        },
      }
      publishRuntime()
    } catch (error) {
      cancelReviewReadIfActive(startedReviewRequestId)
      if (currentToken !== refreshToken) return
      state = {
        ...state,
        loading: false,
        refreshing: false,
        error: toErrorMessage(error),
        gpxImports: { ...state.gpxImports, loading: false },
      }
      publishRuntime()
    }
  }

  /** Defers the paged GPX projection reader until review data is requested. */
  async function readGpxImportProjectionPage(
    missionId: string,
    requestToken: number,
    cursor?: string,
  ) {
    const { readGpxImportProjectionPage: readPage } = await import('../gpx/read-gpx-import-pages')
    return await readPage(
      dependencies.missionStore,
      missionId,
      cursor,
      () => requestToken === refreshToken,
    )
  }

  function cancelActiveReviewRead(): void {
    cancelReviewReadIfActive(activeReviewRequestId)
  }

  async function seekReplay(selectedTime: string, filters?: {
    readonly deviceIds?: readonly string[]
    readonly outingIds?: readonly string[]
  }): Promise<void> {
    const selectedMissionId = state.selectedMissionId
    if (selectedMissionId === null) return
    if (dependencies.missionStore.readMissionReplay === undefined) {
      state = {
        ...state,
        replay: {
          mode: 'replay', selectedTime, result: null, loading: false,
          loadingMore: false, error: 'Replay is unavailable in this runtime.',
        },
      }
      publishRuntime()
      return
    }
    const normalizedTime = new Date(selectedTime).toISOString()
    const currentToken = ++replayToken
    cancelActiveReplayRead()
    resetReplayObjectPagination()
    const requestId = `mission-replay-${requestNamespace}-${++requestSequence}`
    activeReplayRequestId = requestId
    state = {
      ...state,
      replay: {
        mode: 'replay', selectedTime: normalizedTime, result: null,
        loading: true, loadingMore: false, error: null,
      },
    }
    publishRuntime()
    try {
      const result = await dependencies.missionStore.readMissionReplay({
        missionId: selectedMissionId,
        selectedTime: normalizedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 500,
        objectLimit: 100,
        ...(filters?.deviceIds === undefined ? {} : { deviceIds: filters.deviceIds }),
        ...(filters?.outingIds === undefined ? {} : { outingIds: filters.outingIds }),
      }, requestId)
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = {
        ...state,
        replay: {
          mode: 'replay', selectedTime: normalizedTime, result,
          loading: false, loadingMore: false, error: null,
        },
      }
      publishRuntime()
    } catch (error) {
      if (currentToken !== replayToken) return
      if (activeReplayRequestId === requestId) activeReplayRequestId = null
      state = {
        ...state,
        replay: {
          mode: 'replay', selectedTime: normalizedTime, result: null,
          loading: false, loadingMore: false, error: toErrorMessage(error),
        },
      }
      publishRuntime()
    }
  }

  async function loadNextReplayChunk(): Promise<void> {
    const replay = state.replay
    await loadReplayTrackChunk(replay.result?.nextCursor ?? null)
  }

  async function loadReplayTrackChunk(cursor: string | null): Promise<void> {
    const replay = state.replay
    const missionId = state.selectedMissionId
    if (replay.result === null || cursor === null || missionId === null
      || dependencies.missionStore.readMissionReplayTrackChunk === undefined) return
    cancelActiveReplayRead()
    const currentToken = replayToken
    const requestId = `mission-replay-${requestNamespace}-${++requestSequence}`
    activeReplayRequestId = requestId
    state = { ...state, replay: { ...replay, loadingMore: true, error: null } }
    publishRuntime()
    try {
      const chunk = await dependencies.missionStore.readMissionReplayTrackChunk({
        missionId,
        selectedTime: replay.result.selectedTime,
        timezone: replay.result.timezone,
        trackLimit: 500,
        objectLimit: 100,
        cursor,
        ...(replay.result.deviceFilterIds.length === 0
          ? {}
          : { deviceIds: replay.result.deviceFilterIds }),
        ...(replay.result.outingFilterIds.length === 0
          ? {}
          : { outingIds: replay.result.outingFilterIds }),
      }, requestId)
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = {
        ...state,
        replay: {
          ...state.replay,
          result: {
            ...replay.result,
            tracks: chunk.tracks,
            trackCursor: chunk.trackCursor,
            previousCursor: chunk.previousCursor,
            totalTrackCount: chunk.totalTrackCount,
            nextCursor: chunk.nextCursor,
            progress: chunk.progress,
          },
          loadingMore: false,
        },
      }
      publishRuntime()
    } catch (error) {
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = { ...state, replay: { ...state.replay, loadingMore: false, error: toErrorMessage(error) } }
      publishRuntime()
    }
  }

  async function loadReplayObjectChunk(
    objectCursor: string | null,
    targetPageIndex: number,
  ): Promise<void> {
    const replay = state.replay
    const missionId = state.selectedMissionId
    if (replay.result === null || missionId === null
      || dependencies.missionStore.readMissionReplayObjectChunk === undefined) return
    cancelActiveReplayRead()
    const currentToken = replayToken
    const requestId = `mission-replay-${requestNamespace}-${++requestSequence}`
    activeReplayRequestId = requestId
    state = { ...state, replay: { ...replay, loadingMore: true, error: null } }
    publishRuntime()
    try {
      const chunk = await dependencies.missionStore.readMissionReplayObjectChunk({
        missionId,
        selectedTime: replay.result.selectedTime,
        timezone: replay.result.timezone,
        trackLimit: 500,
        objectLimit: 100,
        replayGeneration: replay.result.replayGeneration ?? 0,
        ...(replay.result.deviceFilterIds.length === 0
          ? {}
          : { deviceIds: replay.result.deviceFilterIds }),
        ...(replay.result.outingFilterIds.length === 0
          ? {}
          : { outingIds: replay.result.outingFilterIds }),
        ...(objectCursor === null ? {} : { objectCursor }),
      }, requestId)
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      replayObjectPageCursors = [
        ...replayObjectPageCursors.slice(0, targetPageIndex),
        objectCursor,
      ]
      replayObjectPageIndex = targetPageIndex
      state = {
        ...state,
        replay: {
          ...state.replay,
          result: {
            ...replay.result,
            objects: chunk.objects,
            totalObjectCount: chunk.totalObjectCount,
            objectCursor: chunk.objectCursor,
            nextObjectCursor: chunk.nextObjectCursor,
            limitations: reconcileObjectPageLimitations(
              replay.result.limitations,
              chunk.summarizedObjectCount,
            ),
          },
          loadingMore: false,
        },
      }
      publishRuntime()
    } catch (error) {
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = { ...state, replay: { ...state.replay, loadingMore: false, error: toErrorMessage(error) } }
      publishRuntime()
    }
  }

  function resetReplayObjectPagination(): void {
    replayObjectPageCursors = [null]
    replayObjectPageIndex = 0
  }

  function cancelActiveReplayRead(): void {
    const requestId = activeReplayRequestId
    if (requestId === null) return
    activeReplayRequestId = null
    void dependencies.missionStore.cancelMissionReplay?.(requestId).catch(() => undefined)
  }

  function cancelReviewReadIfActive(requestId: string | null): void {
    if (requestId === null || activeReviewRequestId !== requestId) return
    activeReviewRequestId = null
    void dependencies.missionStore.cancelMissionReviewRead?.(requestId).catch(
      () => undefined,
    )
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
  }
}

/** Replaces page-local large-object disclosure without disturbing mission-wide limitations. */
function reconcileObjectPageLimitations(
  limitations: MissionReplayReadResult['limitations'],
  summarizedObjectCount: number,
): MissionReplayReadResult['limitations'] {
  const missionWideLimitations = limitations.filter(
    (limitation) => limitation.code !== 'large_object_details_summarized',
  )
  return summarizedObjectCount > 0
    ? [...missionWideLimitations, {
        code: 'large_object_details_summarized',
        message: 'Large evidence states are represented by bounded summaries and retained-state hashes in this page.',
        count: summarizedObjectCount,
      }]
    : missionWideLimitations
}

function selectMissionFromList(
  missions: readonly Mission[],
  missionId: string | null,
): Mission | null {
  if (missions.length === 0) {
    return null
  }

  if (missionId !== null) {
    const selected = missions.find((mission) => mission.id === missionId)
    if (selected !== undefined) {
      return selected
    }
  }

  return (
    missions.find((mission) => mission.status === 'active' || mission.status === 'paused') ??
    missions.find((mission) => mission.status === 'finished' || mission.status === 'finalized') ??
    missions[0] ??
    null
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mission review could not load.'
}

export function createMissionReviewRuntimeState(
  overrides: Partial<MissionReviewRuntimeState> = {},
): MissionReviewRuntimeState {
  return {
    ...EMPTY_RUNTIME,
    ...overrides,
  }
}

export type MissionReviewRuntimeFixtures = {
  readonly info: MissionStoreInfo
  readonly events: readonly MissionEvent[]
}
