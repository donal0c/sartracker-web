#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'
import { extractFile } from '@electron/asar'
import { installMainEventLoopProbe, validateMainEventLoopEvidence } from '../build/main-event-loop-probe.js'
import { breadcrumbClientProbeScript } from '../build/breadcrumb-client-probe.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const executablePath = path.resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Pass the packaged Electron executable.')
const output = path.resolve(process.argv[3] ?? 'tmp/don254-transport/package')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'sar-breadcrumb-transport-'))
const clientSource = await readFile('src/infrastructure/mission-store/breadcrumb-query-client.ts', 'utf8')
const clientScript = await breadcrumbClientProbeScript()
const report = { passed: false,
  proofTier: 'Packaged Electron, synthetic 103626-row profile, checkout production TS client transpiled/injected over the packaged bridge/worker/main path; packaged renderer client entry not invoked; not full-candidate or field qualification',
  clientExecution: 'checkout-source-transpiled-and-injected',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  profile, executablePath, clientSourceSha256: hash(clientSource), setupClose: null, launches: [], closes: [] }
let app
try {
  if (process.env.EXPECTED_SOURCE_SHA) {
    assert.equal(report.sourceHead, process.env.EXPECTED_SOURCE_SHA)
    assert.equal(report.sourceDirty, false, 'Exact-head CI smoke requires a clean source tree.')
  }
  if (process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1') {
    assert.equal(process.platform, 'linux')
    assert.ok(executablePath.startsWith(path.resolve('tmp/electron-dist/linux-unpacked') + path.sep))
  }
  let missionId
  app = await launchPackagedApp()
  const setupPage = await app.firstWindow()
  await setupPage.getByTestId('app-title').waitFor({ timeout: 30_000 })
  missionId = await setupPage.evaluate(async () => {
    const store = window.sartrackerElectron.missionStore
    const mission = await store.createMission({ name: 'Synthetic bounded transport proof' })
    for (let index = 0; index < 32; index += 1) await store.upsertDevice({ mission_id: mission.id,
      device_id: `device-${index}`, name: `Synthetic ${index}`, color: '#00AAFF', status: 'online' })
    return mission.id
  })
  const setupProcessHandle = app.process()
  await app.close()
  report.setupClose = { code: setupProcessHandle.exitCode, signal: setupProcessHandle.signalCode }
  assert.equal(setupProcessHandle.exitCode, 0)
  assert.equal(setupProcessHandle.signalCode, null)
  app = undefined
  seedSyntheticPositions(profile, missionId)
  for (let launchIndex = 0; launchIndex < 2; launchIndex += 1) {
    app = await launchPackagedApp()
    const archivePath = await app.evaluate(({ app }) => app.getAppPath())
    assert.ok(archivePath.endsWith('.asar'), 'Use a packaged ASAR, not a dev server.')
    const archiveSha256 = hash(await readFile(archivePath))
    if (report.archiveSha256 === undefined) report.archiveSha256 = archiveSha256
    else assert.equal(archiveSha256, report.archiveSha256, 'Packaged archive changed between measured launches.')
    const files = [...await filesUnder('electron'), ...await filesUnder('dist')]
    report.packagedInputs = {}
    for (const file of files) {
      const expected = hash(await readFile(file))
      assert.equal(hash(extractFile(archivePath, file)), expected, `Packaged input differs: ${file}`)
      report.packagedInputs[file] = expected
    }
    const page = await app.firstWindow()
    const dialogFailures = []
    const dialogHandlers = []
    // Electron's unload coordinator may already have closed the Chromium dialog.
    // Own the handler so that race cannot escape Playwright as an unhandled error.
    page.on('dialog', (dialog) => {
      dialogHandlers.push(dialog.accept().catch((error) => {
        if (!String(error).includes('No dialog is showing')) dialogFailures.push(String(error))
      }))
    })
    await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
    const background = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.minimize()
      // Xvfb may have no window manager to implement minimization. Hiding still
      // exercises a backgrounded operational window with the same preferences.
      if (!window.isMinimized()) window.hide()
      return { minimized: window.isMinimized(), visible: window.isVisible(),
        throttling: window.webContents.getBackgroundThrottling() }
    })
    assert.equal(background.throttling, false, 'Operational window must disable background timer throttling.')
    assert.ok(background.minimized || !background.visible)
    const expected = await app.evaluate(({ app }, missionId) => {
      const require = process.mainModule.require.bind(process.mainModule)
      const Database = require('better-sqlite3')
      const db = new Database(require('node:path').join(app.getPath('userData'), 'mission-store.sqlite'), { readonly: true })
      const result = require(require('node:path').join(app.getAppPath(), 'electron/breadcrumb-query.cjs')).listBreadcrumbPositions(db, missionId, 5000)
      db.close()
      const replacer = (_key, value) => {
        if (typeof value !== 'number') return value
        if (Object.is(value, -0)) return { number: '-0' }
        return Number.isFinite(value) ? value : { number: String(value) }
      }
      const serialized = JSON.stringify(result, replacer)
      const signedZeroSerialization = JSON.stringify(-0, replacer)
      const positiveZeroSerialization = JSON.stringify(0, replacer)
      const sha256 = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex')
      return { count: result.positions.length, digest: sha256(serialized), signedZeroSerialization,
        signedZeroDigest: sha256(signedZeroSerialization), positiveZeroDigest: sha256(positiveZeroSerialization) }
    }, missionId)
    assert.equal(expected.count, 103_626 + launchIndex)
    await page.evaluate(clientScript)
    await app.evaluate((_electron, source) => { globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__ = eval(`(${source})()`) }, installMainEventLoopProbe.toString())
    const actual = await page.evaluate(async ({ missionId, launchIndex }) => {
      const raw = window.sartrackerElectron.missionStore
      if (raw.listBreadcrumbPositions !== undefined) throw new Error('Old whole-result bridge remains exposed.')
      let currentWriteMs = null
      let currentVisible = false
      let exactDotsDuringTransfer = false
      let exactDotQueryMs = null
      const client = globalThis.__createTransportClient({ ...raw, readBreadcrumbQueryFrame: async (input) => {
        const frame = await raw.readBreadcrumbQueryFrame(input)
        if (input.sequence === 0) {
          const started = performance.now()
          const sourceId = `transport-current-${launchIndex}`
          await raw.addPosition({ mission_id: missionId, device_id: 'device-0', source_position_id: sourceId,
            lat: 52.01, lon: -9.01, timestamp: new Date().toISOString(), timestamp_source: 'fix', data_origin: 'live' })
          currentWriteMs = performance.now() - started
          currentVisible = (await raw.latestPositions(missionId)).some((row) => row.source_position_id === sourceId)
          const dotStarted = performance.now()
          let deadline
          try {
            const dots = await Promise.race([
              raw.listExactBreadcrumbDotPage({ missionId, activeDeviceIds: ['device-0'], limit: 100,
                direction: 'latest' }, 'during-transfer'),
              new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Exact dots starved behind paused canonical transfer.')), 5000) }),
            ])
            exactDotQueryMs = performance.now() - dotStarted
            exactDotsDuringTransfer = dots.positions.some((row) => row.source_position_id === sourceId)
          } finally {
            clearTimeout(deadline)
            await raw.cancelExactBreadcrumbDotQuery('during-transfer')
          }
        }
        return frame
      } })
      let maximumRendererGapMs = 0
      let samples = 0
      let previous = performance.now()
      const sample = () => { const now = performance.now(); maximumRendererGapMs = Math.max(maximumRendererGapMs, now - previous); previous = now }
      const timer = setInterval(() => { samples += 1; sample() }, 10)
      const progress = []
      client.subscribeBreadcrumbQueryProgress('packaged-query', (value) => { progress.push(value) })
      let result
      const transferStarted = performance.now()
      try { result = await client.listBreadcrumbPositions(missionId, 5000, 'packaged-query'); await new Promise((resolve) => setTimeout(resolve, 0)); sample() }
      finally { clearInterval(timer) }
      const transferElapsedMs = performance.now() - transferStarted
      const replacer = (_key, value) => {
        if (typeof value !== 'number') return value
        if (Object.is(value, -0)) return { number: '-0' }
        return Number.isFinite(value) ? value : { number: String(value) }
      }
      const serialized = JSON.stringify(result, replacer)
      const signedZeroSerialization = JSON.stringify(-0, replacer)
      const positiveZeroSerialization = JSON.stringify(0, replacer)
      const digestValue = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const signedZeroDigest = await digestValue(signedZeroSerialization)
      const positiveZeroDigest = await digestValue(positiveZeroSerialization)
      const progressMonotonic = progress.every((entry, index) => index === 0
        || entry.receivedPositions >= progress[index - 1].receivedPositions)
      const progressHasIntermediate = progress.some((entry) => entry.receivedPositions > 0
        && entry.receivedPositions < entry.totalPositions)
      const progressTotalsStable = progress.every((entry) => entry.totalPositions === progress[0]?.totalPositions)
      return { count: result.positions.length, digest, maximumRendererGapMs, samples, currentWriteMs, currentVisible,
        exactDotsDuringTransfer, exactDotQueryMs,
        transferElapsedMs,
        progressFirst: progress[0], progressLast: progress.at(-1), progressEvents: progress.length,
        progressMonotonic, progressHasIntermediate, progressTotalsStable,
        signedZeroSerialization, signedZeroDigest, positiveZeroDigest }
    }, { missionId, launchIndex })
    const main = await app.evaluate(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); return globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__.stop() })
    report.launches.push({ expected, actual, main, background })
    assert.ok(actual.transferElapsedMs < 30_000, 'Backgrounded canonical transfer must keep making timely progress.')
    assert.equal(actual.digest, expected.digest, 'Every selected field and ordered row must match the SQLite snapshot.')
    assert.equal(expected.signedZeroSerialization, '{"number":"-0"}', 'Canonical digest must preserve signed zero as an explicit tag.')
    assert.equal(actual.signedZeroSerialization, expected.signedZeroSerialization)
    assert.equal(actual.signedZeroDigest, expected.signedZeroDigest)
    assert.equal(actual.positiveZeroDigest, expected.positiveZeroDigest)
    assert.notEqual(expected.signedZeroDigest, expected.positiveZeroDigest)
    assert.notEqual(actual.signedZeroDigest, actual.positiveZeroDigest, 'Canonical digest must distinguish -0 from +0.')
    assert.equal(actual.count, expected.count)
    assert.equal(actual.currentVisible, true, 'Current fix must be queryable while history transfer is incomplete.')
    assert.equal(actual.exactDotsDuringTransfer, true, 'Exact-dot query must see the current fix while canonical transfer is paused after frame zero.')
    assert.ok(actual.currentWriteMs < 200, `Current write ${actual.currentWriteMs}ms reached unchanged 200ms limit.`)
    assert.deepEqual(actual.progressFirst, { receivedPositions: 0, totalPositions: expected.count })
    assert.deepEqual(actual.progressLast, { receivedPositions: expected.count, totalPositions: expected.count })
    assert.ok(actual.progressEvents >= 3, `Expected intermediate progress before finish, saw ${actual.progressEvents} events.`)
    assert.equal(actual.progressMonotonic, true, 'Progress receivedPositions must be monotonic.')
    assert.equal(actual.progressHasIntermediate, true, 'Progress must report an intermediate transfer before finish.')
    assert.equal(actual.progressTotalsStable, true, 'Progress totalPositions must remain stable.')
    assert.ok(actual.samples > 0 && actual.maximumRendererGapMs < 200, `Renderer gap ${actual.maximumRendererGapMs}ms reached unchanged 200ms limit.`)
    assert.deepEqual(validateMainEventLoopEvidence([main], 1), [])
    const cancellation = await page.evaluate(async ({ missionId }) => {
      const raw = window.sartrackerElectron.missionStore
      const manifest = await raw.startBreadcrumbQuery({ missionId, perDeviceLimit: 5000, requestId: 'cancel-query' })
      const frame = await raw.readBreadcrumbQueryFrame({ requestId: 'cancel-query', snapshotId: manifest.snapshotId, sequence: 0 })
      const cancelled = await raw.cancelBreadcrumbQuery({ requestId: 'cancel-query', snapshotId: manifest.snapshotId })
      let lateRejected = false
      try { await raw.readBreadcrumbQueryFrame({ requestId: 'cancel-query', snapshotId: manifest.snapshotId, sequence: 1 }) } catch { lateRejected = true }
      return { cancelled, lateRejected, maximumFrameUnits: frame.payload.length }
    }, { missionId })
    report.launches.at(-1).cancellation = cancellation
    assert.equal(cancellation.cancelled, true)
    assert.equal(cancellation.lateRejected, true)
    assert.ok(cancellation.maximumFrameUnits <= 32_768)
    const reloadSnapshots = []
    for (let reloadIndex = 0; reloadIndex < 2; reloadIndex += 1) {
      reloadSnapshots.push(await page.evaluate(async (missionId) => {
        const raw = window.sartrackerElectron.missionStore
        let deadline
        try {
          const manifest = await Promise.race([
            raw.startBreadcrumbQuery({ missionId, perDeviceLimit: 5000, requestId: 'reload-query' }),
            new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Reload left canonical query ownership behind.')), 5000) }),
          ])
          await raw.readBreadcrumbQueryFrame({ requestId: 'reload-query', snapshotId: manifest.snapshotId, sequence: 0 })
          return manifest.snapshotId
        } finally { clearTimeout(deadline) }
      }, missionId))
      await page.reload()
      await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
    }
    assert.notEqual(reloadSnapshots[0], reloadSnapshots[1])
    assert.deepEqual(dialogFailures, [], 'Unexpected reload dialog handling failure.')
    report.launches.at(-1).reloadSnapshots = reloadSnapshots
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show() })
    await page.screenshot({ path: path.join(output, `packaged-shell-${launchIndex}.png`) })
    const processHandle = app.process()
    await app.close()
    await Promise.all(dialogHandlers)
    assert.deepEqual(dialogFailures, [], 'Unexpected reload or close dialog handling failure.')
    report.closes.push({ code: processHandle.exitCode, signal: processHandle.signalCode })
    assert.equal(processHandle.exitCode, 0)
    assert.equal(processHandle.signalCode, null)
    app = undefined
  }
  report.passed = true
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch((error) => { report.cleanupError = String(error) })
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, output, error: report.error ?? null }))
}

/** Launches the packaged app against the one disposable profile used by this smoke. */
async function launchPackagedApp() {
  return electron.launch({ executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'] : [],
    env: { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }, timeout: 30_000 })
}

/** Seeds the fixed synthetic position workload only after the setup app has closed. */
function seedSyntheticPositions(userDataPath, missionId) {
  const databasePath = path.join(userDataPath, 'mission-store.sqlite')
  const db = new Database(databasePath)
  try {
    const insert = db.prepare(`INSERT INTO positions (id,mission_id,device_id,source_position_id,name,lat,lon,altitude,speed,battery,accuracy,timestamp,data_origin,timestamp_source)
      VALUES (?,?,?,?,?,52,-9,?,0.125,97,NULL,?,'live','fix')`)
    db.transaction(() => { for (let index = 0; index < 103_626; index += 1) insert.run(`row-${index}`, missionId,
      `device-${index % 32}`, `source-${index}`, index === 33 ? '"\\\n🧭'.repeat(40_000) : `Éire ${index}`,
      index === 19 ? Infinity : null, new Date(1_700_000_000_000 + index * 1_000).toISOString()) })()
    const row = db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(missionId)
    assert.equal(row.count, 103_626)
  } finally {
    db.close()
  }
}

/** Computes an exact source/artifact identity. */
function hash(input) { return createHash('sha256').update(input).digest('hex') }
/** Enumerates the built renderer files bound to the tested package. */
async function filesUnder(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(file))
    else result.push(file)
  }
  return result
}
