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
let app
const report = { proofTier: 'local packaged Electron; synthetic profile; network blocked; native chooser automated',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  sourceFileHashes: Object.fromEntries(await Promise.all([
    'electron/gpx-evidence-import-worker.cjs', 'src/features/gpx/gpx-parser.ts', 'src/features/gpx/start-gpx-runtime.ts',
  ].map(async (file) => [file, sha256(await readFile(file))]))),
  profile, executablePath, sourceSha256: sha256(cdata), largeSourceSha256: sha256(largeSource),
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
  const page = await app.firstWindow()
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
  assert.match(await page.getByTestId('gpx-import-panel').innerText(), /2 shown/i)
  assert.equal(await page.getByTestId('gpx-import-status').innerText(), 'Imported 1 GPX file.')
  report.importSettlementMs = Date.now() - started
  await page.getByTestId('mission-control-collapse-btn').click()
  await page.getByTestId('gpx-import-panel').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'settled.png') })
  report.beforeRestart = await inspect()
  await app.close()
  app = null
  app = await launch()
  await (await app.firstWindow()).getByTestId('app-title').waitFor({ timeout: 30_000 })
  report.afterRestart = await inspect()
  assert.deepEqual(report.afterRestart, report.beforeRestart)
  assert.equal(sha256(await readFile(archivePath)), report.archiveSha256)
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error)
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
  return await electron.launch({ executablePath, args: [], env: { ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }, timeout: 30_000 })
}

/** Automates only file selection; production UI and IPC perform import. */
async function choose(file) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, file)
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
        revisions: db.prepare('SELECT content_sha256, source_bytes_base64 FROM gpx_import_revisions ORDER BY content_sha256').all(),
        count: db.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get().count,
        receipts: db.prepare('SELECT status FROM gpx_import_source_receipts ORDER BY source_path').all(),
        issues: db.prepare('SELECT COUNT(*) AS count FROM gpx_import_failures').get().count,
        endedOutings: db.prepare('SELECT COUNT(*) AS count FROM outings WHERE ended_at IS NOT NULL').get().count,
      }
    } finally { db.close() }
  }, profile)
  assert.equal(result.integrity, 'ok')
  assert.equal(result.count, 75_002)
  assert.equal(result.issues, 0)
  assert.equal(result.endedOutings, 1)
  assert.deepEqual(result.receipts, [{ status: 'settled' }, { status: 'settled' }])
  assert.deepEqual(result.points, [
    { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
    { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
  ])
  for (const revision of result.revisions) {
    const original = revision.content_sha256 === sha256(cdata) ? cdata : largeSource
    assert.equal(revision.source_bytes_base64, Buffer.from(original).toString('base64'))
    assert.equal(revision.content_sha256, sha256(original))
    delete revision.source_bytes_base64
  }
  assert.equal(result.revisions.length, 2)
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
