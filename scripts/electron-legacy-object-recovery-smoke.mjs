#!/usr/bin/env node

// Bounded packaged-native legacy object recovery proof (DON-254).
//
// The fixture is created by the packaged mission-store module, seeded with the
// exact legacy 50,000-marker shape, then reopened by that same packaged module.
// The count observer runs in this controller process, so the Electron main
// timer measures the production main isolate rather than the observer.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { _electron as electron } from 'playwright'
import { extractFile } from '@electron/asar'

import {
  installMainEventLoopProbe,
  validateMainEventLoopEvidence,
} from '../build/main-event-loop-probe.js'
import {
  assertPostSettlementMarkerCustody,
} from '../build/electron-legacy-object-recovery-custody.js'
import checkpointContract from '../electron/legacy-evidence-backfill-checkpoint.cjs'

const { validateLegacyEvidenceBackfillCheckpoint } = checkpointContract

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const EXPECTED_BASELINE_ROWS = 50_000
const PROBE_TIMEOUT_MS = 60_000
const IMPLICATED_PACKAGED_FILES = [
  'electron/legacy-evidence-backfill-runner.cjs',
  'electron/legacy-evidence-backfill-worker.cjs',
  'electron/legacy-evidence-backfill-checkpoint.cjs',
  'electron/mission-evidence-version-store.cjs',
  'electron/mission-store.cjs',
  'electron/mission-worker.cjs',
  'electron/responsive-mission-writer.cjs',
]

const executablePath = path.resolve(process.argv[2] ?? '')
const outputDir = path.resolve(process.argv[3] ?? 'tmp/don254-legacy-recovery/packaged-native')
assert.ok(process.argv[2], 'Pass the packaged Electron executable path as argv[2].')

let app
let uiProfile
let fixtureDir
let observer
const report = {
  proofTier: 'diagnostic-only second disposable mission store using packaged production store/runner via an injected factory; no default app wiring or operator-load qualification',
  issue: 'DON-254',
  expectedBaselineRows: EXPECTED_BASELINE_ROWS,
  passed: false,
}

main().catch(async (error) => {
  report.passed = false
  report.failure = error instanceof Error ? error.message : String(error)
  report.retainedFixturePath = fixtureDir ?? null
  report.cleanupFailures = [...(report.cleanupFailures ?? []), ...await cleanup({ retainFixture: true })]
  await writeReport().catch((writeError) => console.error(`Failed to write receipt: ${writeError.message}`))
  console.error(`electron-legacy-object-recovery-smoke: ${report.failure}`)
  process.exitCode = 1
})

/** Runs the packaged direct-store recovery, close, and restart proof. */
async function main() {
  await mkdir(outputDir, { recursive: true })
  uiProfile = await mkdtemp(path.join(tmpdir(), 'sartracker-don254-ui-'))
  // Synthetic fixture only; retained failures must travel with CI evidence.
  fixtureDir = await mkdtemp(path.join(outputDir, 'synthetic-fixture-'))
  report.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
  report.sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot, encoding: 'utf8' }).trim()
  report.sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim() !== ''
  if (process.env.EXPECTED_SOURCE_SHA) {
    assert.equal(report.sourceHead, process.env.EXPECTED_SOURCE_SHA)
    assert.equal(report.sourceDirty, false, 'CI source must be clean.')
  }
  if (process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1') {
    assert.equal(process.platform, 'linux')
    assert.equal(executablePath, path.join(projectRoot, 'tmp/electron-dist/linux-unpacked/sartracker-web'))
  }
  report.probeSource = {
    scriptSha256: await sha256File(fileURLToPath(import.meta.url)),
    mainTimerSha256: await sha256File(path.join(projectRoot, 'build/main-event-loop-probe.js')),
    custodyOracleSha256: await sha256File(path.join(projectRoot, 'build/electron-legacy-object-recovery-custody.js')),
  }
  app = await launchPackagedApp()
  const page = await app.firstWindow()
  await page.getByTestId('app-title').waitFor({ timeout: 60_000 })
  await recordPackagedIdentity()

  const mission = await evaluatePackaged(async ({ app: electronApp }, directory) => {
    const { createRequire } = process.getBuiltinModule('module')
    const packagedRequire = createRequire(`${electronApp.getAppPath()}/package.json`)
    const { createElectronMissionStore } = packagedRequire('./electron/mission-store.cjs')
    const store = createElectronMissionStore({ userDataPath: directory })
    const mission = await store.createMission({ name: 'DON-254 packaged legacy recovery' })
    await store.prepareClose()
    store.close()
    return mission
  }, fixtureDir)
  report.seededMarkerDigest = await seedExactLegacyFixture(path.join(fixtureDir, 'mission-store.sqlite'), mission.id)
  report.fixture = {
    directoryKind: 'disposable-second-direct-store-directory',
    missionId: mission.id,
    baselineMarkerRows: EXPECTED_BASELINE_ROWS,
    sqliteSha256: await sha256File(path.join(fixtureDir, 'mission-store.sqlite')),
  }

  await installPackagedMainProbe()
  report.firstLaunch = await openDirectPackagedStore(mission.id)
  assert.ok(report.firstLaunch.openMs < 200, `Packaged store open took ${report.firstLaunch.openMs}ms.`)
  assert.equal(report.firstLaunch.workerCount, 1)
  const initialFailures = await evaluatePackaged(async ({}, input) => {
    const state = globalThis.__DON254_LEGACY_RECOVERY__
    const errors = {}
    for (const [name, operation] of Object.entries({
      listVersions: () => state.store.listMissionObjectVersions({ missionId: input.missionId }),
      upsertMarker: () => state.store.upsertMarker({ mission_id: input.missionId, type: 'clue', name: 'Before settlement', description: 'Must remain gated', lat: 52.1, lon: -9.5, irish_grid_e: 480000, irish_grid_n: 580000, display_order: 0, updated_by: 'DON-254 probe' }),
    })) {
      try { await operation(); errors[name] = null } catch (error) { errors[name] = String(error?.message ?? error) }
    }
    return errors
  }, { missionId: mission.id })
  assert.match(initialFailures.listVersions ?? '', /legacy mutable evidence baselines.*background/iu)
  assert.match(initialFailures.upsertMarker ?? '', /legacy mutable evidence baselines.*background/iu)
  report.failClosedBeforeSettlement = initialFailures

  const currentWrite = await evaluatePackaged(async ({}, input) => {
    const state = globalThis.__DON254_LEGACY_RECOVERY__
    await state.store.upsertDevice({ mission_id: input.missionId, device_id: 'don254-current', name: 'Current', color: '#3b82f6', status: 'online' })
    const started = performance.now()
    await state.store.addPosition({ mission_id: input.missionId, device_id: 'don254-current', source_position_id: 'don254-during-backfill', lat: 52.1, lon: -9.5, timestamp: new Date().toISOString(), received_at: new Date().toISOString(), timestamp_source: 'fix' })
    return performance.now() - started
  }, { missionId: mission.id })
  assert.ok(currentWrite < 200, `Current packaged write took ${currentWrite}ms.`)
  report.firstLaunch.currentWriteMs = currentWrite

  observer = await openOffMainObserver(path.join(fixtureDir, 'mission-store.sqlite'))
  const settlement = await observer.waitForCount(EXPECTED_BASELINE_ROWS, PROBE_TIMEOUT_MS)
  report.firstLaunch.observer = settlement
  const completion = await evaluatePackaged(async () => {
    const state = globalThis.__DON254_LEGACY_RECOVERY__
    const completed = await Promise.all(state.workerCompletions)
    await new Promise((resolve) => setImmediate(resolve))
    return completed
  })
  report.firstLaunch.workerCompletion = completion
  assert.equal(completion.length, 1)
  assert.equal(completion[0]?.stopped, undefined)
  assert.ok(Number.isSafeInteger(completion[0]?.workerThreadId) && completion[0].workerThreadId > 0,
    'Recovery must complete through a real production worker.')
  assert.equal(
    validateLegacyEvidenceBackfillCheckpoint(
      completion[0]?.checkpoint,
      completion[0]?.checkpoint?.walSidecarBytes,
      { requireComplete: true },
    ),
    null,
    'Recovery completion must include a physically corroborated complete WAL checkpoint receipt.',
  )
  assert.notEqual(completion[0].workerThreadId, report.firstLaunch.parentThreadId,
    'Recovery completion must identify a different thread from Electron main.')
  report.firstLaunch.mainTimer = await stopPackagedMainProbe()
  assertTimer(report.firstLaunch.mainTimer, 'first launch recovery')
  await observer.close()
  observer = undefined

  report.firstLaunch.rows = inspectRows(path.join(fixtureDir, 'mission-store.sqlite'), mission.id)
  assertRows(report.firstLaunch.rows)
  assert.equal(report.firstLaunch.rows.markerDigest, report.seededMarkerDigest)
  assert.equal(Number(report.firstLaunch.rows.totalMarkerCount), EXPECTED_BASELINE_ROWS)
  report.settledBaselineDigest = report.firstLaunch.rows.baselineDigest

  await installPackagedMainProbe()
  report.firstLaunch.close = await evaluatePackaged(async () => {
    const state = globalThis.__DON254_LEGACY_RECOVERY__
    await new Promise((resolve) => setTimeout(resolve, 100))
    const started = performance.now()
    await state.store.prepareClose()
    const prepareCloseMs = performance.now() - started
    const closeStarted = performance.now()
    state.store.close()
    const closeMs = performance.now() - closeStarted
    const timer = globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__.stop()
    delete globalThis.__DON254_LEGACY_RECOVERY__
    return { prepareCloseMs, closeMs, timer }
  })
  assertTimer(report.firstLaunch.close.timer, 'first launch close')
  assert.ok(report.firstLaunch.close.prepareCloseMs < PROBE_TIMEOUT_MS)
  assert.equal(report.firstLaunch.close.timer.maximumGapMs >= 200, false)
  report.firstLaunch.appClose = await closePackagedApp('first launch')

  app = await launchPackagedApp()
  await (await app.firstWindow()).getByTestId('app-title').waitFor({ timeout: 60_000 })
  const restartArchivePath = await evaluatePackaged(({ app: electronApp }) => electronApp.getAppPath())
  assert.equal(await sha256File(restartArchivePath), report.packaged.asarSha256)
  assert.equal(await sha256File(executablePath), report.packaged.executableSha256)
  await installPackagedMainProbe()
  report.restart = await openDirectPackagedStore(mission.id)
  assert.ok(report.restart.openMs < 200, `Packaged restart store open took ${report.restart.openMs}ms.`)
  assert.equal(report.restart.workerCount, 0)
  await evaluatePackaged(() => new Promise((resolve) => setTimeout(resolve, 100)))
  report.restart.openTimer = await stopPackagedMainProbe()
  assertTimer(report.restart.openTimer, 'restart open')
  report.restart.rowsBeforeMutation = inspectRows(path.join(fixtureDir, 'mission-store.sqlite'), mission.id)
  assert.equal(report.restart.rowsBeforeMutation.baselineDigest, report.settledBaselineDigest)
  assertRows(report.restart.rowsBeforeMutation)
  assert.equal(report.restart.rowsBeforeMutation.markerDigest, report.seededMarkerDigest)
  assert.equal(Number(report.restart.rowsBeforeMutation.totalMarkerCount), EXPECTED_BASELINE_ROWS)
  // Bulk controller-side inspection is outside both measured main-loop intervals.
  await installPackagedMainProbe()
  const mutation = await evaluatePackaged(async ({}, input) => {
    const state = globalThis.__DON254_LEGACY_RECOVERY__
    await new Promise((resolve) => setTimeout(resolve, 100))
    const result = await state.store.upsertMarker({ mission_id: input.missionId, type: 'clue', name: 'After restart', description: 'Post-settlement mutation', lat: 52.1, lon: -9.5, irish_grid_e: 480000, irish_grid_n: 580000, display_order: 0, updated_by: 'DON-254 probe' })
    await state.store.prepareClose()
    state.store.close()
    const timer = globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__.stop()
    delete globalThis.__DON254_LEGACY_RECOVERY__
    return { markerId: result.id, timer }
  }, { missionId: mission.id })
  report.restart.postSettlementMutation = mutation
  assertTimer(mutation.timer, 'restart')
  assert.ok(mutation.timer.maximumGapMs < 200, `Restart main timer reached ${mutation.timer.maximumGapMs}ms.`)
  report.restart.rowsAfterMutation = inspectRows(path.join(fixtureDir, 'mission-store.sqlite'), mission.id)
  assertRows(report.restart.rowsAfterMutation)
  assert.equal(report.restart.rowsAfterMutation.markerDigest, report.seededMarkerDigest)
  assert.equal(report.restart.rowsAfterMutation.baselineDigest, report.settledBaselineDigest)
  assert.equal(report.restart.rowsAfterMutation.totalMarkerCount, EXPECTED_BASELINE_ROWS + 1)
  report.restart.postSettlementCustody = assertPostSettlementMarkerCustody(
    inspectPostSettlementMarkerCustody(
      path.join(fixtureDir, 'mission-store.sqlite'),
      mission.id,
      mutation.markerId,
    ),
  )
  report.restart.appClose = await closePackagedApp('restart')
  const cleanupFailures = await cleanup()
  report.cleanupFailures = cleanupFailures
  assert.deepEqual(cleanupFailures, [], 'Native proof cleanup failed.')
  report.passed = true
  await writeReport()
  console.log(`electron-legacy-object-recovery-smoke: passed; first-main-max=${report.firstLaunch.mainTimer.maximumGapMs.toFixed(2)}ms restart-main-max=${mutation.timer.maximumGapMs.toFixed(2)}ms`)
}

/** Records executable, ASAR, and checkout-matched production inputs. */
async function recordPackagedIdentity() {
  const archivePath = await evaluatePackaged(({ app: electronApp }) => electronApp.getAppPath())
  assert.ok(archivePath.endsWith('.asar'), `Packaged app path was not an ASAR: ${archivePath}`)
  report.packaged = { bindingScope: 'ASAR identity and seven implicated production source files; local dirty probe sources are hashed separately', executableSha256: await sha256File(executablePath), asarSha256: await sha256File(archivePath), files: {} }
  for (const file of IMPLICATED_PACKAGED_FILES) {
    const checkout = await readFile(path.join(projectRoot, file))
    const packaged = extractFile(archivePath, file)
    report.packaged.files[file] = { checkoutSha256: sha256(checkout), packagedSha256: sha256(packaged) }
    assert.equal(report.packaged.files[file].packagedSha256, report.packaged.files[file].checkoutSha256, `Packaged source mismatch: ${file}`)
  }
}

/** Installs the existing independent timer inside the real packaged main isolate. */
async function installPackagedMainProbe() {
  await evaluatePackaged(({}, source) => {
    const install = Function(`return (${source})`)()
    globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__ = install(globalThis)
    return true
  }, installMainEventLoopProbe.toString())
}

/** Stops the in-process timer without using inspector latency as its evidence. */
async function stopPackagedMainProbe() {
  return evaluatePackaged(() => globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__?.stop() ?? null)
}

/** Opens the production store and retains the real worker completion promise. */
async function openDirectPackagedStore(missionId) {
  return evaluatePackaged(async ({ app: electronApp }, input) => {
    const { createRequire } = process.getBuiltinModule('module')
    const packagedRequire = createRequire(`${electronApp.getAppPath()}/package.json`)
    const { createElectronMissionStore } = packagedRequire('./electron/mission-store.cjs')
    const { startLegacyEvidenceBackfillWorker } = packagedRequire('./electron/legacy-evidence-backfill-runner.cjs')
    const workerCompletions = []
    const started = performance.now()
    const store = createElectronMissionStore({
      userDataPath: input.directory,
      startLegacyEvidenceBackfillWorker: (input) => {
        const worker = startLegacyEvidenceBackfillWorker(input)
        workerCompletions.push(worker.completion)
        return worker
      },
    })
    globalThis.__DON254_LEGACY_RECOVERY__ = { store, workerCompletions, missionId: input.missionId }
    return { openMs: performance.now() - started, workerCount: workerCompletions.length,
      parentThreadId: packagedRequire('node:worker_threads').threadId }
  }, { directory: fixtureDir, missionId })
}

/** Launches the packaged binary with an empty isolated UI profile and blocked network. */
async function launchPackagedApp() {
  const args = process.platform === 'linux'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows']
    : []
  return electron.launch({ executablePath, args,
    env: { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: uiProfile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' },
    timeout: 60_000 })
}

/** Creates exactly the legacy 50,000-marker source used by the unit oracle. */
async function seedExactLegacyFixture(databasePath, missionId) {
  const db = new Database(databasePath)
  try {
    db.prepare(`WITH RECURSIVE numbers(n) AS (VALUES (0) UNION ALL SELECT n + 1 FROM numbers WHERE n < 49999)
      INSERT INTO markers (id, mission_id, type, name, description, lat, lon, irish_grid_e, irish_grid_n, created_at, updated_at, display_order, updated_by)
      SELECT printf('legacy-marker-%05d', n), ?, 'clue', printf('Legacy marker %05d', n), 'Retained legacy evidence', 52.1, -9.5, 480000, 580000,
        '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z', n, 'Legacy coordinator' FROM numbers`).run(missionId)
    db.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run()
    db.exec('DROP TABLE mission_object_versions; DROP TABLE legacy_mission_object_backfill_state;')
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM markers WHERE id LIKE 'legacy-marker-%'").get().count, EXPECTED_BASELINE_ROWS)
    return rowsDigest(db.prepare("SELECT * FROM markers WHERE mission_id = ? AND id LIKE 'legacy-marker-%' ORDER BY id").all(missionId))
  } finally { db.close() }
}

/** Keeps the count query off Electron main while retaining its timing evidence. */
async function openOffMainObserver(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  let closed = false
  return {
    /** Polls the exact scalar count at the original 10 ms cadence. */
    async waitForCount(target, timeoutMs) {
      const started = Date.now(); const samples = []; let count = 0
      for (let attempt = 0; attempt < 4_500 && Date.now() - started < timeoutMs && count < target; attempt += 1) {
        await delay(10)
        const queryStarted = performance.now()
        const result = db.prepare('SELECT COUNT(*) AS count FROM mission_object_versions').get()
        count = Number(result.count); samples.push(performance.now() - queryStarted)
      }
      if (count !== target) throw new Error(`Off-main observer reached ${count}/${target} rows before timeout.`)
      return { count, samples: samples.length, maximumQueryMs: Math.max(...samples), observerRealm: 'controller-process' }
    },
    /** Closes the controller's read-only SQLite handle. */
    async close() {
      if (!closed) { db.close(); closed = true }
    },
  }
}

/** Produces bounded row-state, custody, ordering, and baseline digest evidence. */
function inspectRows(databasePath, missionId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const markerRows = db.prepare(
      'SELECT * FROM markers WHERE mission_id = ? AND id LIKE \'legacy-marker-%\' ORDER BY id',
    ).all(missionId)
    const baselineRows = db.prepare(`SELECT *
      FROM mission_object_versions WHERE mission_id = ? AND object_type = 'marker' AND object_id LIKE 'legacy-marker-%' ORDER BY object_id, version_sequence`).all(missionId)
    assert.equal(baselineRows.length, markerRows.length, 'Baseline custody row count did not match legacy marker count.')
    for (const [index, marker] of markerRows.entries()) {
      const version = baselineRows[index]
      assert.equal(version.object_type, 'marker')
      assert.equal(version.object_id, marker.id, `Baseline ordering changed at marker ${marker.id}.`)
      assert.equal(Number(version.version_sequence), 1, `Baseline version sequence changed at marker ${marker.id}.`)
      assert.equal(version.operation, 'legacy_baseline')
      assert.equal(version.completeness, 'legacy_baseline')
      assert.deepEqual(JSON.parse(version.state_json), {
        ...marker,
        legacy_history_known: false,
        legacy_source_effective_at: marker.created_at,
      }, `Baseline state changed at marker ${marker.id}.`)
    }
    const summary = db.prepare(`SELECT
      (SELECT COUNT(*) FROM markers WHERE mission_id = ? AND id LIKE 'legacy-marker-%') AS markerCount,
      (SELECT COUNT(*) FROM markers WHERE mission_id = ?) AS totalMarkerCount,
      (SELECT COUNT(*) FROM mission_object_versions WHERE mission_id = ? AND object_type = 'marker' AND object_id LIKE 'legacy-marker-%') AS versionCount,
      (SELECT COUNT(DISTINCT object_id) FROM mission_object_versions WHERE mission_id = ? AND object_type = 'marker' AND object_id LIKE 'legacy-marker-%') AS distinctVersionCount,
      (SELECT COUNT(*) FROM mission_object_versions WHERE mission_id = ? AND object_type = 'marker' AND object_id LIKE 'legacy-marker-%' AND operation = 'legacy_baseline' AND completeness = 'legacy_baseline') AS baselineCount,
      (SELECT COUNT(*) FROM markers m LEFT JOIN mission_object_versions v ON v.mission_id = m.mission_id AND v.object_type = 'marker' AND v.object_id = m.id WHERE m.mission_id = ? AND m.id LIKE 'legacy-marker-%' AND v.object_id IS NULL) AS missingCustody,
      (SELECT COUNT(*) FROM (SELECT object_id FROM mission_object_versions WHERE mission_id = ? AND object_type = 'marker' AND object_id LIKE 'legacy-marker-%' GROUP BY object_id HAVING COUNT(*) != 1)) AS duplicateObjects`).get(missionId, missionId, missionId, missionId, missionId, missionId, missionId)
    return { ...summary, markerDigest: rowsDigest(markerRows), baselineDigest: rowsDigest(baselineRows) }
  } finally { db.close() }
}

/** Reads one post-settlement marker with its immutable version and audit rows. */
function inspectPostSettlementMarkerCustody(databasePath, missionId, markerId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const marker = db.prepare(
      'SELECT * FROM markers WHERE mission_id = ? AND id = ?',
    ).get(missionId, markerId)
    const versions = db.prepare(`SELECT * FROM mission_object_versions
      WHERE mission_id = ? AND object_type = 'marker' AND object_id = ?
      ORDER BY version_sequence`).all(missionId, markerId)
    const auditEvents = db.prepare(`SELECT * FROM mission_events
      WHERE mission_id = ? AND event_type IN ('marker_created', 'marker_updated', 'marker_deleted')
      ORDER BY rowid`).all(missionId)
    return { missionId, marker, versions, auditEvents }
  } finally { db.close() }
}

/** Rejects any missing, duplicated, reordered, or incomplete baseline row. */
function assertRows(rows) {
  for (const key of ['markerCount', 'versionCount', 'distinctVersionCount', 'baselineCount']) assert.equal(Number(rows[key]), EXPECTED_BASELINE_ROWS, `${key} was not exactly 50,000.`)
  for (const key of ['missingCustody', 'duplicateObjects']) assert.equal(Number(rows[key]), 0, `${key} was non-zero.`)
}

/** Applies the existing packaged timer validator and a local strict gate. */
function assertTimer(timer, phase) {
  assert.ok(timer !== null, `${phase} did not return main timer evidence.`)
  assert.deepEqual(validateMainEventLoopEvidence([timer], 1), [], `${phase} main timer evidence was invalid.`)
  assert.ok(timer.maximumGapMs < 200, `${phase} main timer reached ${timer.maximumGapMs}ms.`)
}

/** Joins one packaged Electron process and requires a clean native exit. */
async function closePackagedApp(phase) {
  const processHandle = app.process()
  await bounded(app.close(), `${phase} packaged close`)
  const result = { code: processHandle.exitCode, signal: processHandle.signalCode }
  assert.equal(result.code, 0, `${phase} packaged Electron exited with code ${result.code}.`)
  assert.equal(result.signal, null, `${phase} packaged Electron exited from signal ${result.signal}.`)
  app = undefined
  return result
}

/** Writes only bounded JSON evidence after every terminal path. */
async function writeReport() {
  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}

/** Hashes the complete ordered evidence rows, including native custody fields. */
function rowsDigest(rows) {
  const digest = createHash('sha256')
  for (const row of rows) digest.update(`${JSON.stringify(row)}\n`)
  return digest.digest('hex')
}

/** Hashes bytes without converting their encoding. */
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
/** Hashes a named immutable input. */
async function sha256File(file) { return sha256(await readFile(file)) }
/** Preserves the observer's original ten millisecond polling delay. */
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

/** Bounds controller waits; a timeout fails the proof and invokes owned cleanup. */
async function bounded(operation, label, timeoutMs = PROBE_TIMEOUT_MS) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

/** Gives every main-process request a controller-owned failure deadline. */
function evaluatePackaged(operation, input) {
  return bounded(app.evaluate(operation, input), 'Packaged main request')
}

/** Joins probe-owned handles and keeps the fixture when the proof fails. */
async function cleanup({ retainFixture = false } = {}) {
  const failures = []
  const ownedObserver = observer
  observer = undefined
  if (ownedObserver) {
    try { await ownedObserver.close() } catch (error) { failures.push(`Observer close: ${error.message}`) }
  }
  const ownedApp = app
  app = undefined
  if (ownedApp) {
    try { await bounded(ownedApp.close(), 'Failure cleanup close', 5_000) } catch (error) {
      failures.push(`App close: ${error.message}`)
      const processHandle = ownedApp.process()
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        const exited = new Promise((resolve) => processHandle.once('exit', resolve))
        processHandle.kill('SIGKILL')
        try { await bounded(exited, 'Forced failure cleanup exit', 5_000) } catch (joinError) {
          failures.push(joinError.message)
        }
      }
    }
  }
  for (const directory of [uiProfile, retainFixture || failures.length > 0 ? undefined : fixtureDir]) {
    if (directory === undefined) continue
    if (directory === fixtureDir && failures.length > 0) continue
    try { await rm(directory, { recursive: true, force: true }) } catch (error) {
      failures.push(`Remove ${directory}: ${error.message}`)
    }
  }
  return failures
}
