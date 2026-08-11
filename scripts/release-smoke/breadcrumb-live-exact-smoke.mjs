import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { chromium } from 'playwright'

import {
  auditRenderedCoordinateDeviation,
  auditRenderedExactGeoJsonFeatures,
  assertExactFixEvidenceChain,
  assertExactFixSequence,
  buildAllowlistedLiveExactReport,
  createExactFixEvidence,
  createExactIdentityTimeEvidence,
  normalizeExactGeoJsonFeatures,
  normalizeExactProviderRows,
  normalizeExactStoredRows,
  parsePrivateTargetSelector,
  validateExactPageTraversal,
} from '../../build/breadcrumb-live-exact-proof-lib.js'

const EXACT_PAGE_LIMIT = 10_000
const LOOKBACK_HOURS = 48
const MINIMUM_FIELD_FIX_COUNT = 8_000
const appPath = requiredEnvironment('SMOKE_APP')
const evidenceDir = requiredEnvironment('SMOKE_EVIDENCE')
const privateVisualDir = requiredEnvironment('SMOKE_PRIVATE_VISUAL_DIR')
const configSource = requiredEnvironment('SMOKE_CONFIG_SOURCE')
const targetSelectorFile = requiredEnvironment('SMOKE_TARGET_SELECTOR_FILE')
const expectedVersion = requiredEnvironment('SMOKE_EXPECTED_VERSION')
const expectedAppSha256 = requiredEnvironment('SMOKE_EXPECTED_APP_SHA256').toLowerCase()
const reconciliationTimeoutMs = optionalPositiveIntegerEnvironment(
  'SMOKE_RECONCILIATION_TIMEOUT_MS',
  180_000,
)
const hmacKey = randomBytes(32)
const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-exact-'))
const userDataDir = path.join(userDataRoot, 'profile')
const privateDotsScreenshotPath = path.join(
  privateVisualDir,
  'real-traccar-exact-breadcrumb-dots.png',
)
const summaryPath = path.join(evidenceDir, 'summary.json')
const rawFixes = []
const sqliteFixes = []
const exactPageFixes = []
const exactGeoJsonFixes = []
const renderedMapFixes = []
let providerPayload = null
let appProcess = null
let browser = null
let screenshotWritten = false
let reportWritten = false

try {
  await verifyOutputIsolation(evidenceDir, privateVisualDir)
  const targetDeviceId = await readPrivateTargetSelector(targetSelectorFile)
  await assertFileSha256(appPath, expectedAppSha256)
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  await mkdir(privateVisualDir, { recursive: true, mode: 0o700 })
  await chmod(privateVisualDir, 0o700)
  await rm(summaryPath, { force: true })
  await rm(privateDotsScreenshotPath, { force: true })
  await mkdir(userDataDir, { recursive: true, mode: 0o700 })
  await copyPrivateConfiguration(configSource, userDataDir)

  const port = await findFreePort()
  appProcess = spawn(
    appPath,
    [
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--ozone-platform=x11',
      '--password-store=basic',
    ],
    {
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  )
  await waitForCdp(port, appProcess)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
  const mastText = await page.getByTestId('app-title').locator('..').textContent()
  assert(mastText?.includes(expectedVersion), 'ARTIFACT_VERSION_MISMATCH')

  const runtime = await page.evaluate(async () =>
    window.sartrackerElectron?.loadRuntimeBootstrapSettings(false),
  )
  const trackingConfig = validateRuntimeTrackingConfig(runtime)
  const pollIntervalMs = validatePositiveInteger(
    runtime.trackingPollIntervalMs,
    'RUNTIME_POLL_INTERVAL_INVALID',
  )

  const missionCreationFloorMs = Date.now()
  await page.getByTestId('mission-name-input').fill('Private exact breadcrumb field proof')
  await page.getByTestId('mission-offset-input').fill('48')
  await page.getByTestId('mission-start-btn').click()
  const mission = await waitForActiveMission(page, 30_000)
  assertLookback(mission.start_time, missionCreationFloorMs)

  await page.getByTestId('open-devices-workspace').click()
  await page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  const activeToggle = page.getByTestId(`device-active-toggle-${targetDeviceId}`)
  await activeToggle.waitFor({ state: 'visible', timeout: 60_000 })
  if ((await activeToggle.textContent())?.trim() !== 'Remove') {
    await activeToggle.click({ force: true })
  }
  const targetDeviceName = await readPrivateTargetDeviceName(
    page,
    mission.id,
    targetDeviceId,
  )
  await page.getByTestId('workspace-close-btn').click({ force: true })
  await page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  await page
    .getByTestId('tracking-status')
    .filter({ hasText: /online/u })
    .waitFor({ timeout: 60_000 })
  await waitForTargetReconciliation({
    page,
    missionId: mission.id,
    targetDeviceId,
    missionStart: mission.start_time,
    requiredUntilMs: missionCreationFloorMs,
    timeoutMs: reconciliationTimeoutMs,
  })

  await page.getByTestId('mission-pause-resume-btn').click({ force: true })
  await page.getByTestId('mission-paused-banner').waitFor({ state: 'visible' })
  const stableWindow = await waitForPausedTargetStability({
    page,
    missionId: mission.id,
    targetDeviceId,
    missionStart: mission.start_time,
    pollIntervalMs,
  })

  const sourceStartedAt = Date.now()
  providerPayload = await fetchProviderPositionsGetOnly({
    trackingConfig,
    targetDeviceId,
    from: mission.start_time,
    to: stableWindow.maximumTimestamp,
  })
  rawFixes.push(...normalizeExactProviderRows(providerPayload, targetDeviceId))
  providerPayload = null
  const sourceFetchMs = Date.now() - sourceStartedAt
  assert(rawFixes.length >= MINIMUM_FIELD_FIX_COUNT, 'FIELD_WORKLOAD_TOO_SMALL')
  assert(rawFixes.length === stableWindow.positionCount, 'PROVIDER_COUNT_MISMATCH')

  const exactPageStartedAt = Date.now()
  const directPages = await readAllExactPages({
    page,
    missionId: mission.id,
    targetDeviceId,
  })
  for (const directPage of directPages.pages) {
    exactPageFixes.push(...directPage)
  }
  const exactPageMs = Date.now() - exactPageStartedAt
  assert(directPages.totalPositionCount === rawFixes.length, 'EXACT_PAGE_TOTAL_MISMATCH')

  const geoJsonStartedAt = Date.now()
  const uiPages = await captureAllUiExactPages({
    page,
    targetDeviceId,
    expectedPages: directPages.pages,
    hmacKey,
  })
  for (const uiPage of uiPages.geoJsonPages) {
    exactGeoJsonFixes.push(...uiPage)
  }
  const geoJsonMs = Date.now() - geoJsonStartedAt
  for (const renderedPage of uiPages.renderedPages) {
    renderedMapFixes.push(...renderedPage)
  }
  const renderedMapMs = uiPages.renderedMapMs

  await page.getByTestId('workspace-close-btn').click({ force: true }).catch(() => undefined)
  await page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  await hidePrivateScreenshotTextAndDeviceLayers(page, targetDeviceName)
  await fitExactSourceToViewport(page)
  await page.screenshot({ path: privateDotsScreenshotPath, fullPage: true })
  await chmod(privateDotsScreenshotPath, 0o600)
  screenshotWritten = true
  const screenshotSha256 = await sha256File(privateDotsScreenshotPath)

  await browser.close()
  browser = null
  await stopOwnedProcess(appProcess)
  appProcess = null

  const sqliteStartedAt = Date.now()
  const sqliteRead = readExactSQLiteRows({
    databasePath: path.join(userDataDir, 'mission-store.sqlite'),
    missionId: mission.id,
    missionStart: mission.start_time,
    targetDeviceId,
  })
  sqliteFixes.push(...normalizeExactStoredRows(sqliteRead.rows, targetDeviceId))
  const sqliteReadMs = Date.now() - sqliteStartedAt

  const fixEvidence = assertExactFixEvidenceChain({
    provider: createExactFixEvidence(rawFixes, hmacKey),
    sqlite: createExactFixEvidence(sqliteFixes, hmacKey),
    exactPages: createExactFixEvidence(exactPageFixes, hmacKey),
    exactGeoJson: createExactFixEvidence(exactGeoJsonFixes, hmacKey),
  })
  const exactSourceIdentityTimeEvidence = createExactIdentityTimeEvidence(
    exactGeoJsonFixes,
    hmacKey,
  )
  const renderedIdentityTimeEvidence = createExactIdentityTimeEvidence(
    renderedMapFixes,
    hmacKey,
  )
  assertEvidenceMatches(
    renderedIdentityTimeEvidence,
    exactSourceIdentityTimeEvidence,
    'RENDERED_IDENTITY_TIME_MISMATCH',
  )
  const report = buildAllowlistedLiveExactReport({
    artifactSha256: expectedAppSha256,
    expectedVersion,
    fixEvidence,
    pageCount: directPages.audit.pageCount,
    maximumPageCount: directPages.audit.maximumPageCount,
    returnedToLatest: uiPages.returnedToLatest,
    baselineBreadcrumbPointCount: uiPages.baselineBreadcrumbPointCount,
    lookbackHours: LOOKBACK_HOURS,
    exactPageLimit: EXACT_PAGE_LIMIT,
    providerGetOnly: true,
    sqliteIntegrityOk: sqliteRead.integrityResult === 'ok',
    screenshotSha256,
    sourceFetchMs,
    sqliteReadMs,
    exactPageMs,
    geoJsonMs,
    renderedMapMs,
    renderedAudit: uiPages.renderedAudit,
    renderedIdentityTimeEvidence: {
      ...renderedIdentityTimeEvidence,
      matched: true,
    },
    renderedCoordinateDeviation: uiPages.renderedCoordinateDeviation,
  })
  sqliteRead.rows.splice(0, sqliteRead.rows.length)
  for (const entries of directPages.pages) entries.splice(0, entries.length)
  for (const entries of uiPages.geoJsonPages) entries.splice(0, entries.length)
  for (const entries of uiPages.renderedPages) entries.splice(0, entries.length)
  rawFixes.splice(0, rawFixes.length)
  sqliteFixes.splice(0, sqliteFixes.length)
  exactPageFixes.splice(0, exactPageFixes.length)
  exactGeoJsonFixes.splice(0, exactGeoJsonFixes.length)
  renderedMapFixes.splice(0, renderedMapFixes.length)
  hmacKey.fill(0)
  await rm(userDataRoot, { recursive: true, force: true })
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(summaryPath, 0o600)
  reportWritten = true
  process.stdout.write('real Traccar exact breadcrumb gate: PASS\n')
} catch (error) {
  process.stderr.write(
    `real Traccar exact breadcrumb gate: FAIL ${classifyFailure(error)}\n`,
  )
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  if (appProcess !== null) {
    await stopOwnedProcess(appProcess).catch(() => undefined)
  }
  if (screenshotWritten && !reportWritten) {
    await rm(privateDotsScreenshotPath, { force: true })
  }
  if (!reportWritten) {
    await rm(summaryPath, { force: true })
  }
  await rm(userDataRoot, { recursive: true, force: true })
  providerPayload = null
  rawFixes.splice(0, rawFixes.length)
  sqliteFixes.splice(0, sqliteFixes.length)
  exactPageFixes.splice(0, exactPageFixes.length)
  exactGeoJsonFixes.splice(0, exactGeoJsonFixes.length)
  renderedMapFixes.splice(0, renderedMapFixes.length)
  hmacKey.fill(0)
}

/** Reads one mandatory non-secret path or artifact expectation. */
function requiredEnvironment(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('REQUIRED_INPUT_MISSING')
  }
  return value
}

/** Reads a bounded positive timeout without accepting operational identity. */
function optionalPositiveIntegerEnvironment(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return fallback
  return validatePositiveInteger(Number(value), 'TIMEOUT_INVALID')
}

/** Verifies the selector file metadata before reading its sensitive contents. */
async function readPrivateTargetSelector(filePath) {
  const metadata = await lstat(filePath)
  const expectedUid = process.getuid?.()
  assert(Number.isSafeInteger(expectedUid), 'TARGET_SELECTOR_OWNER_UNAVAILABLE')
  return parsePrivateTargetSelector(await readFile(filePath, 'utf8'), {
    mode: metadata.mode,
    uid: metadata.uid,
    expectedUid,
    isFile: metadata.isFile(),
    isSymbolicLink: metadata.isSymbolicLink(),
  })
}

/** Prevents the private map screenshot from entering archiveable evidence. */
async function verifyOutputIsolation(archiveDirectory, visualDirectory) {
  const archive = path.resolve(archiveDirectory)
  const visual = path.resolve(visualDirectory)
  const projectDirectory = path.resolve(process.cwd())
  const privateConfigDirectory = path.resolve(configSource)
  const privateSelector = path.resolve(targetSelectorFile)
  assert(
    archive !== visual && !visual.startsWith(`${archive}${path.sep}`),
    'PRIVATE_VISUAL_DIRECTORY_NOT_ISOLATED',
  )
  assert(
    visual !== projectDirectory && !visual.startsWith(`${projectDirectory}${path.sep}`),
    'PRIVATE_VISUAL_DIRECTORY_INSIDE_PROJECT',
  )
  assert(
    archive !== privateConfigDirectory &&
      !archive.startsWith(`${privateConfigDirectory}${path.sep}`) &&
      archive !== privateSelector,
    'ARCHIVE_OVERLAPS_PRIVATE_INPUT',
  )
  const app = await realpath(appPath)
  assert(app !== archive && app !== visual, 'OUTPUT_OVERLAPS_ARTIFACT')
}

/** Copies only the two required private config files into the disposable profile. */
async function copyPrivateConfiguration(sourceDirectory, destinationDirectory) {
  await copyFile(
    path.join(sourceDirectory, 'settings.json'),
    path.join(destinationDirectory, 'settings.json'),
  )
  await copyFile(
    path.join(sourceDirectory, 'credentials.json'),
    path.join(destinationDirectory, 'credentials.json'),
  )
}

/** Validates the in-memory decrypted runtime config without returning evidence. */
function validateRuntimeTrackingConfig(runtime) {
  const config = runtime?.trackingConfig
  if (typeof config !== 'object' || config === null) {
    throw new Error('TRACKING_CONFIG_UNAVAILABLE')
  }
  const providerUrl = new URL(config.baseUrl)
  if (
    providerUrl.protocol !== 'https:' ||
    providerUrl.hostname !== 'kmrtsar.eu' ||
    providerUrl.username !== '' ||
    providerUrl.password !== ''
  ) {
    throw new Error('TRACKING_PROVIDER_INVALID')
  }
  const hasBasic =
    typeof config.email === 'string' &&
    config.email !== '' &&
    typeof config.password === 'string' &&
    config.password !== ''
  const hasToken = typeof config.token === 'string' && config.token !== ''
  if (hasBasic === hasToken) {
    throw new Error('TRACKING_AUTH_INVALID')
  }
  return config
}

/** Waits for the newly-created active mission through the packaged bridge. */
async function waitForActiveMission(page, timeoutMs) {
  await page.waitForFunction(
    async () => (await window.sartrackerElectron?.missionStore.getActiveMission()) !== null,
    undefined,
    { timeout: timeoutMs },
  )
  return page.evaluate(async () => window.sartrackerElectron.missionStore.getActiveMission())
}

/** Reads the private target name only to prove it is absent from the screenshot. */
async function readPrivateTargetDeviceName(page, missionId, targetDeviceId) {
  const name = await page.evaluate(async ({ selectedMissionId, selectedDeviceId }) => {
    const devices = await window.sartrackerElectron.missionStore.listDevices(selectedMissionId)
    return devices.find((device) => device.device_id === selectedDeviceId)?.name ?? null
  }, { selectedMissionId: missionId, selectedDeviceId: targetDeviceId })
  assert(typeof name === 'string' && name.trim() !== '', 'TARGET_DEVICE_NAME_UNAVAILABLE')
  return name
}

/** Proves the UI actually created a 48-hour backdated mission. */
function assertLookback(startTime, missionCreationFloorMs) {
  const actualHours = (missionCreationFloorMs - Date.parse(startTime)) / 3_600_000
  assert(actualHours >= 47.99 && actualHours <= 48.01, 'MISSION_LOOKBACK_INVALID')
}

/** Waits until the target's durable history checkpoint covers mission creation. */
async function waitForTargetReconciliation(input) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    const state = await input.page.evaluate(async ({ missionId, targetDeviceId, missionStart }) => {
      const store = window.sartrackerElectron?.missionStore
      const checkpoints = await store.listTrackingHistoryCheckpoints(missionId)
      const checkpoint = checkpoints.find((entry) => entry.device_id === targetDeviceId)
      const positions = await store.listPositions(missionId, targetDeviceId)
      const count = positions.reduce(
        (total, position) => total + (position.timestamp < missionStart ? 0 : 1),
        0,
      )
      positions.splice?.(0, positions.length)
      return {
        checkpoint: checkpoint ?? null,
        count,
      }
    }, {
      missionId: input.missionId,
      targetDeviceId: input.targetDeviceId,
      missionStart: input.missionStart,
    })
    if (
      state.count > 0 &&
      state.checkpoint?.history_from === input.missionStart &&
      Date.parse(state.checkpoint.reconciled_until) >= input.requiredUntilMs
    ) {
      return
    }
    await input.page.waitForTimeout(500)
  }
  throw new Error('TARGET_RECONCILIATION_TIMEOUT')
}

/** Requires the paused target position set to remain unchanged for two poll intervals. */
async function waitForPausedTargetStability(input) {
  const first = await readTargetPositionWindow(input)
  await input.page.waitForTimeout(Math.max(2_000, input.pollIntervalMs * 2))
  const second = await readTargetPositionWindow(input)
  assert(
    first.positionCount === second.positionCount &&
      first.maximumTimestamp === second.maximumTimestamp,
    'PAUSED_TARGET_NOT_STABLE',
  )
  assert(second.positionCount > 0 && second.maximumTimestamp !== null, 'TARGET_HISTORY_EMPTY')
  return second
}

/** Reads only count and maximum timestamp from the packaged bridge. */
async function readTargetPositionWindow(input) {
  return input.page.evaluate(async ({ missionId, targetDeviceId, missionStart }) => {
    const positions = await window.sartrackerElectron.missionStore.listPositions(
      missionId,
      targetDeviceId,
    )
    let maximumTimestamp = null
    let positionCount = 0
    for (const position of positions) {
      if (position.timestamp < missionStart) continue
      positionCount += 1
      if (maximumTimestamp === null || position.timestamp > maximumTimestamp) {
        maximumTimestamp = position.timestamp
      }
    }
    positions.splice?.(0, positions.length)
    return { positionCount, maximumTimestamp }
  }, {
    missionId: input.missionId,
    targetDeviceId: input.targetDeviceId,
    missionStart: input.missionStart,
  })
}

/** Fetches immutable source truth without using any provider mutation method. */
async function fetchProviderPositionsGetOnly(input) {
  const url = new URL('/api/positions', input.trackingConfig.baseUrl)
  url.searchParams.set('deviceId', input.targetDeviceId)
  url.searchParams.set('from', input.from)
  url.searchParams.set('to', input.to)
  const authorization = input.trackingConfig.token
    ? `Bearer ${input.trackingConfig.token}`
    : `Basic ${Buffer.from(
        `${input.trackingConfig.email}:${input.trackingConfig.password}`,
        'utf8',
      ).toString('base64')}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: authorization },
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  assert(response.ok, 'PROVIDER_GET_FAILED')
  let responseBytes = new Uint8Array(await response.arrayBuffer())
  try {
    assert(responseBytes.byteLength <= 64 * 1024 * 1024, 'PROVIDER_RESPONSE_TOO_LARGE')
    return JSON.parse(new TextDecoder().decode(responseBytes))
  } finally {
    responseBytes.fill(0)
    responseBytes = new Uint8Array()
  }
}

/** Traverses every production exact-page cursor and returns to latest. */
async function readAllExactPages(input) {
  const pages = []
  const traversalPages = []
  const cursors = new Set()
  let direction = 'latest'
  let cursor = null
  let totalPositionCount = null
  let oldestPage = null
  let requestSequence = 0
  while (true) {
    const result = await input.page.evaluate(
      async ({ query, requestId }) =>
        window.sartrackerElectron.missionStore.listExactBreadcrumbDotPage(query, requestId),
      {
        query: {
          missionId: input.missionId,
          activeDeviceIds: [input.targetDeviceId],
          limit: EXACT_PAGE_LIMIT,
          cursor,
          direction,
        },
        requestId: `live-exact-${randomBytes(16).toString('hex')}-${++requestSequence}`,
      },
    )
    assert(result.positions.length === result.pagePositionCount, 'EXACT_PAGE_COUNT_INVALID')
    assert(result.positions.length <= EXACT_PAGE_LIMIT, 'EXACT_PAGE_LIMIT_EXCEEDED')
    totalPositionCount ??= result.totalPositionCount
    assert(totalPositionCount === result.totalPositionCount, 'EXACT_PAGE_TOTAL_CHANGED')
    const normalized = assertExactFixSequence(
      normalizeExactStoredRows(result.positions, input.targetDeviceId),
      'Production exact page',
    )
    pages.push(normalized)
    traversalPages.push({
      positions: normalized,
      totalPositionCount: result.totalPositionCount,
      hasEarlier: result.hasEarlier,
      hasLater: result.hasLater,
      earlierCursor: result.earlierCursor,
      laterCursor: result.laterCursor,
    })
    oldestPage = result
    if (!result.hasEarlier) break
    assert(
      typeof result.earlierCursor === 'string' && !cursors.has(result.earlierCursor),
      'EXACT_PAGE_CURSOR_INVALID',
    )
    cursors.add(result.earlierCursor)
    cursor = result.earlierCursor
    direction = 'earlier'
  }
  while (oldestPage?.hasLater) {
    assert(typeof oldestPage.laterCursor === 'string', 'EXACT_LATER_CURSOR_MISSING')
    oldestPage = await input.page.evaluate(
      async ({ query, requestId }) =>
        window.sartrackerElectron.missionStore.listExactBreadcrumbDotPage(query, requestId),
      {
        query: {
          missionId: input.missionId,
          activeDeviceIds: [input.targetDeviceId],
          limit: EXACT_PAGE_LIMIT,
          cursor: oldestPage.laterCursor,
          direction: 'later',
        },
        requestId: `live-exact-return-${randomBytes(16).toString('hex')}-${++requestSequence}`,
      },
    )
  }
  assert(oldestPage?.hasLater === false, 'EXACT_PAGE_RETURN_TO_LATEST_FAILED')
  const audit = validateExactPageTraversal(
    traversalPages,
    totalPositionCount,
    EXACT_PAGE_LIMIT,
  )
  return { pages, totalPositionCount, returnedToLatest: true, audit }
}

/** Traverses the operator UI and reconciles exact source plus rendered layer per page. */
async function captureAllUiExactPages(input) {
  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await input.page.getByTestId('breadcrumb-mode-dots').click({ force: true })
  const geoJsonPages = []
  const renderedPages = []
  const renderedAudit = createEmptyRenderedAuditDiagnostics()
  let baselineBreadcrumbPointCount = 0
  let renderedMapMs = 0
  const totalPositionCount = input.expectedPages.reduce(
    (total, entries) => total + entries.length,
    0,
  )
  for (let pageIndex = 0; pageIndex < input.expectedPages.length; pageIndex += 1) {
    const expected = createExactFixEvidence(input.expectedPages[pageIndex], input.hmacKey)
    const observed = await waitForExactSourcePage({
      page: input.page,
      targetDeviceId: input.targetDeviceId,
      expected,
      hmacKey: input.hmacKey,
    })
    await assertOperatorPageSummary(
      input.page,
      input.expectedPages[pageIndex],
      totalPositionCount,
    )
    geoJsonPages.push(observed.fixes)
    baselineBreadcrumbPointCount += observed.baselineBreadcrumbPointCount
    const renderedStartedAt = Date.now()
    await fitExactSourceToViewport(input.page)
    const renderedFeatures = await readRenderedExactFeatures(input.page)
    renderedMapMs += Date.now() - renderedStartedAt
    const renderedPageAudit = auditRenderedExactGeoJsonFeatures(
      renderedFeatures,
      input.targetDeviceId,
    )
    mergeRenderedAuditDiagnostics(renderedAudit, renderedPageAudit.diagnostics)
    const rendered = renderedPageAudit.fixes
    assertEvidenceMatches(
      createExactIdentityTimeEvidence(rendered, input.hmacKey),
      createExactIdentityTimeEvidence(input.expectedPages[pageIndex], input.hmacKey),
      'RENDERED_PAGE_IDENTITY_TIME_MISMATCH',
    )
    auditRenderedCoordinateDeviation(input.expectedPages[pageIndex], rendered)
    renderedPages.push(rendered)
    if (pageIndex + 1 < input.expectedPages.length) {
      await input.page.getByTestId('exact-breadcrumb-dots-earlier').click({ force: true })
    }
  }
  for (let pageIndex = input.expectedPages.length - 2; pageIndex >= 0; pageIndex -= 1) {
    await input.page.getByTestId('exact-breadcrumb-dots-later').click({ force: true })
    await waitForExactSourcePage({
      page: input.page,
      targetDeviceId: input.targetDeviceId,
      expected: createExactFixEvidence(input.expectedPages[pageIndex], input.hmacKey),
      hmacKey: input.hmacKey,
    })
    await assertOperatorPageSummary(
      input.page,
      input.expectedPages[pageIndex],
      totalPositionCount,
    )
  }
  const returnedToLatest = await input.page
    .getByTestId('exact-breadcrumb-dots-later')
    .isDisabled()
  const renderedCoordinateDeviation = auditRenderedCoordinateDeviation(
    input.expectedPages.flat(),
    renderedPages.flat(),
  )
  return {
    geoJsonPages,
    renderedPages,
    renderedMapMs,
    renderedAudit,
    renderedCoordinateDeviation,
    baselineBreadcrumbPointCount,
    returnedToLatest,
  }
}

/** Creates one allowlisted accumulator for MapLibre rendered-feature diagnostics. */
function createEmptyRenderedAuditDiagnostics() {
  return {
    renderedFeatureCount: 0,
    uniqueFixCount: 0,
    duplicateTileCopyCount: 0,
    missingFeatureIdCount: 0,
    numericFeatureIdCount: 0,
    stringFeatureIdCount: 0,
    otherFeatureIdCount: 0,
    mismatchedStringFeatureIdCount: 0,
    conflictingDuplicateCount: 0,
  }
}

/** Merges only the fixed, non-sensitive MapLibre audit counters. */
function mergeRenderedAuditDiagnostics(target, pageAudit) {
  for (const key of Object.keys(target)) {
    target[key] += pageAudit[key]
  }
}

/** Waits for a stable exact source page with no representative points in baseline. */
async function waitForExactSourcePage(input) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const snapshot = await readExactAndBaselineSources(input.page)
    try {
      const fixes = assertExactFixSequence(
        normalizeExactGeoJsonFeatures(snapshot.exact, input.targetDeviceId),
        'Exact GeoJSON page',
      )
      const evidence = createExactFixEvidence(fixes, input.hmacKey)
      if (
        evidence.count === input.expected.count &&
        evidence.hmacSha256 === input.expected.hmacSha256
      ) {
        await input.page.waitForTimeout(100)
        const stable = await readExactAndBaselineSources(input.page)
        const stableFixes = assertExactFixSequence(
          normalizeExactGeoJsonFeatures(stable.exact, input.targetDeviceId),
          'Stable exact GeoJSON page',
        )
        assertEvidenceMatches(
          createExactFixEvidence(stableFixes, input.hmacKey),
          input.expected,
          'EXACT_GEOJSON_PAGE_UNSTABLE',
        )
        return {
          fixes: stableFixes,
          baselineBreadcrumbPointCount: countBaselineBreadcrumbPoints(stable.baseline),
        }
      }
    } catch {
      // The page may legitimately be empty while its worker is still loading.
    }
    await input.page.waitForTimeout(100)
  }
  throw new Error('EXACT_GEOJSON_PAGE_TIMEOUT')
}

/** Proves the operator-visible page count and exact time range match the page. */
async function assertOperatorPageSummary(page, expectedRows, totalPositionCount) {
  const first = expectedRows[0]
  const last = expectedRows.at(-1)
  assert(first !== undefined && last !== undefined, 'OPERATOR_PAGE_EMPTY')
  const expected =
    `Showing ${expectedRows.length.toLocaleString('en-US')} exact fixes of ` +
    `${totalPositionCount.toLocaleString('en-US')} — ${first.timestamp} to ${last.timestamp}`
  const actual = (
    await page.getByTestId('exact-breadcrumb-dot-page-summary').textContent()
  )?.trim()
  assert(actual === expected, 'OPERATOR_PAGE_SUMMARY_MISMATCH')
}

/** Reads only public MapLibre source data from the packaged renderer. */
async function readExactAndBaselineSources(page) {
  return page.evaluate(async () => {
    const exactSource = window.__SARTRACKER_MAP__?.getSource('tracking-breadcrumb-dots-exact')
    const baselineSource = window.__SARTRACKER_MAP__?.getSource('tracking')
    if (exactSource === undefined || baselineSource === undefined) {
      throw new Error('MAP_SOURCE_UNAVAILABLE')
    }
    return {
      exact: typeof exactSource.getData === 'function'
        ? await exactSource.getData()
        : exactSource.serialize()?.data,
      baseline: typeof baselineSource.getData === 'function'
        ? await baselineSource.getData()
        : baselineSource.serialize()?.data,
    }
  })
}

/** Counts forbidden representative dot features in the bounded line source. */
function countBaselineBreadcrumbPoints(collection) {
  return (collection?.features ?? []).filter(
    (feature) =>
      feature?.geometry?.type === 'Point' &&
      feature?.properties?.featureKind === 'breadcrumb',
  ).length
}

/** Fits the complete active exact page into the canvas with safe padding. */
async function fitExactSourceToViewport(page) {
  await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    const source = map?.getSource('tracking-breadcrumb-dots-exact')
    const collection = typeof source?.getData === 'function'
      ? await source.getData()
      : source?.serialize()?.data
    const coordinates = (collection?.features ?? [])
      .map((feature) => feature?.geometry?.coordinates)
      .filter((coordinate) =>
        Array.isArray(coordinate) &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
      )
    if (map === undefined || coordinates.length === 0) {
      throw new Error('EXACT_SOURCE_EMPTY')
    }
    const west = Math.min(...coordinates.map((coordinate) => coordinate[0]))
    const east = Math.max(...coordinates.map((coordinate) => coordinate[0]))
    const south = Math.min(...coordinates.map((coordinate) => coordinate[1]))
    const north = Math.max(...coordinates.map((coordinate) => coordinate[1]))
    if (west === east && south === north) {
      map.jumpTo({ center: [west, south], zoom: 14 })
    } else {
      map.fitBounds([[west, south], [east, north]], { padding: 80, duration: 0 })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  })
}

/** Reads the actual rendered circle layer, not merely its source input. */
async function readRenderedExactFeatures(page) {
  return page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) throw new Error('MAP_UNAVAILABLE')
    const exactSource = map.getSource('tracking-breadcrumb-dots-exact')
    const exactCollection = typeof exactSource?.getData === 'function'
      ? await exactSource.getData()
      : exactSource?.serialize()?.data
    const exactCoordinatesByIdentity = new Map(
      (exactCollection?.features ?? []).map((feature) => [
        `${feature?.properties?.deviceId}\u0000${feature?.properties?.sourcePositionId}`,
        feature?.geometry?.coordinates,
      ]),
    )
    return map
      .queryRenderedFeatures(undefined, { layers: ['tracking-breadcrumbs-dots'] })
      .map((feature) => {
        const renderedCoordinates = feature.geometry?.coordinates
        const sourceCoordinates = exactCoordinatesByIdentity.get(
          `${feature.properties?.deviceId}\u0000${feature.properties?.sourcePositionId}`,
        )
        let screenDisplacementX = null
        let screenDisplacementY = null
        if (
          Array.isArray(renderedCoordinates) &&
          Array.isArray(sourceCoordinates) &&
          Number.isFinite(renderedCoordinates[0]) &&
          Number.isFinite(renderedCoordinates[1]) &&
          Number.isFinite(sourceCoordinates[0]) &&
          Number.isFinite(sourceCoordinates[1])
        ) {
          const renderedPoint = map.project(renderedCoordinates)
          const sourcePoint = map.project(sourceCoordinates)
          screenDisplacementX = Math.abs(renderedPoint.x - sourcePoint.x)
          screenDisplacementY = Math.abs(renderedPoint.y - sourcePoint.y)
        }
        return {
          type: 'Feature',
          id: feature.id,
          geometry: feature.geometry,
          properties: feature.properties,
          screenDisplacementX,
          screenDisplacementY,
        }
      })
  })
}

/** Removes sensitive device labels and raw coordinate text from private visual support. */
async function hidePrivateScreenshotTextAndDeviceLayers(page, targetDeviceName) {
  await page.getByTestId('coordinate-readout-group').evaluate((element) => {
    element.style.visibility = 'hidden'
  })
  const renderedPrivateLabelCount = await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    for (const layerId of [
      'tracking-devices-halo',
      'tracking-devices-circle',
      'tracking-devices-label',
    ]) {
      if (map?.getLayer(layerId) !== undefined) {
        map.setLayoutProperty(layerId, 'visibility', 'none')
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    return map?.getLayer('tracking-devices-label') === undefined
      ? 0
      : map.queryRenderedFeatures(undefined, { layers: ['tracking-devices-label'] }).length
  })
  assert(renderedPrivateLabelCount === 0, 'PRIVATE_SCREENSHOT_MAP_LABEL_VISIBLE')
  const visiblePrivateNameCount = await page.evaluate((privateName) =>
    [...document.querySelectorAll('body *')].filter((element) => {
      const style = window.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return (
        element.children.length === 0 &&
        element.textContent?.includes(privateName) === true &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        box.width > 0 &&
        box.height > 0
      )
    }).length,
  targetDeviceName)
  assert(visiblePrivateNameCount === 0, 'PRIVATE_SCREENSHOT_DEVICE_NAME_VISIBLE')
  await page.mouse.move(1, 1)
}

/** Reads the target rows only after the paused packaged process is closed. */
function readExactSQLiteRows(input) {
  const database = new Database(input.databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    const integrityResult = database.pragma('integrity_check', { simple: true })
    const rows = database.prepare(
      `SELECT source_position_id, device_id, lat, lon, timestamp
       FROM positions
       WHERE mission_id = ? AND device_id = ? AND timestamp >= ?`,
    ).all(input.missionId, input.targetDeviceId, input.missionStart)
    return { rows, integrityResult }
  } finally {
    database.close()
  }
}

/** Compares one page without exposing its digest or source records in errors. */
function assertEvidenceMatches(actual, expected, reasonCode) {
  assert(
    actual.count === expected.count && actual.hmacSha256 === expected.hmacSha256,
    reasonCode,
  )
}

/** Verifies the executable bytes match the exact qualified artifact. */
async function assertFileSha256(filePath, expectedSha256) {
  assert(await sha256File(filePath) === expectedSha256, 'ARTIFACT_SHA_MISMATCH')
}

/** Returns one file SHA-256 without reading operational evidence. */
async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

/** Throws a fixed reason code only. */
function assert(condition, reasonCode) {
  if (!condition) throw new Error(reasonCode)
}

/** Validates a positive safe integer. */
function validatePositiveInteger(value, reasonCode) {
  assert(Number.isSafeInteger(value) && value > 0, reasonCode)
  return value
}

/** Maps every failure to a fixed code so raw provider data never reaches logs. */
function classifyFailure(error) {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(message) ? message : 'UNCLASSIFIED_FAILURE'
}

/** Allocates one isolated CDP port. */
async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  assert(typeof address === 'object' && address !== null, 'CDP_PORT_UNAVAILABLE')
  return address.port
}

/** Waits for the owned packaged process or fails closed if it exits. */
async function waitForCdp(port, ownedProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    assert(
      ownedProcess.exitCode === null && ownedProcess.signalCode === null,
      'APP_EXITED_BEFORE_CDP',
    )
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error('CDP_TIMEOUT')
}

/** Stops only the packaged process this gate owns. */
async function stopOwnedProcess(ownedProcess) {
  const hasExited = () => ownedProcess.exitCode !== null || ownedProcess.signalCode !== null
  if (hasExited()) return

  ownedProcess.kill('SIGTERM')
  const terminatedAfterTerm = await new Promise((resolve) => {
    if (hasExited()) {
      resolve(true)
      return
    }

    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    const timeout = setTimeout(() => {
      ownedProcess.removeListener('exit', onExit)
      resolve(hasExited())
    }, 2_000)
    ownedProcess.once('exit', onExit)
  })
  if (terminatedAfterTerm || hasExited()) return

  ownedProcess.kill('SIGKILL')
  await new Promise((resolve, reject) => {
    if (hasExited()) {
      resolve()
      return
    }

    const onExit = () => {
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      ownedProcess.removeListener('exit', onExit)
      reject(new Error('OWNED_PROCESS_KILL_TIMEOUT'))
    }, 10_000)
    ownedProcess.once('exit', onExit)
  })
}
