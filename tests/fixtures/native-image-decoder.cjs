const { app, BrowserWindow } = require('electron')

const decoderPath = process.env.SARTRACKER_DECODER_PATH
if (typeof decoderPath !== 'string' || decoderPath.trim() === '') {
  throw new Error('SARTRACKER_DECODER_PATH is required for the native image decoder fixture.')
}

globalThis.__SARTRACKER_NATIVE_IMAGE_DECODER__ = require(decoderPath)

let window
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 800, height: 600 })
  await window.loadURL('data:text/html,<main data-testid="native-image-decoder-ready">ready</main>')
})
