'use strict'

/** IPC channel the renderer uses once React has committed its first screen. */
const RENDERER_MOUNTED_CHANNEL = 'sartracker:renderer-mounted'

/** Startup watchdog stage name for the wait on the first mounted screen. */
const RENDERER_MOUNT_STAGE = 'map screen start'

/**
 * Waits for the operational renderer to report that its first screen mounted
 * [DON-354]. Electron's load events only prove the HTML arrived; if the entry
 * script or one of its imports fails, nothing mounts and the window stays
 * blank. Startup must hold this gate inside its deadline so that case reaches
 * the visible startup fault screen instead of a silent blank window.
 *
 * Register the gate before loading the page: the signal can arrive before the
 * load promise settles.
 *
 * @param {{
 *   ipcMain: { on: Function, removeListener: Function },
 *   webContents: { id: number },
 * }} dependencies
 * @returns {{ mounted: Promise<void>, dispose: () => void }}
 */
function createRendererMountGate({ ipcMain, webContents }) {
  if (ipcMain === null || typeof ipcMain !== 'object' || typeof ipcMain.on !== 'function') {
    throw new Error('Renderer mount gate needs the Electron IPC main object.')
  }
  if (webContents === null || typeof webContents !== 'object' || !Number.isInteger(webContents.id)) {
    throw new Error('Renderer mount gate needs the operational window contents.')
  }
  let disposed = false
  let resolveMounted
  const mounted = new Promise((resolve) => {
    resolveMounted = resolve
  })

  /** Accepts the signal only from the operational window being started. */
  function handleMounted(event) {
    if (event?.sender?.id !== webContents.id) return
    resolveMounted()
    dispose()
  }

  /** Stops listening; safe to call more than once. */
  function dispose() {
    if (disposed) return
    disposed = true
    ipcMain.removeListener(RENDERER_MOUNTED_CHANNEL, handleMounted)
  }

  ipcMain.on(RENDERER_MOUNTED_CHANNEL, handleMounted)
  return { mounted, dispose }
}

module.exports = {
  RENDERER_MOUNTED_CHANNEL,
  RENDERER_MOUNT_STAGE,
  createRendererMountGate,
}
