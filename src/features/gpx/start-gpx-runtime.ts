import type {
  GpxImportIssue,
  GpxMapProjectionPage,
  GpxTrackImport,
  Outing,
  UpsertGpxTrackImportInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { writeGpxImportColorMetadata } from './gpx-style'
import { digestGpxSource, parseGpxFile } from './gpx-parser'
import { describeGpxMapCoverage, describeListPageMapCoverage, readGpxMapProjection } from './read-gpx-map-projection'

type GpxStoreBoundary = {
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly listGpxImportPage?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<{
    readonly entries: readonly GpxTrackImport[]
    readonly nextCursor: string | null
  }>
  readonly listGpxMapProjectionPage?: (input: {
    readonly missionId: string
    readonly cursor?: string
  }) => Promise<GpxMapProjectionPage>
  readonly upsertGpxImport: (input: UpsertGpxTrackImportInput) => Promise<GpxTrackImport>
  readonly updateGpxImportPresentation?: (input: {
    readonly id: string
    readonly mission_id: string
    readonly display_name?: string
    readonly metadata_json?: string | null
  }) => Promise<GpxTrackImport>
  readonly listGpxImportIssues?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<{
    readonly entries: readonly GpxImportIssue[]
    readonly nextCursor: string | null
  }>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly listOutings?: (missionId: string) => Promise<readonly Outing[]>
  readonly assignGpxImportToOuting?: (input: { readonly import_id: string; readonly outing_id: string; readonly assigned_by?: string | null }) => Promise<GpxTrackImport>
  readonly importGpxEvidencePaths?: (input: {
    readonly missionId: string
    readonly paths: readonly string[]
    readonly skipRetiredSources?: boolean
  }) => Promise<{
    readonly imports: readonly { readonly id: string; readonly revision_sequence?: number }[]
    /** Watched paths whose bytes match their live import; nothing was written for them [DON-350]. */
    readonly unchanged?: readonly string[]
    readonly failures?: readonly { readonly sourcePath: string; readonly reason: string }[]
    readonly dispatchDurationMs: number
  }>
}

/** A watched folder's GPX paths, bounded; omittedCount says how many were left out [DON-350] [M-40]. */
export type WatchedGpxDirectoryListing = {
  readonly paths: readonly string[]
  readonly omittedCount: number
}

type GpxWatchSourceBoundary = {
  readonly listDirectoryFiles: (directoryPath: string) => Promise<readonly GpxImportFileInput[]>
  readonly listDirectoryPaths?: (directoryPath: string) => Promise<readonly string[]>
  /** Lists a watched folder without the 100-file Import Folder cap [DON-350] [M-40]. */
  readonly listWatchedDirectoryPaths?: (directoryPath: string) => Promise<WatchedGpxDirectoryListing>
}

/**
 * Watched folders saved per mission on this computer, so a watch survives a restart [DON-337].
 * Absent in the browser harness, where watches stay in memory as before.
 */
/** Saved watched folders for one mission, as the store returns them [DON-337]. */
export type GpxSavedWatches = {
  readonly paths: readonly string[]
  readonly warning: string | null
}

export type GpxWatchedFolderStoreBoundary = {
  /** The mission's saved folders; `warning` says when they came from the backup copy. */
  readonly loadWatchedFolders: (missionId: string) => Promise<GpxSavedWatches>
  /** `backupWarning` says when the list saved but its backup copy did not. */
  readonly saveWatchedFolders: (missionId: string, paths: readonly string[]) => Promise<GpxWatchSaveResult>
}

export type GpxWatchSaveResult = {
  readonly backupWarning: string | null
}

/** The store accepts at most this many paths per native import call. */
const NATIVE_IMPORT_CHUNK = 100
/** Matches MAX_WATCHED_GPX_LISTING_PATHS in electron/file-system.cjs. */
const WATCHED_LISTING_LIMIT = 1_000

export type GpxImportFileInput = {
  readonly sourcePath: string
  readonly fileName: string
  readonly contents: string
  readonly bytesBase64?: string
}

/** Store records carry imported_at, which tells a newly created track from an existing one [DON-319]. */
export type GpxImportResult = Pick<GpxTrackImport, 'id'> & { readonly imported_at?: string }

type PathImportSource = { readonly skipRetiredSources: boolean }

/** An operator's explicit import: a retired file is refused in plain words. */
const DELIBERATE_IMPORT: PathImportSource = { skipRetiredSources: false }
/** A watched-folder scan meets retired files every pass; they are skipped, not failures. */
const WATCHED_FOLDER_SCAN: PathImportSource = { skipRetiredSources: true }

export type GpxImportOperationOutcome = 'imported' | 'empty' | 'refused' | 'stale' | 'failed'

export type GpxImportOperationFailure = {
  readonly fileName: string
  readonly reason: string
}

export type GpxImportOperationResult = {
  readonly outcome: GpxImportOperationOutcome
  readonly imports: readonly GpxImportResult[]
  readonly failures?: readonly GpxImportOperationFailure[]
}

/** A resumed-watch line, or a problem that leaves folders unwatched after a restart [DON-337]. */
export type GpxWatchNotice = {
  readonly tone: 'resumed' | 'problem'
  readonly message: string
}

export type GpxRuntimeState = {
  readonly activeMissionId: string | null
  readonly imports: readonly GpxTrackImport[]
  readonly outings: readonly Outing[]
  readonly watchedDirectories: readonly string[]
  /** Plain words about saved watches resumed after a restart; null when none were resumed [DON-337]. */
  readonly watchNotice: GpxWatchNotice | null
  /** Saved watches were restored and have not been scanned yet; the bridge scans them once [DON-337]. */
  readonly watchResumePending: boolean
  readonly importIssues: readonly GpxImportIssue[]
  /** Every active import the map draws, thinned by the store to one mission-wide budget [DON-350] [M-87]. */
  readonly mapImports: readonly GpxTrackImport[]
  /** Active imports in the mission, drawn or not. */
  readonly mapImportTotal: number
  /** Operator words when the map does not show every imported track, or could not be refreshed. */
  readonly mapCoverageNotice: string | null
  /** One bounded projection window; additional imports are never silently implied absent. */
  readonly importPageNumber: number
  readonly hasMoreImports: boolean
  readonly loadingMoreImports: boolean
  readonly hasMoreImportIssues: boolean
  readonly loading: boolean
  readonly importing: boolean
  readonly error: string | null
}

type StartGpxRuntimeDependencies = {
  readonly gpxStore: GpxStoreBoundary
  readonly watchSource?: GpxWatchSourceBoundary
  readonly watchedFolderStore?: GpxWatchedFolderStoreBoundary
  readonly applyRuntime: (runtime: GpxRuntimeState) => void
}

export type GpxRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly loadNextImports: () => Promise<void>
  readonly returnToFirstImports: () => Promise<void>
  readonly importFiles: (files: readonly GpxImportFileInput[]) => Promise<GpxImportOperationResult>
  readonly importPaths: (paths: readonly string[]) => Promise<GpxImportOperationResult>
  readonly updateImportColor: (importId: string, color: string) => Promise<GpxTrackImport | null>
  readonly addWatchedDirectory: (directoryPath: string) => Promise<GpxImportOperationResult>
  readonly removeWatchedDirectory: (directoryPath: string) => void
  readonly rescanWatchedDirectories: () => Promise<GpxImportOperationResult>
  /** Scans watches restored after a restart once, so new files import straight away [DON-337]. */
  readonly resumeWatchedDirectories: () => Promise<GpxImportOperationResult>
  readonly deleteImport: (importId: string) => Promise<boolean>
  readonly assignImportToOuting: (importId: string, outingId: string, assignedBy?: string | null) => Promise<GpxTrackImport | null>
}

const GPX_RENDERER_PAGE_LIMIT = 25

const EMPTY_RUNTIME: GpxRuntimeState = {
  activeMissionId: null,
  imports: [],
  outings: [],
  watchedDirectories: [],
  watchNotice: null,
  watchResumePending: false,
  importIssues: [],
  mapImports: [],
  mapImportTotal: 0,
  mapCoverageNotice: null,
  importPageNumber: 1,
  hasMoreImports: false,
  loadingMoreImports: false,
  hasMoreImportIssues: false,
  loading: false,
  importing: false,
  error: null,
}

export async function startGpxRuntime(
  dependencies: StartGpxRuntimeDependencies,
): Promise<GpxRuntimeController> {
  let state: GpxRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0
  let missionGeneration = 0
  // Saves wait for the mission's saved watches to be restored, and run one at
  // a time, each writing that mission's list as it stands then, even after the
  // operator moved to another mission. The mission guard only keeps a stale
  // result off the screen [DON-337].
  let watchRestoration: Promise<void> = Promise.resolve()
  let watchSaves: Promise<void> = Promise.resolve()
  const watchListByMission = new Map<string, readonly string[]>()
  /** Each mission's latest queued save; reopening that mission waits for it. */
  const latestSaveByMission = new Map<string, Promise<void>>()
  /** Missions whose latest save failed, with the warning to show for them. */
  const watchSaveFailures = new Map<string, string>()
  let importPublication = 0
  let importErrorRevision = 0
  let nextImportCursor: string | null = null
  let mapRefreshToken = 0
  /**
   * Colours and outings saved while a map read may already hold older ones. Each read merges the
   * entries newer than its start, so a save never restarts the read and never loses to it [DON-350].
   */
  let presentationSequence = 0
  const savedPresentations = new Map<string, SavedPresentation>()

  publishRuntime()

  const controller: GpxRuntimeController = {
    refreshMission: async (missionId: string | null) => {
      const token = ++refreshToken
      const publication = importPublication
      const errorRevision = importErrorRevision
      const previousMissionId = state.activeMissionId
      if (missionId !== previousMissionId) {
        missionGeneration += 1
        savedPresentations.clear()
      }
      state = {
        ...state,
        activeMissionId: missionId,
        imports: missionId === previousMissionId ? state.imports : [],
        outings: missionId === previousMissionId ? state.outings : [],
        watchedDirectories: missionId === previousMissionId ? state.watchedDirectories : [],
        watchNotice: missionId === previousMissionId ? state.watchNotice : null,
        watchResumePending: missionId === previousMissionId ? state.watchResumePending : false,
        importIssues: missionId === previousMissionId ? state.importIssues : [],
        mapImports: missionId === previousMissionId ? state.mapImports : [],
        mapImportTotal: missionId === previousMissionId ? state.mapImportTotal : 0,
        mapCoverageNotice: missionId === previousMissionId ? state.mapCoverageNotice : null,
        importPageNumber: missionId === previousMissionId ? state.importPageNumber : 1,
        hasMoreImports: missionId === previousMissionId ? state.hasMoreImports : false,
        loadingMoreImports: false,
        hasMoreImportIssues: missionId === previousMissionId ? state.hasMoreImportIssues : false,
        loading: missionId !== null,
        importing: missionId === previousMissionId ? state.importing : false,
        error: null,
      }
      publishRuntime()

      if (missionId === null) {
        nextImportCursor = null
        mapRefreshToken += 1
        state = {
          ...state,
          imports: [],
          outings: [],
          watchedDirectories: [],
          watchNotice: null,
          watchResumePending: false,
          importIssues: [],
          mapImports: [],
          mapImportTotal: 0,
          mapCoverageNotice: null,
          importPageNumber: 1,
          hasMoreImports: false,
          loadingMoreImports: false,
          hasMoreImportIssues: false,
          loading: false,
        }
        publishRuntime()
        return
      }

      const savedWatches = missionId !== previousMissionId
        ? restoreSavedWatches(missionId, missionGeneration, latestSaveByMission.get(missionId) ?? Promise.resolve())
        : Promise.resolve()
      if (missionId !== previousMissionId) watchRestoration = savedWatches
      try {
        const [importPage, outings, issuePage] = await Promise.all([
          readGpxImportProjectionPage(
            missionId,
            undefined,
            () => token === refreshToken && state.activeMissionId === missionId,
          ),
          dependencies.gpxStore.listOutings?.(missionId) ?? Promise.resolve([]),
          dependencies.gpxStore.listGpxImportIssues?.({ missionId, limit: 100 })
            ?? Promise.resolve({ entries: [], nextCursor: null }),
        ])
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }
        if (publication === importPublication) nextImportCursor = importPage.nextCursor

        state = {
          ...state,
          activeMissionId: missionId,
          imports: publication === importPublication ? importPage.entries : state.imports,
          importPageNumber: publication === importPublication ? 1 : state.importPageNumber,
          hasMoreImports: publication === importPublication ? importPage.nextCursor !== null : state.hasMoreImports,
          loadingMoreImports: false,
          outings,
          importIssues: publication === importPublication ? issuePage.entries : state.importIssues,
          hasMoreImportIssues: publication === importPublication ? issuePage.nextCursor !== null : state.hasMoreImportIssues,
          loading: false,
          error: publication === importPublication && errorRevision === importErrorRevision
            ? describeImportIssues(issuePage.entries.length, issuePage.nextCursor)
            : state.error,
        }
        publishRuntime()
        await refreshMap(missionId, () => token === refreshToken && state.activeMissionId === missionId)
        await savedWatches
      } catch (error) {
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        if (publication === importPublication) nextImportCursor = null
        state = {
          ...state,
          imports: publication === importPublication ? [] : state.imports,
          importPageNumber: publication === importPublication ? 1 : state.importPageNumber,
          hasMoreImports: publication === importPublication ? false : state.hasMoreImports,
          loadingMoreImports: false,
          outings: [],
          importIssues: publication === importPublication ? [] : state.importIssues,
          hasMoreImportIssues: publication === importPublication ? false : state.hasMoreImportIssues,
          loading: false,
          error: appendErrorMessage(state.error, toErrorMessage(error)),
        }
        publishRuntime()
        await refreshMap(missionId, () => token === refreshToken && state.activeMissionId === missionId)
        await savedWatches
      }
    },
    loadNextImports: async () => {
      if (state.activeMissionId === null || nextImportCursor === null || state.loadingMoreImports) return
      await loadImportPage(nextImportCursor, state.importPageNumber + 1)
    },
    returnToFirstImports: async () => {
      if (state.activeMissionId === null || state.importPageNumber === 1 || state.loadingMoreImports) return
      await loadImportPage(undefined, 1)
    },
    importFiles: async (files: readonly GpxImportFileInput[]) => {
      return await importFilesIntoRuntime(files)
    },
    importPaths: async (paths) => await importPathsIntoRuntime(paths),
    updateImportColor: async (importId: string, color: string) => {
      const existingImport = state.imports.find((entry) => entry.id === importId)
      if (existingImport === undefined) {
        return null
      }

      const missionId = existingImport.mission_id
      const missionToken = missionGeneration
      const metadataJson = writeGpxImportColorMetadata(existingImport.metadata_json, color)
      const updatedImport = dependencies.gpxStore.updateGpxImportPresentation === undefined
        ? await dependencies.gpxStore.upsertGpxImport({
            id: existingImport.id,
            mission_id: existingImport.mission_id,
            source_path: existingImport.source_path,
            file_name: existingImport.file_name,
            display_name: existingImport.display_name,
            geometry_json: existingImport.geometry_json,
            metadata_json: metadataJson,
          })
        : await dependencies.gpxStore.updateGpxImportPresentation({
            id: existingImport.id,
            mission_id: existingImport.mission_id,
            metadata_json: metadataJson,
          })

      state = {
        ...state,
        imports: state.imports.map((entry) =>
          entry.id === updatedImport.id ? updatedImport : entry,
        ),
        // The map keeps its thinned geometry; only the presentation changes.
        mapImports: state.mapImports.map((entry) =>
          entry.id === updatedImport.id ? { ...entry, metadata_json: updatedImport.metadata_json } : entry,
        ),
        error: null,
      }
      publishRuntime()
      recordSavedPresentation(missionId, missionToken, updatedImport.id, { metadata_json: updatedImport.metadata_json })
      return updatedImport
    },
    addWatchedDirectory: async (directoryPath: string) => {
      const normalizedPath = directoryPath.trim()
      if (
        normalizedPath === '' ||
        dependencies.watchSource === undefined
      ) {
        return operationResult('empty')
      }

      const missionId = state.activeMissionId
      const missionToken = missionGeneration
      if (!state.watchedDirectories.includes(normalizedPath)) {
        state = {
          ...state,
          watchedDirectories: [...state.watchedDirectories, normalizedPath],
        }
        publishRuntime()
        if (missionId !== null) {
          watchListByMission.set(missionId, state.watchedDirectories)
          await saveWatches(missionId, missionToken, 'added')
        }
      } else if (missionId !== null && watchSaveFailures.has(missionId)) {
        // Choosing a watched folder again retries the save the warning asked for.
        await saveWatches(missionId, missionToken, 'added')
      }

      if (canListWatchedPaths()) {
        let listing: WatchedGpxDirectoryListing
        try {
          listing = await listWatchedPaths(normalizedPath)
        } catch (error) {
          if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
            return operationResult('stale')
          }
          const failure = { fileName: normalizedPath, reason: toErrorMessage(error) }
          state = { ...state, error: appendErrorMessage(state.error, describeWatchedFolderFailure(failure)) }
          publishRuntime()
          return operationResult('failed', [], [failure])
        }
        if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
          return operationResult('stale')
        }
        try {
          return await importPathsIntoRuntime(listing.paths, missionId, missionToken, WATCHED_FOLDER_SCAN)
        } finally {
          // Files beyond the listing cap were never sent, whatever happened to the ones that were [coordinator 1].
          publishScanNotices([describeOmittedWatchedFiles(normalizedPath, listing.omittedCount)], missionId, missionToken)
        }
      }
      const files = await dependencies.watchSource.listDirectoryFiles(normalizedPath)
      if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
        return operationResult('stale')
      }
      return await importFilesIntoRuntime(files, missionId, missionToken)
    },
    removeWatchedDirectory: (directoryPath: string) => {
      const normalizedPath = directoryPath.trim()
      if (normalizedPath === '') {
        return
      }

      state = {
        ...state,
        watchedDirectories: state.watchedDirectories.filter((path) => path !== normalizedPath),
      }
      publishRuntime()
      const missionId = state.activeMissionId
      if (missionId !== null) {
        watchListByMission.set(missionId, state.watchedDirectories)
        void saveWatches(missionId, missionGeneration, 'removed')
      }
    },
    resumeWatchedDirectories: async () => {
      if (!state.watchResumePending) return operationResult('empty')
      state = { ...state, watchResumePending: false }
      publishRuntime()
      return await controller.rescanWatchedDirectories()
    },
    rescanWatchedDirectories: async () => {
      if (state.importing) {
        return operationResult('refused')
      }
      if (dependencies.watchSource === undefined || state.watchedDirectories.length === 0) {
        return operationResult('empty')
      }

      const missionId = state.activeMissionId
      const missionToken = missionGeneration
      if (missionId === null) return operationResult('stale')
      const imported: GpxImportResult[] = []
      const failures: GpxImportOperationFailure[] = []
      // A folder that cannot be opened is named as a folder, not counted as a GPX file [DON-337].
      const folderFailures: string[] = []
      const folderFailureNotices: string[] = []
      let hadFailure = false
      // Published after every folder, so a later folder's import cannot clear an earlier warning.
      const omissions: (string | null)[] = []
      // One folder that cannot be listed or imported must not stop the others [DON-350] [M-40].
      for (const directoryPath of state.watchedDirectories) {
        try {
          let result: GpxImportOperationResult
          if (canListWatchedPaths()) {
            const listing = await listWatchedPaths(directoryPath)
            if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale', imported, failures)
            // Recorded before the import, so a failed import cannot drop the over-limit warning.
            omissions.push(describeOmittedWatchedFiles(directoryPath, listing.omittedCount))
            result = await importPathsIntoRuntime(listing.paths, missionId, missionToken, WATCHED_FOLDER_SCAN)
          } else {
            const files = await dependencies.watchSource.listDirectoryFiles(directoryPath)
            if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale', imported, failures)
            result = await importFilesIntoRuntime(files, missionId, missionToken)
          }
          imported.push(...result.imports)
          if (result.failures !== undefined) failures.push(...result.failures)
          hadFailure ||= result.outcome === 'failed'
          if (result.outcome === 'refused' || result.outcome === 'stale') {
            return operationResult(result.outcome, imported, failures)
          }
        } catch (error) {
          if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
            return operationResult('stale', imported, failures)
          }
          // Returned with the file failures; described as a folder, not as a GPX file [DON-337].
          failures.push({ fileName: directoryPath, reason: toErrorMessage(error) })
          folderFailures.push(directoryPath)
          folderFailureNotices.push(describeUnopenableWatchedFolder(directoryPath, error))
          hadFailure = true
        }
      }

      publishScanNotices(
        [
          fileFailuresOf(failures, folderFailures).length > 0
            ? describeOperationFailures(fileFailuresOf(failures, folderFailures))
            : null,
          ...folderFailureNotices,
          ...omissions,
        ],
        missionId,
        missionToken,
      )
      return operationResult(
        imported.length > 0 ? 'imported' : hadFailure ? 'failed' : 'empty',
        imported,
        failures,
      )
    },
    deleteImport: async (importId: string) => {
      const missionId = state.activeMissionId
      const missionToken = missionGeneration
      const ownedImport = state.imports.find((entry) => entry.id === importId)
      if (missionId === null || ownedImport?.mission_id !== missionId) return false
      const didDelete = await dependencies.gpxStore.deleteGpxImport(importId)
      if (!didDelete) {
        return false
      }

      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return true

      importPublication += 1
      state = {
        ...state,
        imports: state.imports.filter((entry) => entry.id !== importId),
        mapImports: state.mapImports.filter((entry) => entry.id !== importId),
        loadingMoreImports: false,
      }
      publishRuntime()
      await refreshMap(missionId, () => missionToken === missionGeneration && state.activeMissionId === missionId)
      return true
    },
    assignImportToOuting: async (importId, outingId, assignedBy) => {
      const missionId = state.activeMissionId
      const token = refreshToken
      const missionToken = missionGeneration
      const existing = state.imports.find((entry) => entry.id === importId)
      if (missionId === null || existing?.mission_id !== missionId
        || dependencies.gpxStore.assignGpxImportToOuting === undefined) return null
      const updated = await dependencies.gpxStore.assignGpxImportToOuting({
        import_id: importId,
        outing_id: outingId,
        ...(assignedBy === undefined ? {} : { assigned_by: assignedBy }),
      })
      recordSavedPresentation(missionId, missionToken, updated.id, updated.outing_id === undefined ? {} : { outing_id: updated.outing_id })
      if (token !== refreshToken || state.activeMissionId !== missionId) return updated
      state = {
        ...state,
        imports: state.imports.map((entry) => entry.id === updated.id ? updated : entry),
        mapImports: state.mapImports.map((entry) =>
          entry.id === updated.id
            ? { ...entry, ...(updated.outing_id === undefined ? {} : { outing_id: updated.outing_id }) }
            : entry),
        error: null,
      }
      publishRuntime()
      return updated
    },
  }
  return controller

  /**
   * Restores the watches saved for a mission when it opens. Never throws: a
   * failure becomes a warning that no folders are being watched [DON-337].
   */
  async function restoreSavedWatches(missionId: string, missionToken: number, earlierSaves: Promise<void>): Promise<void> {
    const store = dependencies.watchedFolderStore
    if (store === undefined || dependencies.watchSource === undefined) return
    // This mission's saves queued before the switch finish first, so the load
    // sees them. Another mission's slow save never holds this one up.
    await earlierSaves
    let saved: readonly string[]
    let loadWarning: string | null
    try {
      const loaded = await store.loadWatchedFolders(missionId)
      saved = loaded.paths
      loadWarning = loaded.warning
    } catch (error) {
      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return
      state = {
        ...state,
        watchNotice: {
          tone: 'problem',
          message: `Watched folders saved for this mission could not be loaded, so none are being watched: ${describeWatchError(error)}. Add them again with Watch Folder.`,
        },
      }
      publishRuntime()
      return
    }
    // Folders added while the list loaded, or kept after a failed save, stay.
    const unsaved = watchListByMission.get(missionId) ?? []
    const watchedDirectories = [...saved, ...unsaved.filter((path) => !saved.includes(path))]
    watchListByMission.set(missionId, watchedDirectories)
    if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return
    const saveFailure = watchSaveFailures.get(missionId) ?? null
    if (saved.length === 0) {
      if (saveFailure === null && watchedDirectories.length === state.watchedDirectories.length) return
      state = {
        ...state,
        watchedDirectories,
        ...(saveFailure !== null ? { watchNotice: { tone: 'problem' as const, message: saveFailure } } : {}),
      }
      publishRuntime()
      return
    }
    state = {
      ...state,
      watchedDirectories,
      watchNotice: {
        tone: loadWarning === null && saveFailure === null ? 'resumed' : 'problem',
        message: [
          `Resumed watching ${saved.length} folder${saved.length === 1 ? '' : 's'} saved for this mission. New GPX files there will import automatically.`,
          loadWarning,
          saveFailure,
        ].filter((part): part is string => part !== null).join(' '),
      },
      watchResumePending: true,
    }
    publishRuntime()
  }

  /**
   * Saves the mission's watch list as it stands when the save runs: after the
   * saved watches were restored, so an edit made while they loaded keeps them,
   * and after any earlier save. A failure is shown until a later save
   * succeeds [DON-337].
   */
  function saveWatches(missionId: string, missionToken: number, change: 'added' | 'removed'): Promise<void> {
    const store = dependencies.watchedFolderStore
    if (store === undefined) return Promise.resolve()
    const restoration = watchRestoration
    const isCurrent = () => missionToken === missionGeneration && state.activeMissionId === missionId
    const save = watchSaves.then(async () => {
      await restoration
      // The mission's own latest list is saved whichever mission is open now.
      const paths = watchListByMission.get(missionId) ?? []
      try {
        const { backupWarning } = await store.saveWatchedFolders(missionId, paths)
        watchSaveFailures.delete(missionId)
        if (!isCurrent()) return
        if (backupWarning !== null) {
          // The list is safe; only its backup copy is behind. Say so plainly.
          state = {
            ...state,
            watchNotice: {
              tone: 'problem',
              message: `${backupWarning.replace(/\.$/u, '')}. The folder will still be watched after a restart. Check the disk and free space; the backup is retried on the next change.`,
            },
          }
          publishRuntime()
        } else if (state.watchNotice?.tone === 'problem') {
          state = { ...state, watchNotice: null }
          publishRuntime()
        }
      } catch (error) {
        const consequence = change === 'added'
          ? 'The folder is watched now but will be forgotten after a restart; choose it again with Watch Folder to retry saving.'
          : 'The folder may be watched again after a restart; remove it again then.'
        const message = `The watched folder list could not be saved: ${describeWatchError(error)}. ${consequence}`
        // Kept for the mission, so it is shown when that mission opens again.
        watchSaveFailures.set(missionId, message)
        if (!isCurrent()) return
        state = { ...state, watchNotice: { tone: 'problem', message } }
        publishRuntime()
      }
    })
    watchSaves = save
    latestSaveByMission.set(missionId, save)
    return save
  }

  async function importFilesIntoRuntime(
    files: readonly GpxImportFileInput[],
    expectedMissionId: string | null = state.activeMissionId,
    expectedMissionToken: number = missionGeneration,
  ): Promise<GpxImportOperationResult> {
    if (
      expectedMissionId === null
      || expectedMissionToken !== missionGeneration
      || state.activeMissionId !== expectedMissionId
      || files.length === 0
    ) {
      return operationResult(
        expectedMissionId === null || expectedMissionToken !== missionGeneration || state.activeMissionId !== expectedMissionId
          ? 'stale'
          : 'empty',
      )
    }

    if (!admitImport()) return operationResult('refused')

    state = {
      ...state,
      importing: true,
      error: null,
    }
    publishRuntime()

    const missionId = expectedMissionId
    const missionToken = expectedMissionToken

    try {
      if (missionId === null) {
        state = {
          ...state,
          importing: false,
        }
        publishRuntime()
        return operationResult('stale')
      }
      const existingByPath = new Map(state.imports.map((entry) => [entry.source_path, entry]))
      const existingByHash = new Map(
        state.imports.flatMap((entry) => entry.content_sha256 == null
          ? []
          : [[entry.content_sha256, entry] as const]),
      )
      const importedHashByPath = new Map(
        state.imports.flatMap((entry) => entry.content_sha256 == null
          ? []
          : [[entry.source_path, entry.content_sha256] as const]),
      )
      const imported: GpxTrackImport[] = []
      const failures: GpxImportOperationFailure[] = []

      for (const file of files) {
        if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
          return operationResult('stale', imported, failures)
        }
        const existingAtPath = existingByPath.get(file.sourcePath)
        if (existingAtPath !== undefined && existingAtPath.content_sha256 == null) continue
        try {
          const parsed = parseGpxFile(file)
          const contentSha256 = await digestGpxSource({
            contents: file.contents,
            ...(file.bytesBase64 === undefined ? {} : { bytesBase64: file.bytesBase64 }),
          })
          if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
            return operationResult('stale', imported, failures)
          }
          if (importedHashByPath.get(file.sourcePath) === contentSha256) continue
          if (existingByHash.has(contentSha256)) continue
          const samePath = existingAtPath
          const nextImport = await dependencies.gpxStore.upsertGpxImport({
            ...(samePath === undefined ? {} : { id: samePath.id }),
            mission_id: missionId,
            source_path: parsed.sourcePath,
            file_name: parsed.fileName,
            display_name: parsed.displayName,
            geometry_json: parsed.geometryJson,
            metadata_json: parsed.metadataJson,
            content_sha256: contentSha256,
            source_bytes_base64: file.bytesBase64 ?? encodeUtf8Base64(file.contents),
            timing_class: parsed.timingClass,
            points: parsed.points.map((point) => ({
              segment_index: point.segmentIndex,
              point_index: point.pointIndex,
              track_name: point.trackName,
              lat: point.lat,
              lon: point.lon,
              elevation: point.elevation,
              timestamp: point.timestamp,
            })),
            rejections: parsed.rejections.map((rejection) => ({
              kind: rejection.kind,
              segment_index: rejection.segmentIndex,
              point_index: rejection.pointIndex,
              reason: rejection.reason,
              source_value: rejection.sourceValue,
            })),
          })
          if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
            return operationResult('stale', imported, failures)
          }
          existingByPath.set(nextImport.source_path, nextImport)
          if (nextImport.content_sha256 != null) existingByHash.set(nextImport.content_sha256, nextImport)
          importedHashByPath.set(file.sourcePath, contentSha256)
          imported.push(nextImport)
        } catch (error) {
          if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
            return operationResult('stale', imported, failures)
          }
          failures.push({ fileName: file.fileName, reason: toErrorMessage(error) })
        }
      }

      const mergedImports = mergeGpxImportsByIdentity(state.imports, imported)
      const projectionPage = mergedImports.length <= GPX_RENDERER_PAGE_LIMIT
        ? { entries: mergedImports, nextCursor: nextImportCursor }
        : await readGpxImportProjectionPage(
            missionId,
            undefined,
            () => missionToken === missionGeneration && state.activeMissionId === missionId,
          )
      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
        return operationResult('stale', imported, failures)
      }
      const projectionChanged = imported.length > 0
      if (projectionChanged) {
        importPublication += 1
        nextImportCursor = projectionPage.nextCursor
      }
      importErrorRevision += 1
      state = {
        ...state,
        importing: false,
        imports: projectionChanged ? projectionPage.entries : state.imports,
        loadingMoreImports: false,
        importPageNumber: projectionChanged ? 1 : state.importPageNumber,
        hasMoreImports: projectionChanged ? projectionPage.nextCursor !== null : state.hasMoreImports,
        error: describeRendererImportFailures(failures),
      }
      publishRuntime()
      if (projectionChanged) {
        await refreshMap(missionId, () => missionToken === missionGeneration && state.activeMissionId === missionId)
      }
      return operationResult(
        imported.length > 0 ? 'imported' : failures.length > 0 ? 'failed' : 'empty',
        imported,
        failures,
      )
    } catch (error) {
      if (state.activeMissionId !== missionId || missionToken !== missionGeneration) return operationResult('stale')
      state = {
        ...state,
        importing: false,
        error: toErrorMessage(error),
        loadingMoreImports: false,
      }
      importErrorRevision += 1
      publishRuntime()
      throw error
    }
  }

  /** Replaces revised projections and appends only genuinely new GPX identities. */
  function mergeGpxImportsByIdentity(
    existing: readonly GpxTrackImport[],
    imported: readonly GpxTrackImport[],
  ): readonly GpxTrackImport[] {
    const byId = new Map(existing.map((entry) => [entry.id, entry]))
    for (const entry of imported) byId.set(entry.id, entry)
    return [...byId.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name))
  }

  async function importPathsIntoRuntime(
    paths: readonly string[],
    expectedMissionId: string | null = state.activeMissionId,
    expectedMissionToken: number = missionGeneration,
    source: PathImportSource = DELIBERATE_IMPORT,
  ): Promise<GpxImportOperationResult> {
    const missionId = expectedMissionId
    const missionToken = expectedMissionToken
    if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
      return operationResult(
        'stale',
      )
    }
    if (paths.length === 0) return operationResult('empty')
    const importNativePaths = dependencies.gpxStore.importGpxEvidencePaths
    if (importNativePaths === undefined) {
      return operationResult('failed', [], [{
        fileName: 'GPX path import',
        reason: 'Native GPX path import is unavailable in this runtime.',
      }])
    }
    if (!admitImport()) return operationResult('refused')
    state = { ...state, importing: true, error: null }
    publishRuntime()
    const isCurrent = () => missionToken === missionGeneration && state.activeMissionId === missionId
    const imports: { readonly id: string; readonly revision_sequence?: number }[] = []
    const nativeFailures: { readonly sourcePath: string; readonly reason: string }[] = []
    let finishedPaths = 0
    try {
      // One admitted import, sent in store-sized chunks, so a large watched folder is not refused [M-40].
      // A chunk that throws stops the rest: a stalled or crashed worker is likely to fail again, and
      // the error then says exactly which files finished and which were never tried.
      for (let start = 0; start < paths.length; start += NATIVE_IMPORT_CHUNK) {
        const chunk = paths.slice(start, start + NATIVE_IMPORT_CHUNK)
        let result
        try {
          result = await importNativePaths({
            missionId,
            paths: chunk,
            ...(source.skipRetiredSources ? { skipRetiredSources: true } : {}),
          })
        } catch (error) {
          throw describeStoppedChunk(error, {
            total: paths.length,
            finished: finishedPaths,
            imported: imports.length,
            failed: nativeFailures.length,
            stopped: chunk.length,
          })
        }
        if (!isCurrent()) return operationResult('stale')
        finishedPaths += chunk.length
        imports.push(...result.imports)
        if ('failures' in result && Array.isArray(result.failures)) nativeFailures.push(...result.failures)
      }
      // Only a new identity or a new revision changes what is shown; an unchanged rescan keeps the page [M-37].
      const projectionChanged = changesProjection(imports)
      const [importPage, issuePage] = await Promise.all([
        projectionChanged
          ? readGpxImportProjectionPage(missionId, undefined, isCurrent)
          : Promise.resolve(null),
        dependencies.gpxStore.listGpxImportIssues?.({ missionId, limit: 100 })
          ?? Promise.resolve({ entries: [], nextCursor: null }),
      ])
      if (!isCurrent()) return operationResult('stale')
      if (importPage !== null) {
        importPublication += 1
        nextImportCursor = importPage.nextCursor
      }
      importErrorRevision += 1
      state = {
        ...state,
        importing: false,
        imports: importPage !== null ? importPage.entries : state.imports,
        importPageNumber: importPage !== null ? 1 : state.importPageNumber,
        hasMoreImports: importPage !== null ? importPage.nextCursor !== null : state.hasMoreImports,
        loadingMoreImports: false,
        importIssues: issuePage.entries,
        hasMoreImportIssues: issuePage.nextCursor !== null,
        error: describeImportIssues(issuePage.entries.length, issuePage.nextCursor)
          ?? (nativeFailures.length === 0
            ? null
            : `${nativeFailures.length} GPX file${nativeFailures.length === 1 ? '' : 's'} could not be imported. Exact failure provenance was retained.`),
      }
      publishRuntime()
      if (projectionChanged) await refreshMap(missionId, isCurrent)
      return operationResult(
        imports.length > 0 ? 'imported' : nativeFailures.length > 0 ? 'failed' : 'empty',
        imports,
        nativeFailures.map((failure) => ({
          fileName: fileNameFromPath(failure.sourcePath),
          reason: failure.reason,
        })),
      )
    } catch (error) {
      if (!isCurrent()) return operationResult('stale')
      // A stopped import may have committed some files and listed the rest as issues: re-read
      // what the store now holds before reporting, so nothing imported is hidden [DON-350] [M-36].
      await rereadAfterFailedImport(missionId, isCurrent)
      if (!isCurrent()) return operationResult('stale')
      state = { ...state, importing: false, loadingMoreImports: false, error: toErrorMessage(error) }
      importErrorRevision += 1
      publishRuntime()
      throw error
    }
  }

  /** True when a returned import is new to the map or carries a different revision. */
  function changesProjection(
    imports: readonly { readonly id: string; readonly revision_sequence?: number }[],
  ): boolean {
    const known = new Map(state.mapImports.map((entry) => [entry.id, entry.revision_sequence]))
    return imports.some((entry) => {
      if (!known.has(entry.id)) return true
      const revision = known.get(entry.id)
      return revision === undefined || entry.revision_sequence === undefined || revision !== entry.revision_sequence
    })
  }

  /** Best-effort re-read of list, issues and map after a failed native import; its own failure stays visible. */
  async function rereadAfterFailedImport(missionId: string, isCurrent: () => boolean): Promise<void> {
    try {
      const [importPage, issuePage] = await Promise.all([
        readGpxImportProjectionPage(missionId, undefined, isCurrent),
        dependencies.gpxStore.listGpxImportIssues?.({ missionId, limit: 100 })
          ?? Promise.resolve({ entries: [], nextCursor: null }),
      ])
      if (!isCurrent()) return
      importPublication += 1
      nextImportCursor = importPage.nextCursor
      state = {
        ...state,
        imports: importPage.entries,
        importPageNumber: 1,
        hasMoreImports: importPage.nextCursor !== null,
        importIssues: issuePage.entries,
        hasMoreImportIssues: issuePage.nextCursor !== null,
      }
    } catch (error) {
      if (!isCurrent()) return
      state = {
        ...state,
        error: appendErrorMessage(state.error, `The GPX list could not be re-read after the import stopped: ${toErrorMessage(error)}`),
      }
    }
    await refreshMap(missionId, isCurrent)
  }

  /** Remembers a saved colour or outing until a map read that started after it has finished. */
  function recordSavedPresentation(
    missionId: string,
    missionToken: number,
    importId: string,
    patch: SavedPresentationPatch,
  ): void {
    if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return
    const earlier = savedPresentations.get(importId)
    savedPresentations.set(importId, { sequence: ++presentationSequence, patch: { ...earlier?.patch, ...patch } })
  }

  /** Applies saves newer than a read's start to its entries, and forgets saves the read already holds. */
  function mergeSavedPresentations(entries: readonly GpxTrackImport[], readFrom: number): readonly GpxTrackImport[] {
    for (const [importId, saved] of savedPresentations) {
      if (saved.sequence <= readFrom) savedPresentations.delete(importId)
    }
    if (savedPresentations.size === 0) return entries
    return entries.map((entry) => {
      const saved = savedPresentations.get(entry.id)
      return saved === undefined ? entry : { ...entry, ...saved.patch }
    })
  }

  /**
   * Re-reads the whole map projection. On failure the last map stays drawn and the operator is told,
   * so a track never disappears without words [DON-350] [M-87].
   */
  async function refreshMap(missionId: string, isCurrent: () => boolean): Promise<void> {
    const listMapPage = dependencies.gpxStore.listGpxMapProjectionPage
    if (listMapPage === undefined) return
    const token = ++mapRefreshToken
    const readFrom = presentationSequence
    const stillCurrent = () => token === mapRefreshToken && isCurrent()
    try {
      const projection = await readGpxMapProjection({ listGpxMapProjectionPage: listMapPage }, missionId, stillCurrent)
      if (projection === null || !stillCurrent()) return
      state = {
        ...state,
        // The last good map stays drawn until this read finishes; it then carries the latest saves.
        mapImports: mergeSavedPresentations(projection.entries, readFrom),
        mapImportTotal: projection.totalActive,
        mapCoverageNotice: describeGpxMapCoverage(projection),
      }
    } catch (error) {
      if (!stillCurrent()) return
      const shown = state.mapImports.length
      state = {
        ...state,
        mapCoverageNotice: `The GPX map could not be refreshed: ${toErrorMessage(error).replace(/\.+$/u, '')}. `
          + `It still shows the ${shown} track${shown === 1 ? '' : 's'} from the last successful read; newer imports may be missing. `
          + 'Every track is still listed in the GPX panel.',
      }
    }
    publishRuntime()
  }

  function canListWatchedPaths(): boolean {
    return dependencies.gpxStore.importGpxEvidencePaths !== undefined
      && (dependencies.watchSource?.listWatchedDirectoryPaths !== undefined
        || dependencies.watchSource?.listDirectoryPaths !== undefined)
  }

  /** Prefers the watched-folder listing, which is not capped at Import Folder's 100 files [M-40]. */
  async function listWatchedPaths(directoryPath: string): Promise<WatchedGpxDirectoryListing> {
    const source = dependencies.watchSource
    if (source?.listWatchedDirectoryPaths !== undefined) return await source.listWatchedDirectoryPaths(directoryPath)
    if (source?.listDirectoryPaths !== undefined) {
      return { paths: await source.listDirectoryPaths(directoryPath), omittedCount: 0 }
    }
    throw new Error('Watched GPX folder listing is unavailable in this runtime.')
  }

  /** Adds a scan's warnings to the operator error line once every folder has been imported. */
  function publishScanNotices(notices: readonly (string | null)[], missionId: string, missionToken: number): void {
    const present = notices.filter((notice): notice is string => notice !== null)
    if (present.length === 0 || missionToken !== missionGeneration || state.activeMissionId !== missionId) return
    let error = state.error
    for (const notice of present) error = appendErrorMessage(error, notice)
    state = { ...state, error }
    publishRuntime()
  }

  /** Keeps a rejected selection visible while the admitted operation is active. */
  function admitImport(): boolean {
    if (!state.importing) {
      state = { ...state, error: null }
      return true
    }
    const notice = 'Another GPX import is in progress. This request was not imported. Retry after it finishes.'
    if (state.error !== notice) {
      state = { ...state, error: notice }
      publishRuntime()
    }
    return false
  }

  /** Publishes the current runtime state without retaining a stale admission notice. */
  function publishRuntime(): void {
    if (dependencies.gpxStore.listGpxMapProjectionPage === undefined && state.mapImports !== state.imports) {
      // Without a map projection the map can draw only the visible page, and says so [DON-350].
      state = {
        ...state,
        mapImports: state.imports,
        mapImportTotal: state.imports.length,
        mapCoverageNotice: describeListPageMapCoverage(
          state.imports.length,
          state.hasMoreImports || state.importPageNumber > 1,
        ),
      }
    }
    dependencies.applyRuntime(state)
  }

  /** Replaces the current renderer window instead of accumulating GPX geometry. */
  async function loadImportPage(cursor: string | undefined, pageNumber: number): Promise<void> {
    const missionId = state.activeMissionId
    const token = refreshToken
    const publication = importPublication
    if (missionId === null) return
    state = { ...state, loadingMoreImports: true, error: null }
    publishRuntime()
    try {
      const page = await readGpxImportProjectionPage(
        missionId,
        cursor,
        () => token === refreshToken && publication === importPublication && state.activeMissionId === missionId,
      )
      if (token !== refreshToken || publication !== importPublication || state.activeMissionId !== missionId) return
      nextImportCursor = page.nextCursor
      state = {
        ...state,
        imports: page.entries,
        importPageNumber: pageNumber,
        hasMoreImports: page.nextCursor !== null,
        loadingMoreImports: false,
      }
      publishRuntime()
    } catch (error) {
      if (token !== refreshToken || publication !== importPublication || state.activeMissionId !== missionId) return
      state = { ...state, loadingMoreImports: false, error: appendErrorMessage(state.error, toErrorMessage(error)) }
      publishRuntime()
    }
  }

  /** Describes one bounded issue page without implying it is the whole retained set. */
  function describeImportIssues(count: number, nextCursor: string | null): string | null {
    if (count === 0) return null
    const prefix = nextCursor === null ? String(count) : `At least ${count}`
    const suffix = nextCursor === null
      ? ''
      : ' Additional retained GPX import issues are available beyond this bounded page.'
    return `${prefix} persisted GPX import issue${count === 1 ? ' requires' : 's require'} operator review. Exact failure provenance was retained.${suffix}`
  }

  /** Reads one renderer projection window with mission-staleness fencing. */
  async function readGpxImportProjectionPage(
    missionId: string,
    cursor: string | undefined,
    isCurrent: () => boolean,
  ) {
    const { readGpxImportProjectionPage: readPage } = await import('./read-gpx-import-pages')
    return await readPage(dependencies.gpxStore, missionId, cursor, isCurrent)
  }
}

function encodeUtf8Base64(contents: string): string {
  const bytes = new TextEncoder().encode(contents)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'GPX import failed.'
}

/** Adds a distinct runtime error once while bounding operator-facing text. */
function appendErrorMessage(existing: string | null, next: string): string {
  if (existing === null || existing === '') return next
  if (existing.includes(next)) return existing
  return `${existing} ${next}`.slice(0, 2_000)
}

/** Creates an explicit renderer import outcome so refusal and staleness cannot look empty. */
function operationResult(
  outcome: GpxImportOperationOutcome,
  imports: readonly GpxImportResult[] = [],
  failures?: readonly GpxImportOperationFailure[],
): GpxImportOperationResult {
  return failures === undefined || failures.length === 0
    ? { outcome, imports }
    : { outcome, imports, failures }
}

/** Summarizes renderer-only failures without claiming native durable evidence retention. */
function describeRendererImportFailures(
  failures: readonly GpxImportOperationFailure[],
): string | null {
  if (failures.length === 0) return null
  const names = failures.slice(0, 3).map((failure) => `${failure.fileName}: ${failure.reason}`)
  const suffix = failures.length > names.length
    ? ` ${failures.length - names.length} additional renderer file failure${failures.length - names.length === 1 ? '' : 's'} were not shown.`
    : ''
  return `Could not import ${failures.length} GPX file${failures.length === 1 ? '' : 's'}. Failed-source evidence was not saved by this import path: ${names.join('; ')}.${suffix}`
}

/** Keeps a multi-directory rescan's partial failure visible after later success. */
function describeOperationFailures(failures: readonly GpxImportOperationFailure[]): string {
  const details = failures.slice(0, 3)
    .map((failure) => `${failure.fileName}: ${failure.reason.replace(/\.+$/u, '')}`)
  const suffix = failures.length > details.length
    ? ` ${failures.length - details.length} additional failure${failures.length - details.length === 1 ? '' : 's'} were not shown.`
    : ''
  return `${failures.length} GPX file${failures.length === 1 ? '' : 's'} could not be imported during this rescan: ${details.join('; ')}.${suffix}`
}

/** Says, in words, that a watched folder holds more files than are watched; null when none are left out. */
type SavedPresentationPatch = { readonly metadata_json?: string | null; readonly outing_id?: string | null }
type SavedPresentation = { readonly sequence: number; readonly patch: SavedPresentationPatch }

type StoppedChunkProgress = {
  readonly total: number
  readonly finished: number
  readonly imported: number
  readonly failed: number
  readonly stopped: number
}

/**
 * Adds the whole-import picture to a chunk's failure: which files finished, which were in the
 * stopped chunk (its own message says how far it got) and which were never tried [DON-350] [M-40].
 */
function describeStoppedChunk(error: unknown, progress: StoppedChunkProgress): unknown {
  // A single-chunk import is fully described by the store's own message.
  if (progress.total <= progress.stopped) return error
  const notTried = progress.total - progress.finished - progress.stopped
  const finished = progress.finished === 0
    ? 'it stopped in the first part'
    : `${progress.finished} finished before the stop (${progress.imported} imported or updated`
      + `${progress.failed > 0 ? `, ${progress.failed} failed` : ''})`
  const cause = toErrorMessage(error).replace(/\.?$/u, '.')
  const described = new Error(
    `${cause} Of ${progress.total} GPX files in this import, ${finished}; `
      + `${notTried} ${notTried === 1 ? 'was' : 'were'} not tried. Import or rescan again to try them.`,
  )
  if (error instanceof Error) described.name = error.name
  return described
}

function describeOmittedWatchedFiles(directoryPath: string, omittedCount: number): string | null {
  if (omittedCount <= 0) return null
  return `Watched folder ${directoryPath} holds more than ${WATCHED_LISTING_LIMIT} GPX files; `
    + `only the ${WATCHED_LISTING_LIMIT} most recently changed are watched and ${omittedCount} are not. `
    + 'Move older files to another folder.'
}

/** Names a watched folder that could not be listed, in words a volunteer can act on. */
/** Operator words for a watch-store or folder error, without Electron's IPC wrapper text. */
function describeWatchError(error: unknown): string {
  return toErrorMessage(error)
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
    .replace(/\.+$/u, '')
}

/** The failures that belong to GPX files, leaving out folders that could not be opened. */
function fileFailuresOf(
  failures: readonly GpxImportOperationFailure[],
  folders: readonly string[],
): readonly GpxImportOperationFailure[] {
  return failures.filter((failure) => !folders.includes(failure.fileName))
}

/** Says a watched folder could not be opened, that its new files are not importing, and what to do. */
function describeUnopenableWatchedFolder(directoryPath: string, error: unknown): string {
  return `Watched folder ${directoryPath} could not be opened: ${describeWatchError(error)}. New GPX files there are not being imported. Reconnect the folder or drive and press Rescan Watches, or remove it from Watched Folders.`
}

function describeWatchedFolderFailure(failure: GpxImportOperationFailure): string {
  return `Watched folder ${failure.fileName} could not be read: ${failure.reason.replace(/\.+$/u, '')}. Check the folder is still connected, then select it again.`
}

/** Extracts a display-safe file name from a native source path. */
function fileNameFromPath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/u).at(-1) ?? sourcePath
}
