#!/usr/bin/env node

// Disposable packaged C16 settings/bootstrap probe.
//
// This producer intentionally uses a synthetic provider URL and fixture-only
// secrets. It exercises the settings bridge and restart lifecycle without
// contacting a real provider. The receipt stores hashes and bounded state
// projections; fixture secret values never enter the receipt or log artifact.

import { _electron as electron } from 'playwright'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { closeOwnedSmokeChild } from '../../build/electron-repair-train-d-smoke-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SYNTHETIC_BASE_URL = 'https://synthetic.invalid.example'
const SYNTHETIC_EMAIL = 'synthetic-operator'
const LEGACY_BAD_SECRET = 'C16_LEGACY_UNDECRYPTABLE_FIXTURE_DO_NOT_EXPORT'
const SECRET_A = 'C16_SYNTHETIC_CANARY_A_DO_NOT_EXPORT'
const SECRET_B = 'C16_SYNTHETIC_CANARY_B_DO_NOT_EXPORT'
const WARNING_TEXT =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
const URL_CREDENTIALS_ERROR =
  'Provider URL must not include embedded credentials. Enter credentials in the authentication fields.'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(redactKnownSecrets(error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  })
}

/** Execute the bounded packaged C16 probe and retain a receipt on every exit path. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const failures = []
  const report = createReport(options)
  let session = null

  try {
    await mkdir(evidenceDir, { recursive: true })
    await rm(userDataDir, { recursive: true, force: true })
    await mkdir(userDataDir, { recursive: true })
    await seedSyntheticBadSecretProfile(userDataDir)

    const source = readSourceIdentity(options.expectedHead)
    report.source = source
    if (source.head !== options.expectedHead) {
      throw new Error('The packaged settings probe expected-head does not match the checked-out source head.')
    }

    session = await launchPackagedApp(options.appPath, options.extraArgs, userDataDir)
    report.buildIdentity = await buildIdentity(session.runtime, options.appPath)
    report.process = { tier: 'packaged-electron-disposable-settings' }

    await session.page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 45_000 })
    if (await session.page.getByText('Runtime startup failed').isVisible().catch(() => false)) {
      throw new Error('Packaged settings probe reached the runtime fault shell.')
    }
    const warning = session.page.getByTestId('tracking-warning')
    await warning.waitFor({ state: 'attached', timeout: 15_000 })
    const warningText = (await warning.textContent())?.trim() ?? ''
    if (warningText !== WARNING_TEXT) {
      throw new Error('Packaged settings probe did not expose the expected undecryptable-secret recovery warning.')
    }
    await captureScreenshot(session.page, evidenceDir, '01-bad-secret-startup.png')

    await openSettings(session.page)
    const baseline = await captureSettingsSnapshot(session.page, userDataDir)
    report.startup = {
      shellReached: true,
      runtimeFaultVisible: false,
      trackingWarning: {
        exactText: warningText,
        actionable: true,
        actions: ['open-settings-workspace', 'settings-provider-secret'],
      },
      initialSettings: baseline.view,
    }
    report.workload = {
      profileId: 'synthetic-disposable-settings',
      providerType: 'traccar_http',
      baseUrlSha256: hashText(SYNTHETIC_BASE_URL),
      networkContactAttempted: false,
    }

    await fillSyntheticSettings(session.page, SECRET_A)
    await saveSettings(session.page)
    const afterSave = await captureSettingsSnapshot(session.page, userDataDir)
    await captureScreenshot(session.page, evidenceDir, '02-settings-saved.png')
    await closeSession(session)
    session = await launchPackagedApp(options.appPath, options.extraArgs, userDataDir)
    const afterSaveRestart = await captureSettingsSnapshotAfterStartup(session.page, userDataDir)
    report.sessions.saveRestartReadback = {
      before: baseline,
      afterSave,
      afterRestart: afterSaveRestart,
    }

    const clearBefore = afterSaveRestart
    await openSettings(session.page)
    await clearStoredSecret(session.page)
    await saveSettings(session.page)
    const afterClear = await captureSettingsSnapshot(session.page, userDataDir)
    await closeSession(session)
    session = await launchPackagedApp(options.appPath, options.extraArgs, userDataDir)
    const afterClearRestart = await captureSettingsSnapshotAfterStartup(session.page, userDataDir)
    report.sessions.clearSecretRestart = {
      before: clearBefore,
      afterSave: afterClear,
      afterRestart: afterClearRestart,
    }

    const reentryBefore = afterClearRestart
    await openSettings(session.page)
    await fillSyntheticSettings(session.page, SECRET_B)
    await saveSettings(session.page)
    const afterReentry = await captureSettingsSnapshot(session.page, userDataDir)
    await closeSession(session)
    session = await launchPackagedApp(options.appPath, options.extraArgs, userDataDir)
    const afterReentryRestart = await captureSettingsSnapshotAfterStartup(session.page, userDataDir)
    report.sessions.reentrySecretRestart = {
      before: reentryBefore,
      afterSave: afterReentry,
      afterRestart: afterReentryRestart,
    }

    await openSettings(session.page)
    const urlField = session.page.getByTestId('settings-provider-url')
    await urlField.fill('https://user:pass@synthetic.invalid.example')
    const urlMessage = session.page.getByText(URL_CREDENTIALS_ERROR, { exact: true })
    await urlMessage.waitFor({ state: 'visible', timeout: 5_000 })
    report.urlCredentials = {
      attempted: true,
      rejected: true,
      saveDisabled: await session.page.getByTestId('settings-save').isDisabled(),
      message: (await urlMessage.textContent())?.trim() ?? '',
    }
    await urlMessage.screenshot({ path: path.join(evidenceDir, '03-url-credentials-rejected.png') })
    await discardUnsavedSettings(session.page)
    report.evidence = [
      '01-bad-secret-startup.png',
      '02-settings-saved.png',
      '03-url-credentials-rejected.png',
    ]
    report.custody = {
      rawSecretValuesIncluded: false,
      secretCanaryAbsent: true,
      legacyCiphertextCanaryAbsent: true,
    }
  } catch (error) {
    failures.push(redactKnownSecrets(error instanceof Error ? error.message : String(error)))
  } finally {
    if (session !== null) {
      try {
        await closeSession(session)
      } catch (error) {
        failures.push(redactKnownSecrets(error instanceof Error ? error.message : String(error)))
      }
    }
    report.result = failures.length === 0 ? 'pass' : 'fail'
    report.failures = failures
    report.custody ??= {
      rawSecretValuesIncluded: false,
      secretCanaryAbsent: true,
      legacyCiphertextCanaryAbsent: true,
    }
    report.receiptIntegrity = {
      fixtureSecretValuesWritten: true,
      fixtureSecretValuesInReceipt: false,
      receiptSchema: 'sartracker-settings-probe-v1',
    }
    assertReceiptContainsNoFixtureSecret(report)
    await writeJson(path.join(evidenceDir, 'receipt.json'), report)
  }

  if (failures.length > 0) process.exitCode = 1
}

/** Create the bounded receipt envelope before any packaged process is started. */
export function createReport(options) {
  return {
    schemaVersion: 1,
    proofKind: 'sartracker-settings-probe-v1',
    contractId: 'C16',
    issue: 'DON-177',
    invocation: {
      appProvided: options.appPath !== '',
      expectedHead: options.expectedHead,
      syntheticProfile: true,
      evidencePath: 'receipt.json',
    },
    result: 'fail',
    failures: [],
    evidence: [],
    sessions: {},
  }
}

/** Seed only synthetic settings and an intentionally undecryptable legacy entry. */
async function seedSyntheticBadSecretProfile(userDataDir) {
  await writeJson(path.join(userDataDir, 'settings.json'), {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 30,
      primaryMissionRoot: '/synthetic/missions',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl: SYNTHETIC_BASE_URL,
      authMode: 'basic',
      email: SYNTHETIC_EMAIL,
      autoConnect: false,
      trackingCacheEnabled: true,
      replayEnabled: false,
      replayStart: '',
      replayDurationHours: 4,
    },
    officialMaps: {
      sourceType: 'none',
      sourcePath: '',
      status: 'not_configured',
      username: '',
      availableSources: [],
      serviceCount: 0,
      message: 'Official maps are not configured.',
      packages: [],
    },
    weather: { links: [] },
  })
  await writeJson(path.join(userDataDir, 'secrets.json'), {
    basic: { encrypted: Buffer.from(LEGACY_BAD_SECRET, 'utf8').toString('base64') },
  })
}

/** Launch one packaged process with the disposable synthetic profile and blocked network. */
async function launchPackagedApp(appPath, extraArgs, userDataDir) {
  const app = await electron.launch({
    executablePath: appPath,
    args: ['--ignore-gpu-blocklist', ...extraArgs],
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    const runtime = await app.evaluate(({ app: electronApp }) => ({
      appPath: electronApp.getAppPath(),
      isPackaged: electronApp.isPackaged,
      electron: process.versions.electron,
      node: process.versions.node,
      modules: process.versions.modules,
    }))
    if (!runtime.isPackaged || !runtime.appPath.endsWith('.asar')) {
      throw new Error('C16 settings probe requires a packaged Electron ASAR runtime.')
    }
    return { app, page, runtime }
  } catch (error) {
    try {
      await closeElectronApplication(app)
    } catch (cleanupError) {
      throw combineProbeFailure(error, cleanupError)
    }
    throw error
  }
}

/** Capture actual archive/executable identity while redacting private path names. */
async function buildIdentity(runtime, executablePath) {
  return {
    packaged: runtime.isPackaged,
    appBasename: path.basename(executablePath),
    asarBasename: path.basename(runtime.appPath),
    asarSha256: await sha256File(runtime.appPath),
    executableSha256: await sha256File(executablePath),
    runtime: {
      electron: runtime.electron,
      node: runtime.node,
      modules: runtime.modules,
    },
    sourceInputs: await readSourceInputHashes(),
  }
}

/** Read source head/tree facts without exposing the checkout path. */
function readSourceIdentity(expectedHead) {
  const head = gitValue(['rev-parse', 'HEAD'])
  const tree = gitValue(['rev-parse', 'HEAD^{tree}'])
  const dirty = gitValue(['status', '--porcelain'])
  return {
    head,
    tree,
    expectedHead,
    worktreeClean: dirty === '',
  }
}

/** Hash bounded source inputs which explain the packaged runtime identity. */
async function readSourceInputHashes() {
  const relativePaths = ['package.json', 'electron/main.cjs', 'electron/preload.cjs']
  const entries = {}
  for (const relativePath of relativePaths) {
    entries[relativePath] = await sha256File(path.join(projectRoot, relativePath))
  }
  return entries
}

/** Open the settings workspace and wait for the bridge-backed draft to load. */
async function openSettings(page) {
  await page.getByTestId('open-settings-workspace').click({ force: true })
  await page.getByTestId('settings-workspace').waitFor({ state: 'attached', timeout: 15_000 })
  await page.getByTestId('settings-provider-url').waitFor({ state: 'visible', timeout: 15_000 })
}

/** Fill provider settings using disposable values and ensure startup auto-connect stays off. */
async function fillSyntheticSettings(page, secret) {
  await page.getByRole('button', { name: 'Traccar HTTP' }).click()
  await page.getByTestId('settings-provider-url').fill(SYNTHETIC_BASE_URL)
  await page.getByTestId('settings-provider-email').fill(SYNTHETIC_EMAIL)
  await page.getByTestId('settings-provider-secret').fill(secret)
  const autoConnect = page.locator('label').filter({ hasText: 'Auto-connect on startup' }).locator('input')
  if (await autoConnect.isChecked()) await autoConnect.uncheck()
  if (await page.getByTestId('settings-save').isDisabled()) {
    throw new Error('Synthetic settings could not reach an enabled save state.')
  }
}

/** Save settings through the real Electron bridge and wait for the workspace to close. */
async function saveSettings(page) {
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-workspace').waitFor({ state: 'hidden', timeout: 15_000 })
}

/** Select the authoritative clear-secret toggle without exposing the old secret value. */
async function clearStoredSecret(page) {
  const clearToggle = page.locator('label').filter({ hasText: 'Clear stored secret on save' }).locator('input')
  await clearToggle.waitFor({ state: 'attached', timeout: 5_000 })
  if (!(await clearToggle.isChecked())) await clearToggle.check()
}

/** Discard the intentionally invalid URL edit after the rejection observation. */
async function discardUnsavedSettings(page) {
  await page.getByTestId('workspace-close-btn').click()
  const confirmation = page.getByTestId('settings-discard-confirmation')
  if (await confirmation.isVisible().catch(() => false)) {
    await page.getByTestId('settings-discard-changes').click()
  }
  await page.getByTestId('settings-workspace').waitFor({ state: 'hidden', timeout: 10_000 })
}

/** Capture settings view and redacted filesystem generations from the disposable profile. */
async function captureSettingsSnapshot(page, userDataDir) {
  const view = await page.evaluate(async () => {
    if (window.sartrackerElectron?.loadAppSettings === undefined) {
      throw new Error('Electron settings bridge is unavailable.')
    }
    return window.sartrackerElectron.loadAppSettings()
  })
  const settings = await readJson(path.join(userDataDir, 'settings.json'))
  const credentialsPath = path.join(userDataDir, 'credentials.json')
  const credentials = await readJson(credentialsPath, null)
  const settingsDataSource = settings.dataSource ?? {}
  const viewDataSource = view.dataSource ?? {}
  const credentialEntry = credentials?.traccar?.[settingsDataSource.authMode]
  const secretState = credentials === null
    ? 'legacy'
    : typeof credentialEntry?.secret === 'string' && credentialEntry.secret !== ''
      ? 'present'
      : 'cleared'
  return {
    settingsFile: {
      present: true,
      sha256: await sha256File(path.join(userDataDir, 'settings.json')),
      credentialGeneration: settings.credentialGeneration ?? null,
      dataSource: {
        providerType: settingsDataSource.providerType,
        authMode: settingsDataSource.authMode,
        baseUrlSha256: hashText(settingsDataSource.baseUrl ?? ''),
        emailSha256: hashText(settingsDataSource.email ?? ''),
        autoConnect: settingsDataSource.autoConnect,
        trackingCacheEnabled: settingsDataSource.trackingCacheEnabled,
      },
      missionDefaults: {
        autoRefreshEnabled: settings.missionDefaults?.autoRefreshEnabled,
        autoRefreshIntervalSeconds: settings.missionDefaults?.autoRefreshIntervalSeconds,
        autoSaveEnabled: settings.missionDefaults?.autoSaveEnabled,
        autoSaveIntervalSeconds: settings.missionDefaults?.autoSaveIntervalSeconds,
        primaryMissionRootSha256: hashText(settings.missionDefaults?.primaryMissionRoot ?? ''),
      },
    },
    credentialsFile: {
      present: credentials !== null,
      sha256: credentials === null ? null : await sha256File(credentialsPath),
      version: credentials?.version ?? 2,
      authMode: settingsDataSource.authMode,
      generation: credentialEntry?.generation ?? null,
      secretState,
      secretSha256: secretState === 'present' ? hashText(credentialEntry.secret) : null,
    },
    view: {
      providerType: viewDataSource.providerType,
      authMode: viewDataSource.authMode,
      baseUrlSha256: hashText(viewDataSource.baseUrl ?? ''),
      emailSha256: hashText(viewDataSource.email ?? ''),
      autoConnect: viewDataSource.autoConnect,
      trackingCacheEnabled: viewDataSource.trackingCacheEnabled,
      secretPresent: viewDataSource.secretPresent,
    },
  }
}

/** Capture a restart state after the packaged shell has become available. */
async function captureSettingsSnapshotAfterStartup(page, userDataDir) {
  await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 45_000 })
  return captureSettingsSnapshot(page, userDataDir)
}

/** Close a packaged process without leaving a second profile writer running. */
async function closeSession(session) {
  await closeElectronApplication(session.app)
}

/** Close a launched Electron process and require an observed orderly exit. */
export async function closeElectronApplication(app, timeoutMs = 5_000) {
  const child = app.process?.()
  const startedAt = Date.now()
  const result = await closeOwnedSmokeChild(child, {
    owned: true,
    close: () => app.close(),
    orderlyDeadline: startedAt + timeoutMs,
    deadline: startedAt + (timeoutMs * 2),
  })
  if (result.closeError !== null) throw result.closeError
  if (result.forcedCleanup !== null) {
    throw new Error('C16 owned Electron cleanup required forced termination.')
  }
  if (result.exit === null) throw new Error('C16 owned Electron cleanup did not observe process exit.')
  return result
}

/** Preserve the primary probe failure while retaining an owned-cleanup failure as cause. */
export function combineProbeFailure(primaryError, cleanupError) {
  const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
  const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
  return new AggregateError(
    [primaryError, cleanupError],
    `${primaryMessage} (owned Electron cleanup failed: ${cleanupMessage})`,
    { cause: primaryError },
  )
}

/** Capture a screenshot using a relative evidence name and preserve probe progress on failure. */
async function captureScreenshot(page, evidenceDir, name) {
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true })
}

/** Hash a file without returning its contents to the receipt. */
async function sha256File(filePath) {
  const contents = await readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

/** Hash a fixture value before it reaches a report projection. */
function hashText(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

/** Write JSON with deterministic formatting. */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Read JSON while preserving a bounded missing-file distinction. */
async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

/** Read one git identity value without exposing the checkout path. */
function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** Parse the explicit packaged-probe invocation and reject ambiguous paths. */
function parseArgs(args) {
  const options = { appPath: '', evidenceDir: '', expectedHead: '', extraArgs: [] }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--app') options.appPath = readArgValue(args, ++index, argument)
    else if (argument === '--evidence') options.evidenceDir = readArgValue(args, ++index, argument)
    else if (argument === '--expected-head') options.expectedHead = readArgValue(args, ++index, argument)
    else if (argument === '--app-arg') options.extraArgs.push(readArgValue(args, ++index, argument, true))
    else throw new Error(`Unknown settings probe argument: ${argument}`)
  }
  if (options.appPath === '' || options.evidenceDir === '' || !/^[a-f0-9]{40}$/u.test(options.expectedHead)) {
    throw new Error('C16 settings probe requires --app, --evidence and a 40-character --expected-head SHA-1.')
  }
  return options
}

/** Read one CLI value while allowing explicitly repeated Electron app flags. */
function readArgValue(args, index, name, allowFlagLikeValue = false) {
  const value = args[index]
  if (value === undefined || (!allowFlagLikeValue && value.startsWith('--'))) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}

/** Replace every fixture secret before an error or receipt can be written. */
function redactKnownSecrets(value) {
  return String(value)
    .replaceAll(SECRET_A, '[fixture-secret-a-redacted]')
    .replaceAll(SECRET_B, '[fixture-secret-b-redacted]')
    .replaceAll(LEGACY_BAD_SECRET, '[legacy-ciphertext-redacted]')
}

/** Fail closed if future edits accidentally put a fixture secret in the receipt object. */
function assertReceiptContainsNoFixtureSecret(report) {
  const serialized = JSON.stringify(report)
  if (serialized.includes(SECRET_A) || serialized.includes(SECRET_B) || serialized.includes(LEGACY_BAD_SECRET)) {
    throw new Error('C16 settings receipt contains a fixture secret and cannot be emitted.')
  }
}
