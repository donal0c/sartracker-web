#!/usr/bin/env node
// Repair Train B: actual packaged renderer/IPC/worker/SQLite with synthetic files.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright'
import { extractFile } from '@electron/asar'

const executablePath = path.resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Pass the packaged Electron executable path.')
const output = path.resolve(process.argv[3] ?? 'tmp/repair-train-b/package')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'sar-gpx-fidelity-'))
const source = await readFile('tests/fixtures/gpx-extension-fidelity.gpx', 'utf8')
const cdata = source.replace(/>(Ridge party|100|110|2026-09-07T08:0[01]:00Z)</g, '><![CDATA[$1]]><')
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
const report = { proofTier: `${expectedSourceSha === null ? 'local' : 'CI'} packaged Electron; synthetic profile; network blocked; native chooser automated`,
  sourceHead, sourceTree, sourceDirty, expectedSourceSha, expectedSourceTree,
  sourceFileHashes: Object.fromEntries(await Promise.all([
    'electron/gpx-evidence-import-worker.cjs', 'src/features/gpx/gpx-parser.ts', 'src/features/gpx/start-gpx-runtime.ts',
  ].map(async (file) => [file, sha256(await readFile(file))]))),
  profile, executablePath, sourceSha256: sha256(cdata), largeSourceSha256: sha256(largeSource),
  malformedSourceSha256: sha256(malformedSource), undatedSourceSha256: sha256(undatedSource),
  largePointCount: 75_000, passed: false }
try {
  app = await launch()
  const archivePath = await app.evaluate(({ app }) => app.getAppPath())
  assert.ok(archivePath.endsWith('.asar'), 'Must exercise the packaged application archive.')
  report.archiveSha256 = sha256(await readFile(archivePath))
  const packagedInputs = ['electron/gpx-evidence-import-worker.cjs', 'shared/gpx-source-scalars.mjs', ...await filesUnder('dist')]
  report.packagedInputHashes = {}
  for (const file of packagedInputs) {
    assert.equal(sha256(extractFile(archivePath, file)), sha256(await readFile(file)), `Packaged source mismatch: ${file}`)
    report.packagedInputHashes[file] = sha256(await readFile(file))
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
  await page.getByTestId('mission-control-collapse-btn').click()
  await page.getByTestId('gpx-import-panel').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'settled.png') })
  report.beforeRestart = await inspect()
  await app.close()
  app = null
  app = await launch()
  page = await app.firstWindow()
  attachDiagnostics(page, app)
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
  report.afterRestart = await inspect()
  assert.deepEqual(report.afterRestart, report.beforeRestart)
  assert.equal(sha256(await readFile(archivePath)), report.archiveSha256)
  report.passed = true
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
  // Match the existing Linux AppImage smoke's attested Mesa/ANGLE setup.
  const args = process.platform === 'linux' ? [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=gl',
    '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
  ] : []
  return await electron.launch({ executablePath, args, env: { ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }, timeout: 30_000 })
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

/** Inspects persisted canonical rows with the package's native SQLite dependency. */
async function inspect() {
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
        revisions: db.prepare('SELECT content_sha256, source_bytes_base64 FROM gpx_import_revisions ORDER BY content_sha256').all(),
        failures: db.prepare(`SELECT file_name, content_sha256, source_bytes_base64, reason,
            rejection_count, rejections_json
          FROM gpx_import_failures ORDER BY file_name`).all(),
        count: db.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get().count,
        receipts: db.prepare('SELECT file_name, status FROM gpx_import_source_receipts ORDER BY source_path').all(),
        endedOutings: db.prepare('SELECT COUNT(*) AS count FROM outings WHERE ended_at IS NOT NULL').get().count,
      }
    } finally { db.close() }
  }, profile)
  assert.equal(result.integrity, 'ok')
  assert.equal(result.count, 75_004)
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
    { file_name: 'malformed-geometry.gpx', status: 'failed' },
    { file_name: 'outing-race.gpx', status: 'settled' },
    { file_name: 'undated-late-name.gpx', status: 'settled' },
  ])
  assert.deepEqual(result.points, [
    { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
    { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
  ])
  const revisionSources = new Map([
    [sha256(cdata), cdata],
    [sha256(largeSource), largeSource],
    [sha256(undatedSource), undatedSource],
  ])
  for (const revision of result.revisions) {
    const original = revisionSources.get(revision.content_sha256)
    assert.ok(original !== undefined, `Unexpected packaged GPX revision digest: ${revision.content_sha256}`)
    assert.equal(revision.source_bytes_base64, Buffer.from(original).toString('base64'))
    assert.equal(revision.content_sha256, sha256(original))
    delete revision.source_bytes_base64
  }
  assert.equal(result.revisions.length, 3)
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
