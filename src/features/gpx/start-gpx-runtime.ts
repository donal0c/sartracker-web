import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'
import { writeGpxImportColorMetadata } from './gpx-style'
import { parseGpxFile } from './gpx-parser'

type GpxStoreBoundary = {
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly upsertGpxImport: (input: {
    readonly id?: string | null
    readonly mission_id: string
    readonly source_path: string
    readonly file_name: string
    readonly display_name: string
    readonly geometry_json: string
    readonly metadata_json?: string | null
  }) => Promise<GpxTrackImport>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
}

type GpxWatchSourceBoundary = {
  readonly listDirectoryFiles: (directoryPath: string) => Promise<readonly GpxImportFileInput[]>
}

export type GpxImportFileInput = {
  readonly sourcePath: string
  readonly fileName: string
  readonly contents: string
}

export type GpxRuntimeState = {
  readonly activeMissionId: string | null
  readonly imports: readonly GpxTrackImport[]
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
  readonly updateImportColor: (importId: string, color: string) => Promise<GpxTrackImport | null>
  readonly addWatchedDirectory: (directoryPath: string) => Promise<readonly GpxTrackImport[]>
  readonly removeWatchedDirectory: (directoryPath: string) => void
  readonly rescanWatchedDirectories: () => Promise<readonly GpxTrackImport[]>
  readonly deleteImport: (importId: string) => Promise<boolean>
}

const EMPTY_RUNTIME: GpxRuntimeState = {
  activeMissionId: null,
  imports: [],
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
        watchedDirectories: missionId === previousMissionId ? state.watchedDirectories : [],
        loading: missionId !== null,
        error: null,
      }
      publishRuntime()

      if (missionId === null) {
        state = {
          ...state,
          imports: [],
          watchedDirectories: [],
          loading: false,
        }
        publishRuntime()
        return
      }

      try {
        const imports = await dependencies.gpxStore.listGpxImports(missionId)
        if (token !== refreshToken || state.activeMissionId !== missionId) {
          return
        }

        state = {
          ...state,
          activeMissionId: missionId,
          imports,
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
          loading: false,
          error: toErrorMessage(error),
        }
        publishRuntime()
      }
    },
    importFiles: async (files: readonly GpxImportFileInput[]) => {
      return await importFilesIntoRuntime(files)
    },
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

      const files = await dependencies.watchSource.listDirectoryFiles(normalizedPath)
      return await importFilesIntoRuntime(files)
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
        const files = await dependencies.watchSource.listDirectoryFiles(directoryPath)
        imported.push(...(await importFilesIntoRuntime(files)))
      }

      return imported
    },
    deleteImport: async (importId: string) => {
      const didDelete = await dependencies.gpxStore.deleteGpxImport(importId)
      if (!didDelete) {
        return false
      }

      state = {
        ...state,
        imports: state.imports.filter((entry) => entry.id !== importId),
      }
      publishRuntime()
      return true
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

    try {
      const missionId = state.activeMissionId
      if (missionId === null) {
        state = {
          ...state,
          importing: false,
        }
        publishRuntime()
        return []
      }
      const existingPaths = new Set(state.imports.map((entry) => entry.source_path))
      const imported: GpxTrackImport[] = []

      for (const file of files) {
        if (existingPaths.has(file.sourcePath)) {
          continue
        }

        const parsed = parseGpxFile(file)
        const nextImport = await dependencies.gpxStore.upsertGpxImport({
          mission_id: missionId,
          source_path: parsed.sourcePath,
          file_name: parsed.fileName,
          display_name: parsed.displayName,
          geometry_json: parsed.geometryJson,
          metadata_json: parsed.metadataJson,
        })
        existingPaths.add(nextImport.source_path)
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
      state = {
        ...state,
        importing: false,
        error: toErrorMessage(error),
      }
      publishRuntime()
      throw error
    }
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'GPX import failed.'
}
