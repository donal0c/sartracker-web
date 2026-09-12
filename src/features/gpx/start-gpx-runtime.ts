import type {
  GpxImportIssue,
  GpxTrackImport,
  Outing,
  UpsertGpxTrackImportInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { writeGpxImportColorMetadata } from './gpx-style'
import { digestGpxSource, parseGpxFile } from './gpx-parser'

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
  }) => Promise<{
    readonly imports: readonly { readonly id: string }[]
    readonly failures?: readonly { readonly sourcePath: string; readonly reason: string }[]
    readonly dispatchDurationMs: number
  }>
}

type GpxWatchSourceBoundary = {
  readonly listDirectoryFiles: (directoryPath: string) => Promise<readonly GpxImportFileInput[]>
  readonly listDirectoryPaths?: (directoryPath: string) => Promise<readonly string[]>
}

export type GpxImportFileInput = {
  readonly sourcePath: string
  readonly fileName: string
  readonly contents: string
  readonly bytesBase64?: string
}

export type GpxImportResult = Pick<GpxTrackImport, 'id'>

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

export type GpxRuntimeState = {
  readonly activeMissionId: string | null
  readonly imports: readonly GpxTrackImport[]
  readonly outings: readonly Outing[]
  readonly watchedDirectories: readonly string[]
  readonly importIssues: readonly GpxImportIssue[]
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
  readonly deleteImport: (importId: string) => Promise<boolean>
  readonly assignImportToOuting: (importId: string, outingId: string, assignedBy?: string | null) => Promise<GpxTrackImport | null>
}

const GPX_RENDERER_PAGE_LIMIT = 25

const EMPTY_RUNTIME: GpxRuntimeState = {
  activeMissionId: null,
  imports: [],
  outings: [],
  watchedDirectories: [],
  importIssues: [],
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
  let importPublication = 0
  let importErrorRevision = 0
  let nextImportCursor: string | null = null

  publishRuntime()

  return {
    refreshMission: async (missionId: string | null) => {
      const token = ++refreshToken
      const publication = importPublication
      const errorRevision = importErrorRevision
      const previousMissionId = state.activeMissionId
      if (missionId !== previousMissionId) {
        missionGeneration += 1
      }
      state = {
        ...state,
        activeMissionId: missionId,
        imports: missionId === previousMissionId ? state.imports : [],
        outings: missionId === previousMissionId ? state.outings : [],
        watchedDirectories: missionId === previousMissionId ? state.watchedDirectories : [],
        importIssues: missionId === previousMissionId ? state.importIssues : [],
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
        state = {
          ...state,
          imports: [],
          outings: [],
          watchedDirectories: [],
          importIssues: [],
          importPageNumber: 1,
          hasMoreImports: false,
          loadingMoreImports: false,
          hasMoreImportIssues: false,
          loading: false,
        }
        publishRuntime()
        return
      }

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
        error: null,
      }
      publishRuntime()
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

      if (!state.watchedDirectories.includes(normalizedPath)) {
        state = {
          ...state,
          watchedDirectories: [...state.watchedDirectories, normalizedPath],
        }
        publishRuntime()
      }

      const missionId = state.activeMissionId
      const missionToken = missionGeneration

      if (
        dependencies.gpxStore.importGpxEvidencePaths !== undefined
        && dependencies.watchSource.listDirectoryPaths !== undefined
      ) {
        const paths = await dependencies.watchSource.listDirectoryPaths(normalizedPath)
        if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
          return operationResult('stale')
        }
        return await importPathsIntoRuntime(paths, missionId, missionToken)
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
      let hadFailure = false
      let currentDirectory = 'watched folder scan'
      try {
        for (const directoryPath of state.watchedDirectories) {
          currentDirectory = directoryPath
          if (
            dependencies.gpxStore.importGpxEvidencePaths !== undefined
            && dependencies.watchSource.listDirectoryPaths !== undefined
          ) {
            const paths = await dependencies.watchSource.listDirectoryPaths(directoryPath)
            if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale', imported, failures)
            const result = await importPathsIntoRuntime(paths, missionId, missionToken)
            imported.push(...result.imports)
            if (result.failures !== undefined) failures.push(...result.failures)
            hadFailure ||= result.outcome === 'failed'
            if (result.outcome === 'refused' || result.outcome === 'stale') {
              return operationResult(result.outcome, imported, failures)
            }
          } else {
            const files = await dependencies.watchSource.listDirectoryFiles(directoryPath)
            if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale', imported, failures)
            const result = await importFilesIntoRuntime(files, missionId, missionToken)
            imported.push(...result.imports)
            if (result.failures !== undefined) failures.push(...result.failures)
            hadFailure ||= result.outcome === 'failed'
            if (result.outcome === 'refused' || result.outcome === 'stale') {
              return operationResult(result.outcome, imported, failures)
            }
          }
        }

        if (failures.length > 0 && missionToken === missionGeneration && state.activeMissionId === missionId) {
          state = { ...state, error: appendErrorMessage(state.error, describeOperationFailures(failures)) }
          publishRuntime()
        }
        return operationResult(
          imported.length > 0 ? 'imported' : hadFailure ? 'failed' : 'empty',
          imported,
          failures,
        )
      } catch (error) {
        if (missionToken !== missionGeneration || state.activeMissionId !== missionId) {
          return operationResult('stale', imported, failures)
        }
        const scanFailure = { fileName: currentDirectory, reason: toErrorMessage(error) }
        state = {
          ...state,
          error: appendErrorMessage(state.error, scanFailure.reason),
        }
        publishRuntime()
        return operationResult('failed', imported, [...failures, scanFailure])
      }
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
        loadingMoreImports: false,
      }
      publishRuntime()
      return true
    },
    assignImportToOuting: async (importId, outingId, assignedBy) => {
      const missionId = state.activeMissionId
      const token = refreshToken
      const existing = state.imports.find((entry) => entry.id === importId)
      if (missionId === null || existing?.mission_id !== missionId
        || dependencies.gpxStore.assignGpxImportToOuting === undefined) return null
      const updated = await dependencies.gpxStore.assignGpxImportToOuting({
        import_id: importId,
        outing_id: outingId,
        ...(assignedBy === undefined ? {} : { assigned_by: assignedBy }),
      })
      if (token !== refreshToken || state.activeMissionId !== missionId) return updated
      state = {
        ...state,
        imports: state.imports.map((entry) => entry.id === updated.id ? updated : entry),
        error: null,
      }
      publishRuntime()
      return updated
    },
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
  ): Promise<GpxImportOperationResult> {
    const missionId = expectedMissionId
    const missionToken = expectedMissionToken
    if (missionId === null || missionToken !== missionGeneration || state.activeMissionId !== missionId) {
      return operationResult(
        'stale',
      )
    }
    if (paths.length === 0) return operationResult('empty')
    if (dependencies.gpxStore.importGpxEvidencePaths === undefined) {
      return operationResult('failed', [], [{
        fileName: 'GPX path import',
        reason: 'Native GPX path import is unavailable in this runtime.',
      }])
    }
    if (!admitImport()) return operationResult('refused')
    state = { ...state, importing: true, error: null }
    publishRuntime()
    try {
      const result = await dependencies.gpxStore.importGpxEvidencePaths({ missionId, paths })
      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale')
      const [importPage, issuePage] = await Promise.all([
        readGpxImportProjectionPage(
          missionId,
          undefined,
          () => missionToken === missionGeneration && state.activeMissionId === missionId,
        ),
        dependencies.gpxStore.listGpxImportIssues?.({ missionId, limit: 100 })
          ?? Promise.resolve({ entries: [], nextCursor: null }),
      ])
      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale')
      const failures = 'failures' in result && Array.isArray(result.failures) ? result.failures : []
      const projectionChanged = result.imports.length > 0
      if (projectionChanged) {
        importPublication += 1
        nextImportCursor = importPage.nextCursor
      }
      importErrorRevision += 1
      state = {
        ...state,
        importing: false,
        imports: projectionChanged ? importPage.entries : state.imports,
        importPageNumber: projectionChanged ? 1 : state.importPageNumber,
        hasMoreImports: projectionChanged ? importPage.nextCursor !== null : state.hasMoreImports,
        loadingMoreImports: false,
        importIssues: issuePage.entries,
        hasMoreImportIssues: issuePage.nextCursor !== null,
        error: describeImportIssues(issuePage.entries.length, issuePage.nextCursor)
          ?? (failures.length === 0
            ? null
            : `${failures.length} GPX file${failures.length === 1 ? '' : 's'} could not be imported. Exact failure provenance was retained.`),
      }
      publishRuntime()
      return operationResult(
        result.imports.length > 0 ? 'imported' : failures.length > 0 ? 'failed' : 'empty',
        result.imports,
        failures.map((failure) => ({
          fileName: fileNameFromPath(failure.sourcePath),
          reason: failure.reason,
        })),
      )
    } catch (error) {
      if (missionToken !== missionGeneration || state.activeMissionId !== missionId) return operationResult('stale')
      state = { ...state, importing: false, loadingMoreImports: false, error: toErrorMessage(error) }
      importErrorRevision += 1
      publishRuntime()
      throw error
    }
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
    return `${prefix} persisted GPX import issue${count === 1 ? '' : 's'} require operator review. Exact failure provenance was retained.${suffix}`
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
  const details = failures.slice(0, 3).map((failure) => `${failure.fileName}: ${failure.reason}`)
  const suffix = failures.length > details.length
    ? ` ${failures.length - details.length} additional failure${failures.length - details.length === 1 ? '' : 's'} were not shown.`
    : ''
  return `${failures.length} GPX file${failures.length === 1 ? '' : 's'} could not be imported during this rescan: ${details.join('; ')}.${suffix}`
}

/** Extracts a display-safe file name from a native source path. */
function fileNameFromPath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/u).at(-1) ?? sourcePath
}
