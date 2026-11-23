// DON-353: opens the real renderer in a first Electron window, isolated and
// sandboxed like the product's window, with no script injected before load.
// The renderer runs its browser harness, so no mission store is needed.
const { app, BrowserWindow } = require('electron')

let window
app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  await window.loadURL(process.env.WAR06_RENDERER_URL)
})
