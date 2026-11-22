'use strict'

/**
 * IPC for watched GPX folders saved per mission [DON-337].
 *
 * The main process owns the saved list. Loading a mission's list re-allows
 * those folders for listing, because the operator chose them before the
 * restart. Saving accepts only folders the operator chose in this session (or
 * restored from the saved list), so the renderer cannot widen file access.
 */

const LOAD_WATCHED_GPX_FOLDERS_CHANNEL = 'sartracker:load-watched-gpx-folders'
const SAVE_WATCHED_GPX_FOLDERS_CHANNEL = 'sartracker:save-watched-gpx-folders'

/**
 * Registers the load and save handlers.
 * @param {{
 *   ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void },
 *   validateIpcSender: (event: unknown) => void,
 *   watchedFolderStore: { loadWatchedGpxFolders: (missionId: unknown) => Promise<{ paths: string[] }>, saveWatchedGpxFolders: (input: unknown) => Promise<{ paths: string[] }> },
 *   fileSystem: { assertWatchableGpxDirectory: (path: string) => void, restoreWatchedGpxDirectory: (path: string) => void },
 * }} options
 */
function registerGpxWatchedFolderHandlers(options) {
  const { ipcMain, validateIpcSender, watchedFolderStore, fileSystem } = options
  ipcMain.handle(LOAD_WATCHED_GPX_FOLDERS_CHANNEL, async (event, missionId) => {
    validateIpcSender(event)
    const saved = await watchedFolderStore.loadWatchedGpxFolders(missionId)
    for (const directoryPath of saved.paths) fileSystem.restoreWatchedGpxDirectory(directoryPath)
    return saved
  })
  ipcMain.handle(SAVE_WATCHED_GPX_FOLDERS_CHANNEL, async (event, input) => {
    validateIpcSender(event)
    const paths = typeof input === 'object' && input !== null && Array.isArray(input.paths) ? input.paths : null
    if (paths !== null) {
      for (const directoryPath of paths) fileSystem.assertWatchableGpxDirectory(directoryPath)
    }
    return await watchedFolderStore.saveWatchedGpxFolders(input)
  })
}

module.exports = {
  LOAD_WATCHED_GPX_FOLDERS_CHANNEL,
  SAVE_WATCHED_GPX_FOLDERS_CHANNEL,
  registerGpxWatchedFolderHandlers,
}
