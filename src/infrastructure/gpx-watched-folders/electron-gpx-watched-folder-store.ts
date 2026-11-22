import type { GpxWatchedFolderStoreBoundary } from '../../features/gpx/start-gpx-runtime'

/**
 * Saves watched GPX folders per mission through the Electron main process, so
 * a watch survives a restart [DON-337]. The main process owns the file and
 * re-allows the saved folders for listing when a mission loads them.
 */
export function createElectronGpxWatchedFolderStore(): GpxWatchedFolderStoreBoundary {
  return {
    loadWatchedFolders: async (missionId) => (await getBridge().loadWatchedGpxFolders(missionId)).paths,
    saveWatchedFolders: async (missionId, paths) => {
      await getBridge().saveWatchedGpxFolders({ missionId, paths })
    },
  }
}

function getBridge() {
  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron watched-folder bridge is not available.')
  }
  return bridge
}
