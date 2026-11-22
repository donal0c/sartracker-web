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
 * Registers the load and save handlers. Each failure is logged as a structured
 * warning (folder count and reason, never folder paths) before it reaches the
 * renderer, which shows it to the operator.
 * @param {{
 *   ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void },
 *   validateIpcSender: (event: unknown) => void,
 *   watchedFolderStore: { loadWatchedGpxFolders: (missionId: unknown) => Promise<{ paths: string[], warning?: string }>, saveWatchedGpxFolders: (input: unknown) => Promise<{ paths: string[], warning?: string }> },
 *   fileSystem: { assertWatchableGpxDirectory: (path: string) => void, restoreWatchedGpxDirectory: (path: string) => void },
 *   logEvent: (entry: { level: 'warn', event: string, fields: Record<string, unknown> }) => Promise<unknown> | unknown,
 * }} options
 */
function registerGpxWatchedFolderHandlers(options) {
  const { ipcMain, validateIpcSender, watchedFolderStore, fileSystem, logEvent } = options

  /**
   * Logs without letting a logging failure hide the original error.
   * @param {string} event
   * @param {Record<string, unknown>} fields
   */
  async function warn(event, fields) {
    try {
      await logEvent({ level: 'warn', event, fields })
    } catch {
      // The operator still sees the original error in the renderer.
    }
  }

  ipcMain.handle(LOAD_WATCHED_GPX_FOLDERS_CHANNEL, async (event, missionId) => {
    validateIpcSender(event)
    let saved = { paths: [] }
    try {
      saved = await watchedFolderStore.loadWatchedGpxFolders(missionId)
      for (const directoryPath of saved.paths) fileSystem.restoreWatchedGpxDirectory(directoryPath)
    } catch (error) {
      await warn('gpx_watched_folders_load_failed', { reason: redactPaths(describeError(error), saved.paths) })
      throw error
    }
    if (saved.warning !== undefined) {
      await warn('gpx_watched_folders_restored_from_backup', { folderCount: saved.paths.length })
    }
    return saved
  })
  ipcMain.handle(SAVE_WATCHED_GPX_FOLDERS_CHANNEL, async (event, input) => {
    validateIpcSender(event)
    const paths = typeof input === 'object' && input !== null && Array.isArray(input.paths) ? input.paths : null
    try {
      if (paths !== null) {
        for (const directoryPath of paths) fileSystem.assertWatchableGpxDirectory(directoryPath)
      }
      const result = await watchedFolderStore.saveWatchedGpxFolders(input)
      if (result.warning !== undefined) {
        await warn('gpx_watched_folders_backup_failed', { folderCount: result.paths.length, reason: redactPaths(result.warning, result.paths) })
        // The operator is told too: the list saved, its backup needs attention.
        return { paths: result.paths, warning: result.warning }
      }
      return { paths: result.paths }
    } catch (error) {
      await warn('gpx_watched_folders_save_failed', {
        folderCount: paths === null ? null : paths.length,
        reason: redactPaths(describeError(error), paths ?? []),
      })
      throw error
    }
  })
}

/**
 * Replaces folder paths in a message, so logs never carry machine paths.
 * @param {string} message
 * @param {readonly unknown[]} paths
 */
function redactPaths(message, paths) {
  let redacted = message
  for (const entry of paths) {
    if (typeof entry === 'string' && entry.length > 0) redacted = redacted.split(entry).join('<folder>')
  }
  return redacted
}

/** @param {unknown} error */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = {
  LOAD_WATCHED_GPX_FOLDERS_CHANNEL,
  SAVE_WATCHED_GPX_FOLDERS_CHANNEL,
  registerGpxWatchedFolderHandlers,
}
