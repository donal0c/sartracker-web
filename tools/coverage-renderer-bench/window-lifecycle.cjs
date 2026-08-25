/** Registers one idempotent teardown callback for the benchmark renderer. */
function attachRendererTeardown(window, onDestroyed) {
  let detached = false
  const detach = () => {
    if (detached) return
    detached = true
    onDestroyed()
  }
  window.once('closed', detach)
  window.webContents.once('destroyed', detach)
}

/** Reads one renderer working-set sample without leaking destruction races. */
function readRendererRssBytes(window, getAppMetrics) {
  if (window === null) return 0
  try {
    if (window.isDestroyed()) return 0
    const webContents = window.webContents
    if (webContents.isDestroyed()) return 0
    const rendererPid = webContents.getOSProcessId()
    if (!Number.isSafeInteger(rendererPid) || rendererPid <= 0) return 0
    const metric = getAppMetrics().find((candidate) => candidate.pid === rendererPid)
    return (metric?.memory?.workingSetSize ?? 0) * 1024
  } catch (error) {
    if (isDestroyedElectronObjectError(error)) return 0
    throw error
  }
}

/** Sends a streamed event only while the benchmark renderer remains alive. */
function sendWorkerEvent(window, message) {
  if (window === null) return false
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return false
    window.webContents.send('coverage-bench:worker-event', message)
    return true
  } catch (error) {
    if (isDestroyedElectronObjectError(error)) return false
    throw error
  }
}

/** Identifies Electron's documented destroyed-object failure at lifecycle boundaries. */
function isDestroyedElectronObjectError(error) {
  return error instanceof Error && /object has been destroyed/i.test(error.message)
}

module.exports = {
  attachRendererTeardown,
  readRendererRssBytes,
  sendWorkerEvent,
}
