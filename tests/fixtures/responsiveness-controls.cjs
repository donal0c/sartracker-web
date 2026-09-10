const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 800, height: 600 })
  await window.loadURL('data:text/html,<button data-testid="open-devices-workspace" style="position:absolute;left:20px;top:20px;width:160px;height:40px">Devices</button>')
})
