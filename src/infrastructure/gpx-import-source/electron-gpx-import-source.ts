import type { GpxImportSource } from './tauri-gpx-import-source'

/**
 * Wraps Electron-native GPX file/folder selection and file loading.
 */
export function createElectronGpxImportSource(): GpxImportSource {
  return {
    chooseFilePaths: () => getBridge().chooseGpxFilePaths(),
    chooseDirectoryPath: () => getBridge().chooseGpxDirectoryPath(),
    readFiles: (paths) => getBridge().readGpxFiles(paths),
    listDirectoryFiles: (directoryPath) =>
      getBridge().listGpxDirectoryFiles(directoryPath),
  }
}

function getBridge() {
  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron GPX bridge is not available.')
  }
  return bridge
}
