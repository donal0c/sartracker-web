const { app, BrowserWindow } = require('electron')
// Retain the native window across deliberate allocation/GC-heavy stall controls.
let window
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 800, height: 600 })
  await window.loadURL('data:text/html,<button data-testid="open-devices-workspace" style="position:absolute;left:20px;top:20px;width:160px;height:40px">Devices</button>')
})
