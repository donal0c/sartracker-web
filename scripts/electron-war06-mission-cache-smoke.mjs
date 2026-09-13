#!/usr/bin/env node

// Bounded DON-267 packaged proof for mission-scoped tracking cache recovery.
// This script deliberately exercises the packaged renderer and production
// polling/IPC/SQLite path. The only direct writes are disposable setup
// fixtures: settings before launch, Mission B creation/participant selection,
// and retained cache copies between launches.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { _electron as electron } from 'playwright'
import { extractFile } from '@electron/asar'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const runnerPath = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(runnerPath), '..')
const CACHE_FILE_NAME = 'tracking-cache.json'
const DISCARDED_CACHE_WARNING =
  'Tracking cache could not be matched to this mission; waiting for fresh current positions.'
const DEVICE_ID = '1'
const A_CURRENT_ID = '601'
const A_HISTORY_IDS = ['611', '612']
const B_CURRENT_ID = '701'
const B_HISTORY_IDS = ['711', '712']
const CLOSE_TIMEOUT_MS = 20_000
const CONDITION_TIMEOUT_MS = 45_000

main().catch((error) => {
  console.error(`electron-war06-mission-cache-smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs the bounded packaged mission/cache proof and writes a receipt. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const appPath = path.resolve(options.appPath)
  const evidenceDir = path.resolve(options.evidenceDir)
  await mkdir(evidenceDir, { recursive: true })

  const profile = await mkdtemp(path.join(os.tmpdir(), 'sartracker-war06-cache-'))
  const cachePath = path.join(profile, CACHE_FILE_NAME)
  const sourceStatus = gitOutput(['status', '--porcelain'])
  const sourceDiff = gitOutput(['diff', 'HEAD', '--no-ext-diff', '--binary'])
  const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA ?? null
  const expectedSourceTree = process.env.EXPECTED_SOURCE_TREE ?? null
  const report = {
    schemaVersion: 1,
    issue: 'DON-267',
    proof: 'actual packaged Electron renderer, poller, IPC and SQLite; loopback synthetic provider',
    startedAt: new Date().toISOString(),
    sourceHead: gitValue(['rev-parse', 'HEAD']),
    sourceTree: gitValue(['rev-parse', 'HEAD^{tree}']),
    sourceDirty: sourceStatus.trim().length > 0,
    sourceStatusSha256: sha256(sourceStatus),
    sourceDiffSha256: sha256(sourceDiff),
    sourceDiffBytes: Buffer.byteLength(sourceDiff, 'utf8'),
    expectedSourceSha,
    expectedSourceTree,
    runnerPath,
    runnerSha256: await sha256File(runnerPath),
    executablePath: appPath,
    evidenceDirectory: evidenceDir,
    profile,
    setupOnly: [
      'Disposable settings and credentials were seeded before the first launch.',
      'Mission B, its device metadata and participant selection were created through the real preload missionStore IPC during setup; no B positions were seeded.',
      'A cache bytes were retained and copied back after Mission B setup to create the deliberate cross-mission fixture.',
      'The legacy fixture was made by removing mission_id from that retained A cache copy.',
    ],
    provider: null,
    package: null,
    launches: [],
    phases: {},
    failures: [],
    result: 'fail',
  }

  let provider
  let activeLaunch = null
  let failure = null
  let retainedMissionACache = null
  let missionA = null
  let missionB = null

  try {
    assert.ok(await isRegularFile(appPath), `Packaged Electron executable does not exist: ${appPath}`)
    if (expectedSourceSha !== null) {
      assert.equal(report.sourceHead, expectedSourceSha, 'Smoke source head does not match EXPECTED_SOURCE_SHA.')
      assert.equal(report.sourceDirty, false, 'Exact-head packaged smoke requires a clean source tree.')
    }
    if (expectedSourceTree !== null) {
      assert.equal(report.sourceTree, expectedSourceTree, 'Smoke source tree does not match EXPECTED_SOURCE_TREE.')
    }
    if (process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1') {
      const unpackedRoot = `${path.resolve(projectRoot, 'tmp', 'electron-dist', 'linux-unpacked')}${path.sep}`
      assert.equal(process.platform, 'linux', 'Linux packaged smoke must run on Linux.')
      assert.ok(appPath.startsWith(unpackedRoot), 'Smoke must run the CI-built linux-unpacked executable.')
    }
    provider = await startSyntheticProvider()
    report.provider = provider.describe()
    await seedSyntheticSettings(profile, provider.origin)

    activeLaunch = await launchPackaged(appPath, profile, 'mission-a-live', report)
    report.package = await attestPackagedInputs(activeLaunch.app, appPath)
    await prepareMissionA(activeLaunch.page)
    missionA = await waitForValue(
      () => readActiveMission(activeLaunch.page),
      (mission) => mission?.name === 'WAR-06 Mission A',
      'Mission A to become active',
    )
    const missionALive = await waitForCache(
      cachePath,
      (cache) => cache?.mission_id === missionA.id && cacheHasIds(cache, [A_CURRENT_ID]),
      'Mission A current position and mission-scoped cache write',
    )
    const missionAHistory = await waitForCache(
      cachePath,
      (cache) => cache?.mission_id === missionA.id && cacheHasIds(cache, A_HISTORY_IDS),
      'Mission A history to be represented in the cache',
    )
    retainedMissionACache = await readFile(cachePath, 'utf8')
    assertCacheMatchesMission(
      parseCache(retainedMissionACache),
      missionA.id,
      [A_CURRENT_ID, ...A_HISTORY_IDS],
    )
    const missionAWrite = await capturePhase(
      activeLaunch,
      evidenceDir,
      'mission-a-live',
      missionA.id,
      {
        cache: missionALive,
        cacheWithHistory: summarizeCache(missionAHistory),
        expectedCurrentIds: [A_CURRENT_ID],
        expectedHistoryIds: A_HISTORY_IDS,
      },
    )
    report.phases.missionAWrite = missionAWrite
    assert.ok(missionAWrite.surface.currentFixCount > 0, 'Mission A live provider response never rendered a current fix.')
    assert.ok((missionAWrite.cache?.positionCount ?? 0) > 0, 'Mission A cache write contained no current position.')
    assertCacheMatchesMission(missionALive, missionA.id, [A_CURRENT_ID])
    assertCacheMatchesMission(missionAHistory, missionA.id, A_HISTORY_IDS)
    await closeLaunch(activeLaunch, report)
    activeLaunch = null

    provider.setAvailable(false)
    activeLaunch = await launchPackaged(appPath, profile, 'mission-a-offline-restart', report)
    const positiveSamples = await observeActionSurface(activeLaunch.page, async () => {
      await resumeRecoverableMission(activeLaunch.page, missionA.id)
      await waitForValue(
        () => readOperatorSurface(activeLaunch.page),
        (surface) => surface.mode.toLowerCase() === 'offline'
          && surface.currentFixCount > 0 && surface.cachedDeviceCount > 0,
        'same-mission restart to show retained cache',
      )
    })
    const missionAOffline = await capturePhase(
      activeLaunch,
      evidenceDir,
      'mission-a-offline-restart',
      missionA.id,
      { surfaceSamples: [...activeLaunch.startupSamples, ...positiveSamples.samples] },
    )
    assert.equal(missionAOffline.surface.mode.toLowerCase(), 'offline')
    assert.match(missionAOffline.surface.counters, /Cache\s*1/i)
    assert.match(missionAOffline.deviceWorkspace?.coordinates ?? '', /52\.10010,\s*-9\.70010/,
      'A positive-control recovery did not show A coordinates in the operator inspector.')
    assert.ok((missionAOffline.surfaceSamples?.sampleCount ?? 0) > 0, 'A positive-control recovery produced no renderer surface samples.')
    assert.ok(missionAOffline.surfaceSamples.maxCurrentFixCount > 0, 'A positive-control recovery never rendered a current fix.')
    assert.ok(missionAOffline.surfaceSamples.maxCachedDeviceCount > 0, 'A positive-control recovery never rendered a cached device.')
    assertHasIds(missionAOffline.ipc.positions, [A_CURRENT_ID], 'A positive-control SQLite/IPC evidence')
    assertCacheMatchesMission(missionAOffline.cache, missionA.id, [A_CURRENT_ID])
    report.phases.missionAOfflineRestart = missionAOffline
    await closeLaunch(activeLaunch, report)
    activeLaunch = null

    activeLaunch = await launchPackaged(appPath, profile, 'mission-b-setup', report)
    await resumeRecoverableMission(activeLaunch.page, missionA.id)
    await finishMission(activeLaunch.page, missionA.id)
    await waitForValue(
      () => readActiveMission(activeLaunch.page),
      (mission) => mission === null,
      'Mission A to finish before Mission B setup',
    )
    missionB = await createMissionBForSetup(activeLaunch.page)
    await selectMissionBDeviceForSetup(activeLaunch.page, missionB.id)
    const setupEvidence = await readMissionEvidence(activeLaunch.page, missionB.id)
    assert.equal(setupEvidence.mission?.id, missionB.id)
    assert.equal(setupEvidence.mission?.status, 'active')
    report.phases.missionBSetup = {
      setupOnly: true,
      mission: summarizeMission(setupEvidence.mission),
      participants: setupEvidence.participants,
      sqliteIpc: setupEvidence.sqliteIpc,
    }
    await closeLaunch(activeLaunch, report)
    activeLaunch = null

    await writeFile(cachePath, retainedMissionACache, 'utf8')
    const keyedFixture = parseCache(await readFile(cachePath, 'utf8'))
    assertCacheMatchesMission(keyedFixture, missionA.id, [A_CURRENT_ID, ...A_HISTORY_IDS])
    report.phases.missionBKeyedFixture = {
      setupOnly: true,
      cachePath,
      cache: summarizeCache(keyedFixture),
      cacheSha256: sha256(retainedMissionACache),
      sourceMissionId: missionA.id,
      targetMissionId: missionB.id,
      operation: 'restored retained Mission A bytes after Mission B was created',
    }

    activeLaunch = await launchPackaged(appPath, profile, 'mission-b-keyed-a-rejected', report)
    const keyedObservation = await observeActionSurface(activeLaunch.page, async () => {
      await resumeRecoverableMission(activeLaunch.page, missionB.id)
      return waitForValue(
        () => readOperatorSurface(activeLaunch.page),
        (surface) => surface.warning.includes(DISCARDED_CACHE_WARNING),
        'planned keyed-cache discard warning for Mission B',
      )
    })
    const keyedReject = await capturePhase(
      activeLaunch,
      evidenceDir,
      'mission-b-keyed-a-rejected',
      missionB.id,
      {
        cache: await readCache(cachePath),
        discardWarning: keyedObservation.result.warning,
        surfaceSamples: [...activeLaunch.startupSamples, ...keyedObservation.samples],
      },
    )
    assertCacheMatchesMission(keyedReject.cache, missionA.id, [A_CURRENT_ID, ...A_HISTORY_IDS])
    assertMissionBHasNoMissionA(keyedReject, missionA.id, 'keyed A cache under Mission B')
    report.phases.missionBKeyedReject = keyedReject
    await closeLaunch(activeLaunch, report)
    activeLaunch = null

    await writeFile(cachePath, JSON.stringify({ ...parseCache(retainedMissionACache), mission_id: undefined }), 'utf8')
    const legacyPayload = parseCache(await readFile(cachePath, 'utf8'))
    report.phases.missionBLegacyFixture = {
      setupOnly: true,
      cachePath,
      cache: summarizeCache(legacyPayload),
      cacheSha256: sha256(await readFile(cachePath, 'utf8')),
      sourceMissionId: missionA.id,
      targetMissionId: missionB.id,
      operation: 'removed mission_id from retained Mission A cache; legacy identity is unknown and must be discarded',
    }

    activeLaunch = await launchPackaged(appPath, profile, 'mission-b-legacy-rejected', report)
    const legacyObservation = await observeActionSurface(activeLaunch.page, async () => {
      await resumeRecoverableMission(activeLaunch.page, missionB.id)
      return waitForValue(
        () => readOperatorSurface(activeLaunch.page),
        (surface) => surface.warning.includes(DISCARDED_CACHE_WARNING),
        'planned legacy-cache discard warning for Mission B',
      )
    })
    const legacyReject = await capturePhase(
      activeLaunch,
      evidenceDir,
      'mission-b-legacy-rejected',
      missionB.id,
      {
        cache: legacyPayload,
        discardWarning: legacyObservation.result.warning,
        surfaceSamples: [...activeLaunch.startupSamples, ...legacyObservation.samples],
      },
    )
    assert.equal(legacyReject.cache?.mission_id, undefined, 'Legacy fixture unexpectedly carried a mission identity.')
    assert.ok(cacheHasIds(legacyReject.cache, [A_CURRENT_ID, ...A_HISTORY_IDS]),
      'Legacy fixture no longer contains the retained Mission A rows.')
    assertMissionBHasNoMissionA(legacyReject, missionA.id, 'legacy unkeyed A cache under Mission B')
    report.phases.missionBLegacyReject = legacyReject

    provider.setMode('B')
    provider.setAvailable(true)
    await waitForValue(
      async () => ({
        surface: await readOperatorSurface(activeLaunch.page),
        cache: await readCache(cachePath),
      }),
      (observation) => observation.surface.mode.toLowerCase() === 'online'
        && cacheHasIds(observation.cache, [B_CURRENT_ID, ...B_HISTORY_IDS])
        && observation.cache?.mission_id === missionB.id,
      'fresh Mission B response and mission-scoped cache write',
    )
    const freshB = await capturePhase(activeLaunch, evidenceDir, 'mission-b-fresh', missionB.id)
    assertMissionBFresh(freshB, missionA.id, missionB.id)
    report.phases.missionBFresh = freshB
    await closeLaunch(activeLaunch, report)
    activeLaunch = null

    report.provider = provider.describe()
    report.result = 'pass'
  } catch (error) {
    failure = error
    report.failures.push(error instanceof Error ? error.message : String(error))
    if (activeLaunch !== null) {
      try {
        const failureScreenshot = path.join(evidenceDir, 'failure.png')
        await activeLaunch.page.screenshot({ path: failureScreenshot })
        report.failureScreenshot = failureScreenshot
      } catch (screenshotError) {
        report.failures.push(`Failure screenshot could not be captured: ${messageOf(screenshotError)}`)
      }
    }
  } finally {
    if (activeLaunch !== null) {
      try {
        await closeLaunch(activeLaunch, report)
      } catch (closeError) {
        report.failures.push(`Cleanup close failed: ${messageOf(closeError)}`)
      }
    }
    if (provider !== undefined) {
      try {
        await provider.close()
      } catch (providerError) {
        report.failures.push(`Synthetic provider close failed: ${messageOf(providerError)}`)
      }
      report.provider = provider.describe()
    }
    report.finishedAt = new Date().toISOString()
    if (report.failures.length > 0) report.result = 'fail'
    report.profileRemoved = false
    await writeFile(path.join(evidenceDir, 'receipt.json'), JSON.stringify(report, null, 2), 'utf8')
  }

  if (failure !== null) throw failure
  if (report.result !== 'pass') throw new Error(report.failures.join('; ') || 'Packaged smoke failed.')
}

/** Parses the deliberately small CLI surface for a packaged-only smoke. */
function parseArgs(argv) {
  let appPath = null
  let evidenceDir = path.join(projectRoot, 'tmp', 'war06-mission-cache-smoke')
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--app') {
      appPath = argv[++index]
    } else if (argument === '--evidence') {
      evidenceDir = argv[++index]
    } else if (argument === '--help') {
      console.log('Usage: node scripts/electron-war06-mission-cache-smoke.mjs --app <packaged-executable> [--evidence <directory>]')
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

/** Seeds only app settings and synthetic credentials in the disposable profile. */
async function seedSyntheticSettings(profile, origin) {
  const { createElectronSettingsStore } = require(path.join(projectRoot, 'electron', 'settings-store.cjs'))
  const settingsStore = createElectronSettingsStore({ userDataPath: profile })
  const settings = await settingsStore.loadAppSettings()
  await settingsStore.saveAppSettings({
    ...settings,
    missionDefaults: {
      ...settings.missionDefaults,
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 5,
      autoSaveEnabled: false,
    },
    dataSource: {
      ...settings.dataSource,
      providerType: 'traccar_http',
      baseUrl: origin,
      authMode: 'basic',
      email: 'war06-synthetic@example.invalid',
      secretInput: 'war06-synthetic-secret',
      autoConnect: true,
      trackingCacheEnabled: true,
    },
  })
}

/** Starts the deterministic loopback Traccar subset used by all launches. */
async function startSyntheticProvider() {
  let available = true
  let mode = 'A'
  let observedAt = Date.now()
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push({
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.search,
      available,
      mode,
      at: new Date().toISOString(),
    })
    if (requests.length > 500) requests.shift()
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (!available) {
      send(503, { error: 'synthetic provider outage' })
      return
    }
    if (url.pathname === '/api/session') {
      send(200, { id: 'war06-session' })
      return
    }
    if (url.pathname === '/api/devices') {
      send(200, [{
        id: Number(DEVICE_ID),
        name: 'WAR-06 Synthetic Device',
        uniqueId: 'war06-synthetic-device',
        status: 'online',
        lastUpdate: new Date(observedAt).toISOString(),
      }])
      return
    }
    if (url.pathname === '/api/groups') {
      send(200, [])
      return
    }
    if (url.pathname === '/api/positions') {
      const historyRequest = url.searchParams.has('from') || url.searchParams.has('to')
      send(200, historyRequest ? syntheticHistory(mode, observedAt) : [syntheticCurrent(mode, observedAt)])
      return
    }
    send(404, { error: 'synthetic route not implemented' })
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
    setAvailable(next) {
      available = next
    },
    setMode(next) {
      assert.ok(next === 'A' || next === 'B')
      mode = next
      observedAt = Date.now()
    },
    describe() {
      return {
        origin,
        available,
        mode,
        requestCount: requests.length,
        requestCounts: requests.reduce((counts, request) => {
          const key = `${request.method} ${request.path}`
          counts[key] = (counts[key] ?? 0) + 1
          return counts
        }, {}),
        recentRequests: requests.slice(-20),
      }
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

/** Builds a recent normalized Traccar-shaped position for the selected phase. */
function syntheticCurrent(currentMode, observedAt) {
  const isA = currentMode === 'A'
  return {
    id: Number(isA ? A_CURRENT_ID : B_CURRENT_ID),
    deviceId: Number(DEVICE_ID),
    latitude: isA ? 52.1001 : 52.9001,
    longitude: isA ? -9.7001 : -9.1001,
    fixTime: new Date(observedAt - 1_000).toISOString(),
    valid: true,
    accuracy: 4,
    speed: 0,
    attributes: {},
  }
}

/** Builds deliberately distinct current and historical positions. */
function syntheticHistory(currentMode, observedAt) {
  const isA = currentMode === 'A'
  const ids = isA ? A_HISTORY_IDS : B_HISTORY_IDS
  const latitude = isA ? 52.1001 : 52.9001
  const longitude = isA ? -9.7001 : -9.1001
  return ids.map((id, index) => ({
    id: Number(id),
    deviceId: Number(DEVICE_ID),
    latitude: latitude + index * 0.0001,
    longitude: longitude - index * 0.0001,
    fixTime: new Date(observedAt - (index + 2) * 60_000).toISOString(),
    valid: true,
    accuracy: 4,
    speed: 0,
    attributes: {},
  }))
}

/** Launches exactly the supplied packaged executable with a disposable profile. */
async function launchPackaged(appPath, profile, label, report) {
  const launch = {
    label,
    app: null,
    page: null,
    process: null,
    diagnostics: { consoleErrors: [], pageErrors: [], processStderr: [] },
    screenshots: [],
    startupSamples: [],
    close: null,
  }
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
    timeout: CLOSE_TIMEOUT_MS,
  })
  launch.process = launch.app.process()
  assert.ok(launch.process !== null, `Packaged launch did not expose a child process for ${label}`)
  launch.process.stderr?.on('data', (chunk) => {
    launch.diagnostics.processStderr.push(sanitizeDiagnosticText(String(chunk)))
    if (launch.diagnostics.processStderr.length > 40) launch.diagnostics.processStderr.shift()
  })
  launch.page = await launch.app.firstWindow()
  launch.page.on('console', (message) => {
    if (message.type() === 'error') launch.diagnostics.consoleErrors.push(sanitizeDiagnosticText(message.text()))
  })
  launch.page.on('pageerror', (error) => {
    launch.diagnostics.pageErrors.push(sanitizeDiagnosticText(error.message))
  })
  const startupObservation = await observeActionSurface(launch.page, () =>
    launch.page.getByTestId('app-title').waitFor({ timeout: CLOSE_TIMEOUT_MS }))
  launch.startupSamples = startupObservation.samples
  report.launches.push({ label, executablePath: appPath, launchedAt: new Date().toISOString() })
  return launch
}

/** Verifies the running app resolves to the asar and that packaged inputs match source inputs. */
async function attestPackagedInputs(app, appPath) {
  const archivePath = await app.evaluate(({ app: runningApp }) => runningApp.getAppPath())
  assert.ok(typeof archivePath === 'string' && archivePath.endsWith('.asar'),
    `Packaged launch resolved to ${archivePath}; expected an app.asar renderer.`)
  const archiveBytes = await readFile(archivePath)
  const sourcePackage = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const packagedPackage = JSON.parse(extractFile(archivePath, 'package.json').toString('utf8'))
  assert.equal(packagedPackage.name, sourcePackage.name, 'Packaged package name does not match source package.json.')
  assert.equal(packagedPackage.version, sourcePackage.version, 'Packaged package version does not match source package.json.')
  // electron-builder removes development metadata from the main package.json.
  // Compare runtime fields and retain both byte hashes instead of requiring
  // an intentionally transformed manifest to be byte-identical.
  for (const field of ['main', 'type', 'dependencies']) {
    assert.deepEqual(packagedPackage[field], sourcePackage[field], `Packaged manifest runtime field mismatch: ${field}`)
  }
  const electronFiles = await filesUnder(path.join(projectRoot, 'electron'), 'electron')
  const distFiles = await filesUnder(path.join(projectRoot, 'dist'), 'dist')
  const sharedFiles = await filesUnder(path.join(projectRoot, 'shared'), 'shared')
  const sourceInputs = [...electronFiles, ...distFiles, ...sharedFiles]
  const inputHashes = {}
  for (const relativePath of sourceInputs) {
    const sourcePath = path.join(projectRoot, relativePath)
    const sourceBytes = await readFile(sourcePath)
    const packagedBytes = extractFile(archivePath, relativePath)
    const sourceHash = sha256(sourceBytes)
    const packagedHash = sha256(packagedBytes)
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
    manifest: {
      sourceSha256: await sha256File(path.join(projectRoot, 'package.json')),
      packagedSha256: sha256(extractFile(archivePath, 'package.json')),
      runtimeFieldsMatch: true,
      transformation: 'electron-builder main manifest development-metadata cleanup',
    },
    inputHashes,
  }
}

/** Performs the real operator setup for Mission A, including participant selection. */
async function prepareMissionA(page) {
  const picker = page.getByTestId('participant-device-picker')
  await picker.getByRole('checkbox').first().waitFor({ timeout: CONDITION_TIMEOUT_MS })
  await picker.getByRole('checkbox').first().check()
  await page.getByTestId('mission-name-input').fill('WAR-06 Mission A')
  // Keep the synthetic history rows inside the real mission evidence window.
  // This is still operator setup through the production control, rather than
  // a direct mission-store fixture write.
  await page.getByTestId('mission-offset-input').fill('1')
  await page.getByTestId('mission-start-btn').click()
}

/** Resumes the recoverable mission through the operator-facing recovery control. */
async function resumeRecoverableMission(page, missionId) {
  const dialog = page.getByTestId('mission-recovery-dialog')
  await dialog.waitFor({ state: 'visible', timeout: CONDITION_TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Resume', exact: true }).click()
  await waitForValue(
    () => readActiveMission(page),
    (mission) => mission?.id === missionId && mission.status === 'active',
    `mission ${missionId} to resume`,
  )
}

/** Finishes a mission through the operator-facing decision dialog. */
async function finishMission(page, missionId) {
  await page.getByTestId('mission-finish-btn').click()
  const dialog = page.getByTestId('mission-finish-dialog')
  await dialog.waitFor({ state: 'visible', timeout: CONDITION_TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Confirm Finish', exact: true }).click()
  await waitForValue(
    () => readActiveMission(page),
    (mission) => mission === null,
    `mission ${missionId} to finish`,
  )
}

/** Creates Mission B through real preload IPC as a clearly labelled setup operation. */
async function createMissionBForSetup(page) {
  const mission = await page.evaluate(async () => {
    const store = window.sartrackerElectron?.missionStore
    if (store?.createMission === undefined) throw new Error('Mission creation IPC is unavailable.')
    return store.createMission({
      name: 'WAR-06 Mission B',
      // Keep the synthetic history rows inside the real B evidence window.
      start_time: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    })
  })
  assert.ok(mission?.id, 'Mission B setup did not return a mission id.')
  return mission
}

/** Selects the synthetic device for Mission B through real preload IPC setup. */
async function selectMissionBDeviceForSetup(page, missionId) {
  const participants = await page.evaluate(async ({ id, deviceId }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store?.selectMissionParticipants === undefined) {
      throw new Error('Mission participant IPC is unavailable.')
    }
    // This is an existing mission restart fixture. Seed its device metadata
    // before selecting it, so backfill does not race a missing setup row.
    await store.upsertDevice({ mission_id: id, device_id: deviceId,
      name: 'WAR-06 Synthetic Device', color: '#00a6ed', status: 'offline',
      last_seen: null, unique_id: 'war06-synthetic-device', group_id: null })
    return store.selectMissionParticipants({
      mission_id: id,
      groups: [],
      devices: [{ traccar_device_id: deviceId }],
      selected_by: 'WAR-06 packaged smoke setup',
    })
  }, { id: missionId, deviceId: DEVICE_ID })
  assert.ok(Array.isArray(participants) && participants.some((participant) => participant.traccar_device_id === DEVICE_ID),
    'Mission B setup did not retain the synthetic participant.')
}

/** Captures screenshot, operator surface, read-only IPC and read-only SQLite evidence. */
async function capturePhase(launch, evidenceDir, phase, missionId, extra = {}) {
  const screenshotPath = path.join(evidenceDir, `${phase}.png`)
  await launch.page.screenshot({ path: screenshotPath })
  launch.screenshots.push(screenshotPath)
  const surface = await readOperatorSurface(launch.page, { requireCounters: true })
  const ipc = await readMissionEvidence(launch.page, missionId)
  const deviceWorkspace = await captureDeviceWorkspace(launch, evidenceDir, phase)
  const cache = extra.cache ?? await readCache(path.join(await readUserDataPath(launch.page), CACHE_FILE_NAME))
  const reportExtra = { ...extra }
  delete reportExtra.cache
  if (Array.isArray(reportExtra.surfaceSamples)) {
    reportExtra.surfaceSamples = summarizeSurfaceSamples(reportExtra.surfaceSamples)
  }
  const result = {
    phase,
    screenshotPath,
    surface,
    cache: summarizeCache(cache),
    ipc,
    deviceWorkspace,
    ...reportExtra,
  }
  assert.ok(typeof ipc.sqliteIpc?.database_path === 'string', 'Mission store info did not expose database_path for readonly SQLite evidence.')
  result.sqliteReadOnly = readOnlySqliteEvidence(ipc.sqliteIpc.database_path, missionId)
  return result
}

/** Reads the current operator-visible text without mutating renderer state. */
async function readOperatorSurface(page, options = {}) {
  const surface = await page.evaluate(() => {
    const text = (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? ''
    return {
      mode: text('tracking-mode-chip'),
      warning: text('tracking-warning'),
      counters: text('tracking-counters'),
      stationaryAttention: text('stationary-attention-summary'),
      body: document.body.innerText,
    }
  })
  if (options.requireCounters === true) {
    assert.match(surface.counters, /Fixes\s*\d+/i, 'Tracking fixes counter is not readable on the operator surface.')
    assert.match(surface.counters, /Cache\s*\d+/i, 'Tracking cache counter is not readable on the operator surface.')
  }
  return {
    ...surface,
    currentFixCount: readCounter(surface.counters, 'Fixes'),
    cachedDeviceCount: readCounter(surface.counters, 'Cache'),
  }
}

/** Captures the operator device inspector and coordinates when a row exists. */
async function captureDeviceWorkspace(launch, evidenceDir, phase) {
  const openButton = launch.page.getByTestId('open-devices-workspace')
  if (await openButton.count() === 0) return { visible: false }
  await openButton.click()
  const workspace = launch.page.getByTestId('devices-workspace')
  await workspace.waitFor({ state: 'visible', timeout: CONDITION_TIMEOUT_MS })
  const row = launch.page.getByTestId(`device-select-name-${DEVICE_ID}`)
  const layout = workspace.locator('..')
  if (await row.count() > 0) {
    await row.click()
    await layout.getByText('Coordinates', { exact: true }).waitFor()
  }
  // The inspector is a sibling of the roster section, inside this layout.
  const workspaceText = await layout.innerText()
  const screenshotPath = path.join(evidenceDir, `${phase}-devices.png`)
  await launch.page.screenshot({ path: screenshotPath })
  launch.screenshots.push(screenshotPath)
  const closeButton = launch.page.getByTestId('workspace-close-btn')
  if (await closeButton.count() > 0) await closeButton.click()
  return {
    visible: true,
    screenshotPath,
    text: workspaceText,
    coordinates: workspaceText.match(/Coordinates\s+(-?\d+\.\d+),\s*(-?\d+\.\d+)/i)?.[0] ?? null,
    syntheticDeviceVisible: workspaceText.includes('WAR-06 Synthetic Device'),
  }
}

/** Samples the visible renderer while recovery and cache admission are settling. */
async function observeActionSurface(page, action) {
  const samples = []
  let observing = true
  const sampler = (async () => {
    while (observing) {
      try {
        samples.push(await readOperatorSurface(page))
      } catch {
        // The renderer can be between startup documents; retain surrounding samples.
      }
      await delay(50)
    }
  })()
  let result
  try {
    result = await action()
  } finally {
    observing = false
    await sampler
  }
  if (result !== null && typeof result === 'object'
    && 'warning' in result && typeof result.warning === 'string') {
    samples.push(result)
  }
  return { result, samples }
}

/** Reduces startup observations to current/cache counts and warning sightings. */
function summarizeSurfaceSamples(samples) {
  const validSamples = samples.filter((sample) => sample !== null && sample !== undefined)
  return {
    sampleCount: validSamples.length,
    first: validSamples[0] ?? null,
    last: validSamples.at(-1) ?? null,
    maxCurrentFixCount: Math.max(0, ...validSamples.map((sample) => sample.currentFixCount ?? 0)),
    maxCachedDeviceCount: Math.max(0, ...validSamples.map((sample) => sample.cachedDeviceCount ?? 0)),
    discardWarningObserved: validSamples.some((sample) => sample.warning.includes(DISCARDED_CACHE_WARNING)),
    attentionObserved: validSamples.some((sample) => sample.stationaryAttention !== ''),
  }
}

/** Reads a named integer from the four-column tracking counter readout. */
function readCounter(text, label) {
  const value = text.match(new RegExp(`${label}\\s*(\\d+)`, 'i'))?.[1]
  return value === undefined ? 0 : Number(value)
}

/** Reads mission evidence through the exposed read-only preload methods. */
async function readMissionEvidence(page, missionId) {
  const result = await page.evaluate(async (id) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission store IPC is unavailable.')
    const [mission, recoverable, participants, devices, positions, events, info] = await Promise.all([
      store.getMission(id),
      store.getRecoverableMission(),
      store.listMissionParticipants(id),
      store.listDevices(id),
      store.listPositions(id),
      store.listMissionEvents(id),
      store.info(),
    ])
    return {
      mission,
      recoverable: recoverable === null ? null : { id: recoverable.id, status: recoverable.status },
      participants,
      devices,
      positions,
      events: events.filter((event) => event.event_type !== 'device_updated' && event.event_type !== 'position_recorded'),
      sqliteIpc: info,
    }
  }, missionId)
  return result
}

/** Reads active mission state through read-only preload IPC. */
async function readActiveMission(page) {
  return page.evaluate(async () => window.sartrackerElectron?.missionStore.getActiveMission() ?? null)
}

/** Resolves the profile path from Electron's read-only app settings/runtime surface. */
async function readUserDataPath(page) {
  const info = await page.evaluate(async () => window.sartrackerElectron?.missionStore.info())
  assert.ok(typeof info?.database_path === 'string', 'Mission store info did not expose database_path.')
  return path.dirname(info.database_path)
}

/** Opens SQLite in readonly mode only, and returns bounded identity evidence. */
function readOnlySqliteEvidence(databasePath, missionId) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const positions = database.prepare(`SELECT source_position_id, id, data_origin, timestamp
      FROM positions WHERE mission_id = ? ORDER BY timestamp ASC, id ASC`).all(missionId)
    const counts = database.prepare(`SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?`).get(missionId)
    return {
      databasePath,
      positions: positions.map((position) => ({
        sourcePositionId: position.source_position_id,
        id: position.id,
        dataOrigin: position.data_origin,
        timestamp: position.timestamp,
      })),
      positionCount: Number(counts.count),
    }
  } finally {
    database.close()
  }
}

/** Waits for a condition without making elapsed time part of the proof. */
async function waitForValue(read, predicate, description) {
  const deadline = Date.now() + CONDITION_TIMEOUT_MS
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await read()
    if (predicate(lastValue)) return lastValue
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}. Last observed value: ${safeJson(lastValue)}`)
}

/** Waits for a valid cache payload and returns the parsed payload. */
async function waitForCache(cachePath, predicate, description) {
  return waitForValue(
    async () => readCache(cachePath),
    predicate,
    description,
  )
}

/** Reads a cache file while allowing the first launch to create it asynchronously. */
async function readCache(cachePath) {
  try {
    return parseCache(await readFile(cachePath, 'utf8'))
  } catch {
    return null
  }
}

/** Parses a cache only for evidence/fixture inspection; production parses it in the renderer. */
function parseCache(contents) {
  const value = JSON.parse(contents)
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value
}

/** Summarizes cache identity and row ids without copying the full payload to the report. */
function summarizeCache(cache) {
  if (cache === null || cache === undefined) return null
  return {
    mission_id: cache.mission_id,
    cached_at: cache.cached_at,
    deviceIds: deviceIdsFromEntries(cache.devices),
    positionIds: idsFromEntries(cache.positions),
    breadcrumbIds: idsFromEntries(cache.breadcrumbs),
    positionCount: Array.isArray(cache.positions) ? cache.positions.length : 0,
    breadcrumbCount: Array.isArray(cache.breadcrumbs) ? cache.breadcrumbs.length : 0,
  }
}

/** Checks ids across either normalized cache rows or native persisted positions. */
function idsFromEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => String(entry.source_position_id ?? entry.sourcePositionId ?? entry.id ?? '')).filter(Boolean)
}

/** Extracts Traccar device identities from a cache payload. */
function deviceIdsFromEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => String(entry.device_id ?? entry.deviceId ?? entry.id ?? '')).filter(Boolean)
}

/** Checks a cache contains all expected source position identities. */
function cacheHasIds(cache, expectedIds) {
  if (cache === null || cache === undefined) return false
  const ids = new Set([
    ...(Array.isArray(cache.positionIds) ? cache.positionIds : idsFromEntries(cache.positions)),
    ...(Array.isArray(cache.breadcrumbIds) ? cache.breadcrumbIds : idsFromEntries(cache.breadcrumbs)),
  ])
  return expectedIds.every((id) => ids.has(String(id)))
}

/** Ensures a genuine cache write is mission keyed and carries expected rows. */
function assertCacheMatchesMission(cache, missionId, expectedIds) {
  assert.equal(cache?.mission_id, missionId)
  assert.ok(cacheHasIds(cache, expectedIds), `Cache is missing expected ids ${expectedIds.join(', ')}`)
}

/** Ensures A never appears in any B operator, IPC or SQLite evidence. */
function assertMissionBHasNoMissionA(phase, missionAId, label) {
  assert.ok((phase.surfaceSamples?.sampleCount ?? 0) > 0, `${label} produced no renderer surface samples.`)
  assert.notEqual(phase.cache?.mission_id, phase.ipc.mission.id, `${label} was incorrectly accepted by mission identity.`)
  assert.ok(phase.surface.warning.includes(DISCARDED_CACHE_WARNING)
    || phase.discardWarning === DISCARDED_CACHE_WARNING,
  `${label} did not expose the planned discard warning before fresh data.`)
  assert.equal(phase.surface.currentFixCount, 0, `${label} rendered current fixes under Mission B.`)
  assert.equal(phase.surface.cachedDeviceCount, 0, `${label} rendered cached devices under Mission B.`)
  assert.equal(phase.surfaceSamples?.maxCurrentFixCount ?? 0, 0, `${label} transiently rendered a current fix.`)
  assert.equal(phase.surfaceSamples?.maxCachedDeviceCount ?? 0, 0, `${label} transiently rendered a cached device.`)
  assert.equal(phase.surfaceSamples?.attentionObserved ?? false, false, `${label} transiently rendered stationary attention.`)
  assert.equal(phase.surfaceSamples?.discardWarningObserved ?? false, true, `${label} did not expose the planned discard warning during recovery.`)
  assert.equal(phase.ipc.positions.length, 0, `${label} persisted positions while provider data was unavailable.`)
  assert.equal(phase.sqliteReadOnly.positionCount, 0, `${label} persisted readonly SQLite positions while provider data was unavailable.`)
  assertNoIds(phase.ipc.positions, [A_CURRENT_ID, ...A_HISTORY_IDS], `${label} renderer IPC evidence`)
  assertNoIds(phase.sqliteReadOnly.positions, [A_CURRENT_ID, ...A_HISTORY_IDS], `${label} readonly SQLite evidence`)
  assert.equal(phase.surface.stationaryAttention, '', `${label} left stationary attention visible.`)
  assert.equal(phase.ipc.positions.some((position) => String(position.mission_id) === missionAId), false)
}

/** Ensures Mission B fresh evidence is B-keyed and contains no A source identity. */
function assertMissionBFresh(phase, missionAId, missionBId) {
  assert.equal(phase.cache?.mission_id, missionBId)
  assert.ok(cacheHasIds(phase.cache, [B_CURRENT_ID, ...B_HISTORY_IDS]))
  assert.equal(phase.ipc.mission.id, missionBId)
  assert.equal(phase.surface.mode.toLowerCase(), 'online')
  assert.equal(phase.surface.warning.includes(DISCARDED_CACHE_WARNING), false,
    'Mission B retained the cache-discard warning after fresh B data arrived.')
  assert.ok(phase.surface.currentFixCount > 0, 'Mission B fresh response did not render a current fix.')
  assert.equal(phase.deviceWorkspace?.syntheticDeviceVisible, true, 'Mission B synthetic device was not visible in the inspector.')
  assert.match(phase.deviceWorkspace?.coordinates ?? '', /52\.90010,\s*-9\.10010/, 'Mission B inspector did not show B coordinates.')
  assertNoIds(phase.ipc.positions, [A_CURRENT_ID, ...A_HISTORY_IDS], 'Mission B fresh renderer IPC evidence')
  assertNoIds(phase.sqliteReadOnly.positions, [A_CURRENT_ID, ...A_HISTORY_IDS], 'Mission B fresh readonly SQLite evidence')
  assert.ok(phase.sqliteReadOnly.positions.some((position) =>
    String(position.sourcePositionId) === B_CURRENT_ID || String(position.sourcePositionId) === B_HISTORY_IDS[0]))
  assert.equal(phase.ipc.positions.some((position) => String(position.mission_id) === missionAId), false)
}

/** Checks all evidence entries for forbidden source ids. */
function assertNoIds(entries, forbiddenIds, label) {
  const forbidden = new Set(forbiddenIds.map(String))
  const found = entries.flatMap((entry) => {
    const candidates = [entry.source_position_id, entry.sourcePositionId, entry.id]
    return candidates.filter((candidate) => candidate !== null && candidate !== undefined && forbidden.has(String(candidate)))
  })
  assert.deepEqual(found, [], `${label} contains forbidden source ids: ${found.join(', ')}`)
}

/** Checks that positive-control evidence retains at least one expected source id. */
function assertHasIds(entries, expectedIds, label) {
  const ids = new Set(idsFromEntries(entries))
  for (const expectedId of expectedIds) {
    assert.ok(ids.has(String(expectedId)), `${label} is missing expected source id ${expectedId}.`)
  }
}

/** Captures the mission and identity fields used in report-only setup evidence. */
function summarizeMission(mission) {
  if (mission === null || mission === undefined) return null
  return { id: mission.id, name: mission.name, status: mission.status, start_time: mission.start_time }
}

/** Closes the packaged app and requires a clean exit code from the child process. */
async function closeLaunch(launch, report) {
  const startedAt = Date.now()
  let closeError = null
  try {
    await launch.app.close()
  } catch (error) {
    closeError = error
  }
  const exit = await waitForProcessExit(launch.process, CLOSE_TIMEOUT_MS)
  const closeEvidence = {
    requested: 'playwright ElectronApplication.close()',
    graceful: closeError === null && exit !== null && exit.exitCode === 0,
    exitCode: exit?.exitCode ?? null,
    signal: exit?.signal ?? null,
    durationMs: Date.now() - startedAt,
    diagnostics: launch.diagnostics,
    screenshots: launch.screenshots,
  }
  launch.close = closeEvidence
  const reportLaunch = report.launches.find((entry) => entry.label === launch.label)
  if (reportLaunch !== undefined) reportLaunch.close = closeEvidence
  if (closeError !== null) throw new Error(`${launch.label} close failed: ${messageOf(closeError)}`)
  assert.ok(exit !== null, `${launch.label} did not exit after orderly close.`)
  assert.equal(exit.exitCode, 0, `${launch.label} exited with code ${exit.exitCode ?? 'null'}${exit.signal ? ` (${exit.signal})` : ''}.`)
  return closeEvidence
}

/** Waits for the Electron child process to exit without killing it. */
function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve({ exitCode: child.exitCode, signal: child.signalCode })
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    child.once('exit', (exitCode, signal) => finish({ exitCode, signal }))
  })
}

/** Enumerates regular source files for packaged-input hash matching. */
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

/** Hashes a byte sequence with SHA-256 for artifact identity evidence. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Hashes a regular file without changing it. */
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

/** Redacts accidental provider/password text from diagnostic output. */
function sanitizeDiagnosticText(value) {
  return value.replace(/(authorization\s*:\s*basic\s+)[^\s]+/gi, '$1[redacted]')
    .slice(0, 2_000)
}

/** Bounds diagnostic formatting so timeout failures remain readable. */
function safeJson(value) {
  try {
    return JSON.stringify(value)?.slice(0, 1_000) ?? 'undefined'
  } catch {
    return String(value)
  }
}

/** Converts any thrown value to a concise message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Reads source identity for the receipt without changing the worktree. */
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
