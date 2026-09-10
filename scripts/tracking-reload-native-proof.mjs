import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const evidence = resolve(process.env.TRAIN_A_OUTPUT ?? 'output/repair-train-a/native-red')
await mkdir(evidence, { recursive: true })
const control = process.argv.includes('--control')
const prefix = control ? 'tracking-reload-native-control' : 'tracking-reload-native'
const appRoot = process.cwd()
const profile = resolve(evidence, `tracking-reload-native-profile-${Date.now()}`)
await mkdir(profile, { recursive: true })
let holdNext = false, sessions = 0, currentRequests = 0, historyRequests = 0
let holdReplacement = false
let injectReplacementRejections = false
const replacementHeld = []
const held = [], emitted = [], events = []
const rosterLastUpdate = new Date().toISOString()
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
  if (url.pathname === '/api/session') { sessions++; events.push({ event: 'session', sessions, at: Date.now() }); send({ id: 1, name: 'Synthetic audit' }); return }
  if (url.pathname === '/api/devices') { send([{ id: 1, name: 'Synthetic Alpha', uniqueId: 'audit-1', status: 'online', lastUpdate: process.argv.includes('--changing-roster') ? new Date().toISOString() : rosterLastUpdate }]); return }
  if (url.pathname === '/api/groups') { send([]); return }
  if (url.pathname === '/api/positions' && url.searchParams.has('deviceId')) {
    historyRequests++; const from = Date.parse(url.searchParams.get('from')), to = Date.parse(url.searchParams.get('to'))
    send(emitted.filter((entry) => Date.parse(entry.fixTime) >= from && Date.parse(entry.fixTime) <= to)); return
  }
  if (url.pathname === '/api/positions') {
    currentRequests++
    const point = { id: 1000 + currentRequests, deviceId: 1, latitude: 52 + currentRequests / 100000,
      longitude: -9.7, fixTime: new Date().toISOString(), valid: true, accuracy: 4, attributes: {} }
    const rows = injectReplacementRejections ? [point, { ...point, id: point.id + 10_000, latitude: 100 }] : [point]
    if (holdNext) { holdNext = false; held.push(() => { emitted.push(point); send(rows) }); events.push({ event: 'held-current', id: point.id, at: Date.now() }); return }
    if (holdReplacement) { replacementHeld.push(() => { emitted.push(point); send(rows); events.push({ event: 'sent-replacement', id: point.id, at: Date.now() }) }); return }
    emitted.push(point); events.push({ event: 'sent-current', id: point.id, at: Date.now() }); send(rows); return
  }
  send([])
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const { createElectronSettingsStore } = require(resolve(appRoot, 'electron/settings-store.cjs'))
const settingsStore = createElectronSettingsStore({ userDataPath: profile })
const settings = await settingsStore.loadAppSettings()
await settingsStore.saveAppSettings({ ...settings,
  missionDefaults: { ...settings.missionDefaults, autoRefreshIntervalSeconds: 5, autoSaveEnabled: false },
  dataSource: { ...settings.dataSource, providerType: 'traccar_http', baseUrl: origin, authMode: 'basic',
    email: 'synthetic-audit', secretInput: 'synthetic-audit', autoConnect: true, trackingCacheEnabled: false },
})
const app = await electron.launch({ executablePath: process.env.TRAIN_A_EXECUTABLE ?? resolve(appRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: process.env.TRAIN_A_EXECUTABLE === undefined ? [resolve(appRoot, 'electron/main.cjs')] : [],
  env: { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }, timeout: 20000 })
const appLog = []; app.process().stderr?.on('data', (data) => appLog.push(String(data)))
const errors = []
async function waitFor(predicate, timeout = 10000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) throw new Error('audit condition timed out'); await new Promise((done) => setTimeout(done, 30)) } }
try {
  const page = await app.firstWindow(); page.on('pageerror', (error) => errors.push(error.message))
  await page.getByTestId('app-title').waitFor({ timeout: 20000 })
  await page.getByTestId('participant-device-picker').getByRole('checkbox').waitFor()
  await page.getByTestId('participant-device-picker').getByRole('checkbox').check()
  await page.getByTestId('mission-name-input').fill('Synthetic overlapping reload audit')
  await waitFor(() => currentRequests >= 1)
  await page.getByTestId('mission-start-btn').click()
  await page.getByTestId('open-devices-workspace').click()
  await page.getByTestId('device-status-1').waitFor()
  await page.getByTestId('workspace-close-btn').click()
  holdNext = true
  await waitFor(() => held.length === 1)
  injectReplacementRejections = process.argv.includes('--replacement-rejection')
  holdReplacement = true
  await page.getByTestId('open-settings-workspace').click()
  await page.getByTestId('settings-save-connect').click()
  await page.getByTestId('settings-workspace').waitFor({ state: 'hidden' })
  await new Promise((done) => setTimeout(done, 70))
  await page.getByTestId('open-devices-workspace').click()
  if (!control) {
    await page.getByTestId('devices-refresh-btn').click()
    await new Promise((done) => setTimeout(done, 300))
  }
  await new Promise((done) => setTimeout(done, 150))
  await page.screenshot({ path: resolve(evidence, `${prefix}-reconnecting.png`) })
  const reconnectingStatus = await page.getByTestId('device-status-1').innerText()
  const reconnectingSource = await page.getByTestId('device-source-1').innerText()
  const replacementStartedAt = Date.now()
  holdReplacement = false
  replacementHeld.splice(0).forEach((release) => release())
  await waitFor(async () => {
    const replacement = events.filter(entry => entry.event === 'sent-replacement' || entry.event === 'sent-current').at(-1)
    if (!replacement || replacement.id <= events.find(entry => entry.event === 'held-current').id) return false
    return (await page.getByTestId('devices-inspector').innerText()).includes((52 + (replacement.id - 1000) / 100000).toFixed(5))
  }, 5000)
  const replacementRenderedMs = Date.now() - replacementStartedAt
  events.push({ event: 'replacement-rendered-before-old-release', replacementRenderedMs, at: Date.now() })
  if (injectReplacementRejections) {
    await page.getByTestId('device-ingest-warning-1').waitFor()
    // Hold later replacement responses so they cannot mask an old response
    // incorrectly clearing the selected rejection warning.
    holdReplacement = true
  }
  events.push({ event: 'release-old-current', at: Date.now() })
  held.splice(0).forEach((release) => release())
  await new Promise((done) => setTimeout(done, 300))
  const rejectionWarningRetained = !injectReplacementRejections || await page.getByTestId('device-ingest-warning-1').isVisible()
  if (injectReplacementRejections) {
    await page.screenshot({ path: resolve(evidence, `${prefix}-retained-rejection.png`) })
    holdReplacement = false
    replacementHeld.splice(0).forEach((release) => release())
  }
  await new Promise((done) => setTimeout(done, 500))
  const requestsAtSettledRace = currentRequests
  try { await waitFor(() => currentRequests >= requestsAtSettledRace + 2, 15000) }
  catch { events.push({ event: 'no-two-later-polls', requestsAtSettledRace, currentRequests, at: Date.now() }) }
  await new Promise((done) => setTimeout(done, 300))
  const state = await page.evaluate(async () => {
    const missions = await window.sartrackerElectron.missionStore.listMissions()
    const mission = missions.find((entry) => entry.name === 'Synthetic overlapping reload audit')
    return { missionId: mission.id, positions: await window.sartrackerElectron.missionStore.listPositions(mission.id),
      health: await window.sartrackerElectron.missionStore.getIngestEvidenceHealth(mission.id) }
  })
  const result = { proof: `${process.env.TRAIN_A_EXECUTABLE ? 'Packaged Electron executable' : 'Development Electron'}; actual Settings Save Connect and Devices Reconnect; local synthetic HTTP provider holds one current response; actual bulk SQLite/custody/runtime/pollers; no importer/runtime/controller mocks; bounded local proof, not release qualification`, control, profile,
    executable: process.env.TRAIN_A_EXECUTABLE ?? null, replacementRenderedMs, reconnectingStatus, reconnectingSource,
    injectReplacementRejections, rejectionWarningRetained,
    sessions, currentRequests, historyRequests, emittedIds: emitted.map((point) => point.id), events,
    persistedIds: state.positions.map((point) => point.source_position_id), health: state.health,
    body: (await page.locator('body').innerText()).slice(-10000), errors }
  await page.screenshot({ path: resolve(evidence, `${prefix}.png`) })
  if (!control) {
    const beforeRetry = currentRequests
    await page.getByTestId('devices-refresh-btn').click()
    await waitFor(() => currentRequests >= beforeRetry + 2)
    await new Promise((done) => setTimeout(done, 300))
    result.retry = await page.evaluate(async () => {
      const missions = await window.sartrackerElectron.missionStore.listMissions()
      const mission = missions.find((entry) => entry.name === 'Synthetic overlapping reload audit')
      const positions = await window.sartrackerElectron.missionStore.listPositions(mission.id)
      return { persistedIds: positions.map((point) => point.source_position_id),
        body: document.body.innerText.slice(-6000) }
    })
    result.retry.currentRequests = currentRequests
    await page.screenshot({ path: resolve(evidence, `${prefix}-retry.png`) })
  }
  await writeFile(resolve(evidence, `${prefix}-result.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ sessions, currentRequests: result.currentRequests, requestsAtSettledRace, errors, recoveredAutomatically: result.currentRequests > requestsAtSettledRace + 1, health: result.health }))
  if (events.some(entry => entry.event === 'no-two-later-polls')) throw new Error('AUD-13: tracking did not automatically resume after overlapping reloads')
  if (result.health.state !== 'healthy') throw new Error('AUD-13: native evidence health is not healthy')
  if (!result.persistedIds.includes(String(events.find(entry => entry.event === 'held-current').id))) throw new Error('AUD-13: held source fix was not retained')
  if (reconnectingStatus.toLowerCase() === 'online') throw new Error('AUD-13: retained position remained ONLINE while reconnecting')
  if (reconnectingSource !== 'Last known') throw new Error('AUD-13: retained position was not labelled Last known while reconnecting')
  if (!rejectionWarningRetained) throw new Error('AUD-13: retiring response cleared the selected rejection warning')
} finally {
  holdReplacement = false
  replacementHeld.splice(0).forEach((release) => release())
  held.splice(0).forEach((release) => release())
  await writeFile(resolve(evidence, `${prefix}-events.json`), JSON.stringify({ profile, sessions, currentRequests, historyRequests, events }, null, 2))
  await writeFile(resolve(evidence, `${prefix}-app.log`), appLog.join(''))
  // A native startup-fault dialog can block normal quit. This deadline owns
  // only the synthetic process launched above and preserves its profile/logs.
  const shutdownDeadline = setTimeout(() => app.process().kill('SIGKILL'), 5000)
  try { await app.close() }
  finally {
    clearTimeout(shutdownDeadline)
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
}
