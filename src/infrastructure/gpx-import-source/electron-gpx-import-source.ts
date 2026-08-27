import type { GpxImportSource } from './tauri-gpx-import-source'

/**
 * Wraps Electron-native GPX path selection without exposing exact bytes to the renderer.
 */
export function createElectronGpxImportSource(): GpxImportSource {
  return {
    chooseFilePaths: () => getBridge().chooseGpxFilePaths(),
    chooseDirectoryPath: () => getBridge().chooseGpxDirectoryPath(),
    readFiles: async () => {
      throw new Error('Raw GPX file reads are not available to the Electron renderer.')
    },
    listDirectoryFiles: async () => {
      throw new Error('Raw GPX directory reads are not available to the Electron renderer.')
    },
    listDirectoryPaths: (directoryPath) =>
      getBridge().listGpxDirectoryPaths(directoryPath),
  }
}

function getBridge() {
  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron GPX bridge is not available.')
  }
  return bridge
}
