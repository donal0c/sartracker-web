#!/usr/bin/env node
// Repair Train B: actual packaged renderer/IPC/worker/SQLite with synthetic files.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, fork } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'
import { extractFile } from '@electron/asar'
import { MAX_GPX_SOURCE_BYTES, readBoundedGpxSource } from '../electron/gpx-source-reader.cjs'

const executablePath = path.resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Pass the packaged Electron executable path.')
const output = path.resolve(process.argv[3] ?? 'tmp/repair-train-b/package')
const developmentTestHarness = process.env.SARTRACKER_GPX_DEVELOPMENT_TEST_HARNESS === '1'
const developmentKillOnly = developmentTestHarness && process.env.SARTRACKER_GPX_KILL_ONLY === '1'
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'sar-gpx-fidelity-'))
const source = await readFile('tests/fixtures/gpx-extension-fidelity.gpx', 'utf8')
const cdata = source.replace(/>(Ridge party|100|110|2026-09-07T08:0[01]:00Z)</g, '><![CDATA[$1]]><')
const replacementSource = cdata.replaceAll('Ridge party', ' Ridge party ')
const sourcePath = path.join(profile, 'fidelity.gpx')
await writeFile(sourcePath, cdata)
const points = Array.from({ length: 75_000 }, (_, index) =>
  `<trkpt lat="${(52 + (index % 1000) / 100000).toFixed(5)}" lon="-9.7"><time>${new Date(Date.parse('2026-09-07T08:00:00Z') + index * 1000).toISOString()}</time></trkpt>`).join('')
const largeSource = `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Synthetic regression"><trk><trkseg>${points}</trkseg></trk></gpx>`
assert.ok(Buffer.byteLength(largeSource) < 8 * 1024 * 1024)
const largePath = path.join(profile, 'outing-race.gpx')
await writeFile(largePath, largeSource)
const malformedSource = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg><trkseg xmlns="urn:sar:wrong"><trkpt lat="51" lon="-8"/><trkpt lat="51.1" lon="-8"/></trkseg></trk></gpx>`
const malformedPath = path.join(profile, 'malformed-geometry.gpx')
await writeFile(malformedPath, malformedSource)
const undatedSource = `<gpx><trk><trkseg><trkpt lat="52" lon="-9"><extensions><time>2026-09-07T08:00:00Z</time><ele>999</ele></extensions></trkpt><trkpt lat="53" lon="-9"/></trkseg><name>Ridge party</name></trk></gpx>`
const undatedPath = path.join(profile, 'undated-late-name.gpx')
await writeFile(undatedPath, undatedSource)
const boundaryFixtures = await prepareBoundaryFixtures(profile)
const boundaryProbe = await inspectBoundaryFixtures(boundaryFixtures)
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA ?? null
const expectedSourceTree = process.env.EXPECTED_SOURCE_TREE ?? null
if (expectedSourceSha !== null) assert.equal(sourceHead, expectedSourceSha, 'Smoke source head does not match EXPECTED_SOURCE_SHA.')
if (expectedSourceTree !== null) assert.equal(sourceTree, expectedSourceTree, 'Smoke source tree does not match EXPECTED_SOURCE_TREE.')
if (expectedSourceSha !== null) assert.equal(sourceDirty, false, 'Smoke source tree must be clean when EXPECTED_SOURCE_SHA is supplied.')
if (process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1') {
  const unpackedRoot = path.resolve('tmp/electron-dist/linux-unpacked') + path.sep
  assert.equal(process.platform, 'linux', 'Linux unpacked package smoke must run on Linux.')
  assert.ok(executablePath.startsWith(unpackedRoot), 'Smoke must run the CI-built linux-unpacked executable.')
}
let app
let page
const rendererConsole = []
const rendererPageErrors = []
const mainStdout = []
const mainStderr = []
const MAX_DIAGNOSTIC_CHUNK_LENGTH = 8_192
const report = { developmentTestHarness, developmentKillOnly,
  proofTier: `${developmentTestHarness ? 'development' : expectedSourceSha === null ? 'local' : 'CI'} ${developmentTestHarness ? 'Electron development harness' : 'packaged Electron'}; synthetic profile; network blocked; native chooser automated`,
  sourceHead, sourceTree, sourceDirty, expectedSourceSha, expectedSourceTree,
  sourceFileHashes: Object.fromEntries(await Promise.all([
    'electron/gpx-evidence-import-worker.cjs', 'electron/gpx-source-reader.cjs', 'src/features/gpx/gpx-parser.ts', 'src/features/gpx/start-gpx-runtime.ts',
  ].map(async (file) => [file, sha256(await readFile(file))]))),
  profile, executablePath, sourceSha256: sha256(cdata), largeSourceSha256: sha256(largeSource),
  malformedSourceSha256: sha256(malformedSource), undatedSourceSha256: sha256(undatedSource),
  largePointCount: 75_000,
  boundaryProbe,
  killRecovery: {
    attempted: false,
    phases: ['pending', 'retained'],
    receipt_checkpoint: false,
    copy_checkpoint: false,
    commit_checkpoint: false,
    gap: 'The packaged producer has no safe process-kill injection seam; use the dedicated forced-kill recovery lane.',
  },
  passed: false }
try {
  if (developmentKillOnly) {
    report.killRecovery = await runPackagedKillRecovery({
      sourcePath: boundaryFixtures.exactPath,
      sourceBytes: MAX_GPX_SOURCE_BYTES,
      sourceSha256: boundaryProbe.exact.sha256,
      output,
    })
    report.passed = report.killRecovery.receipt_checkpoint
  } else {
  app = await launch()
  const archivePath = await app.evaluate(({ app }) => app.getAppPath())
  if (developmentTestHarness) {
    assert.ok(!archivePath.endsWith('.asar'), 'Development test harness must not masquerade as a packaged archive.')
    report.archiveSha256 = null
    report.packagedInputHashes = {}
  } else {
    assert.ok(archivePath.endsWith('.asar'), 'Must exercise the packaged application archive.')
    report.archiveSha256 = sha256(await readFile(archivePath))
    const packagedInputs = ['electron/gpx-evidence-import-worker.cjs', 'electron/gpx-source-reader.cjs', 'shared/gpx-source-scalars.mjs', ...await filesUnder('dist')]
    report.packagedInputHashes = {}
    for (const file of packagedInputs) {
      assert.equal(sha256(extractFile(archivePath, file)), sha256(await readFile(file)), `Packaged source mismatch: ${file}`)
      report.packagedInputHashes[file] = sha256(await readFile(file))
    }
  }
  page = await app.firstWindow()
  attachDiagnostics(page, app)
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
  await page.getByTestId('mission-name-input').fill('Packaged GPX fidelity')
  await page.getByTestId('mission-start-btn').click()
  await page.getByTestId('outing-label-input').fill('Import race outing')
  await page.getByTestId('outing-start-btn').click()
  await page.getByTestId('active-outing-label').waitFor()
  await page.getByTestId('sidebar-tab-tools').click()
  await choose(sourcePath)
  await page.getByTestId('gpx-import-files').click()
  await page.getByTestId('gpx-import-status').filter({ hasText: 'Imported 1 GPX file.' }).waitFor()
  await choose(largePath)
  await page.getByTestId('gpx-import-files').click()
  await page.getByTestId('gpx-import-files').filter({ hasText: 'Importing' }).waitFor()
  const started = Date.now()
  await page.getByTestId('outing-end-btn').click()
  await page.getByTestId('outing-no-active-notice').waitFor()
  assert.ok(await page.getByTestId('gpx-import-files').isDisabled(), 'Outing must end before import settles.')
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="gpx-import-files"]')
    return button && !button.disabled && !button.textContent.includes('Importing')
  }, undefined, { timeout: 90_000 })
  report.importSettlementMs = Date.now() - started
  await importSelected(malformedPath)
  await page.getByTestId('gpx-import-issues').filter({ hasText: 'malformed-geometry.gpx' }).waitFor()
  await importSelected(undatedPath)
  await page.getByTestId('gpx-import-list').filter({ hasText: 'undated-late-name' }).waitFor()
  assert.match(await page.getByTestId('gpx-import-panel').innerText(), /3 shown/i)
  assert.equal(await page.getByTestId('gpx-import-status').innerText(), 'Imported 1 GPX file.')

  const duplicateBefore = await inspect({ strict: false })
  await importSelected(sourcePath)
  const duplicateAfter = await inspect({ strict: false })
  report.duplicateIdentity = {
    attempted: true,
    same_content_skipped: duplicateBefore.revisions.length === duplicateAfter.revisions.length,
    no_new_revision: duplicateBefore.revisions.length === duplicateAfter.revisions.length,
    before_revision_count: duplicateBefore.revisions.length,
    after_revision_count: duplicateAfter.revisions.length,
  }

  const replacementBefore = await inspect({ strict: false })
  await writeFile(sourcePath, replacementSource)
  await importSelected(sourcePath)
  await writeFile(sourcePath, cdata)
  await importSelected(sourcePath)
  const replacementAfter = await inspect({ strict: false })
  const fidelityRevisions = replacementAfter.revisions.filter((revision) => revision.file_name === 'fidelity.gpx')
  report.replacementIdentity = {
    attempted: true,
    original_sha256: sha256(cdata),
    replacement_sha256: sha256(replacementSource),
    final_sha256: fidelityRevisions.at(-1)?.content_sha256 ?? null,
    before_revision_count: replacementBefore.revisions.length,
    after_revision_count: replacementAfter.revisions.length,
    revisions_added: replacementAfter.revisions.length - replacementBefore.revisions.length,
    source_path_stable: fidelityRevisions.length === 3,
  }
  report.concurrentIdentity = await exerciseConcurrentIdentity(sourcePath, replacementAfter.revisions.length)
  report.sourceSidecarKillRecovery = await runKillRecovery({ sourcePath: largePath, sourceBytes: Buffer.byteLength(largeSource), output })
  report.killRecovery = await runPackagedKillRecovery({
    sourcePath: boundaryFixtures.exactPath,
    sourceBytes: MAX_GPX_SOURCE_BYTES,
    sourceSha256: boundaryProbe.exact.sha256,
    output,
  })
  await page.getByTestId('mission-control-collapse-btn').click()
  await page.getByTestId('gpx-import-panel').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'settled.png') })
  report.beforeRestart = await inspect()
  report.lifecycle = report.beforeRestart.lifecycle
  await app.close()
  app = null
  app = await launch()
  page = await app.firstWindow()
  attachDiagnostics(page, app)
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
  report.afterRestart = await inspect()
  assert.deepEqual(report.afterRestart, report.beforeRestart)
  if (!developmentTestHarness) assert.equal(sha256(await readFile(archivePath)), report.archiveSha256)
  report.passed = true
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error)
  try { await captureFailureDiagnostics() }
  catch (diagnosticError) { report.failureDiagnosticsError = diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }
  throw error
} finally {
  try { if (app) await app.close() }
  catch (error) {
    report.passed = false
    report.cleanupFailure = error instanceof Error ? error.message : String(error)
    throw error
  } finally { await writeFile(path.join(output, 'receipt.json'), JSON.stringify(report, null, 2)) }
}

/** Launches the real artifact against a disposable retained profile. */
async function launch() {
  return await launchAtProfile(profile)
}

/** Launches the supplied packaged executable against one explicitly owned profile. */
async function launchAtProfile(profilePath) {
  // Match the existing Linux AppImage smoke's attested Mesa/ANGLE setup.
  const args = [
    ...(developmentTestHarness ? [path.resolve('electron/main.cjs')] : []),
    ...(process.platform === 'linux' ? [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=gl',
    '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
  ] : []),
  ]
  const env = { ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profilePath, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
  if (developmentTestHarness) delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  return await electron.launch({ executablePath, args, env, timeout: 30_000 })
}

/** Retains bounded renderer and main-process diagnostics for a failed smoke. */
function attachDiagnostics(nextPage, nextApp) {
  nextPage.on('console', (message) => retain(rendererConsole, `${message.type()}: ${message.text()}\n`))
  nextPage.on('pageerror', (error) => retain(rendererPageErrors, error instanceof Error ? error.stack ?? error.message : String(error)))
  if (typeof nextApp.process !== 'function') return
  try {
    const process = nextApp.process()
    process.stdout?.on('data', (chunk) => retain(mainStdout, String(chunk)))
    process.stderr?.on('data', (chunk) => retain(mainStderr, String(chunk)))
  } catch { /* Diagnostics must never affect the smoke. */ }
}

/** Retains only the most recent diagnostics so a failing app cannot fill CI evidence. */
function retain(target, value) {
  const boundedValue = value.length > MAX_DIAGNOSTIC_CHUNK_LENGTH
    ? `[truncated ${value.length - MAX_DIAGNOSTIC_CHUNK_LENGTH} chars]\n${value.slice(-MAX_DIAGNOSTIC_CHUNK_LENGTH)}`
    : value
  target.push(boundedValue)
  if (target.length > 200) target.splice(0, target.length - 200)
}

/** Captures failure state without masking the original smoke assertion. */
async function captureFailureDiagnostics() {
  const files = []
  let bodyText = ''
  let uiState = null
  if (page) {
    bodyText = await page.locator('body').innerText().catch((error) => `body capture failed: ${String(error)}`)
    uiState = await page.evaluate(() => ({
      missionControl: document.querySelector('[data-testid="mission-control"]')?.textContent?.trim() ?? null,
      missionPhase: document.querySelector('[data-testid="mission-control"]')?.getAttribute('data-mission-phase') ?? null,
      missionPhaseChip: document.querySelector('[data-testid="mission-phase-chip"]')?.textContent?.trim() ?? null,
      outingSection: document.querySelector('[data-testid="outing-controls-section"]')?.textContent?.trim() ?? null,
      outingLabelInput: Boolean(document.querySelector('[data-testid="outing-label-input"]')),
      outingStartButton: Boolean(document.querySelector('[data-testid="outing-start-btn"]')),
    })).catch((error) => ({ captureError: String(error) }))
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).then(() => files.push('failure.png')).catch(() => undefined)
  }
  await writeFile(path.join(output, 'failure-body.txt'), bodyText)
  files.push('failure-body.txt')
  await writeFile(path.join(output, 'failure-ui.json'), JSON.stringify(uiState, null, 2))
  files.push('failure-ui.json')
  const nativeState = await inspectStartupState()
  await writeFile(path.join(output, 'failure-native-state.json'), JSON.stringify(nativeState, null, 2))
  files.push('failure-native-state.json')
  await writeFile(path.join(output, 'failure-renderer-console.log'), rendererConsole.join(''))
  files.push('failure-renderer-console.log')
  await writeFile(path.join(output, 'failure-renderer-errors.log'), rendererPageErrors.join('\n'))
  files.push('failure-renderer-errors.log')
  await writeFile(path.join(output, 'failure-main-stdout.log'), mainStdout.join(''))
  files.push('failure-main-stdout.log')
  await writeFile(path.join(output, 'failure-main-stderr.log'), mainStderr.join(''))
  files.push('failure-main-stderr.log')
  const runtimeLog = await readTail(path.join(profile, 'logs', 'runtime.log'))
  await writeFile(path.join(output, 'failure-runtime.log'), runtimeLog)
  files.push('failure-runtime.log')
  report.failureDiagnostics = { files, uiState, nativeState,
    rendererConsoleEntries: rendererConsole.length, rendererPageErrorEntries: rendererPageErrors.length,
    mainStdoutChunks: mainStdout.length, mainStderrChunks: mainStderr.length }
}

/** Reads a bounded tail of the disposable profile's runtime timeline. */
async function readTail(file) {
  try {
    const value = await readFile(file, 'utf8')
    return value.length > 64 * 1024 ? `[truncated ${value.length - 64 * 1024} chars]\n${value.slice(-64 * 1024)}` : value
  } catch (error) {
    return `runtime log unavailable: ${String(error)}\n`
  }
}

/** Reads the disposable profile's mission/outings state while the failed app remains open. */
async function inspectStartupState() {
  if (!app) return null
  return await app.evaluate(({ app }, userDataPath) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const require = createRequire(`${app.getAppPath()}/package.json`)
    const Database = require('better-sqlite3')
    const db = new Database(`${userDataPath}/mission-store.sqlite`, { readonly: true })
    try {
      return {
        missions: db.prepare(`SELECT id, name, status, start_time, finish_time FROM missions ORDER BY start_time, id`).all(),
        outings: db.prepare(`SELECT id, mission_id, label, started_at, ended_at FROM outings ORDER BY started_at, id`).all(),
      }
    } finally { db.close() }
  }, profile).catch((error) => ({ error: String(error) }))
}

/** Automates only file selection; production UI and IPC perform import. */
async function choose(file) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, file)
}

/** Imports one selected file and waits for the bounded renderer operation to settle. */
async function importSelected(file) {
  await choose(file)
  const page = await app.firstWindow()
  await page.getByTestId('gpx-import-files').click()
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="gpx-import-files"]')
    return button && !button.disabled && !button.textContent.includes('Importing')
  }, undefined, { timeout: 90_000 })
}

/** Creates one valid GPX source at the exact reader ceiling and one first-byte-over source. */
async function prepareBoundaryFixtures(directory) {
  const prefix = '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><name>Boundary</name><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="52.1" lon="-9.1"/><extensions><padding>'
  const suffix = '</padding></extensions></trkseg></trk></gpx>'
  const paddingBytes = MAX_GPX_SOURCE_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)
  assert.ok(paddingBytes > 0, 'The exact GPX boundary fixture must have positive padding.')
  const exact = Buffer.from(`${prefix}${'x'.repeat(paddingBytes)}${suffix}`)
  assert.equal(exact.byteLength, MAX_GPX_SOURCE_BYTES)
  const exactPath = path.join(directory, 'boundary-exact.gpx')
  const overPath = path.join(directory, 'boundary-over.gpx')
  await writeFile(exactPath, exact)
  await writeFile(overPath, Buffer.concat([exact, Buffer.from('x')]))
  return { exactPath, overPath }
}

/** Exercises the production source-reader boundary without importing the huge fixtures into the mission. */
async function inspectBoundaryFixtures(fixtures) {
  const exactBytes = await readBoundedGpxSource(fixtures.exactPath)
  const overBytes = await readFile(fixtures.overPath)
  let overError = null
  try {
    await readBoundedGpxSource(fixtures.overPath)
  } catch (error) {
    overError = error instanceof Error ? error.message : String(error)
  }
  return {
    maxBytes: MAX_GPX_SOURCE_BYTES,
    exact: { bytes: exactBytes.byteLength, accepted: true, sha256: sha256(exactBytes) },
    over: { bytes: overBytes.byteLength, rejected: overError !== null, sha256: sha256(overBytes), error: overError },
    packagedReaderHash: sha256(await readFile('electron/gpx-source-reader.cjs')),
  }
}

/** Runs two same-source IPC imports together and records the reconciled durable result. */
async function exerciseConcurrentIdentity(sourcePath, beforeRevisionCount) {
  const outcomes = await page.evaluate(async (input) => {
    const mission = await window.sartrackerElectron?.missionStore?.getActiveMission()
    if (typeof mission?.id !== 'string') throw new Error('Concurrent GPX identity probe could not resolve the active mission.')
    const calls = [0, 1].map(() => window.sartrackerElectron.missionStore.importGpxEvidencePaths({
      missionId: mission.id,
      paths: [input.sourcePath],
    }))
    const settled = await Promise.allSettled(calls)
    return settled.map((entry) => entry.status === 'fulfilled'
      ? { status: entry.status, importCount: entry.value?.imports?.length ?? 0 }
      : { status: entry.status, error: String(entry.reason) })
  }, { sourcePath })
  const after = await inspect({ strict: false })
  return {
    attempted: true,
    request_count: outcomes.length,
    settled_count: outcomes.length,
    outcomes,
    no_duplicate_revision: after.revisions.length === beforeRevisionCount,
  }
}

/** Runs both durable GPX forced-kill barriers in an owned sidecar profile and retains failed audits. */
async function runKillRecovery({ sourcePath, sourceBytes, output }) {
  const cases = []
  for (const phase of ['pending', 'retained']) {
    cases.push(await runKillRecoveryCase({ phase, sourcePath, sourceBytes, output }))
  }
  return {
    schema: 'sartracker-gpx-kill-recovery-v1',
    attempted: true,
    proofMode: 'production-mission-store-sidecar',
    fixtureBytes: sourceBytes,
    phases: ['pending', 'retained'],
    cases,
    receipt_checkpoint: cases.every((entry) => entry.barrier_observed === true && entry.recovered_status === 'failed'),
    copy_checkpoint: cases.some((entry) => entry.copy_checkpoint === true),
    commit_checkpoint: cases.every((entry) => entry.no_committed_revision === true),
  }
}

/** Runs the forced-kill boundary against the supplied packaged Electron process through public IPC. */
async function runPackagedKillRecovery({ sourcePath, sourceBytes, sourceSha256, output }) {
  const instrumentation = {
    attempted: true,
    mode: 'scoped in-memory default mission-worker constructor fault injection',
    workerPath: 'electron/gpx-evidence-import-worker.cjs',
    profileScope: 'exact owned user-data profile and database path',
    restoredAfterDispatch: true,
  }
  const cases = []
  for (const phase of ['pending', 'retained']) {
    cases.push(await runPackagedKillRecoveryCase({
      phase, sourcePath, sourceBytes, sourceSha256, output, instrumentation,
    }))
  }
  return {
    schema: 'sartracker-gpx-kill-recovery-v1',
    attempted: true,
    proofMode: 'packaged-electron-public-ipc',
    fixtureBytes: sourceBytes,
    source_sha256: sourceSha256,
    phases: ['pending', 'retained'],
    instrumentation: {
      attempted: true,
      mode: 'scoped in-memory default mission-store Worker fault injection',
      workerPath: 'electron/gpx-evidence-import-worker.cjs',
      profileScope: 'exact owned user-data profile and database path',
      restoredAfterDispatch: true,
      developmentTestHarness,
    },
    cases,
    receipt_checkpoint: cases.every((entry) => entry.barrier_observed === true && entry.recovered_status === 'failed'),
    copy_checkpoint: cases.some((entry) => entry.copy_checkpoint === true),
    commit_checkpoint: cases.every((entry) => entry.no_committed_revision === true),
  }
}

/** Install a reversible Worker constructor hook in the existing default app store. */
async function installScopedGpxWorkerHook(app, profilePath, phase) {
  return await app.evaluate(({ app }, input) => {
    const nodePath = process.getBuiltinModule('node:path')
    const createRequire = process.getBuiltinModule('node:module').createRequire
    const appRoot = app.getAppPath()
    const mainPath = appRoot.endsWith(`${nodePath.sep}electron`)
      ? nodePath.join(appRoot, 'main.cjs')
      : nodePath.join(appRoot, 'electron', 'main.cjs')
    const require = createRequire(mainPath)
    const { Worker } = require('./mission-worker.cjs')
    const original = Object.getPrototypeOf(Worker)
    if (typeof original !== 'function') throw new Error('Packaged mission Worker superclass is unavailable.')
    const exactWorkerPath = nodePath.resolve(nodePath.dirname(mainPath), 'gpx-evidence-import-worker.cjs')
    const exactDatabasePath = nodePath.resolve(nodePath.join(app.getPath('userData'), 'mission-store.sqlite'))
    if (nodePath.resolve(input.profilePath) !== nodePath.dirname(exactDatabasePath)) {
      throw new Error('Scoped GPX Worker hook profile does not match the app-owned user-data directory.')
    }
    const state = { matched: 0, restored: false, restore: null }
    const restore = () => {
      if (state.restored) return
      Object.setPrototypeOf(Worker, original)
      state.restored = true
    }
    state.restore = restore
    class ScopedWorker extends original {
      constructor(filename, options = {}) {
        const workerData = options.workerData
        const matches = nodePath.resolve(String(filename)) === exactWorkerPath
          && nodePath.resolve(String(workerData?.databasePath ?? '')) === exactDatabasePath
        super(filename, matches
          ? { ...options, workerData: { ...workerData, pauseAfter: input.phase } }
          : options)
        if (matches) {
          state.matched += 1
          restore()
        }
      }
    }
    Object.defineProperty(Worker, '__sartrackerScopedGpxWorkerState', { value: state, configurable: true })
    Object.setPrototypeOf(Worker, ScopedWorker)
    return {
      workerPath: exactWorkerPath,
      databasePath: exactDatabasePath,
      installed: true,
    }
  }, { profilePath, phase })
}

/** Read the matched-hit and restoration state from the existing app Worker class. */
async function readScopedGpxWorkerHook(app) {
  return await app.evaluate(({ app }) => {
    const nodePath = process.getBuiltinModule('node:path')
    const createRequire = process.getBuiltinModule('node:module').createRequire
    const appRoot = app.getAppPath()
    const mainPath = appRoot.endsWith(`${nodePath.sep}electron`)
      ? nodePath.join(appRoot, 'main.cjs')
      : nodePath.join(appRoot, 'electron', 'main.cjs')
    const require = createRequire(mainPath)
    const { Worker } = require('./mission-worker.cjs')
    const state = Worker.__sartrackerScopedGpxWorkerState
    return state === undefined ? { matched: 0, restored: false } : { matched: state.matched, restored: state.restored }
  })
}

/** Restore the Worker constructor chain even when the expected barrier was missed. */
async function restoreScopedGpxWorkerHook(app) {
  if (app === null) return { matched: 0, restored: false }
  return await app.evaluate(({ app }) => {
    const nodePath = process.getBuiltinModule('node:path')
    const createRequire = process.getBuiltinModule('node:module').createRequire
    const appRoot = app.getAppPath()
    const mainPath = appRoot.endsWith(`${nodePath.sep}electron`)
      ? nodePath.join(appRoot, 'main.cjs')
      : nodePath.join(appRoot, 'electron', 'main.cjs')
    const require = createRequire(mainPath)
    const { Worker } = require('./mission-worker.cjs')
    const state = Worker.__sartrackerScopedGpxWorkerState
    if (state !== undefined) {
      if (typeof state.restore === 'function') state.restore()
      else state.restored = true
    }
    return state === undefined ? { matched: 0, restored: false } : { matched: state.matched, restored: state.restored }
  }).catch(() => ({ matched: 0, restored: false }))
}

/** Kills the actual packaged app PID at an observed durable receipt phase, then reopens its profile. */
async function runPackagedKillRecoveryCase({ phase, sourcePath, sourceBytes, sourceSha256, output, instrumentation = null }) {
  const killRoot = await mkdtemp(path.join(output, `.gpx-packaged-kill-${phase}-`))
  const killSourcePath = path.join(killRoot, `${phase}.gpx`)
  await copyFile(sourcePath, killSourcePath)
  let app = null
  let recoveryApp = null
  let appPid = null
  let barrierObserved = false
  let signal = null
  let missionId = null
  let workerHookState = { matched: 0, restored: false }
  try {
    app = await launchAtProfile(killRoot)
    const nextPage = await app.firstWindow()
    await nextPage.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    const mission = await nextPage.evaluate((boundary) => window.sartrackerElectron.missionStore.createMission({
      name: `Packaged GPX forced kill ${boundary}`,
    }), phase)
    missionId = mission?.id ?? null
    if (typeof missionId !== 'string' || missionId.length === 0) throw new Error('Packaged GPX kill probe did not create a mission through public IPC.')
    if (instrumentation !== null) {
      await installScopedGpxWorkerHook(app, killRoot, phase)
    }
    await nextPage.evaluate(({ missionId: activeMissionId, sourcePath: selectedPath }) => {
      void window.sartrackerElectron.missionStore.importGpxEvidencePaths({
        missionId: activeMissionId,
        paths: [selectedPath],
      }).catch(() => undefined)
    }, { missionId, sourcePath: killSourcePath })
    const process = app.process()
    appPid = process?.pid ?? null
    if (!Number.isSafeInteger(appPid) || appPid <= 0) throw new Error('Packaged GPX kill probe could not observe the Electron app PID.')
    const mainReportedPid = await app.evaluate(({ app }) => process.pid)
    if (mainReportedPid !== appPid) throw new Error('Packaged GPX kill probe app PID differs from the Electron main-process PID.')
    await waitForPackagedReceiptStatus(path.join(killRoot, 'mission-store.sqlite'), missionId, phase, app)
    workerHookState = await readScopedGpxWorkerHook(app)
    if (instrumentation !== null && (workerHookState.matched !== 1 || workerHookState.restored !== true)) {
      throw new Error(`Packaged GPX Worker hook did not observe and restore one exact worker dispatch (matched=${workerHookState.matched}, restored=${workerHookState.restored}).`)
    }
    barrierObserved = true
    if (!process.kill('SIGKILL')) throw new Error('Packaged Electron app did not accept SIGKILL at the observed receipt barrier.')
    const [, observedSignal] = await once(process, 'exit')
    signal = observedSignal
    await app.close().catch(() => undefined)
    app = null

    recoveryApp = await launchAtProfile(killRoot)
    const recoveryPage = await recoveryApp.firstWindow()
    await recoveryPage.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    await waitForRecoveredKillReceipt(path.join(killRoot, 'mission-store.sqlite'), missionId)
    await recoveryApp.close()
    recoveryApp = null
    const audit = await readKillRecoveryAudit(path.join(killRoot, 'mission-store.sqlite'), missionId)
    const retainedDatabasePath = path.join(output, `gpx-packaged-kill-${phase}-recovered.sqlite`)
    await copyFile(path.join(killRoot, 'mission-store.sqlite'), retainedDatabasePath)
    const retainedIdentity = await fileIdentity(retainedDatabasePath)
    const profileRemoved = await rm(killRoot, { recursive: true, force: true }).then(() => true, () => false)
    return packagedKillCaseResult({ phase, sourceBytes, sourceSha256, appPid, barrierObserved, signal, audit, retainedIdentity, profileRemoved, workerHookState })
  } catch (error) {
    await restoreScopedGpxWorkerHook(app)
    await recoveryApp?.close().catch(() => undefined)
    await app?.close().catch(() => undefined)
    return {
      phase,
      sourceBytes,
      source_sha256: sourceSha256,
      app_pid: appPid,
      barrier_observed: barrierObserved,
      signal,
      recovered_status: null,
      receipt_checkpoint: false,
      copy_checkpoint: false,
      no_committed_revision: false,
      batch_checkpoint: false,
      failure_reason: error instanceof Error ? error.message : String(error),
      failure_hash: null,
      retained_database: null,
      profile_removed: false,
      profile_path: path.basename(killRoot),
      worker_hook_matched: workerHookState.matched,
      worker_hook_restored: workerHookState.restored,
    }
  }
}

/** Reads the package-owned SQLite audit after startup recovery has settled the interrupted receipt. */
async function readKillRecoveryAudit(databasePath, missionId) {
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const receipt = database.prepare(`SELECT status, content_sha256, source_bytes_base64
      FROM gpx_import_source_receipts WHERE mission_id = ?`).get(missionId)
    const failure = database.prepare(`SELECT content_sha256, source_bytes_base64, reason
      FROM gpx_import_failures WHERE mission_id = ?`).get(missionId)
    const batch = database.prepare(`SELECT status, total_files, completed_files, failed_files, finished_at
      FROM gpx_import_batches WHERE mission_id = ?`).get(missionId)
    const committedRevisionCount = database.prepare(`SELECT COUNT(*) AS count
      FROM gpx_import_revisions WHERE mission_id = ? AND import_state = 'complete'`).get(missionId).count
    return {
      receiptStatus: receipt?.status ?? null,
      receiptHash: receipt?.content_sha256 ?? null,
      receiptBytesRetained: receipt?.source_bytes_base64 !== null && receipt?.source_bytes_base64 !== undefined,
      failureHash: failure?.content_sha256 ?? null,
      failureBytesRetained: failure?.source_bytes_base64 !== null && failure?.source_bytes_base64 !== undefined,
      failureReason: failure?.reason ?? null,
      batchStatus: batch?.status ?? null,
      batchTotalFiles: batch?.total_files ?? null,
      batchCompletedFiles: batch?.completed_files ?? null,
      batchFailedFiles: batch?.failed_files ?? null,
      batchFinished: typeof batch?.finished_at === 'string' && batch.finished_at.length > 0,
      committedRevisionCount,
    }
  } finally { database.close() }
}

/** Converts the independent SQLite audit into the strict packaged kill receipt shape. */
function packagedKillCaseResult({ phase, sourceBytes, sourceSha256, appPid, barrierObserved, signal, audit, retainedIdentity, profileRemoved, workerHookState }) {
  return {
    phase,
    sourceBytes,
    source_sha256: sourceSha256,
    app_pid: appPid,
    barrier_observed: barrierObserved,
    signal,
    recovered_status: audit.receiptStatus,
    receipt_checkpoint: audit.receiptStatus === 'failed',
    copy_checkpoint: phase === 'pending'
      ? audit.receiptBytesRetained === false && audit.failureBytesRetained === false
      : audit.receiptBytesRetained === false && audit.failureBytesRetained === true,
    no_committed_revision: audit.committedRevisionCount === 0,
    batch_checkpoint: audit.batchStatus === 'interrupted'
      && audit.batchTotalFiles === 1 && audit.batchCompletedFiles === 0 && audit.batchFailedFiles === 1 && audit.batchFinished === true,
    failure_reason: audit.failureReason,
    failure_hash: audit.failureHash,
    retained_database: retainedIdentity,
    profile_removed: profileRemoved,
    worker_hook_matched: workerHookState.matched,
    worker_hook_restored: workerHookState.restored,
  }
}

/** Waits until the packaged public-IPC import leaves its requested durable receipt barrier. */
async function waitForPackagedReceiptStatus(databasePath, missionId, expectedStatus, app) {
  const deadline = Date.now() + 30_000
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  let lastReadError = null
  while (Date.now() < deadline) {
    const process = app.process()
    if (process === undefined || process.exitCode !== null || process.signalCode !== null) throw new Error(`Packaged Electron exited before ${expectedStatus} receipt barrier.`)
    try {
      const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 })
      const row = database.prepare(`SELECT status FROM gpx_import_source_receipts
        WHERE mission_id = ? ORDER BY updated_at DESC LIMIT 1`).get(missionId)
      database.close()
      if (row?.status === expectedStatus) return
    } catch (error) {
      lastReadError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for packaged ${expectedStatus} GPX receipt barrier.${lastReadError === null ? '' : ` Last read error: ${lastReadError}`}`)
}

/** Kills one owned worker only after its requested receipt state is durable, then reopens the store. */
async function runKillRecoveryCase({ phase, sourcePath, sourceBytes, output }) {
  const killRoot = await mkdtemp(path.join(output, `.gpx-kill-${phase}-`))
  let child = null
  let missionId = null
  let barrierObserved = false
  try {
    const require = createRequire(import.meta.url)
    const { createElectronMissionStore } = require('../electron/mission-store.cjs')
    const store = createElectronMissionStore({ userDataPath: killRoot, readAdminRoster: async () => [] })
    const mission = await store.createMission({ name: `C09 forced kill ${phase}` })
    missionId = mission.id
    await store.prepareClose()
    store.close()

    const killSourcePath = path.join(killRoot, `${phase}.gpx`)
    await copyFile(sourcePath, killSourcePath)
    child = fork(path.resolve('tests/fixtures/gpx-import-kill-child.cjs'), [killRoot, missionId, killSourcePath, phase], { silent: true })
    await waitForKillReceiptStatus(path.join(killRoot, 'mission-store.sqlite'), phase, child)
    barrierObserved = true
    child.kill('SIGKILL')
    const [, signal] = await once(child, 'exit')

    const recoveredStore = createElectronMissionStore({ userDataPath: killRoot, readAdminRoster: async () => [] })
    await waitForRecoveredKillReceipt(path.join(killRoot, 'mission-store.sqlite'), missionId)
    await recoveredStore.prepareClose()
    recoveredStore.close()

    const requireRecovered = createRequire(import.meta.url)
    const Database = requireRecovered('better-sqlite3')
    const databasePath = path.join(killRoot, 'mission-store.sqlite')
    const database = new Database(databasePath, { readonly: true, fileMustExist: true })
    let audit
    try {
      const receipt = database.prepare(`SELECT status, content_sha256, source_bytes_base64
        FROM gpx_import_source_receipts WHERE mission_id = ?`).get(missionId)
      const failure = database.prepare(`SELECT content_sha256, source_bytes_base64, reason
        FROM gpx_import_failures WHERE mission_id = ?`).get(missionId)
      const batch = database.prepare(`SELECT status, total_files, completed_files, failed_files, finished_at
        FROM gpx_import_batches WHERE mission_id = ?`).get(missionId)
      const committedRevisionCount = database.prepare(`SELECT COUNT(*) AS count
        FROM gpx_import_revisions WHERE mission_id = ? AND import_state = 'complete'`).get(missionId).count
      audit = {
        receiptStatus: receipt?.status ?? null,
        receiptHash: receipt?.content_sha256 ?? null,
        receiptBytesRetained: receipt?.source_bytes_base64 !== null && receipt?.source_bytes_base64 !== undefined,
        failureHash: failure?.content_sha256 ?? null,
        failureBytesRetained: failure?.source_bytes_base64 !== null && failure?.source_bytes_base64 !== undefined,
        failureReason: failure?.reason ?? null,
        batchStatus: batch?.status ?? null,
        batchTotalFiles: batch?.total_files ?? null,
        batchCompletedFiles: batch?.completed_files ?? null,
        batchFailedFiles: batch?.failed_files ?? null,
        batchFinished: typeof batch?.finished_at === 'string' && batch.finished_at.length > 0,
        committedRevisionCount,
      }
    } finally { database.close() }
    const retainedDatabasePath = path.join(output, `gpx-kill-${phase}-recovered.sqlite`)
    await copyFile(databasePath, retainedDatabasePath)
    const retainedIdentity = await fileIdentity(retainedDatabasePath)
    const profileRemoved = await rm(killRoot, { recursive: true, force: true }).then(() => true, () => false)
    return {
      phase,
      sourceBytes,
      barrier_observed: barrierObserved,
      signal,
      recovered_status: audit.receiptStatus,
      receipt_checkpoint: audit.receiptStatus === 'failed',
      copy_checkpoint: phase === 'pending'
        ? audit.receiptBytesRetained === false && audit.failureBytesRetained === false
        : audit.receiptBytesRetained === false && audit.failureBytesRetained === true,
      no_committed_revision: audit.committedRevisionCount === 0,
      batch_checkpoint: audit.batchStatus === 'interrupted'
        && audit.batchTotalFiles === 1 && audit.batchCompletedFiles === 0 && audit.batchFailedFiles === 1 && audit.batchFinished === true,
      failure_reason: audit.failureReason,
      failure_hash: audit.failureHash,
      retained_database: retainedIdentity,
      profile_removed: profileRemoved,
    }
  } catch (error) {
    if (child !== null && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'exit').catch(() => undefined)
    }
    return {
      phase,
      sourceBytes,
      barrier_observed: barrierObserved,
      signal: null,
      recovered_status: null,
      receipt_checkpoint: false,
      copy_checkpoint: false,
      no_committed_revision: false,
      batch_checkpoint: false,
      failure_reason: error instanceof Error ? error.message : String(error),
      failure_hash: null,
      retained_database: null,
      profile_removed: await rm(killRoot, { recursive: true, force: true }).then(() => true, () => false),
    }
  }
}

/** Waits until the kill child reaches the requested pending or retained receipt barrier. */
async function waitForKillReceiptStatus(databasePath, expectedStatus, child) {
  const deadline = Date.now() + 15_000
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Kill child exited before ${expectedStatus} receipt barrier.`)
    try {
      const database = new Database(databasePath, { readonly: true, fileMustExist: true })
      const row = database.prepare(`SELECT status FROM gpx_import_source_receipts ORDER BY updated_at DESC LIMIT 1`).get()
      database.close()
      if (row?.status === expectedStatus) return
    } catch { /* The child may still be opening or writing its owned profile. */ }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${expectedStatus} GPX receipt barrier.`)
}

/** Waits for startup recovery to convert the interrupted receipt into a durable failure. */
async function waitForRecoveredKillReceipt(databasePath, missionId) {
  const deadline = Date.now() + 15_000
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  while (Date.now() < deadline) {
    try {
      const database = new Database(databasePath, { readonly: true, fileMustExist: true })
      const row = database.prepare(`SELECT status FROM gpx_import_source_receipts WHERE mission_id = ?`).get(missionId)
      database.close()
      if (row?.status === 'failed') return
    } catch { /* Recovery opens before the read-only audit can attach. */ }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for recovered GPX receipt failure.')
}

/** Streams a retained kill-recovery database identity without exposing its path. */
async function fileIdentity(filename) {
  const bytes = await readFile(filename)
  return { bytes: bytes.byteLength, sha256: sha256(bytes), basename: path.basename(filename) }
}

/** Inspects persisted canonical rows with the package's native SQLite dependency. */
async function inspect({ strict = true } = {}) {
  const result = await app.evaluate(({ app }, userDataPath) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const require = createRequire(`${app.getAppPath()}/package.json`)
    const Database = require('better-sqlite3')
    const db = new Database(`${userDataPath}/mission-store.sqlite`, { readonly: true })
    try {
      return {
        integrity: db.pragma('integrity_check', { simple: true }),
        points: db.prepare(`SELECT point_index, track_name, lat, lon, elevation, source_time FROM gpx_evidence_points
          WHERE import_id = (SELECT id FROM gpx_track_imports WHERE file_name = 'fidelity.gpx') ORDER BY point_index`).all(),
        undated: db.prepare(`SELECT imports.file_name, imports.display_name, imports.timing_class,
            points.point_index, points.track_name, points.source_time
          FROM gpx_track_imports AS imports
          JOIN gpx_evidence_points AS points ON points.import_id = imports.id
            AND points.revision_sequence = imports.revision_sequence
          WHERE imports.file_name = 'undated-late-name.gpx'
          ORDER BY points.point_index`).all(),
        imports: db.prepare(`SELECT file_name, display_name, timing_class
          FROM gpx_track_imports ORDER BY file_name`).all(),
        revisions: db.prepare(`SELECT file_name, revision_sequence, content_sha256, source_bytes_base64,
            import_state, audit_event_id
          FROM gpx_import_revisions ORDER BY file_name, revision_sequence`).all(),
        failures: db.prepare(`SELECT file_name, content_sha256, source_bytes_base64, reason,
            rejection_count, rejections_json
          FROM gpx_import_failures ORDER BY file_name`).all(),
        count: db.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get().count,
        receipts: db.prepare('SELECT file_name, status FROM gpx_import_source_receipts ORDER BY source_path').all(),
        endedOutings: db.prepare('SELECT COUNT(*) AS count FROM outings WHERE ended_at IS NOT NULL').get().count,
        lifecycle: {
          batches: db.prepare(`SELECT id, status, total_files, completed_files, failed_files, finished_at
            FROM gpx_import_batches ORDER BY started_at, id`).all(),
          receipts: db.prepare(`SELECT receipts.file_name, receipts.status, receipts.content_sha256,
              CASE WHEN receipts.source_bytes_base64 IS NOT NULL OR EXISTS (
                SELECT 1 FROM gpx_import_revisions AS revisions
                WHERE revisions.mission_id = receipts.mission_id
                  AND revisions.source_path = receipts.source_path
                  AND revisions.source_bytes_base64 IS NOT NULL
              ) THEN 1 ELSE 0 END AS copy_checkpoint
            FROM gpx_import_source_receipts AS receipts
            ORDER BY receipts.created_at, receipts.source_path`).all().map((entry) => ({
              ...entry, copy_checkpoint: entry.copy_checkpoint === 1,
            })),
          commits: db.prepare(`SELECT revisions.file_name, revisions.import_state,
              revisions.revision_sequence, revisions.audit_event_id,
              CASE WHEN revisions.import_state = 'complete' AND revisions.audit_event_id IS NOT NULL
                THEN 1 ELSE 0 END AS commit_checkpoint
            FROM gpx_import_revisions AS revisions
            ORDER BY revisions.file_name, revisions.revision_sequence`).all().map((entry) => ({
              ...entry, commit_checkpoint: entry.commit_checkpoint === 1,
            })),
          unsettled_count: db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_source_receipts
            WHERE status IN ('pending', 'retained')`).get().count,
        },
      }
    } finally { db.close() }
  }, profile)
  if (!strict) return result
  assert.equal(result.integrity, 'ok')
  // Every complete fidelity revision retains its two canonical points; the
  // current, replacement, and restored revisions therefore contribute six
  // points alongside the 75,000-point track and two undated points.
  assert.equal(result.count, 75_008)
  assert.deepEqual(result.imports, [
    { file_name: 'fidelity.gpx', display_name: 'fidelity', timing_class: 'fully_dated' },
    { file_name: 'outing-race.gpx', display_name: 'outing-race', timing_class: 'fully_dated' },
    { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated' },
  ])
  assert.deepEqual(result.undated, [
    { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated', point_index: 0, track_name: 'Ridge party', source_time: null },
    { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated', point_index: 1, track_name: 'Ridge party', source_time: null },
  ])
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].file_name, 'malformed-geometry.gpx')
  assert.equal(result.failures[0].content_sha256, sha256(malformedSource))
  assert.equal(result.failures[0].source_bytes_base64, Buffer.from(malformedSource).toString('base64'))
  assert.equal(result.failures[0].reason, 'GPX namespace_mismatch: trkseg.')
  assert.equal(result.failures[0].rejection_count, 0)
  assert.equal(result.failures[0].rejections_json, '[]')
  assert.equal(result.endedOutings, 1)
  assert.deepEqual(result.receipts, [
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'fidelity.gpx', status: 'settled' },
    { file_name: 'malformed-geometry.gpx', status: 'failed' },
    { file_name: 'outing-race.gpx', status: 'settled' },
    { file_name: 'undated-late-name.gpx', status: 'settled' },
  ])
  assert.deepEqual(result.points, [
    { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
    { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
    { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
    { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
    { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
    { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
  ])
  const revisionSources = new Map([
    [sha256(cdata), cdata],
    [sha256(replacementSource), replacementSource],
    [sha256(largeSource), largeSource],
    [sha256(undatedSource), undatedSource],
  ])
  for (const revision of result.revisions) {
    const original = revisionSources.get(revision.content_sha256)
    assert.ok(original !== undefined, `Unexpected packaged GPX revision digest: ${revision.content_sha256}`)
    assert.equal(revision.source_bytes_base64, Buffer.from(original).toString('base64'))
    assert.equal(revision.content_sha256, sha256(original))
  }
  assert.equal(result.revisions.length, 5)
  return result
}

/** Hashes exact bytes for artifact and evidence identity. */
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

/** Enumerates actual built renderer inputs so a stale package cannot pass. */
async function filesUnder(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(file))
    else files.push(file)
  }
  return files.sort()
}
