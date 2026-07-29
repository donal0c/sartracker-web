import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { chromium } from 'playwright'

import { hasBreadcrumbReconciliationWarning } from '../../build/release-smoke-lib.js'

const appPath = requiredEnvironment('SMOKE_APP')
const evidenceDir = requiredEnvironment('SMOKE_EVIDENCE')
const configSource = requiredEnvironment('SMOKE_CONFIG_SOURCE')
const expectedVersion = requiredEnvironment('SMOKE_EXPECTED_VERSION')
const expectedAppSha256 = requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')
await assertFileSha256(appPath, expectedAppSha256)
await mkdir(evidenceDir, { recursive: true })
const settingsSourcePath = path.join(configSource, 'settings.json')
const credentialsSourcePath = path.join(configSource, 'credentials.json')
const configSensitiveValues = await loadSensitiveEvidenceValues([
  settingsSourcePath,
  credentialsSourcePath,
  configSource,
])
const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-traccar-'))
const userDataDir = path.join(userDataRoot, 'profile')
const sensitiveEvidenceValues = [...configSensitiveValues, userDataRoot]

let browser
let appProcess
let summary
try {
  await mkdir(userDataDir, { recursive: true })
  await copyFile(settingsSourcePath, path.join(userDataDir, 'settings.json'))
  await copyFile(credentialsSourcePath, path.join(userDataDir, 'credentials.json'))

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
  assert(mastText?.includes(expectedVersion), `Packaged mast did not show ${expectedVersion}.`)

  await page.getByTestId('mission-name-input').fill('Breadcrumb Release Live Traccar Gate')
  await page.getByTestId('mission-start-btn').click()
  await page.getByTestId('mission-control').filter({ hasText: 'active' }).waitFor()
  await page.getByTestId('open-settings-workspace').click()
  const providerUrl = await page.getByTestId('settings-provider-url').inputValue()
  assert(/kmrtsar\.eu/u.test(providerUrl), 'The expected live Traccar provider is not configured.')

  await page.getByTestId('settings-test-connection').click()
  await page
    .getByTestId('settings-feedback')
    .filter({ hasText: /Connection successful/u })
    .waitFor({ timeout: 30_000 })
  await page.getByTestId('settings-save-connect').click()
  await page
    .getByTestId('tracking-status')
    .filter({ hasText: /online/u })
    .waitFor({ timeout: 45_000 })

  await page.waitForTimeout(12_000)
  await waitForReconciliation(page)
  const evidence = await page.evaluate(async () => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) {
      throw new Error('Electron mission-store bridge is unavailable.')
    }
    const mission = await store.getActiveMission()
    if (mission === null) {
      throw new Error('Live Traccar gate has no active mission.')
    }
    const devices = await store.listDevices(mission.id)
    const positions = await store.listPositions(mission.id)
    return {
      missionId: mission.id,
      deviceCount: devices.length,
      positionCount: positions.length,
    }
  })
  assert(evidence.deviceCount > 0, 'Live Traccar returned no devices.')
  assert(evidence.positionCount > 0, 'Live Traccar persisted no positions.')
  const trackingText = (
    (await page.getByTestId('tracking-status').textContent()) ?? ''
  ).slice(0, 1_000)
  assert(
    !hasBreadcrumbReconciliationWarning(trackingText),
    'Live Traccar breadcrumb history did not finish reconciliation.',
  )
  await page.getByTestId('tracking-status').screenshot({
    path: path.join(evidenceDir, 'live-traccar.png'),
  })
  summary = {
    result: 'pass',
    expectedVersion,
    providerMatched: true,
    connectionTestPassed: true,
    trackingOnline: true,
    ...evidence,
    appSha256: expectedAppSha256,
    reconciliationComplete: true,
    reconciliationWarningVisible: false,
  }
} finally {
  await browser?.close().catch(() => undefined)
  appProcess?.kill('SIGTERM')
  if (appProcess !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    appProcess.kill('SIGKILL')
  }
  await rm(userDataRoot, { recursive: true, force: true })
  await assertEvidenceIsSanitized(evidenceDir, sensitiveEvidenceValues)
}

await writeFile(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
)
await assertEvidenceIsSanitized(evidenceDir, sensitiveEvidenceValues)

/**
 * Reads one mandatory smoke environment variable.
 */
function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`)
  }
  return value
}

/**
 * Throws a clear gate error when an invariant is false.
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Verifies that the executable under smoke is exactly the expected artifact.
 */
async function assertFileSha256(filePath, expectedSha256) {
  const actual = createHash('sha256').update(await readFile(filePath)).digest('hex')
  assert(
    actual === expectedSha256.toLowerCase(),
    `Smoke executable SHA-256 is ${actual}; expected ${expectedSha256}.`,
  )
}

/**
 * Collects private configuration strings and local paths that must never
 * appear in archiveable smoke evidence.
 */
async function loadSensitiveEvidenceValues(sources) {
  const values = new Set()
  for (const source of sources) {
    values.add(String(source))
    if (!String(source).endsWith('.json')) {
      continue
    }
    const raw = await readFile(source, 'utf8')
    values.add(raw)
    try {
      collectStringValues(JSON.parse(raw), values)
    } catch {
      throw new Error(`Live Traccar configuration is not valid JSON: ${path.basename(source)}.`)
    }
  }
  return [...values].filter((value) => value.length >= 8)
}

/**
 * Recursively collects string leaves from private configuration JSON.
 */
function collectStringValues(value, output) {
  if (typeof value === 'string') {
    output.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, output)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, output)
    }
  }
}

/**
 * Fails the smoke if archiveable evidence contains a profile/config file or
 * any literal private configuration value.
 */
async function assertEvidenceIsSanitized(directory, sensitiveValues) {
  const forbiddenNames = /^(?:credentials\.json|settings\.json|mission-store(?:\..*)?|user-data)$/iu
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (forbiddenNames.test(entry.name)) {
        throw new Error(`Sensitive live-smoke evidence path was created: ${entry.name}.`)
      }
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!/\.(?:json|log|md|txt)$/iu.test(entry.name)) {
        continue
      }
      const text = await readFile(entryPath, 'utf8')
      for (const value of sensitiveValues) {
        if (text.includes(value)) {
          throw new Error(`Sensitive live-smoke configuration leaked into ${entry.name}.`)
        }
      }
    }
  }
}

/**
 * Waits for mission history reconciliation to finish instead of accepting an
 * online current-position view with incomplete breadcrumb history.
 */
async function waitForReconciliation(page) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const text = ((await page.getByTestId('tracking-status').textContent()) ?? '').slice(0, 1_000)
    if (!hasBreadcrumbReconciliationWarning(text)) {
      return
    }
    await page.waitForTimeout(1_000)
  }
  throw new Error('Timed out waiting for live breadcrumb history reconciliation.')
}

/**
 * Allocates an isolated local CDP port.
 */
async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address !== 'object' || address === null) {
    throw new Error('Could not allocate a CDP port.')
  }
  return address.port
}

/**
 * Waits for Electron's DevTools endpoint or fails if the process exits.
 */
async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electron exited before CDP became available: ${appProcess.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for Electron CDP on port ${port}.`)
}
