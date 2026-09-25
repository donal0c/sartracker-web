const path = require('node:path')

const STARTUP_FAILURE_CLOSE_CHANNEL = 'sartracker:startup-failure-close'
const WINDOW_OPTIONS = Object.freeze({
  title: 'SAR Tracker could not start',
  width: 620,
  height: 360,
  minWidth: 520,
  minHeight: 320,
  center: true,
  show: false,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  autoHideMenuBar: true,
  backgroundColor: '#f8fafc',
  webPreferences: Object.freeze({
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'startup-failure-preload.cjs'),
    sandbox: true,
    webSecurity: true,
    devTools: false,
  }),
})
const activeStartupFailureWindows = new Set()

/** Builds a self-contained startup fault page without interpreting operator text as HTML. */
function createStartupFailureDataUrl(message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('Startup failure window requires an operator message.')
  }
  const safeMessage = escapeHtml(message)
  const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>SAR Tracker could not start</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #17212f; }
    main { min-height: 100vh; display: flex; flex-direction: column; padding: 30px 34px 24px; }
    h1 { margin: 0 0 18px; font-size: 23px; line-height: 1.25; font-weight: 650; }
    p { margin: 0; font-size: 15px; line-height: 1.55; white-space: pre-wrap; }
    footer { display: flex; justify-content: center; margin-top: auto; padding-top: 24px; }
    button { width: 142px; height: 40px; padding: 0; border: 1px solid #173b65; border-radius: 5px; background: #173b65; color: white; font: inherit; font-weight: 600; cursor: pointer; }
    button:focus-visible { outline: 3px solid #f2ae37; outline-offset: 3px; }
  </style>
</head>
<body>
  <main role="alert" aria-labelledby="startup-heading">
    <h1 id="startup-heading">SAR Tracker could not start</h1>
    <p>${safeMessage}</p>
    <footer><button id="close" type="button">Close and exit</button></footer>
  </main>
  <script>
    document.getElementById('close').addEventListener('click', () => window.sarTrackerStartupFailure.close())
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.sarTrackerStartupFailure.close()
    })
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
}

/** Shows the isolated operator fault window and resolves when the operator closes it. */
function showStartupFailureWindow(options) {
  if (typeof options?.BrowserWindow !== 'function') {
    return Promise.reject(new Error('Startup failure window requires Electron BrowserWindow.'))
  }
  if (typeof options?.ipcMain?.on !== 'function' || typeof options.ipcMain.removeListener !== 'function') {
    return Promise.reject(new Error('Startup failure window requires the Electron main-process IPC adapter.'))
  }
  let pageUrl
  try {
    pageUrl = createStartupFailureDataUrl(options.message)
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    let window
    let settled = false
    let closeActionRegistered = false
    const closeActionListener = (event) => {
      if (event?.sender !== window?.webContents) return
      window.close()
    }
    const settle = (action, value) => {
      if (settled) return
      settled = true
      if (window !== undefined) activeStartupFailureWindows.delete(window)
      if (closeActionRegistered) {
        options.ipcMain.removeListener(STARTUP_FAILURE_CLOSE_CHANNEL, closeActionListener)
        closeActionRegistered = false
      }
      action(value)
    }
    try {
      window = new options.BrowserWindow(WINDOW_OPTIONS)
      activeStartupFailureWindows.add(window)
      // The fault page is the operator's only message; nothing may replace it.
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      options.ipcMain.on(STARTUP_FAILURE_CLOSE_CHANNEL, closeActionListener)
      closeActionRegistered = true
      window.once('closed', () => settle(resolve))
      Promise.resolve(window.loadURL(pageUrl)).then(
        () => {
          if (!settled) window.show()
        },
        (error) => {
          if (settled) return
          // Settle first: Electron's destroy() emits 'closed' synchronously,
          // which would otherwise report this load failure as an operator close
          // and suppress the caller's native-dialog fallback.
          settle(reject, error)
          try {
            window.destroy()
          } catch {
            // The load failure is already reported to the caller.
          }
        },
      )
    } catch (error) {
      settle(reject, error)
      if (window !== undefined) {
        try {
          window.destroy()
        } catch {
          // The window-creation failure is already reported to the caller.
        }
      }
    }
  })
}

/**
 * Closes every open startup fault window through its normal close path, so an
 * app-level quit request is handled exactly like the operator's dismissal.
 */
function closeStartupFailureWindows() {
  for (const window of [...activeStartupFailureWindows]) {
    try {
      window.close()
    } catch {
      // A window that cannot close keeps waiting for the operator's action.
    }
  }
}

/** Escapes HTML metacharacters in the safe operator message. */
function escapeHtml(value) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

module.exports = {
  closeStartupFailureWindows,
  createStartupFailureDataUrl,
  showStartupFailureWindow,
}
