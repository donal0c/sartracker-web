import type { GpxWatchedFolderStoreBoundary } from '../../features/gpx/start-gpx-runtime'

/**
 * Saves watched GPX folders per mission through the Electron main process, so
 * a watch survives a restart [DON-337]. The main process owns the file and
 * re-allows the saved folders for listing when a mission loads them.
 */
export function createElectronGpxWatchedFolderStore(): GpxWatchedFolderStoreBoundary {
  return {
    loadWatchedFolders: async (missionId) => {
      const saved = await getBridge().loadWatchedGpxFolders(missionId)
      return { paths: saved.paths, warning: saved.warning ?? null }
    },
    saveWatchedFolders: async (missionId, paths) => {
      const result = await getBridge().saveWatchedGpxFolders({ missionId, paths })
      return { backupWarning: result.warning ?? null }
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
