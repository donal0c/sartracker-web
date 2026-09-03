import type {
  Mission,
  MissionEvent,
  MissionStore,
  MissionStoreInfo,
  MissionReplayReadResult,
  MissionReplayFilterPage,
  SearchAreaProjection,
  SearchAssignmentProjection,
  SearchOperationPage,
  SearchOperationPageKind,
  SearchPassProjection,
  Outing,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import type { ArchiveReviewPublicSession } from '../../infrastructure/archive-review/archive-review-types'
import type { ArchiveReviewAttachmentPage } from '../../infrastructure/archive-review/electron-archive-review-source'
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
  | 'listSearchOperationPage'
  | 'readMissionReplayFilterPage'
  | 'listOutings'
  | 'upsertSearchAssignment'
  | 'upsertSearchPass'
> & {
  readonly openAttachment?: (input: {
    readonly missionId: string
    readonly attachmentPath: string
    readonly referenceKind: string
    readonly referenceId: string
  }) => Promise<boolean>
  readonly listArchiveAttachmentPage?: (input: {
    readonly missionId: string
    readonly cursor: string | null
    readonly limit: number
  }) => Promise<ArchiveReviewAttachmentPage>
}

export type MissionReviewRuntimeState = {
  readonly source: 'live' | 'archive'
  readonly archiveSession: ArchiveReviewPublicSession | null
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
    readonly areas: readonly SearchAreaProjection[]
    readonly assignments: readonly SearchAssignmentProjection[]
    readonly passes: readonly SearchPassProjection[]
    readonly outings: readonly Outing[]
    readonly pages: Readonly<Record<SearchOperationPageKind, SearchOperationPageState>>
  }
}

/** Creates an empty bounded-page state for renderer initialization. */
function emptyPageState(): SearchOperationPageState {
  return {
    search: '', pageNumber: 1, visibleCount: 0, totalCount: 0,
    hasMore: false, nextCursor: null, loading: false,
  }
}

/** Converts a Search Operations result into explicit renderer continuation state. */
function pageStateFromResult(result: SearchOperationPage): SearchOperationPageState {
  return {
    search: result.search,
    pageNumber: 1,
    visibleCount: result.entries.length,
    totalCount: result.totalCount,
    hasMore: result.nextCursor !== null,
    nextCursor: result.nextCursor,
    loading: false,
  }
}

/** Converts the first Replay outing-choice page into explicit continuation state. */
function replayOutingPageState(result: MissionReplayReadResult): SearchOperationPageState {
  return {
    search: '',
    pageNumber: 1,
    visibleCount: result.availableOutingIds.length,
    totalCount: result.availableOutingTotalCount ?? result.availableOutingIds.length,
    hasMore: (result.availableOutingNextCursor ?? null) !== null,
    nextCursor: result.availableOutingNextCursor ?? null,
    loading: false,
  }
}

/** Converts a later Replay filter page into explicit continuation state. */
function pageStateFromFilterResult(
  result: MissionReplayFilterPage,
  pageNumber: number,
): SearchOperationPageState {
  return {
    search: result.search,
    pageNumber,
    visibleCount: result.entries.length,
    totalCount: result.totalCount,
    hasMore: result.nextCursor !== null,
    nextCursor: result.nextCursor,
    loading: false,
  }
}

/** Replaces exactly one Search Operations projection and its page metadata. */
function replaceSearchOperationPage(
  state: MissionReviewRuntimeState,
  kind: SearchOperationPageKind,
  result: SearchOperationPage,
  pageNumber: number,
): MissionReviewRuntimeState {
  const nextPage = { ...pageStateFromResult(result), pageNumber }
  const entries = result.entries
  const nextOperations = kind === 'areas'
    ? { ...state.searchOperations, areas: entries as readonly SearchAreaProjection[] }
    : kind === 'assignments'
      ? { ...state.searchOperations, assignments: entries as readonly SearchAssignmentProjection[] }
      : kind === 'outings'
        ? { ...state.searchOperations, outings: entries as readonly Outing[] }
        : { ...state.searchOperations, passes: entries as readonly SearchPassProjection[] }
  return {
    ...state,
    searchOperations: {
      ...nextOperations,
      pages: { ...state.searchOperations.pages, [kind]: nextPage },
    },
  }
}

/** Releases page spinners when a newer whole-Review read invalidates their requests. */
function releaseSearchOperationLoading(
  operations: MissionReviewRuntimeState['searchOperations'],
): MissionReviewRuntimeState['searchOperations'] {
  return {
    ...operations,
    pages: {
      areas: { ...operations.pages.areas, loading: false },
      assignments: { ...operations.pages.assignments, loading: false },
      outings: { ...operations.pages.outings, loading: false },
      passes: { ...operations.pages.passes, loading: false },
    },
  }
}

export type SearchOperationPageState = {
  readonly search: string
  readonly pageNumber: number
  readonly visibleCount: number
  readonly totalCount: number
  readonly hasMore: boolean
  readonly nextCursor: string | null
  readonly loading: boolean
}

export type MissionReplayRuntimeState = {
  readonly mode: 'live' | 'replay'
  readonly selectedTime: string | null
  readonly result: MissionReplayReadResult | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: string | null
  readonly outingFilters: SearchOperationPageState
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
  readonly searchSearchOperations: (
    kind: SearchOperationPageKind,
    search: string,
  ) => Promise<void>
  readonly loadNextSearchOperations: (kind: SearchOperationPageKind) => Promise<void>
  readonly returnToFirstSearchOperations: (kind: SearchOperationPageKind) => Promise<void>
  readonly searchReplayOutingFilters: (search: string) => Promise<void>
  readonly loadNextReplayOutingFilters: () => Promise<void>
  readonly returnToFirstReplayOutingFilters: () => Promise<void>
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
  readonly openAttachment: (input: {
    readonly attachmentPath: string
    readonly referenceKind: string
    readonly referenceId: string
  }) => Promise<boolean>
  readonly listArchiveAttachmentPage: (input: {
    readonly cursor: string | null
    readonly limit: number
  }) => Promise<ArchiveReviewAttachmentPage>
}

export type StartMissionReviewRuntimeDependencies = {
  readonly source?: 'live' | 'archive'
  readonly archiveSession?: ArchiveReviewPublicSession | null
  readonly missionStore: MissionReviewStoreBoundary
  readonly layerCatalogStore: Pick<LayerCatalogStore, 'listMetadata'>
  readonly openLiveAttachment?: (attachmentPath: string) => Promise<void | boolean>
  readonly applyRuntime: (runtime: MissionReviewRuntimeState) => void
}

const EMPTY_RUNTIME: MissionReviewRuntimeState = {
  source: 'live',
  archiveSession: null,
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
    outingFilters: emptyPageState(),
  },
  searchOperations: {
    areas: [], assignments: [], passes: [], outings: [],
    pages: {
      areas: emptyPageState(), assignments: emptyPageState(),
      outings: emptyPageState(), passes: emptyPageState(),
    },
  },
}

export async function startMissionReviewRuntime(
  dependencies: StartMissionReviewRuntimeDependencies,
): Promise<MissionReviewController> {
  const source = dependencies.source ?? 'live'
  const archiveSession = dependencies.archiveSession ?? null
  if ((source === 'archive' && archiveSession === null)
    || (source === 'live' && archiveSession !== null)) {
    throw new Error('Mission Review source metadata is invalid.')
  }
  let state: MissionReviewRuntimeState = { ...EMPTY_RUNTIME, source, archiveSession }
  let refreshToken = 0
  let requestSequence = 0
  const requestNamespace = globalThis.crypto.randomUUID()
  let activeReviewRequestId: string | null = null
  let replayToken = 0
  let activeReplayRequestId: string | null = null
  let replayObjectPageCursors: readonly (string | null)[] = [null]
  let replayObjectPageIndex = 0
  const searchOperationTokens: Record<SearchOperationPageKind, number> = {
    areas: 0, assignments: 0, outings: 0, passes: 0,
  }
  const searchOperationGenerations: Record<SearchOperationPageKind, number> = {
    areas: 0, assignments: 0, outings: 0, passes: 0,
  }

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
    searchSearchOperations: async (kind, search) => {
      await loadSearchOperationPage(kind, search, undefined, 1)
    },
    loadNextSearchOperations: async (kind) => {
      const page = state.searchOperations.pages[kind]
      if (page.nextCursor === null || page.loading) return
      await loadSearchOperationPage(kind, page.search, page.nextCursor, page.pageNumber + 1)
    },
    returnToFirstSearchOperations: async (kind) => {
      const page = state.searchOperations.pages[kind]
      if (page.pageNumber === 1 || page.loading) return
      await loadSearchOperationPage(kind, page.search, undefined, 1)
    },
    searchReplayOutingFilters: async (search) => {
      await loadReplayOutingFilterPage(search, undefined, 1)
    },
    loadNextReplayOutingFilters: async () => {
      const page = state.replay.outingFilters
      if (page.nextCursor === null || page.loading) return
      await loadReplayOutingFilterPage(page.search, page.nextCursor, page.pageNumber + 1)
    },
    returnToFirstReplayOutingFilters: async () => {
      const page = state.replay.outingFilters
      if (page.pageNumber === 1 || page.loading) return
      await loadReplayOutingFilterPage(page.search, undefined, 1)
    },
    recordSearchAssignment: async (input) => {
      if (state.source === 'archive') {
        throw new Error('Archived mission review is read-only.')
      }
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
      if (state.source === 'archive') {
        throw new Error('Archived mission review is read-only.')
      }
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
    openAttachment: async (input) => {
      if (state.source === 'archive') {
        if (state.archiveSession === null || dependencies.missionStore.openAttachment === undefined) {
          throw new Error('Archived attachment review is unavailable.')
        }
        return await dependencies.missionStore.openAttachment({
          missionId: state.archiveSession.missionId,
          attachmentPath: input.attachmentPath,
          referenceKind: input.referenceKind,
          referenceId: input.referenceId,
        })
      }
      if (dependencies.openLiveAttachment === undefined) {
        throw new Error('Mission attachment opening is unavailable in this runtime.')
      }
      await dependencies.openLiveAttachment(input.attachmentPath)
      return true
    },
    listArchiveAttachmentPage: async (input) => {
      if (state.source !== 'archive' || state.archiveSession === null
        || dependencies.missionStore.listArchiveAttachmentPage === undefined) {
        throw new Error('Archived attachment history is unavailable.')
      }
      return await dependencies.missionStore.listArchiveAttachmentPage({
        missionId: state.archiveSession.missionId,
        cursor: input.cursor,
        limit: input.limit,
      })
    },
  }

  async function loadMission(
    preferredMissionId: string | null,
    preserveSnapshot: boolean,
    gpxCursor?: string,
    gpxPageNumber: number = 1,
  ): Promise<void> {
    const currentToken = ++refreshToken
    invalidateSearchOperationReads()
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
      searchOperations: releaseSearchOperationLoading(state.searchOperations),
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

      const liveSourceUnavailable = source === 'live'
        ? liveReviewUnavailableMessage(selectedMission)
        : null
      if (liveSourceUnavailable !== null) {
        replayToken += 1
        cancelActiveReplayRead()
        resetReplayObjectPagination()
        state = {
          ...state,
          missions,
          selectedMissionId: selectedMission.id,
          snapshot: null,
          loading: false,
          refreshing: false,
          error: liveSourceUnavailable,
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
        searchAreasPage, searchAssignmentsPage, searchPassesPage, searchOutingsPage,
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
          readInitialSearchOperationPage(selectedMission.id, 'areas'),
          readInitialSearchOperationPage(selectedMission.id, 'assignments'),
          readInitialSearchOperationPage(selectedMission.id, 'passes'),
          readInitialSearchOperationPage(selectedMission.id, 'outings'),
        ])
      if (activeReviewRequestId === reviewRequestId) {
        activeReviewRequestId = null
      }
      if (currentToken !== refreshToken) return

      const searchOperationGeneration = searchAreasPage.generation
      if ([searchAssignmentsPage, searchPassesPage, searchOutingsPage]
        .some((page) => page.generation !== searchOperationGeneration)) {
        throw new Error('Search Operations changed while Review refreshed; refresh again.')
      }

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
          areas: searchAreasPage.entries as readonly SearchAreaProjection[],
          assignments: searchAssignmentsPage.entries as readonly SearchAssignmentProjection[],
          passes: searchPassesPage.entries as readonly SearchPassProjection[],
          outings: searchOutingsPage.entries as readonly Outing[],
          pages: {
            areas: pageStateFromResult(searchAreasPage),
            assignments: pageStateFromResult(searchAssignmentsPage),
            passes: pageStateFromResult(searchPassesPage),
            outings: pageStateFromResult(searchOutingsPage),
          },
        },
      }
      searchOperationGenerations.areas = searchAreasPage.generation
      searchOperationGenerations.assignments = searchAssignmentsPage.generation
      searchOperationGenerations.passes = searchPassesPage.generation
      searchOperationGenerations.outings = searchOutingsPage.generation
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

  /** Reads the first bounded page for one Search Operations projection. */
  async function readInitialSearchOperationPage(
    missionId: string,
    kind: SearchOperationPageKind,
  ): Promise<SearchOperationPage> {
    if (dependencies.missionStore.listSearchOperationPage === undefined) {
      return { kind, search: '', generation: 0, entries: [], totalCount: 0, nextCursor: null }
    }
    return await dependencies.missionStore.listSearchOperationPage({
      missionId, kind, limit: 25,
    })
  }

  /** Replaces one renderer Search Operations page without accumulating prior pages. */
  async function loadSearchOperationPage(
    kind: SearchOperationPageKind,
    search: string,
    cursor: string | undefined,
    pageNumber: number,
  ): Promise<void> {
    const missionId = state.selectedMissionId
    const readPage = dependencies.missionStore.listSearchOperationPage
    if (missionId === null || readPage === undefined || state.loading || state.refreshing) return
    const reviewToken = refreshToken
    const token = ++searchOperationTokens[kind]
    const expectedGeneration = searchOperationGenerations[kind]
    state = {
      ...state,
      searchOperations: {
        ...state.searchOperations,
        pages: {
          ...state.searchOperations.pages,
          [kind]: { ...state.searchOperations.pages[kind], loading: true },
        },
      },
    }
    publishRuntime()
    try {
      const result = await readPage({
        missionId, kind, search, limit: 25, ...(cursor === undefined ? {} : { cursor }),
      })
      if (token !== searchOperationTokens[kind] || reviewToken !== refreshToken
        || missionId !== state.selectedMissionId || state.loading || state.refreshing) return
      if (cursor !== undefined && result.generation !== expectedGeneration) {
        throw new Error('Search Operations page changed; return to the first page.')
      }
      state = replaceSearchOperationPage(state, kind, result, pageNumber)
      searchOperationGenerations[kind] = result.generation
      publishRuntime()
    } catch (error) {
      if (token !== searchOperationTokens[kind] || reviewToken !== refreshToken
        || missionId !== state.selectedMissionId || state.loading || state.refreshing) return
      state = {
        ...state,
        error: toErrorMessage(error),
        searchOperations: {
          ...state.searchOperations,
          pages: {
            ...state.searchOperations.pages,
            [kind]: { ...state.searchOperations.pages[kind], loading: false },
          },
        },
      }
      publishRuntime()
    }
  }

  /** Prevents any page read started before a mission refresh from publishing afterward. */
  function invalidateSearchOperationReads(): void {
    searchOperationTokens.areas += 1
    searchOperationTokens.assignments += 1
    searchOperationTokens.outings += 1
    searchOperationTokens.passes += 1
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
          outingFilters: emptyPageState(),
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
        outingFilters: emptyPageState(),
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
          outingFilters: replayOutingPageState(result),
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
          outingFilters: emptyPageState(),
        },
      }
      publishRuntime()
    }
  }

  async function loadNextReplayChunk(): Promise<void> {
    const replay = state.replay
    await loadReplayTrackChunk(replay.result?.nextCursor ?? null)
  }

  /** Replaces the visible Replay outing-choice page while retaining selected IDs. */
  async function loadReplayOutingFilterPage(
    search: string,
    cursor: string | undefined,
    pageNumber: number,
  ): Promise<void> {
    const replay = state.replay
    const missionId = state.selectedMissionId
    const readPage = dependencies.missionStore.readMissionReplayFilterPage
    if (replay.result === null || missionId === null || readPage === undefined) return
    cancelActiveReplayRead()
    const currentToken = replayToken
    const requestId = `mission-replay-${requestNamespace}-${++requestSequence}`
    activeReplayRequestId = requestId
    state = {
      ...state,
      replay: {
        ...replay,
        outingFilters: { ...replay.outingFilters, loading: true },
        error: null,
      },
    }
    publishRuntime()
    try {
      const page = await readPage({
        missionId,
        selectedTime: replay.result.selectedTime,
        timezone: replay.result.timezone,
        trackLimit: 500,
        objectLimit: 100,
        filterKind: 'outing',
        filterSearch: search,
        filterLimit: 100,
        ...(cursor === undefined ? {} : { filterCursor: cursor }),
      }, requestId)
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = {
        ...state,
        replay: {
          ...state.replay,
          result: {
            ...replay.result,
            availableOutingIds: page.entries,
            availableOutingTotalCount: page.totalCount,
            availableOutingNextCursor: page.nextCursor,
          },
          outingFilters: pageStateFromFilterResult(page, pageNumber),
        },
      }
      publishRuntime()
    } catch (error) {
      if (currentToken !== replayToken || activeReplayRequestId !== requestId) return
      activeReplayRequestId = null
      state = {
        ...state,
        replay: {
          ...state.replay,
          outingFilters: { ...state.replay.outingFilters, loading: false },
          error: toErrorMessage(error),
        },
      }
      publishRuntime()
    }
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

/** Explains why one mission must not fan out through the ordinary live-store Review facade. */
function liveReviewUnavailableMessage(mission: Mission): string | null {
  if (mission.storage_state === undefined || mission.storage_state === 'live') return null
  if (mission.storage_state === 'recovery_required') {
    return 'Archive custody recovery is still running or needs operator review. Ordinary live Review is unavailable until it settles.'
  }
  if (mission.storage_state === 'archived') {
    return 'This mission is stored in its verified archive. Open it from Saved Mission Archives for read-only Review.'
  }
  return 'This mission has cleanup in progress. Resume its durable archive cleanup before opening ordinary live Review.'
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
