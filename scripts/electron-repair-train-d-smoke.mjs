#!/usr/bin/env node

// Bounded packaged proof for Repair Train D AUD-08/DON-271 and
// AUD-09/DON-279. This runner deliberately uses the production renderer,
// preload bridge, Electron main process, Search Operations worker, and SQLite
// files. The provider is a disposable loopback Traccar subset; settings and
// Search Operations rows are setup writes made through documented boundaries.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractFile } from '@electron/asar'
import { _electron as electron } from 'playwright'
import { attachPackagedPageDiagnostics, createPackagedStderrCollector, sanitizePackagedDiagnosticText, waitForPackagedStderrDrain } from '../build/packaged-page-diagnostics.js'
import {
  appendBoundedDiagnostic,
  assertNoUnexpectedDiagnostics,
  collectUnexpectedDiagnostics,
  closeOwnedSmokeChild,
  createDiagnosticState,
  createSmokeDiagnosticAllowlist,
  createSmokeDeadlines,
  evaluateSmokeResults,
  historyRequestCoversWindow,
  isMissionReadyForRecovery,
  isBoundedHistoryHoldRequest,
  remainingSmokeTime,
  runBounded,
} from '../build/electron-repair-train-d-smoke-lib.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const runnerPath = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(runnerPath), '..')

const GROUP_ID = '101'
const SUCCESS_DEVICE_ID = '11'
const HELD_DEVICE_ID = '22'
const SEARCH_AREA_COUNT = 26
const CONDITION_TIMEOUT_MS = 45_000
const CLOSE_TIMEOUT_MS = 20_000
const SMOKE_DEADLINE_MS = 240_000
const CLEANUP_RESERVE_MS = 20_000
const CLEANUP_ESCALATION_RESERVE_MS = 10_000
let scenarioDeadline = Number.POSITIVE_INFINITY
let cleanupDeadline = Number.POSITIVE_INFINITY
let cleanupPreEscalationDeadline = Number.POSITIVE_INFINITY
let operationDeadline = Number.POSITIVE_INFINITY

main().catch((error) => {
  console.error(`electron-repair-train-d-smoke: ${messageOf(error)}`)
  process.exitCode = 1
})

/** Runs the bounded packaged proof and writes a receipt for the parent task. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const deadlines = createSmokeDeadlines(
    Date.now(),
    SMOKE_DEADLINE_MS,
    CLEANUP_RESERVE_MS,
    CLEANUP_ESCALATION_RESERVE_MS,
  )
  scenarioDeadline = deadlines.scenarioDeadline
  cleanupDeadline = deadlines.cleanupDeadline
  cleanupPreEscalationDeadline = deadlines.cleanupPreEscalationDeadline
  operationDeadline = scenarioDeadline
  const evidenceDir = path.resolve(options.evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  const profile = await mkdtemp(path.join(os.tmpdir(), 'sartracker-repair-train-d-'))
  const sourceStatus = gitOutput(['status', '--porcelain'])
  const sourceDiff = gitOutput(['diff', 'HEAD', '--no-ext-diff', '--binary'])
  const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA ?? null
  const expectedSourceTree = process.env.EXPECTED_SOURCE_TREE ?? null
  const report = {
    schemaVersion: 1,
    issues: ['DON-271', 'DON-279'],
    proof: 'actual packaged Electron preload IPC, main mission store, Search Operations worker, SQLite, backup, and restart; bounded Search Operations IPC pagination with separate browser-rendered evidence; disposable loopback Traccar provider',
    qualificationBoundary: 'bounded packaged smoke only; no BCP17, release, field, or timing qualification claim',
    startedAt: new Date().toISOString(),
    source: {
      head: gitValue(['rev-parse', 'HEAD']),
      tree: gitValue(['rev-parse', 'HEAD^{tree}']),
      dirty: sourceStatus.trim().length > 0,
      statusSha256: sha256(sourceStatus),
      diffSha256: sha256(sourceDiff),
      diffBytes: Buffer.byteLength(sourceDiff, 'utf8'),
      proofMode: expectedSourceSha === null ? 'local-working-tree' : 'exact-head-clean-tree',
      expectedSourceSha,
      expectedSourceTree,
    },
    runnerPath,
    runnerSha256: await sha256File(runnerPath),
    diagnosticHelperSha256: await sha256File(path.join(projectRoot, 'build/packaged-page-diagnostics.js')),
    executablePath: path.resolve(options.appPath),
    evidenceDirectory: evidenceDir,
    profile,
    profileRetention: { status: 'pending', path: profile, credentials: '[redacted]' },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      launchArgs: process.platform === 'linux'
        ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
        : [],
      requireLinuxUnpacked: process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1',
      network: 'main-process loopback provider only; renderer egress blocked',
      deadlines: {
        totalMs: SMOKE_DEADLINE_MS,
        cleanupReserveMs: CLEANUP_RESERVE_MS,
        escalationReserveMs: CLEANUP_ESCALATION_RESERVE_MS,
      },
    },
    package: null,
    provider: null,
    launches: [],
    phases: {},
    scenarioResults: { aud08: 'pending', aud09: 'pending', restart: 'pending' },
    scenarioResult: 'pending',
    diagnosticResult: 'pending',
    diagnosticBlockers: [],
    failures: [],
    result: 'fail',
  }

  let provider = null
  let activeLaunch = null
  let failure = null
  let activeScenario = null
  const cleanupFailures = []

  try {
    const appPath = path.resolve(options.appPath)
    assertBeforeDeadline('packaged smoke startup')
    assert.ok(await isRegularFile(appPath), `Packaged Electron executable does not exist: ${appPath}`)
    if (expectedSourceSha !== null) {
      assert.equal(report.source.head, expectedSourceSha, 'Smoke source head does not match EXPECTED_SOURCE_SHA.')
      assert.equal(report.source.dirty, false, 'Exact-head packaged smoke requires a clean source tree.')
    }
    if (expectedSourceTree !== null) {
      assert.equal(report.source.tree, expectedSourceTree, 'Smoke source tree does not match EXPECTED_SOURCE_TREE.')
    }
    if (process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1') {
      const unpackedRoot = `${path.resolve(projectRoot, 'tmp', 'electron-dist', 'linux-unpacked')}${path.sep}`
      assert.equal(process.platform, 'linux', 'Linux packaged smoke must run on Linux.')
      assert.ok(appPath.startsWith(unpackedRoot), 'Smoke must run the CI-built linux-unpacked executable.')
    }
    provider = await startSyntheticProvider()
    report.provider = provider.describe()
    await seedSyntheticSettings(profile, provider.origin)

    activeLaunch = await launchPackaged(appPath, profile, 'repair-train-d-initial', report)
    activeLaunch.diagnosticPhase = 'attestation'
    report.package = await attestPackagedInputs(activeLaunch.app, appPath, activeLaunch.page)

    assertBeforeDeadline('AUD-08')
    activeScenario = 'aud08'
    activeLaunch.diagnosticPhase = 'aud08'
    const aud08 = await runAud08({
      launch: activeLaunch,
      provider,
      evidenceDir,
    })
    report.phases.aud08 = aud08
    report.scenarioResults.aud08 = 'pass'

    assertBeforeDeadline('AUD-09')
    activeScenario = 'aud09'
    activeLaunch.diagnosticPhase = 'aud09'
    const aud09 = await runAud09({
      launch: activeLaunch,
      evidenceDir,
      profile,
    })
    report.phases.aud09 = aud09
    report.scenarioResults.aud09 = 'pass'

    assertBeforeDeadline('first packaged close')
    activeLaunch.diagnosticPhase = 'close'
    await closeLaunch(activeLaunch, report, provider)
    activeLaunch = null

    assertBeforeDeadline('packaged restart')
    activeScenario = 'restart'
    activeLaunch = await launchPackaged(appPath, profile, 'repair-train-d-restart', report)
    activeLaunch.diagnosticPhase = 'restart'
    await ensureMissionActive(activeLaunch.page, aud08.missionId)
    report.phases.restart = await verifyRestart({
      launch: activeLaunch,
      aud08,
      aud09,
      evidenceDir,
    })
    report.scenarioResults.restart = 'pass'
    activeScenario = null
    await closeLaunch(activeLaunch, report, provider)
    activeLaunch = null

    report.provider = provider.describe()
    try {
      assertNoUnexpectedDiagnosticsForReport(report)
      report.diagnosticResult = 'pass'
    } catch (diagnosticError) {
      recordDiagnosticFailure(report, diagnosticError)
      throw diagnosticError
    }
  } catch (error) {
    failure = error
    if (activeScenario !== null && report.scenarioResults[activeScenario] === 'pending') {
      report.scenarioResults[activeScenario] = 'fail'
    }
    report.failures.push(messageOf(error))
    if (activeLaunch !== null) {
      try {
        const failureScreenshot = path.join(evidenceDir, 'failure.png')
        const screenshotTimeout = Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline))
        if (screenshotTimeout > 0) {
          await boundedPageScreenshot(activeLaunch.page, {
            path: failureScreenshot,
            fullPage: true,
          }, 'failure screenshot')
          report.failureScreenshot = failureScreenshot
        }
      } catch (screenshotError) {
        report.failures.push(`Failure screenshot could not be captured: ${messageOf(screenshotError)}`)
      }
    }
  } finally {
    if (activeLaunch !== null) {
      try {
        await closeLaunch(activeLaunch, report, provider)
      } catch (closeError) {
        cleanupFailures.push(`Cleanup close failed: ${messageOf(closeError)}`)
      }
    }
    if (provider !== null) {
      try {
        const providerTimeout = Math.min(CLOSE_TIMEOUT_MS, remainingSmokeTime(cleanupDeadline))
        await provider.close(providerTimeout)
      } catch (providerError) {
        cleanupFailures.push(`Synthetic provider close failed: ${messageOf(providerError)}`)
      }
      report.provider = provider.describe()
    }
    report.failures.push(...cleanupFailures)
    report.finishedAt = new Date().toISOString()
    if (report.diagnosticResult === 'pending') {
      try {
        assertNoUnexpectedDiagnosticsForReport(report)
        report.diagnosticResult = 'pass'
      } catch (diagnosticError) {
        recordDiagnosticFailure(report, diagnosticError)
      }
    }
    const evaluatedResults = evaluateSmokeResults(report.scenarioResults, report.diagnosticResult)
    report.scenarioResult = evaluatedResults.scenarioResult
    if (evaluatedResults.result !== 'pass' && report.failures.length === 0) {
      report.failures.push('Packaged smoke did not complete all required scenarios and diagnostics.')
    }
    report.result = evaluatedResults.result === 'pass' && report.failures.length === 0
      ? 'pass' : 'fail'
    if (report.result === 'pass') {
      try {
        await rm(profile, { recursive: true, force: true })
        report.profileRetention = {
          status: 'removed',
          path: '[removed disposable profile]',
          credentials: '[redacted]',
        }
      } catch (profileError) {
        report.failures.push(`Disposable profile cleanup failed: ${messageOf(profileError)}`)
        report.result = 'fail'
      }
    }
    if (report.result !== 'pass') {
      report.profileRetention = {
        status: 'retained-for-failure-inspection',
        path: profile,
        credentials: '[redacted]',
      }
    }
    try {
      await writeFile(path.join(evidenceDir, 'receipt.json'), JSON.stringify(report, null, 2), 'utf8')
    } catch (receiptError) {
      cleanupFailures.push(`Receipt write failed: ${messageOf(receiptError)}`)
      report.failures.push(`Receipt write failed: ${messageOf(receiptError)}`)
      report.result = 'fail'
    }
  }

  if (failure !== null) throw failure
  if (cleanupFailures.length > 0 || report.failures.length > 0) {
    throw new Error(`Packaged smoke failed: ${report.failures.join('; ')}`)
  }
}

/** Parses the deliberately small packaged-only command line. */
function parseArgs(argv) {
  let appPath = null
  let evidenceDir = path.join(projectRoot, 'tmp', 'repair-train-d-package-smoke')
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--app') {
      appPath = argv[++index]
    } else if (argument === '--evidence') {
      evidenceDir = argv[++index]
    } else if (argument === '--help') {
      console.log('Usage: node scripts/electron-repair-train-d-smoke.mjs --app <packaged-executable> [--evidence <directory>]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (typeof appPath !== 'string' || appPath.trim() === '') {
    throw new Error('Pass the packaged Electron executable with --app; this proof never falls back to Electron source.')
  }
  return { appPath, evidenceDir }
}

/** Seeds only disposable settings and credentials before packaged launch. */
async function seedSyntheticSettings(profile, origin) {
  const { createElectronSettingsStore } = require(path.join(projectRoot, 'electron', 'settings-store.cjs'))
  const settingsStore = createElectronSettingsStore({ userDataPath: profile })
  const settings = await settingsStore.loadAppSettings()
  await settingsStore.saveAppSettings({
    ...settings,
    missionDefaults: {
      ...settings.missionDefaults,
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 1,
      autoSaveEnabled: false,
    },
    dataSource: {
      ...settings.dataSource,
      providerType: 'traccar_http',
      baseUrl: origin,
      authMode: 'basic',
      email: 'repair-train-d@example.invalid',
      secretInput: 'repair-train-d-secret',
      autoConnect: true,
      trackingCacheEnabled: false,
    },
  })
}

/** Starts a deterministic loopback Traccar subset with one held history device. */
async function startSyntheticProvider() {
  let roster = 'initial'
  let historyMode = 'allow'
  let observedAt = Date.now()
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const isHistory = url.searchParams.has('from') || url.searchParams.has('to')
    const deviceId = url.searchParams.get('deviceId')
    const entry = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.search,
      deviceId,
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      isHistory,
      roster,
      historyMode,
      at: new Date().toISOString(),
    }
    requests.push(entry)
    if (requests.length > 1_000) requests.shift()

    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/session') {
      send(200, { id: 'repair-train-d-session' })
      return
    }
    if (url.pathname === '/api/devices') {
      send(200, devicesForRoster(roster, observedAt))
      return
    }
    if (url.pathname === '/api/groups') {
      send(200, [{ id: Number(GROUP_ID), name: 'Kerry MRT', groupId: 0 }])
      return
    }
    if (url.pathname === '/api/positions') {
      if (isHistory && historyMode === 'hold-22' && deviceId === HELD_DEVICE_ID) {
        entry.status = 503
        send(503, { error: 'repair-train-d deliberate device-22 history hold' })
        return
      }
      entry.status = 200
      const requestedDeviceIds = isHistory && deviceId !== null
        ? [deviceId]
        : devicesForRoster(roster, observedAt).map((device) => String(device.id))
      send(200, requestedDeviceIds.map((id, index) => syntheticPosition(id, index, observedAt, isHistory)))
      return
    }
    entry.status = 404
    send(404, { error: 'repair-train-d route not implemented' })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    setRoster(next) {
      assert.ok(next === 'initial' || next === 'expanded')
      roster = next
      observedAt = Date.now()
    },
    setHistoryMode(next) {
      assert.ok(next === 'allow' || next === 'hold-22')
      historyMode = next
    },
    currentRequestCount() {
      return requests.filter((request) => request.path === '/api/positions' && !request.isHistory && request.status === 200).length
    },
    historyHoldCount() {
      return requests.filter((request) => request.isHistory && request.deviceId === HELD_DEVICE_ID && request.status === 503).length
    },
    historyHoldEvidence() {
      return requests.find((request) => isBoundedHistoryHoldRequest(request)) ?? null
    },
    historyRequestsFor(deviceId) {
      return requests.filter((request) => request.isHistory && request.deviceId === String(deviceId))
    },
    describe() {
      return {
        origin,
        roster,
        historyMode,
        requestCount: requests.length,
        currentPositionRequests: requests.filter((request) => request.path === '/api/positions' && !request.isHistory && request.status === 200).length,
        heldHistoryRequests: requests.filter((request) => request.isHistory && request.deviceId === HELD_DEVICE_ID && request.status === 503).length,
        historyHoldEvidence: requests.find((request) => isBoundedHistoryHoldRequest(request)) ?? null,
        recentRequests: requests.slice(-30),
      }
    },
    close(timeoutMs = CLOSE_TIMEOUT_MS) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        server.close()
        server.closeAllConnections?.()
        server.closeIdleConnections?.()
        return Promise.reject(new Error('Synthetic provider cleanup has no remaining smoke deadline.'))
      }
      const boundedTimeout = timeoutMs
      return new Promise((resolve, reject) => {
        let settled = false
        const finish = (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          error ? reject(error) : resolve()
        }
        const timer = setTimeout(() => {
          server.closeAllConnections?.()
          server.closeIdleConnections?.()
          finish(new Error('Synthetic provider did not close before the smoke deadline.'))
        }, boundedTimeout)
        server.close((error) => finish(error))
      })
    },
  }
}

/** Returns the staged roster while keeping the successful device lexically first. */
function devicesForRoster(stage, timestamp) {
  const original = { id: Number(HELD_DEVICE_ID), name: 'Repair Train D A', uniqueId: 'repair-train-d-22', status: 'online', lastUpdate: new Date(timestamp).toISOString(), groupId: Number(GROUP_ID) }
  if (stage === 'initial') return [original]
  // Keep B first in the expanded roster so the runtime scheduler can complete
  // the new member before the deliberately held original A checkpoint.
  return [
    { id: Number(SUCCESS_DEVICE_ID), name: 'Repair Train D B', uniqueId: 'repair-train-d-11', status: 'online', lastUpdate: new Date(timestamp).toISOString(), groupId: Number(GROUP_ID) },
    original,
  ]
}

/** Returns a valid fix-time row for either current polling or history backfill. */
function syntheticPosition(deviceId, index, timestamp, isHistory) {
  const numericId = Number(deviceId)
  return {
    id: Number(`${isHistory ? 8 : 7}${numericId}${index}`),
    deviceId: numericId,
    latitude: 52.1 + numericId / 10_000,
    longitude: -9.7 - numericId / 10_000,
    fixTime: new Date(timestamp - (isHistory ? 60_000 : 1_000)).toISOString(),
    valid: true,
    accuracy: 4,
    speed: 0,
    attributes: {},
  }
}

/** Launches exactly the supplied packaged executable with a disposable profile. */
async function launchPackaged(appPath, profile, label, report) {
  const launch = {
    label,
    profile,
    app: null,
    page: null,
    process: null,
    diagnostics: createDiagnosticState(),
    screenshots: [],
    stderrCollector: null,
    attachedPages: new Set(),
    diagnosticPhase: 'launch',
    diagnosticStartedAt: performance.now(),
    teardownRequestedAt: null,
    exitObservedAt: null,
    close: null,
  }
  assertBeforeDeadline(`${label} launch`)
  launch.app = await electron.launch({
    executablePath: appPath,
    args: process.platform === 'linux' ? [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
    ] : [],
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
    },
    timeout: Math.min(CLOSE_TIMEOUT_MS, remainingSmokeTime(operationDeadline)),
  })
  launch.process = launch.app.process()
  assert.ok(launch.process !== null, `Packaged launch did not expose a child process for ${label}`)
  assert.ok(launch.process.stderr !== null && launch.process.stderr !== undefined,
    `Packaged launch ${label} did not expose an owned stderr stream.`)
  launch.process.once('exit', () => { launch.exitObservedAt = new Date().toISOString() })
  launch.process.on('error', (error) => {
    appendLaunchDiagnostic(launch, 'mainProcessErrors', {
      message: sanitizeDiagnosticText(error.message),
      name: sanitizeDiagnosticText(error.name),
      stack: sanitizeDiagnosticText(error.stack ?? ''),
    }, 'main-process.error', 'main-process')
  })
  launch.process.stderr.on('data', (chunk) => {
    appendProcessStderrDiagnostics(launch, String(chunk))
  })
  report.launches.push({ label, executablePath: appPath, pid: launch.process.pid, launchedAt: new Date().toISOString() })
  try {
    // Playwright cannot observe a renderer before electron.launch returns; attach
    // immediately afterwards and also cover any already-created startup pages.
    launch.app.on('window', (page) => attachPageDiagnostics(launch, page))
    for (const page of launch.app.windows()) attachPageDiagnostics(launch, page)
    const firstWindow = await runBounded(
      () => launch.app.firstWindow(),
      Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline)),
    )
    if (!firstWindow.completed) throw new Error(`${label} first window did not appear before the smoke deadline.`)
    launch.page = firstWindow.value
    attachPageDiagnostics(launch, launch.page)
    await boundedPageAction(
      launch.page,
      () => launch.page.getByTestId('app-title').waitFor({ state: 'visible' }),
      `${label} app title`,
    )
    return launch
  } catch (error) {
    try {
      await closeLaunch(launch, report)
    } catch (closeError) {
      throw new Error(`${messageOf(error)}; launch cleanup failed: ${messageOf(closeError)}`)
    }
    throw error
  }
}

/** Attaches renderer diagnostics once to each startup or later Electron page. */
function attachPageDiagnostics(launch, page) {
  if (launch.attachedPages.has(page)) return
  launch.attachedPages.add(page)
  attachPackagedPageDiagnostics(page, (field, entry, type, source) => {
    appendLaunchDiagnostic(launch, field, entry, type, source)
  }, sanitizeDiagnosticText)
}

/** Appends one launch diagnostic with the current smoke phase and source. */
function appendLaunchDiagnostic(launch, field, entry, type, source) {
  const raw = typeof entry === 'string' ? { message: entry } : entry
  appendBoundedDiagnostic(launch.diagnostics, field, {
    ...raw,
    elapsedMs: performance.now() - launch.diagnosticStartedAt,
    teardownRequestedAt: launch.teardownRequestedAt,
  }, {
    phase: launch.diagnosticPhase,
    type,
    source,
  })
}

/** Verifies ASAR identity and hashes every packaged runtime input. */
async function attestPackagedInputs(app, appPath, page) {
  const archivePath = await boundedAppEvaluate(
    app,
    ({ app: runningApp }) => runningApp.getAppPath(),
    undefined,
    'read packaged ASAR path',
  )
  assert.ok(typeof archivePath === 'string' && archivePath.endsWith('.asar'),
    `Packaged launch resolved to ${archivePath}; expected an app.asar renderer.`)
  const windowAttestation = await boundedPageEvaluate(page, () => ({
    href: window.location.href,
    title: document.title,
    missionStoreMethods: Object.keys(window.sartrackerElectron?.missionStore ?? {}).sort(),
    hasTraccarHttpBridge: typeof window.sartrackerElectron?.traccarHttpRequest === 'function',
  }), undefined, 'attest packaged preload bridge')
  const archiveBytes = await readFile(archivePath)
  const sourcePackage = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const packagedPackage = JSON.parse(extractFile(archivePath, 'package.json').toString('utf8'))
  assert.equal(packagedPackage.name, sourcePackage.name, 'Packaged package name does not match source package.json.')
  assert.equal(packagedPackage.version, sourcePackage.version, 'Packaged package version does not match source package.json.')
  for (const field of ['main', 'type', 'dependencies']) {
    assert.deepEqual(packagedPackage[field], sourcePackage[field], `Packaged manifest runtime field mismatch: ${field}`)
  }
  const sourceInputs = [
    ...await filesUnder(path.join(projectRoot, 'electron'), 'electron'),
    ...await filesUnder(path.join(projectRoot, 'dist'), 'dist'),
    ...await filesUnder(path.join(projectRoot, 'shared'), 'shared'),
  ]
  const inputHashes = {}
  for (const relativePath of sourceInputs) {
    const sourceHash = await sha256File(path.join(projectRoot, relativePath))
    const packagedHash = sha256(extractFile(archivePath, relativePath))
    assert.equal(packagedHash, sourceHash, `Packaged input mismatch: ${relativePath}`)
    inputHashes[relativePath] = sourceHash
  }
  return {
    executablePath: appPath,
    executableSha256: await sha256File(appPath),
    archivePath,
    archiveSha256: sha256(archiveBytes),
    archiveBytes: archiveBytes.byteLength,
    packageName: packagedPackage.name,
    packageVersion: packagedPackage.version,
    sourcePackageVersion: sourcePackage.version,
    packagedInputsMatch: true,
    windowAttestation,
    inputHashes,
  }
}

/** Exercises AUD-08 through the operator UI plus real provider-driven backfill. */
async function runAud08({ launch, provider, evidenceDir }) {
  const page = launch.page
  const picker = page.getByTestId('participant-group-picker')
  await boundedPageAction(page,
    () => picker.getByRole('checkbox').first().waitFor({ state: 'visible' }),
    'AUD-08 participant group picker',
  )
  await boundedPageAction(page, () => picker.getByRole('checkbox').first().check(), 'AUD-08 select participant group')
  await boundedPageAction(page,
    () => page.getByTestId('mission-name-input').fill('Repair Train D participant backfill'),
    'AUD-08 mission name',
  )
  await boundedPageAction(page, () => page.getByTestId('mission-offset-input').fill('2'), 'AUD-08 mission offset')
  await boundedPageAction(page, () => page.getByTestId('mission-start-btn').click(), 'AUD-08 start mission')

  const mission = await waitForValue(
    () => readActiveMission(page),
    (value) => value?.status === 'active' && value.name === 'Repair Train D participant backfill',
    'AUD-08 mission to become active',
  )
  const missionStart = mission.start_time
  const initialComplete = await waitForValue(
    () => readParticipantSnapshot(page, mission.id),
    (snapshot) => snapshot.checkpoints.some((checkpoint) => checkpoint.traccar_device_id === HELD_DEVICE_ID && checkpoint.completed === 1),
    'automatic provider backfill for original member A',
  )
  const initialScreenshot = path.join(evidenceDir, 'aud08-initial-backfill-complete.png')
  await boundedPageScreenshot(page, { path: initialScreenshot, fullPage: true }, 'AUD-08 initial screenshot')
  launch.screenshots.push(initialScreenshot)

  const activeGroup = page.getByTestId('participant-active-list').locator('[data-participant-kind="group"]')
  await boundedPageAction(page,
    () => activeGroup.getByRole('button', { name: 'Remove', exact: true }).click(),
    'AUD-08 remove initial group',
  )
  await waitForValue(
    () => page.getByTestId('participant-active-list').innerText(),
    (text) => !text.includes('Kerry MRT'),
    'initial group removal',
  )
  provider.setRoster('expanded')
  await boundedPageAction(page,
    () => page.getByTestId('participant-add-kind').selectOption('device'),
    'AUD-08 select device roster kind before waiting for expanded provider roster',
  )
  await waitForValue(
    () => page.getByTestId('participant-add-ref').locator('option[value="11"]').count(),
    (count) => count === 1,
    'expanded provider roster to expose new member B after initial group removal',
  )
  const currentRequestsBeforeHold = provider.currentRequestCount()
  provider.setHistoryMode('hold-22')

  await boundedPageAction(page,
    () => page.getByTestId('participant-add-kind').selectOption('group'),
    'AUD-08 select re-add group kind',
  )
  await boundedPageAction(page,
    () => page.getByTestId('participant-add-ref').selectOption(GROUP_ID),
    'AUD-08 select re-add group',
  )
  const requestedEffectiveFrom = formatDateTimeLocalCeil(missionStart)
  await boundedPageAction(page,
    () => page.getByTestId('participant-effective-from').fill(requestedEffectiveFrom),
    'AUD-08 set re-add effective-from',
  )
  await boundedPageAction(page, () => page.getByTestId('participant-add-btn').click(), 'AUD-08 re-add group')

  const readdedCheckpoints = await waitForValue(
    () => readParticipantSnapshot(page, mission.id),
    (snapshot) => {
      const held = latestCheckpoint(snapshot.checkpoints, HELD_DEVICE_ID)
      const successful = latestCheckpoint(snapshot.checkpoints, SUCCESS_DEVICE_ID)
      return held?.completed === 0 && successful?.completed === 1 && held.window_from < held.window_to
    },
    're-added group checkpoints to be created with one held member',
  )
  await waitForValue(
    () => ({ current: provider.currentRequestCount(), held: provider.historyHoldCount() }),
    (value) => value.current >= currentRequestsBeforeHold + 2 && value.held > 0,
    'current provider polling to continue while device 22 history is held',
  )
  const readdedGroup = readdedCheckpoints.participants.find((participant) =>
    participant.kind === 'group' && participant.removed_at === null)
  assert.ok(readdedGroup !== undefined, 'AUD-08 re-added group was not visible through packaged IPC.')
  assert.equal(Date.parse(readdedGroup.effective_from), new Date(requestedEffectiveFrom).getTime(),
    'AUD-08 re-added group effective-from did not match the requested safe minute boundary.')
  assert.ok(Date.parse(readdedGroup.effective_from) > Date.parse(missionStart),
    'AUD-08 re-added group effective-from was not strictly inside the mission.')
  const readdWindow = {
    from: readdedGroup.effective_from,
    to: readdedGroup.added_at,
  }
  const successfulHistoryRequest = await waitForValue(
    () => provider.historyRequestsFor(SUCCESS_DEVICE_ID),
    (requests) => requests.some((request) => request.status === 200
      && historyRequestCoversWindow(request, readdWindow)),
    `successful device 11 history request covering the re-add window ${readdWindow.from}..${readdWindow.to}`,
  )
  const successfulRequest = successfulHistoryRequest.find((request) => request.status === 200
    && historyRequestCoversWindow(request, readdWindow))
  assert.ok(successfulRequest !== undefined)
  assert.equal(readdedGroup.backfill_member_count, 2, 'AUD-08 group denominator did not include both re-added members.')
  assert.equal(readdedGroup.backfill_completed_count, 1, 'AUD-08 group completion count did not retain the successful member.')
  const heldCheckpoint = latestCheckpoint(readdedCheckpoints.checkpoints, HELD_DEVICE_ID)
  const successfulCheckpoint = latestCheckpoint(readdedCheckpoints.checkpoints, SUCCESS_DEVICE_ID)
  assert.equal(heldCheckpoint?.completed, 0)
  assert.equal(successfulCheckpoint?.completed, 1)

  await waitForValue(
    () => page.getByTestId('participant-backfill-status').innerText(),
    (text) => text.includes('pending / retrying for 1/2 required group members'),
    'packaged renderer to show the complete starting roster with one pending member',
  )
  await boundedPageAction(page,
    () => page.getByTestId('participant-backfill-status').scrollIntoViewIfNeeded(),
    'AUD-08 scroll progress into view',
  )
  const progressScreenshot = path.join(evidenceDir, 'aud08-readded-group-progress.png')
  await boundedPageScreenshot(page, { path: progressScreenshot, fullPage: true }, 'AUD-08 progress screenshot')
  launch.screenshots.push(progressScreenshot)

  await boundedPageAction(page, () => page.getByTestId('mission-finish-btn').click(), 'AUD-08 open finish dialog')
  await boundedPageAction(page,
    () => page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish', exact: true }).click(),
    'AUD-08 attempt finish',
  )
  const finishBlocked = await waitForValue(
    () => page.locator('body').innerText(),
    (text) => text.toLowerCase().includes('participant history backfill') && text.toLowerCase().includes('incomplete'),
    'AUD-08 finish fence to remain visible',
  )
  const afterBlocked = await readParticipantSnapshot(page, mission.id)
  assert.equal(afterBlocked.mission?.status, 'active', 'AUD-08 finish fence changed the mission status.')
  const screenshot = path.join(evidenceDir, 'aud08-readded-group-pending.png')
  await boundedPageScreenshot(page, { path: screenshot, fullPage: true }, 'AUD-08 finish refusal screenshot')
  launch.screenshots.push(screenshot)
  return {
    missionId: mission.id,
    missionStart,
    automaticBackfill: {
      initialMember: HELD_DEVICE_ID,
      initialCheckpointCompleted: true,
      readdedSuccessfulMember: SUCCESS_DEVICE_ID,
      readdedHeldMember: HELD_DEVICE_ID,
      readdWindow,
      successfulHistoryRequest: successfulRequest,
      providerHistoryHoldObserved: provider.historyHoldCount(),
      currentRequestsBeforeHold,
      currentRequestsAfterHold: provider.currentRequestCount(),
    },
    initial: summarizeParticipantSnapshot(initialComplete),
    readdedPending: summarizeParticipantSnapshot(readdedCheckpoints),
    finishBlockedSurface: finishBlocked.slice(-1_000),
    progressScreenshot,
    screenshot,
    setupBoundary: 'group removal/re-add used operator controls; checkpoint assertions used public preload missionStore IPC; no internal store injection',
  }
}

/** Exercises AUD-09 page cursor continuity through backup and a packaged restart. */
async function runAud09({ launch, evidenceDir, profile }) {
  const page = launch.page
  const mission = await readActiveMission(page)
  assert.ok(mission?.id, 'AUD-09 requires the active packaged mission from AUD-08.')
  const areaInputs = Array.from({ length: SEARCH_AREA_COUNT }, (_, index) => ({
    id: `repair-train-d-area-${String(index).padStart(2, '0')}`,
    mission_id: mission.id,
    name: `AUD-09 area ${String(index).padStart(2, '0')}`,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.8, 52], [-9.7, 52], [-9.7, 52.1], [-9.8, 52.1], [-9.8, 52]]],
    }),
    updated_by: 'Repair Train D packaged smoke',
  }))
  const firstPage = await boundedPageEvaluate(page, async ({ missionId, inputs }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store?.upsertSearchArea === undefined || store.listSearchOperationPage === undefined) {
      throw new Error('Search Operations IPC is unavailable.')
    }
    for (const input of inputs) await store.upsertSearchArea(input)
    return store.listSearchOperationPage({ missionId, kind: 'areas', limit: 25 })
  }, { missionId: mission.id, inputs: areaInputs }, 'AUD-09 insert areas and read first page')
  assert.equal(firstPage.entries.length, 25, 'AUD-09 packaged first page did not contain 25 entries.')
  assert.equal(firstPage.totalCount, SEARCH_AREA_COUNT, 'AUD-09 packaged first page total is not exact.')
  assert.equal(typeof firstPage.nextCursor, 'string', 'AUD-09 packaged first page did not return a cursor.')

  const backupPath = await boundedPageEvaluate(page, async () => {
    const syncBackup = window.sartrackerElectron?.missionStore.syncBackup
    if (syncBackup === undefined) throw new Error('Mission backup IPC is unavailable.')
    return syncBackup('repair-train-d-aud-09')
  }, undefined, 'AUD-09 sync production backup mirror')
  const expectedBackupPath = path.join(path.resolve(profile), 'mission-store.backup.sqlite')
  assert.equal(path.isAbsolute(backupPath), true, 'AUD-09 backup path must be absolute.')
  assert.equal(path.resolve(backupPath), expectedBackupPath, 'AUD-09 backup path was not the profile production mirror.')

  const secondPage = await readSearchPage(page, mission.id, firstPage.nextCursor)
  assert.equal(secondPage.entries.length, 1, 'AUD-09 packaged second page did not contain the final entry.')
  assert.equal(secondPage.entries[0]?.name, 'AUD-09 area 25')
  assert.equal(secondPage.generation, firstPage.generation, 'AUD-09 cursor generation changed after backup.')
  const info = await boundedPageEvaluate(
    page,
    async () => window.sartrackerElectron?.missionStore.info(),
    undefined,
    'AUD-09 read live store info',
  )
  assert.ok(typeof info?.database_path === 'string', 'AUD-09 packaged mission info did not expose database_path.')
  assert.equal(path.resolve(info.database_path), path.join(path.resolve(profile), 'mission-store.sqlite'),
    'AUD-09 live database path was not inside the disposable profile.')
  const readonly = readOnlySearchEvidence(info.database_path, backupPath, mission.id)
  assert.equal(readonly.live.searchAreaCount, SEARCH_AREA_COUNT)
  assert.equal(readonly.backup.searchAreaCount, SEARCH_AREA_COUNT)
  assert.equal(readonly.live.integrity, 'ok')
  assert.equal(readonly.backup.integrity, 'ok')
  assert.ok(readonly.live.backupSyncEventCount >= 1, 'AUD-09 live SQLite lacks the backup audit append.')
  assert.equal(readonly.live.searchOperationsGeneration, firstPage.generation)
  assert.equal(readonly.backup.searchOperationsGeneration, firstPage.generation)

  await boundedPageAction(page,
    () => page.getByTestId('open-mission-review-workspace').click(),
    'AUD-09 open mission review workspace',
  )
  await boundedPageAction(page,
    () => page.getByRole('button', { name: 'Search Passes', exact: true }).click(),
    'AUD-09 open Search Passes',
  )
  await waitForValue(
    () => page.getByTestId('search-operation-areas-page-controls').innerText(),
    (text) => text.includes(`Showing 25 of ${SEARCH_AREA_COUNT}`),
    'rendered Search Operations first page',
  )
  const screenshot = path.join(evidenceDir, 'aud09-search-operations-after-backup.png')
  await boundedPageScreenshot(page, { path: screenshot, fullPage: true }, 'AUD-09 Search Operations screenshot')
  launch.screenshots.push(screenshot)
  return {
    missionId: mission.id,
    firstPage: summarizeSearchPage(firstPage),
    secondPage: summarizeSearchPage(secondPage),
    backupPath,
    readonly,
    screenshot,
    setupBoundary: 'Search Operations pagination and backup continuity are an IPC/SQLite packaged claim; rendered browser evidence is separate and this harness does not claim a post-backup operator record mutation',
  }
}

/** Reopens the same profile and proves participant, cursor, backup, and SQLite continuity. */
async function verifyRestart({ launch, aud08, aud09, evidenceDir }) {
  const snapshot = await waitForValue(
    () => readParticipantSnapshot(launch.page, aud08.missionId),
    (value) => value.mission?.id === aud08.missionId && value.mission.status === 'active',
    'active mission to hydrate after packaged restart',
  )
  const held = latestCheckpoint(snapshot.checkpoints, HELD_DEVICE_ID)
  assert.equal(held?.completed, 0, 'AUD-08 pending checkpoint was not retained across restart.')
  const readdedGroup = snapshot.participants.find((participant) => participant.kind === 'group' && participant.removed_at === null)
  assert.equal(readdedGroup?.backfill_member_count, 2)
  assert.equal(readdedGroup?.backfill_completed_count, 1)

  const secondPage = await readSearchPage(launch.page, aud09.missionId, aud09.firstPage.nextCursor)
  assert.equal(secondPage.entries.length, 1, 'AUD-09 retained cursor did not survive packaged restart.')
  assert.equal(secondPage.entries[0]?.name, 'AUD-09 area 25')
  assert.equal(secondPage.generation, aud09.firstPage.generation)
  const info = await boundedPageEvaluate(
    launch.page,
    async () => window.sartrackerElectron?.missionStore.info(),
    undefined,
    'restart read live store info',
  )
  assert.ok(typeof info?.database_path === 'string', 'Restarted packaged mission info did not expose database_path.')
  assert.equal(path.resolve(info.database_path), path.join(path.resolve(launch.profile), 'mission-store.sqlite'),
    'Restarted live database path was not inside the disposable profile.')
  const readonly = readOnlySearchEvidence(info.database_path, aud09.backupPath, aud09.missionId)
  assert.equal(readonly.live.searchAreaCount, SEARCH_AREA_COUNT)
  assert.equal(readonly.backup.searchAreaCount, SEARCH_AREA_COUNT)
  assert.equal(path.resolve(aud09.backupPath), path.join(path.resolve(launch.profile), 'mission-store.backup.sqlite'))
  assert.equal(readonly.live.integrity, 'ok')
  assert.equal(readonly.backup.integrity, 'ok')
  assert.ok(readonly.live.backupSyncEventCount >= 1)
  assert.equal(readonly.live.searchOperationsGeneration, aud09.firstPage.generation)
  assert.equal(readonly.backup.searchOperationsGeneration, aud09.firstPage.generation)
  const screenshot = path.join(evidenceDir, 'restart-participant-and-search-cursor.png')
  await boundedPageScreenshot(launch.page, { path: screenshot, fullPage: true }, 'restart screenshot')
  launch.screenshots.push(screenshot)
  return {
    participant: summarizeParticipantSnapshot(snapshot),
    secondPage: summarizeSearchPage(secondPage),
    readonly,
    screenshot,
  }
}

/** Reads the active mission through public preload IPC without mutating state. */
async function readActiveMission(page) {
  return boundedPageEvaluate(
    page,
    async () => window.sartrackerElectron?.missionStore.getActiveMission() ?? null,
    undefined,
    'read active mission',
  )
}

/** Reads participant/checkpoint truth through public preload IPC. */
async function readParticipantSnapshot(page, missionId) {
  return boundedPageEvaluate(page, async (id) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission store IPC is unavailable.')
    const [mission, participants, checkpoints, memberships, info] = await Promise.all([
      store.getMission(id),
      store.listMissionParticipants(id),
      store.listParticipantBackfillCheckpoints(id),
      store.listGroupMembershipEvents(id),
      store.info(),
    ])
    return { mission, participants, checkpoints, memberships, info }
  }, missionId, 'read participant snapshot')
}

/** Reads one Search Operations page through the public preload bridge. */
async function readSearchPage(page, missionId, cursor) {
  return boundedPageEvaluate(page, async ({ id, nextCursor }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store?.listSearchOperationPage === undefined) throw new Error('Search Operations IPC is unavailable.')
    return store.listSearchOperationPage({
      missionId: id,
      kind: 'areas',
      limit: 25,
      ...(nextCursor === null ? {} : { cursor: nextCursor }),
    })
  }, { id: missionId, nextCursor: cursor }, 'read Search Operations page')
}

/** Reads live and mirror databases without issuing checkpoint, write, or repair pragmas. */
function readOnlySearchEvidence(databasePath, backupPath, missionId) {
  const readDatabase = (filePath) => {
    const database = new Database(filePath, { readonly: true, fileMustExist: true })
    try {
      const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check
      const areaCount = database.prepare(`SELECT COUNT(*) AS count FROM search_areas
        WHERE mission_id = ? AND retired_at IS NULL`).get(missionId)
      const backupSync = database.prepare(`SELECT COUNT(*) AS count FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_backup_synced'`).get(missionId)
      const generations = database.prepare(`SELECT generation, search_operations_generation
        FROM mission_replay_generations WHERE mission_id = ?`).get(missionId)
      const participantRows = database.prepare(`SELECT traccar_device_id, window_from, window_to, completed
        FROM participant_backfill_checkpoints WHERE mission_id = ?
        ORDER BY traccar_device_id ASC, window_from ASC`).all(missionId)
      return {
        path: filePath,
        sha256: sha256FileSync(filePath),
        integrity,
        generation: Number(generations?.generation ?? -1),
        searchOperationsGeneration: Number(generations?.search_operations_generation ?? -1),
        searchAreaCount: Number(areaCount?.count ?? 0),
        backupSyncEventCount: Number(backupSync?.count ?? 0),
        participantRows,
      }
    } finally {
      database.close()
    }
  }
  return { live: readDatabase(databasePath), backup: readDatabase(backupPath) }
}

/** Ensures an existing active mission is resumed when the packaged shell presents recovery. */
async function ensureMissionActive(page, missionId) {
  const state = await waitForValue(
    () => boundedPageEvaluate(page, async () => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined) throw new Error('Mission store IPC is unavailable.')
      return {
        active: await store.getActiveMission(),
        recoverable: await store.getRecoverableMission(),
      }
    }, undefined, 'read restart mission recovery state'),
    (value) => isMissionReadyForRecovery(value, missionId),
    'mission state to hydrate after packaged restart',
  )
  if (state.active?.id === missionId && state.active.status === 'active') return
  const dialog = page.getByTestId('mission-recovery-dialog')
  await boundedPageAction(page, () => dialog.waitFor({ state: 'visible' }), 'show mission recovery dialog')
  await boundedPageAction(page,
    () => dialog.getByRole('button', { name: 'Resume', exact: true }).click(),
    'resume recovered mission',
  )
  await waitForValue(
    () => readActiveMission(page),
    (value) => value?.id === missionId && value.status === 'active',
    'mission recovery to resume after packaged restart',
  )
}

/** Closes the packaged app and requires an orderly zero exit. */
async function closeLaunch(launch, report, provider = null) {
  launch.diagnosticPhase = 'close'
  launch.teardownRequestedAt ??= new Date().toISOString()
  let closeError = null
  let forcedCleanup = null
  const previousOperationDeadline = operationDeadline
  operationDeadline = cleanupDeadline
  try {
    const closed = await closeOwnedSmokeChild(launch.process, {
      owned: true,
      close: () => launch.app.close(),
      orderlyDeadline: cleanupPreEscalationDeadline,
      deadline: cleanupDeadline,
    })
    const exit = closed.exit
    closeError = closed.closeError
    forcedCleanup = closed.forcedCleanup
    const stderrDrained = await waitForPackagedStderrDrain(
      launch.process?.stderr,
      Math.min(CLOSE_TIMEOUT_MS, remainingSmokeTime(cleanupDeadline)),
    )
    if (!stderrDrained) closeError ??= new Error('Packaged smoke stderr did not drain before the deadline.')
    flushProcessStderrDiagnostics(launch)
    const closeEvidence = {
      requested: 'playwright ElectronApplication.close()',
      requestedAt: launch.teardownRequestedAt,
      exitObservedAt: launch.exitObservedAt,
      stderrDrainedAt: stderrDrained ? new Date().toISOString() : null,
      graceful: closeError === null && forcedCleanup === null && exit !== null && exit.exitCode === 0,
      forcedCleanup,
      exitCode: exit?.exitCode ?? null,
      signal: exit?.signal ?? null,
      diagnostics: launch.diagnostics,
      screenshots: launch.screenshots,
    }
    launch.close = closeEvidence
    const reportLaunch = report.launches.find((entry) => entry.label === launch.label)
    if (reportLaunch !== undefined) reportLaunch.close = closeEvidence
    try {
      assertNoUnexpectedDiagnostics(launch.diagnostics, createSmokeDiagnosticAllowlist({
        historyHoldEvidence: provider?.historyHoldEvidence?.(),
        providerOrigin: provider?.origin,
        platform: process.platform,
        productScenariosPassed: allTrainDScenariosPassed(report.scenarioResults),
        teardownRequestedAt: launch.teardownRequestedAt,
        processStderr: launch.diagnostics.processStderr,
        processStderrCount: launch.diagnostics.counts.processStderr,
        processStderrTruncated: launch.diagnostics.truncated.processStderr,
      }))
    } catch (diagnosticError) {
      recordDiagnosticFailure(report, diagnosticError, launch)
      closeError ??= diagnosticError
    }
    if (closeError !== null) throw new Error(`${launch.label} close failed: ${messageOf(closeError)}`)
    assert.ok(exit !== null, `${launch.label} did not exit after orderly close.`)
    assert.equal(exit.exitCode, 0, `${launch.label} exited with code ${exit.exitCode ?? 'null'}${exit.signal ? ` (${exit.signal})` : ''}.`)
    return closeEvidence
  } finally {
    operationDeadline = previousOperationDeadline
  }
}

/** Stores complete stderr lines while retaining a partial final chunk for close. */
function appendProcessStderrDiagnostics(launch, chunk) {
  launch.stderrCollector ??= createPackagedStderrCollector((message) => {
    appendLaunchDiagnostic(launch, 'processStderr', { message }, 'stderr', 'main-process-stderr')
  })
  launch.stderrCollector.write(chunk)
}

/** Flushes a final stderr chunk before terminal diagnostic validation. */
function flushProcessStderrDiagnostics(launch) {
  launch.stderrCollector?.flush()
}

/** Waits for a bounded condition without making elapsed time part of the proof. */
async function waitForValue(read, predicate, description) {
  const deadline = Math.min(Date.now() + CONDITION_TIMEOUT_MS, operationDeadline)
  let lastValue
  while (Date.now() < deadline) {
    assertBeforeDeadline(description)
    const readResult = await runBounded(read, remainingSmokeTime(deadline))
    if (!readResult.completed) throw new Error(`Packaged smoke deadline exceeded while reading ${description}.`)
    lastValue = readResult.value
    if (predicate(lastValue)) return lastValue
    await delay(Math.min(100, remainingSmokeTime(deadline)))
  }
  throw new Error(`Timed out waiting for ${description}. Last observed value: ${safeJson(lastValue)}`)
}

/** Selects the latest fixed checkpoint for one device. */
function latestCheckpoint(checkpoints, deviceId) {
  return checkpoints
    .filter((checkpoint) => checkpoint.traccar_device_id === deviceId)
    .sort((left, right) => String(left.window_to).localeCompare(String(right.window_to)))
    .at(-1)
}

/** Keeps receipt participant evidence bounded while retaining the assertions that matter. */
function summarizeParticipantSnapshot(snapshot) {
  return {
    mission: snapshot.mission === null ? null : {
      id: snapshot.mission.id,
      status: snapshot.mission.status,
      name: snapshot.mission.name,
      start_time: snapshot.mission.start_time,
    },
    participants: snapshot.participants,
    checkpoints: snapshot.checkpoints,
    memberships: snapshot.memberships,
    databasePath: snapshot.info?.database_path ?? null,
  }
}

/** Keeps receipt Search Operations page evidence bounded and reviewable. */
function summarizeSearchPage(page) {
  return {
    kind: page.kind,
    search: page.search,
    generation: page.generation,
    totalCount: page.totalCount,
    entryCount: page.entries.length,
    firstEntry: page.entries[0] ?? null,
    lastEntry: page.entries.at(-1) ?? null,
    nextCursor: page.nextCursor,
  }
}

/** Converts an ISO timestamp to the datetime-local shape used by the operator control. */
function formatDateTimeLocal(value) {
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Chooses the next minute boundary so the re-add window is strictly inside the mission. */
function formatDateTimeLocalCeil(value) {
  const original = new Date(value)
  const date = new Date(original)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  return formatDateTimeLocal(date)
}

/** Recursively enumerates regular source files for package hash matching. */
async function filesUnder(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(root, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

/** Hashes a byte sequence with SHA-256. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Hashes a regular file synchronously for a readonly receipt. */
function sha256FileSync(filePath) {
  return sha256(require('node:fs').readFileSync(filePath))
}

/** Hashes a regular file asynchronously. */
async function sha256File(filePath) {
  return sha256(await readFile(filePath))
}

/** Checks that a path is a regular file. */
async function isRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** Converts any thrown value to a concise message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Validates all captured launch diagnostics against the smoke context. */
function assertNoUnexpectedDiagnosticsForReport(report) {
  for (const launch of report.launches) {
    const diagnostics = launch.close?.diagnostics
    assertNoUnexpectedDiagnostics(diagnostics, createReportLaunchDiagnosticAllowlist(report, launch))
  }
}

/** Returns whether all three Train D product scenarios completed successfully. */
function allTrainDScenariosPassed(scenarioResults) {
  return scenarioResults?.aud08 === 'pass'
    && scenarioResults?.aud09 === 'pass'
    && scenarioResults?.restart === 'pass'
}

/** Builds a fail-closed diagnostic allowlist for one captured launch. */
function createReportLaunchDiagnosticAllowlist(report, launch) {
  const diagnostics = launch.close?.diagnostics
  return createSmokeDiagnosticAllowlist({
    historyHoldEvidence: report.provider?.historyHoldEvidence,
    providerOrigin: report.provider?.origin,
    platform: process.platform,
    productScenariosPassed: allTrainDScenariosPassed(report.scenarioResults),
    teardownRequestedAt: launch.close?.requestedAt ?? null,
    processStderr: diagnostics?.processStderr ?? [],
    processStderrCount: diagnostics?.counts?.processStderr,
    processStderrTruncated: diagnostics?.truncated?.processStderr,
  })
}

/** Retains diagnostic blockers independently of the scenario result fields. */
function recordDiagnosticFailure(report, error, launch = null) {
  report.diagnosticResult = 'fail'
  const label = launch?.label ?? 'terminal'
  const message = messageOf(error)
  if (report.diagnosticBlockers.some((blocker) => blocker.launch === label && blocker.error === message)) return
  const blocker = { launch: label, error: message, unexpected: null, rawEvents: null }
  const diagnosticSources = launch === null
    ? report.launches.map((entry) => ({
      label: entry.label,
      diagnostics: entry.close?.diagnostics,
      allowlist: createReportLaunchDiagnosticAllowlist(report, entry),
    }))
    : [{
      label,
      diagnostics: launch.diagnostics,
      allowlist: createSmokeDiagnosticAllowlist({
        historyHoldEvidence: report.provider?.historyHoldEvidence,
        providerOrigin: report.provider?.origin,
        platform: process.platform,
        productScenariosPassed: allTrainDScenariosPassed(report.scenarioResults),
        teardownRequestedAt: launch.teardownRequestedAt,
        processStderr: launch.diagnostics.processStderr,
        processStderrCount: launch.diagnostics.counts.processStderr,
        processStderrTruncated: launch.diagnostics.truncated.processStderr,
      }),
    }]
  const unexpected = {}
  const rawEvents = {}
  for (const source of diagnosticSources) {
    const diagnostics = source.diagnostics
    if (diagnostics === undefined || diagnostics === null) continue
    try {
      unexpected[source.label] = collectUnexpectedDiagnostics(diagnostics, source.allowlist).unexpected
    } catch {
      rawEvents[source.label] = Array.isArray(diagnostics.unexpectedEvents)
        ? diagnostics.unexpectedEvents : []
    }
  }
  if (Object.keys(unexpected).length > 0) blocker.unexpected = unexpected
  if (Object.keys(rawEvents).length > 0) blocker.rawEvents = rawEvents
  report.diagnosticBlockers.push(blocker)
}

/** Throws as soon as the complete smoke deadline is exhausted. */
function assertBeforeDeadline(description) {
  if (remainingSmokeTime(operationDeadline) <= 0) {
    throw new Error(`Packaged smoke deadline exceeded during ${description}.`)
  }
}

/** Runs one renderer action with both a Playwright and complete-smoke deadline. */
async function boundedPageAction(page, operation, description) {
  assertBeforeDeadline(description)
  const timeout = Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline))
  page.setDefaultTimeout(timeout)
  const result = await runBounded(operation, timeout)
  if (!result.completed) throw new Error(`Packaged smoke deadline exceeded during ${description}.`)
  return result.value
}

/** Captures one renderer screenshot without allowing filesystem or browser waits to escape. */
async function boundedPageScreenshot(page, options, description) {
  assertBeforeDeadline(description)
  const timeout = Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline))
  const result = await runBounded(
    () => page.screenshot({ ...options, timeout }),
    timeout,
  )
  if (!result.completed) throw new Error(`Packaged smoke deadline exceeded during ${description}.`)
  return result.value
}

/** Reads one renderer IPC value inside the complete-smoke deadline. */
async function boundedPageEvaluate(page, pageFunction, argument, description) {
  assertBeforeDeadline(description)
  const timeout = Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline))
  const result = await runBounded(
    () => page.evaluate(pageFunction, argument),
    timeout,
  )
  if (!result.completed) throw new Error(`Packaged smoke deadline exceeded during ${description}.`)
  return result.value
}

/** Reads one Electron application value inside the complete-smoke deadline. */
async function boundedAppEvaluate(app, pageFunction, argument, description) {
  assertBeforeDeadline(description)
  const timeout = Math.min(CONDITION_TIMEOUT_MS, remainingSmokeTime(operationDeadline))
  const result = await runBounded(
    () => app.evaluate(pageFunction, argument),
    timeout,
  )
  if (!result.completed) throw new Error(`Packaged smoke deadline exceeded during ${description}.`)
  return result.value
}

/** Redacts credentials and sensitive query values from process diagnostics. */
function sanitizeDiagnosticText(value) {
  return sanitizePackagedDiagnosticText(value)
}

/** Bounds diagnostic formatting so timeout failures remain readable. */
function safeJson(value) {
  try {
    return JSON.stringify(value)?.slice(0, 1_000) ?? 'undefined'
  } catch {
    return String(value)
  }
}

/** Reads one Git value without mutating the checkout. */
function gitValue(argumentsList) {
  try {
    return execFileSync('git', argumentsList, { cwd: projectRoot, encoding: 'utf8' }).trim()
  } catch (error) {
    return `unavailable: ${messageOf(error)}`
  }
}

/** Reads untrimmed Git output for a bounded working-source digest. */
function gitOutput(argumentsList) {
  try {
    return execFileSync('git', argumentsList, { cwd: projectRoot, encoding: 'utf8' })
  } catch (error) {
    return `unavailable: ${messageOf(error)}`
  }
}

/** Small non-blocking polling delay. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
