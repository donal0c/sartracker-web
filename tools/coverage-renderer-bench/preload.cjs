const { contextBridge, ipcRenderer } = require('electron')

let fatalReported = false

/** Ensures a renderer bootstrap failure terminates the orchestrated run loudly. */
function reportFatal(message) {
  if (fatalReported) return
  fatalReported = true
  void ipcRenderer.invoke('coverage-bench:fail', String(message)).catch(() => {})
}

window.addEventListener('error', (event) => reportFatal(event.error?.message ?? event.message))
window.addEventListener('unhandledrejection', (event) =>
  reportFatal(event.reason instanceof Error ? event.reason.message : event.reason))

contextBridge.exposeInMainWorld('coverageBench', {
  getConfig: () => ipcRenderer.invoke('coverage-bench:get-config'),
  start: () => ipcRenderer.invoke('coverage-bench:start'),
  primeInvalidation: () => ipcRenderer.invoke('coverage-bench:prime-invalidation'),
  attestPane: (bounds) => ipcRenderer.invoke('coverage-bench:attest-pane', bounds),
  appendLateBatch: () => ipcRenderer.invoke('coverage-bench:append-late-batch'),
  readTile: (request) => ipcRenderer.invoke('coverage-bench:read-tile', request),
  readMainSamples: () => ipcRenderer.invoke('coverage-bench:read-main-samples'),
  readMemory: () => ipcRenderer.invoke('coverage-bench:read-memory'),
  finish: (result) => ipcRenderer.invoke('coverage-bench:finish', result),
  fail: (message) => ipcRenderer.invoke('coverage-bench:fail', message),
  killAtFirstUseful: (progress) => ipcRenderer.invoke('coverage-bench:kill-at-first-useful', progress),
  onWorkerEvent: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('coverage-bench:worker-event', handler)
    return () => ipcRenderer.removeListener('coverage-bench:worker-event', handler)
  },
})
