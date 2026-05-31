import type { TrackingCache } from './tauri-tracking-cache'

/**
 * Creates the Electron-backed tracking cache adapter.
 */
export function createElectronTrackingCache(): TrackingCache {
  return {
    read: () => {
      const bridge = window.sartrackerElectron
      if (bridge === undefined) {
        throw new Error('Electron tracking cache bridge is not available.')
      }
      return bridge.readTrackingCache()
    },
    write: (contents) => {
      const bridge = window.sartrackerElectron
      if (bridge === undefined) {
        throw new Error('Electron tracking cache bridge is not available.')
      }
      return bridge.writeTrackingCache(contents)
    },
  }
}
