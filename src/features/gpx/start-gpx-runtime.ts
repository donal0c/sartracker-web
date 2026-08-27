import type {
  GpxTrackImport,
  Outing,
  UpsertGpxTrackImportInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { writeGpxImportColorMetadata } from './gpx-style'
import { digestGpxSource, parseGpxFile } from './gpx-parser'

type GpxStoreBoundary = {
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly upsertGpxImport: (input: UpsertGpxTrackImportInput) => Promise<GpxTrackImport>
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

export type GpxRuntimeState = {
  readonly activeMissionId: string | null
  readonly imports: readonly GpxTrackImport[]
  readonly outings: readonly Outing[]
  readonly watchedDirectories: readonly string[]
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
  readonly importFiles: (files: readonly GpxImportFileInput[]) => Promise<readonly GpxTrackImport[]>
  readonly importPaths: (paths: readonly string[]) => Promise<readonly GpxTrackImport[]>
  readonly updateImportColor: (importId: string, color: string) => Promise<GpxTrackImport | null>
  readonly addWatchedDirectory: (directoryPath: string) => Promise<readonly GpxTrackImport[]>
  readonly removeWatchedDirectory: (directoryPath: string) => void
  readonly rescanWatchedDirectories: () => Promise<readonly GpxTrackImport[]>
  readonly deleteImport: (importId: string) => Promise<boolean>
  readonly assignImportToOuting: (importId: string, outingId: string, assignedBy?: string | null) => Promise<GpxTrackImport | null>
}

const EMPTY_RUNTIME: GpxRuntimeState = {
  activeMissionId: null,
  imports: [],
  outings: [],
  watchedDirectories: [],
  loading: false,
  importing: false,
  error: null,
}

export async function startGpxRuntime(
  dependencies: StartGpxRuntimeDependencies,
): Promise<GpxRuntimeController> {
  let state: GpxRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0

  publishRuntime()

  return {
    refreshMission: async (missionId: string | null) => {
      const token = ++refreshToken
      const previousMissionId = state.activeMissionId
      state = {
        ...state,
        activeMissionId: missionId,
        imports: missionId === previousMissionId ? state.imports : [],
        outings: missionId === previousMissionId ? state.outings : [],
        watchedDirectories: missionId === previousMissionId ? state.watchedDirectories : [],
        loading: missionId !== null,
        importing: missionId === previousMissionId ? state.importing : false,
        error: null,
      }
      publishRuntime()

      if (missionId === null) {
        state = {
          ...state,
          imports: [],
          outings: [],
          watchedDirectories: [],
          loading: false,
        }
        publishRuntime()
        return
      }

      try {
        const [imports, outings] = await Promise.all([
          dependencies.gpxStore.listGpxImports(missionId),
          dependencies.gpxStore.listOutings?.(missionId) ?? Promise.resolve([]),
        ])
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        state = {
          ...state,
          activeMissionId: missionId,
          imports,
          outings,
          loading: false,
          error: null,
        }
        publishRuntime()
      } catch (error) {
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        state = {
          ...state,
          imports: [],
          outings: [],
          loading: false,
          error: toErrorMessage(error),
        }
        publishRuntime()
      }
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

      const updatedImport = await dependencies.gpxStore.upsertGpxImport({
        id: existingImport.id,
        mission_id: existingImport.mission_id,
        source_path: existingImport.source_path,
        file_name: existingImport.file_name,
        display_name: existingImport.display_name,
        geometry_json: existingImport.geometry_json,
        metadata_json: writeGpxImportColorMetadata(existingImport.metadata_json, color),
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
        state.watchedDirectories.includes(normalizedPath) ||
        dependencies.watchSource === undefined
      ) {
        return []
      }

      state = {
        ...state,
        watchedDirectories: [...state.watchedDirectories, normalizedPath],
      }
      publishRuntime()

      if (
        dependencies.gpxStore.importGpxEvidencePaths !== undefined
        && dependencies.watchSource.listDirectoryPaths !== undefined
      ) {
        return await importPathsIntoRuntime(
          await dependencies.watchSource.listDirectoryPaths(normalizedPath),
        )
      }
      return await importFilesIntoRuntime(
        await dependencies.watchSource.listDirectoryFiles(normalizedPath),
      )
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
      if (dependencies.watchSource === undefined || state.watchedDirectories.length === 0) {
        return []
      }

      const imported: GpxTrackImport[] = []
      for (const directoryPath of state.watchedDirectories) {
        if (
          dependencies.gpxStore.importGpxEvidencePaths !== undefined
          && dependencies.watchSource.listDirectoryPaths !== undefined
        ) {
          imported.push(...(await importPathsIntoRuntime(
            await dependencies.watchSource.listDirectoryPaths(directoryPath),
          )))
        } else {
          imported.push(...(await importFilesIntoRuntime(
            await dependencies.watchSource.listDirectoryFiles(directoryPath),
          )))
        }
      }

      return imported
    },
    deleteImport: async (importId: string) => {
      const missionId = state.activeMissionId
      const token = refreshToken
      const ownedImport = state.imports.find((entry) => entry.id === importId)
      if (missionId === null || ownedImport?.mission_id !== missionId) return false
      const didDelete = await dependencies.gpxStore.deleteGpxImport(importId)
      if (!didDelete) {
        return false
      }

      if (token !== refreshToken || state.activeMissionId !== missionId) return true

      state = {
        ...state,
        imports: state.imports.filter((entry) => entry.id !== importId),
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
  ): Promise<readonly GpxTrackImport[]> {
    if (state.activeMissionId === null || files.length === 0) {
      return []
    }

    state = {
      ...state,
      importing: true,
      error: null,
    }
    publishRuntime()

    const missionId = state.activeMissionId
    const missionToken = refreshToken

    try {
      if (missionId === null) {
        state = {
          ...state,
          importing: false,
        }
        publishRuntime()
        return []
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

      for (const file of files) {
        if (missionToken !== refreshToken || state.activeMissionId !== missionId) return []
        const existingAtPath = existingByPath.get(file.sourcePath)
        if (existingAtPath !== undefined && existingAtPath.content_sha256 == null) continue
        const parsed = parseGpxFile(file)
        const contentSha256 = await digestGpxSource({
          contents: file.contents,
          ...(file.bytesBase64 === undefined ? {} : { bytesBase64: file.bytesBase64 }),
        })
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
        if (missionToken !== refreshToken || state.activeMissionId !== missionId) return []
        existingByPath.set(nextImport.source_path, nextImport)
        if (nextImport.content_sha256 != null) existingByHash.set(nextImport.content_sha256, nextImport)
        importedHashByPath.set(file.sourcePath, contentSha256)
        imported.push(nextImport)
      }

      state = {
        ...state,
        importing: false,
        imports: [...state.imports, ...imported].sort((left, right) =>
          left.display_name.localeCompare(right.display_name),
        ),
        error: null,
      }
      publishRuntime()
      return imported
    } catch (error) {
      if (state.activeMissionId !== missionId || missionToken !== refreshToken) return []
      state = {
        ...state,
        importing: false,
        error: toErrorMessage(error),
      }
      publishRuntime()
      throw error
    }
  }

  async function importPathsIntoRuntime(paths: readonly string[]): Promise<readonly GpxTrackImport[]> {
    const missionId = state.activeMissionId
    const missionToken = refreshToken
    if (missionId === null || paths.length === 0 || dependencies.gpxStore.importGpxEvidencePaths === undefined) {
      return []
    }
    state = { ...state, importing: true, error: null }
    publishRuntime()
    try {
      const result = await dependencies.gpxStore.importGpxEvidencePaths({ missionId, paths })
      if (missionToken !== refreshToken || state.activeMissionId !== missionId) return []
      const imports = await dependencies.gpxStore.listGpxImports(missionId)
      if (missionToken !== refreshToken || state.activeMissionId !== missionId) return []
      const importedIds = new Set(result.imports.map((entry) => entry.id))
      const failures = 'failures' in result && Array.isArray(result.failures) ? result.failures : []
      state = {
        ...state,
        importing: false,
        imports,
        error: failures.length === 0
          ? null
          : `${failures.length} GPX file${failures.length === 1 ? '' : 's'} could not be imported. Exact failure provenance was retained.`,
      }
      publishRuntime()
      return imports.filter((entry) => importedIds.has(entry.id))
    } catch (error) {
      if (missionToken !== refreshToken || state.activeMissionId !== missionId) return []
      state = { ...state, importing: false, error: toErrorMessage(error) }
      publishRuntime()
      throw error
    }
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
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
