import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import type { GpxImportFileInput } from '../../features/gpx/start-gpx-runtime'

export type GpxImportSource = {
  readonly chooseFilePaths: () => Promise<readonly string[]>
  readonly chooseDirectoryPath: () => Promise<string | null>
  readonly readFiles: (paths: readonly string[]) => Promise<readonly GpxImportFileInput[]>
  readonly listDirectoryFiles: (directoryPath: string) => Promise<readonly GpxImportFileInput[]>
}

/**
 * Wraps desktop-native GPX file/folder selection and file loading for the GPX runtime.
 */
export function createTauriGpxImportSource(): GpxImportSource {
  return {
    chooseFilePaths: async () => normalizePaths(await openGpxFilesDialog()),
    chooseDirectoryPath: async () => normalizeDirectory(await openGpxDirectoryDialog()),
    readFiles: async (paths) =>
      invoke<readonly GpxImportFileInput[]>('read_gpx_files', { paths: [...paths] }),
    listDirectoryFiles: async (directoryPath) =>
      invoke<readonly GpxImportFileInput[]>('list_gpx_directory_files', { directoryPath }),
  }
}

async function openGpxFilesDialog(): Promise<string | string[] | null> {
  return await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'GPX tracks', extensions: ['gpx'] }],
  })
}

async function openGpxDirectoryDialog(): Promise<string | string[] | null> {
  return await open({
    multiple: false,
    directory: true,
  })
}

function normalizePaths(selection: string | string[] | null): readonly string[] {
  if (selection === null) {
    return []
  }

  return (Array.isArray(selection) ? selection : [selection]).filter(
    (path): path is string => typeof path === 'string' && path.trim() !== '',
  )
}

function normalizeDirectory(selection: string | string[] | null): string | null {
  const [directory] = normalizePaths(selection)
  return directory ?? null
}
