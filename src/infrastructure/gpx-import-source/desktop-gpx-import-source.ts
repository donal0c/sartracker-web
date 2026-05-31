import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { createElectronGpxImportSource } from './electron-gpx-import-source'
import { createTauriGpxImportSource, type GpxImportSource } from './tauri-gpx-import-source'

/**
 * Creates the GPX import source for the active desktop runtime.
 */
export function createDesktopGpxImportSource(): GpxImportSource {
  return isElectronRuntimeAvailable()
    ? createElectronGpxImportSource()
    : createTauriGpxImportSource()
}
