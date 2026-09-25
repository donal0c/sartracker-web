const { contextBridge, ipcRenderer } = require('electron')

/** Sends the isolated startup fault window's explicit close request to main. */
function closeStartupFailureWindow() {
  ipcRenderer.send('sartracker:startup-failure-close')
}

contextBridge.exposeInMainWorld('sarTrackerStartupFailure', Object.freeze({
  close: closeStartupFailureWindow,
}))
