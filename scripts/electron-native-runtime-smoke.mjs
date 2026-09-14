#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile } from '@electron/asar'
import { _electron as electron } from 'playwright'
import { attachPackagedPageDiagnostics, createPackagedStderrCollector, sanitizePackagedDiagnosticText as sanitize } from '../build/packaged-page-diagnostics.js'
import { appendBoundedDiagnostic, assertNoUnexpectedDiagnostics, closeOwnedSmokeChild, createDiagnosticState, runBounded } from '../build/electron-repair-train-d-smoke-lib.js'
import { validateNativeRuntimeReceipt } from '../build/native-runtime-smoke-receipt.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const executablePath = path.resolve(process.argv[2] ?? '')
const output = path.resolve(process.argv[3] ?? 'tmp/native-runtime-repair/scoped-native')
const diagnostics = createDiagnosticState()
const report = { issue: 'DON-254', result: 'fail', boundary: 'packaged file startup and actual preload IPC; separately injected packaged-store snapshot/cancellation control; not Train D, timing, field or release qualification', diagnostics }
let app
let profile
let phase = 'launch'
const stderrEvents = []

/** Recognizes only the attached inspector's exact disconnect transport lines. */
function isInspectorTransport(entry) {
  return /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/u.test(entry.message)
    || entry.message === 'For help, see: https://nodejs.org/en/docs/inspector'
}

/** Captures complete sanitized stderr lines with their delivery phase and time. */
const stderrCollector = createPackagedStderrCollector((message) => {
  const entry = { message, phase, at: new Date().toISOString(), elapsedMs: performance.now() - diagnostics.captureStartedAt }
  stderrEvents.push(entry)
  if (!isInspectorTransport(entry)) {
    appendBoundedDiagnostic(diagnostics, 'processStderr', entry, { phase, type: 'stderr', source: 'main-process-stderr' })
  }
})

/** Hashes retained bytes without interpreting their content. */
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }

/** Runs one bounded native control and always joins its owned child. */
async function main() {
  assert.ok(process.argv[2], 'Provide the packaged executable path.')
  await mkdir(output, { recursive: true })
  profile = await mkdtemp(path.join(os.tmpdir(), 'sartracker-native-runtime-'))
  await mkdir(path.join(profile, 'separate-synthetic-store'))
  report.source = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
  }
  if (process.env.EXPECTED_SOURCE_SHA) {
    assert.equal(report.source.head, process.env.EXPECTED_SOURCE_SHA)
    assert.equal(report.source.dirty, false, 'CI native source must be clean.')
  }
  report.harness = Object.fromEntries(await Promise.all([
    'scripts/electron-native-runtime-smoke.mjs', 'build/packaged-page-diagnostics.js',
    'build/electron-repair-train-d-smoke-lib.js', 'electron/diagnostic-sanitizer.cjs',
    'build/native-runtime-smoke-receipt.js',
  ].map(async file => [file, hash(await readFile(path.join(root, file)))])))
  app = await electron.launch({
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'] : [],
    env: { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' },
    timeout: 30_000,
  })
  app.process().stderr?.on('data', stderrCollector.write)
  const attached = new Set()
  const attach = page => {
    if (attached.has(page)) return
    attached.add(page)
    attachPackagedPageDiagnostics(page, (field, entry, type, source) => {
      appendBoundedDiagnostic(diagnostics, field, entry, { phase, type, source })
    }, sanitize)
  }
  app.on('window', attach)
  for (const page of app.windows()) attach(page)
  const page = await app.firstWindow()
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
  const archive = await app.evaluate(({ app: runningApp }) => runningApp.getAppPath())
  assert.ok(archive.endsWith('.asar'))
  report.package = { archiveSha256: hash(await readFile(archive)), inputs: {} }
  for (const file of ['electron/mission-store.cjs', 'electron/coverage-query-worker.cjs',
    'electron/coverage-query-runner.cjs', 'electron/coverage-ipc.cjs', 'electron/coverage-owner-lifecycle.cjs']) {
    const packaged = hash(extractFile(archive, file))
    assert.equal(packaged, hash(await readFile(path.join(root, file))), `Packaged input mismatch: ${file}`)
    report.package.inputs[file] = packaged
  }
  phase = 'preload-ipc'
  report.ipc = await page.evaluate(async () => {
    const store = window.sartrackerElectron.missionStore
    const mission = await store.createMission({ name: 'Native runtime IPC control', start_time: '2026-08-24T08:00:00.000Z' })
    await store.readCoverageManifest(mission.id, 'native-warmup')
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) =>
      store.readCoverageManifest(mission.id, `native-concurrent-${index}`)))
    return { protocol: location.protocol, count: results.length,
      allEnumerated: results.every(result => result.enumerated && result.chunks.length === 0),
      serviceWorkers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0 }
  })
  assert.equal(report.ipc.protocol, 'file:')
  assert.equal(report.ipc.count, 24)
  assert.equal(report.ipc.allEnumerated, true)
  assert.equal(report.ipc.serviceWorkers, 0)
  phase = 'packaged-store-snapshot-and-exit'
  report.store = await app.evaluate(async ({ app: runningApp }, fixtureDirectory) => {
    const { createRequire } = process.getBuiltinModule('module')
    const load = createRequire(`${runningApp.getAppPath()}/package.json`)
    const { createElectronMissionStore } = load('./electron/mission-store.cjs')
    const { runCoverageQueryInWorker } = load('./electron/coverage-query-runner.cjs')
    let store
    let added = false
    let cancelNext = false
    let physicalExit = false
    store = createElectronMissionStore({ userDataPath: fixtureDirectory,
      runCoverageQueryInWorker: async input => {
        if (input.query.kind === 'enumerate' && !added) {
          added = true
          await store.createOuting({ mission_id: input.query.missionId, label: 'Concurrent native outing', started_at: '2026-08-24T08:30:00.000Z' })
        }
        if (cancelNext) {
          const controller = new AbortController()
          const operation = runCoverageQueryInWorker({ ...input, signal: controller.signal })
          operation.workerExited.then(() => { physicalExit = true })
          controller.abort()
          try { await operation } catch (error) {
            await operation.workerExited
            throw error
          }
        }
        return runCoverageQueryInWorker(input)
      },
    })
    try {
      const mission = await store.createMission({ name: 'Native snapshot control', start_time: '2026-08-24T08:00:00.000Z' })
      await store.upsertDevice({ mission_id: mission.id, device_id: 'synthetic-1', name: 'Synthetic device', color: '#fff', status: 'online' })
      await store.addPositionsBulk({ mission_id: mission.id, positions: [{ device_id: 'synthetic-1', source_position_id: 'native-fix', lat: 52, lon: -9.7, timestamp: '2026-08-24T09:00:00.000Z', timestamp_source: 'fix' }] })
      const manifest = await store.readCoverageManifest(mission.id, 'native-race')
      cancelNext = true
      let cancellation = null
      try { await store.readCoverageManifest(mission.id, 'native-abort') } catch (error) { cancellation = error.name }
      await store.prepareClose()
      return { added, kinds: manifest.chunks.map(chunk => chunk.key.period_kind).sort(),
        exactFixes: manifest.chunks.reduce((sum, chunk) => sum + chunk.exactCount, 0), cancellation, physicalExit }
    } finally { await store.prepareClose(); store.close() }
  }, path.join(profile, 'separate-synthetic-store'))
  assert.deepEqual(report.store.kinds, ['outing', 'unassigned'])
  assert.equal(report.store.exactFixes, 1)
  assert.equal(report.store.cancellation, 'AbortError')
  assert.equal(report.store.physicalExit, true)
  await page.screenshot({ path: path.join(output, 'packaged-runtime.png') })
}

try {
  const outcome = await runBounded(main, 90_000)
  assert.equal(outcome.completed, true, 'Native runtime control exceeded 90 seconds.')
  report.result = 'pass'
} catch (error) {
  report.failure = sanitize(error.message)
} finally {
  phase = 'close'
  if (app) {
    const now = Date.now()
    report.close = await closeOwnedSmokeChild(app.process(), {
      owned: true, close: () => app.close(), orderlyDeadline: now + 15_000, deadline: now + 25_000,
    }).catch(error => ({ failure: sanitize(error.message) }))
    if (report.close.closeError) report.close.closeError = sanitize(report.close.closeError.message)
    if (report.close.exit?.exitCode !== 0 || report.close.forcedCleanup !== null || report.close.closeError !== null) report.result = 'fail'
  }
  stderrCollector.flush()
  report.stderr = stderrEvents
  // These exact lines are emitted by the Playwright-attached Node inspector at
  // disconnect. Retain them separately; application warnings/errors still fail.
  report.inspectorTransport = report.stderr.filter(isInspectorTransport)
  try { assertNoUnexpectedDiagnostics(diagnostics) } catch (error) { report.result = 'fail'; report.diagnosticFailure = sanitize(error.message) }
  report.profileRemoved = false
  if (profile && (!app || report.close?.exit !== null && report.close?.exit !== undefined)) {
    await rm(profile, { recursive: true, force: true })
    report.profileRemoved = true
  }
  try { validateNativeRuntimeReceipt(report, process.env.EXPECTED_SOURCE_SHA) }
  catch (error) { report.result = 'fail'; report.validationFailure = sanitize(error.message) }
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'receipt.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ result: report.result, failure: report.failure, diagnosticFailure: report.diagnosticFailure, receipt: path.join(output, 'receipt.json') }))
  if (report.result !== 'pass') process.exitCode = 1
}
