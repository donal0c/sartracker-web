#!/usr/bin/env node

// Packaged C01 startup-admission probe.
//
// This producer owns a fixed disposable profile matrix and records raw observations
// from the packaged Electron API/process boundary. The paired receipt module
// recomputes every safety predicate; this script never turns its own `result`
// field into qualification evidence.

import { createHash, randomUUID } from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  chmod,
  copyFile,
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

import { _electron as electron } from 'playwright'

import { countDescendantElectronRenderers } from '../../build/release-smoke-lib.js'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import {
  C01_STARTUP_PROOF_MODE,
  C01_HELD_GATE_TIMEOUT_MS,
  C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
  C01_OVERSIZED_STORE_BYTES,
  C01_STARTUP_PROFILE_KINDS,
  STARTUP_PROBE_DESCRIPTOR,
  validateStartupContractEvidence,
} from './startup-receipts.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u

/** Bounds only the disposable SQLite lock-holder setup, not the app response. */
export const C01_STORE_LOCK_READY_TIMEOUT_MS = 5_000
const APP_CLOSE_TIMEOUT_MS = 20_000
const DIALOG_TIMEOUT_MS = 20_000
const DIALOG_DISMISSAL_TIMEOUT_MS = 2_000
const BAD_SECRET_WARNING =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
const SYNTHETIC_BASE_URL = 'https://c01.synthetic.invalid.example'
const LEGACY_SECRET_CANARY = 'C01_SYNTHETIC_LEGACY_CIPHERTEXT_DO_NOT_EXPORT'
const REENTRY_SECRET_CANARY = 'C01_SYNTHETIC_REENTRY_SECRET_DO_NOT_EXPORT'

/** Parse the exact packaged C01 invocation; arbitrary app flags are rejected. */
export function parseStartupProbeArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('C01 startup probe arguments must be an array.')
  let appPath
  let evidenceDir
  let expectedHead
  let expectedAppSha256
  let enospcMount
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--app') {
      if (appPath !== undefined) throw new Error('C01 startup probe received duplicate --app.')
      appPath = readArgument(argv, ++index, '--app')
    } else if (argument === '--evidence') {
      if (evidenceDir !== undefined) throw new Error('C01 startup probe received duplicate --evidence.')
      evidenceDir = readArgument(argv, ++index, '--evidence')
    } else if (argument === '--expected-head') {
      if (expectedHead !== undefined) throw new Error('C01 startup probe received duplicate --expected-head.')
      expectedHead = readArgument(argv, ++index, '--expected-head')
    } else if (argument === '--expected-app-sha256') {
      if (expectedAppSha256 !== undefined) {
        throw new Error('C01 startup probe received duplicate --expected-app-sha256.')
      }
      expectedAppSha256 = readArgument(argv, ++index, '--expected-app-sha256')
    } else if (argument === '--enospc-mount') {
      if (enospcMount !== undefined) throw new Error('C01 startup probe received duplicate --enospc-mount.')
      enospcMount = readArgument(argv, ++index, '--enospc-mount')
    } else {
      throw new Error(`C01 startup probe received unknown argument: ${argument}`)
    }
  }
  if (!isAbsolutePath(appPath) || !isAbsolutePath(evidenceDir)) {
    throw new Error('C01 startup probe requires absolute --app and --evidence paths.')
  }
  if (!SHA1.test(expectedHead ?? '')) {
    throw new Error('C01 startup probe requires a 40-character lowercase --expected-head SHA-1.')
  }
  if (!SHA256.test(expectedAppSha256 ?? '')) {
    throw new Error('C01 startup probe requires a 64-character lowercase --expected-app-sha256.')
  }
  if (enospcMount !== undefined && !isAbsolutePath(enospcMount)) {
    throw new Error('C01 startup probe requires an absolute --enospc-mount path.')
  }
  return Object.freeze({
    appPath,
    evidenceDir,
    expectedHead,
    expectedAppSha256,
    ...(enospcMount === undefined ? {} : { enospcMount }),
  })
}

/** Run all bounded C01 profiles and retain a raw receipt plus independent result. */
export async function runStartupAdmissionProbe(options) {
  validateOptions(options)
  const evidenceDir = path.resolve(options.evidenceDir)
  await assertFreshEvidenceDirectory(evidenceDir)
  const source = readStartupSourceIdentity(options.expectedHead)
  const executableSha256 = await sha256File(options.appPath)
  const expected = {
    proofMode: C01_STARTUP_PROOF_MODE,
    source: { expectedHead: options.expectedHead, tree: source.tree },
    artifact: {
      packagedExecutableSha256: options.expectedAppSha256,
      packagedApplicationArchiveSha256: '0'.repeat(64),
    },
    process: { tier: C01_STARTUP_PROOF_MODE },
    workload: {
      supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
      profileKinds: [...C01_STARTUP_PROFILE_KINDS],
    },
  }
  const report = {
    schema: STARTUP_PROBE_DESCRIPTOR.schema,
    contractId: 'C01',
    proofMode: C01_STARTUP_PROOF_MODE,
    source,
    app: {
      suppliedPath: options.appPath,
      executableSha256,
      isPackaged: false,
      appPath: null,
      asarSha256: null,
    },
    runtime: null,
    process: { tier: C01_STARTUP_PROOF_MODE },
    scenarios: {},
    custody: {
      rawSecretsIncluded: false,
      networkContactAttempted: false,
      profilesDisposable: true,
      sourceProfileRetained: false,
    },
    result: 'fail',
    failures: [],
  }
  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-c01-startup-'))
  try {
    if (executableSha256 !== options.expectedAppSha256) {
      report.failures.push('Supplied packaged executable SHA-256 differs from expected binding.')
    }
    const scenarioRunners = {
      'absent-schema': () => runAbsentSchemaScenario(options, path.join(disposableRoot, 'absent-schema'), evidenceDir, report),
      'valid-schema': () => runValidSchemaScenario(options, path.join(disposableRoot, 'valid-schema'), evidenceDir, report),
      'legacy-bad-secret': () => runBadSecretScenario(options, path.join(disposableRoot, 'bad-secret'), evidenceDir, report),
      'corrupt-settings': () => runCorruptSettingsScenario(options, path.join(disposableRoot, 'corrupt-settings'), evidenceDir, report),
      'corrupt-schema': () => runCorruptSchemaScenario(options, path.join(disposableRoot, 'corrupt-schema'), report),
      'newer-schema': () => runNewerSchemaScenario(options, path.join(disposableRoot, 'newer-schema'), report),
      'oversized-store': () => runOversizedStoreScenario(options, path.join(disposableRoot, 'oversized-store'), evidenceDir, report),
      'permission-fault': () => runPermissionFaultScenario(options, path.join(disposableRoot, 'permission-fault'), report),
      'disk-full': () => runDiskFullScenario(options, path.join(disposableRoot, 'disk-full'), report),
      'held-diagnostics-gate': () => runHeldGateScenario(options, path.join(disposableRoot, 'held-diagnostics-gate'), report, 'diagnostics'),
      'held-crash-gate': () => runHeldGateScenario(options, path.join(disposableRoot, 'held-crash-gate'), report, 'crash'),
      'held-store-gate': () => runHeldGateScenario(options, path.join(disposableRoot, 'held-store-gate'), report, 'store'),
      'active-recoverable': () => runActiveRecoverableScenario(options, path.join(disposableRoot, 'active-recoverable'), evidenceDir, report),
    }
    for (const profileKind of C01_STARTUP_PROFILE_KINDS) {
      const runner = scenarioRunners[profileKind]
      const scenario = await runScenario(profileKind, runner, report)
      report.scenarios[profileKind] = scenario
    }
  } catch (error) {
    report.failures.push(sanitizeError(error, disposableRoot))
  } finally {
    await rm(disposableRoot, { recursive: true, force: true }).catch((error) => {
      report.failures.push(`Disposable C01 profile cleanup failed: ${sanitizeError(error)}`)
    })
  }

  const archiveSha256 = typeof report.app.asarSha256 === 'string' ? report.app.asarSha256 : null
  if (SHA256.test(archiveSha256 ?? '')) {
    expected.artifact.packagedApplicationArchiveSha256 = archiveSha256
  }
  const validation = validateStartupContractEvidence('C01', report, expected)
  report.result = validation.status
  report.recomputedPredicates = validation.recomputedPredicates
  report.failureReasons = validation.failureReasons
  await writeJson(path.join(evidenceDir, STARTUP_PROBE_DESCRIPTOR.reportPath), report)
  return Object.freeze({ report: Object.freeze(report), validation })
}

/**
 * Calibrate one startup dependency hold against the local Electron main process.
 * This development-only helper records raw timeout/exit facts and never claims
 * packaged identity or C01 qualification.
 */
export async function runStartupHeldGateDevelopmentProbe(options) {
  const gateKinds = new Set(['diagnostics', 'crash', 'store'])
  if (!isAbsolutePath(options?.appPath) || !isAbsolutePath(options?.evidenceDir)
      || !gateKinds.has(options?.gateKind)) {
    throw new Error('C01 development held-gate probe requires absolute app/evidence paths and a fixed gate kind.')
  }
  const evidenceDir = path.resolve(options.evidenceDir)
  await assertFreshEvidenceDirectory(evidenceDir)
  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-c01-held-dev-'))
  try {
    const scenario = await runHeldGateScenario({
      appPath: options.appPath,
      evidenceDir,
      developmentTestHarness: options.launchPackagedTarget !== true,
      captureX11Diagnostics: process.env.SARTRACKER_C01_CAPTURE_X11_DIAGNOSTICS === '1',
    }, path.join(disposableRoot, options.gateKind), {}, options.gateKind)
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1',
      contractId: 'C01',
      proofMode: 'development-electron-held-gate-calibration',
      gateKind: options.gateKind,
      app: { suppliedPath: options.appPath },
      scenario,
      qualification: { eligible: false, reason: 'Development calibration is not packaged C01 evidence.' },
    }
    await writeJson(path.join(evidenceDir, `held-${options.gateKind}.json`), report)
    return Object.freeze(report)
  } finally {
    await rm(disposableRoot, { recursive: true, force: true })
  }
}

/** Retain one scenario failure while continuing the other independent profiles. */
async function runScenario(name, operation, report) {
  try {
    return await operation()
  } catch (error) {
    const failure = `${name}: ${sanitizeError(error)}`
    report.failures.push(failure)
    return { profileKind: name, failure }
  }
}

/** Seed a profile without a mission database and prove first-start creation. */
async function runAbsentSchemaScenario(options, profile, evidenceDir, report) {
  await mkdir(profile, { recursive: true })
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const before = await snapshotProfileFiles(profile, false)
  const scenario = await runNormalShellScenario(options, profile, report, 'absent-schema', evidenceDir, {
    before,
    inspect: async (_page, after) => ({
      observed: 'created-current-schema',
      beforeFiles: { database: Object.hasOwn(before, 'mission-store.sqlite') },
      afterStore: {
        schemaVersion: readProfileSchemaVersion(profile),
        databaseCreated: Object.hasOwn(after, 'mission-store.sqlite'),
      },
    }),
  })
  return scenario
}

/** Seed and run a current-schema profile through the normal packaged shell. */
async function runValidSchemaScenario(options, profile, evidenceDir, report) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  return runNormalShellScenario(options, profile, report, 'valid-schema', evidenceDir)
}

/** Seed an active mission and verify that startup exposes the same mission. */
async function runActiveRecoverableScenario(options, profile, evidenceDir, report) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const store = createElectronMissionStore({ userDataPath: profile })
  let mission
  try {
    mission = await store.createMission({
      name: 'C01 disposable recoverable mission',
      start_time: '2026-09-20T08:00:00.000Z',
    })
    await store.syncBackup('c01-active-recoverable-seed')
  } finally {
    await store.prepareClose()
    store.close()
  }
  const before = await snapshotProfileFiles(profile)
  return runNormalShellScenario(options, profile, report, 'active-recoverable', evidenceDir, {
    before,
    inspect: async (page) => {
      const recovery = await page.evaluate(async () => {
        const active = await window.sartrackerElectron?.missionStore?.getActiveMission?.()
        return active === null || active === undefined
          ? { activeMissionVisible: false, missionId: null, missionStatus: null, noDataLoss: false }
          : {
              activeMissionVisible: true,
              missionId: active.id ?? null,
              missionStatus: active.status ?? null,
              noDataLoss: typeof active.id === 'string' && active.name === 'C01 disposable recoverable mission',
            }
      })
      return {
        observed: 'recoverable-mission',
        store: {
          missionId: mission.id,
          missionStatus: recovery.missionStatus,
          schemaVersion: readProfileSchemaVersion(profile),
        },
        recovery,
      }
    },
  })
}

/** Run a normal packaged shell and retain only bounded runtime observations. */
async function runNormalShellScenario(options, profile, report, profileKind, evidenceDir, configuration = {}) {
  const before = configuration.before ?? await snapshotProfileFiles(profile, false)
  let app = null
  let pid = null
  let scenario = null
  const launchStartedAt = Date.now()
  try {
    app = await launchPackaged(options.appPath, profile)
    pid = app.process()?.pid ?? null
    const runtime = await readRuntimeIdentity(app)
    applyRuntimeIdentity(report, runtime, options.appPath)
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 45_000 })
    const shellAtMs = Date.now() - launchStartedAt
    const runtimeFaultVisible = await page.getByTestId('runtime-failed-shell').isVisible().catch(() => false)
    const after = await snapshotProfileFiles(profile, false)
    const inspected = configuration.inspect === undefined
      ? {
          observed: 'normal-shell',
          store: { schemaVersion: readProfileSchemaVersion(profile) },
        }
      : await configuration.inspect(page, after)
    scenario = {
      profileKind,
      ...inspected,
      shellReached: true,
      runtimeFaultVisible,
      provider: { networkContactAttempted: false },
      originalFiles: { before, after },
      process: { pid, shellAtMs, closed: false },
    }
    if (evidenceDir !== undefined && profileKind === 'valid-schema') {
      await page.screenshot({ path: path.join(evidenceDir, 'c01-valid-schema-normal-shell.png'), fullPage: true })
    }
  } finally {
    const closed = await closeElectronApp(app)
    const after = await snapshotProfileFiles(profile, false).catch(() => ({}))
    if (scenario !== null) {
      scenario.process.closed = closed
      scenario.originalFiles.after = after
    }
  }
  return scenario ?? {
    profileKind,
    failure: `C01 ${profileKind} profile did not produce packaged shell observations.`,
  }
}

/** Seed a malformed SQLite file and observe the native startup refusal. */
async function runCorruptSchemaScenario(options, profile, report) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  await writeFile(path.join(profile, 'mission-store.sqlite'), Buffer.from('C01 synthetic corrupt SQLite store', 'utf8'))
  const before = await snapshotProfileFiles(profile)
  return observeNativeStartupFault(options, profile, report, 'corrupt-schema', 'corrupt-store', before)
}

/** Generate both fixed store boundaries and exercise each through the package observer. */
async function runOversizedStoreScenario(options, profile, evidenceDir, report) {
  const smallProfile = path.join(profile, 'small')
  const fieldProfile = path.join(profile, 'field')
  const smallFixture = await prepareOversizedBoundaryProfile(smallProfile, 'small')
  const fieldFixture = await prepareOversizedBoundaryProfile(fieldProfile, 'field')
  const normal = await runNormalShellScenario(
    options,
    smallProfile,
    report,
    'oversized-store',
    evidenceDir,
    { before: smallFixture.before },
  )
  const fieldNormal = await runNormalShellScenario(
    options,
    fieldProfile,
    report,
    'oversized-store',
    undefined,
    { before: fieldFixture.before },
  )
  const fieldOutcome = fieldNormal.failure === undefined && fieldNormal.runtimeFaultVisible === false
    ? 'normal-shell'
    : 'actionable-fault'
  const observations = [
    {
      requestedBytes: C01_OVERSIZED_STORE_BYTES[0],
      observedBytes: smallFixture.manifest.database.bytes,
      outcome: normal.failure === undefined && normal.runtimeFaultVisible === false ? 'normal-shell' : 'actionable-fault',
      fixturePreset: 'small',
      fixtureSha256: smallFixture.manifest.database.sha256,
    },
    {
      requestedBytes: C01_OVERSIZED_STORE_BYTES[1],
      observedBytes: fieldFixture.manifest.database.bytes,
      outcome: fieldOutcome,
      fixturePreset: 'field',
      fixtureSha256: fieldFixture.manifest.database.sha256,
    },
  ]
  const bothNormal = normal.failure === undefined && fieldNormal.failure === undefined
    && normal.runtimeFaultVisible === false && fieldNormal.runtimeFaultVisible === false
  return {
    ...normal,
    profileKind: 'oversized-store',
    observed: 'bounded-admission',
    admission: {
      status: bothNormal ? 'normal-shell' : 'actionable-fault',
      originalPreserved: true,
      bounded: true,
    },
    process: normal.process,
    fieldProcess: fieldNormal.process,
    originalFiles: {
      before: {
        ...prefixSnapshot('small', normal.originalFiles?.before ?? smallFixture.before),
        ...prefixSnapshot('field', fieldNormal.originalFiles?.before ?? fieldFixture.before),
      },
      after: {
        ...prefixSnapshot('small', normal.originalFiles?.after ?? {}),
        ...prefixSnapshot('field', fieldNormal.originalFiles?.after ?? {}),
      },
    },
    workload: {
      observations,
      fieldFixtureExecuted: true,
      fieldFixtureReason: 'The field fixture is copied into a disposable profile and launched through the same packaged process observer; this code path is not executed during development tests.',
    },
  }
}

/** Generate one current-schema fixture and install it into an isolated startup profile. */
async function prepareOversizedBoundaryProfile(profile, preset) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const fixture = await generateMissionStoreFixture({
    preset,
    outputPath: path.join(profile, `${preset}-mission-store.sqlite`),
  })
  await copyFile(fixture.outputPath, path.join(profile, 'mission-store.sqlite'))
  return {
    fixture,
    before: await snapshotProfileFiles(profile),
  }
}

/** Prefix profile snapshots so two disposable boundary runs remain independently checkable. */
function prefixSnapshot(prefix, snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([name, value]) => [`${prefix}/${name}`, value]))
}

/** Attempt a read-only profile and retain the failure if runtime injection is ineffective. */
async function runPermissionFaultScenario(options, profile, report) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const before = await snapshotProfileFiles(profile)
  const databasePath = path.join(profile, 'mission-store.sqlite')
  let scenario
  let restored = false
  try {
    await chmod(databasePath, 0o444)
    await chmod(profile, 0o555)
    scenario = await observeNativeStartupFault(options, profile, report, 'permission-fault', 'permission', before, {
      databaseMode: 0o444,
      directoryMode: 0o555,
    })
  } finally {
    await chmod(databasePath, 0o644).catch(() => undefined)
    await chmod(profile, 0o755).catch(() => undefined)
    restored = true
  }
  if (scenario === undefined) {
    return {
      profileKind: 'permission-fault',
      observed: 'not-observed',
      failure: 'C01 permission-fault setup did not yield a native startup observation.',
      filesystem: { databaseMode: 0o444, directoryMode: 0o555, restored },
    }
  }
  scenario.filesystem = { ...scenario.filesystem, restored }
  return scenario
}

/**
 * Run the physical disk-full startup boundary when a reviewed small volume is supplied.
 * Without that execution input the report retains an explicit unsupported calibration;
 * it never upgrades a synthetic ENOSPC throw into packaged evidence.
 */
async function runDiskFullScenario(options, profile) {
  if (options.enospcMount !== undefined) {
    return runPhysicalDiskFullScenario(options, profile)
  }
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const before = await snapshotProfileFiles(profile)
  const after = await snapshotProfileFiles(profile)
  return {
    profileKind: 'disk-full',
    observed: 'unavailable',
    faultKind: 'disk-full',
    precondition: {
      kind: 'bounded-enospc',
      status: 'ENVIRONMENT_BLOCKED',
      observed: false,
      deviceDistinct: false,
      totalBytes: null,
      availableBytes: null,
      reason: 'C01 physical disk-full requires a reviewed absolute --enospc-mount; host storage was not mutated.',
    },
    filesystem: {
      errorCode: null,
      originalPreserved: true,
      physical: false,
      injectionAttempted: false,
      synthetic: false,
      boundary: 'bounded-enospc-volume-not-supplied',
    },
    process: { tier: C01_STARTUP_PROOF_MODE, pid: process.pid, closed: true },
    originalFiles: { before, after },
    failure: 'C01 disk-full is unavailable without the reviewed bounded ENOSPC mount input; no synthetic fault is substituted.',
  }
}

/** Prepare, fill and observe one owned bounded filesystem at the packaged startup boundary. */
async function runPhysicalDiskFullScenario(options, disposableProfile) {
  const prepared = await prepareBoundedEnospcVolume(options.enospcMount, options.evidenceDir)
  if (!prepared.ready) {
    await seedOperationalProfile(disposableProfile)
    await writeJson(path.join(disposableProfile, 'settings.json'), syntheticSettings(false))
    const before = await snapshotProfileFiles(disposableProfile)
    const after = await snapshotProfileFiles(disposableProfile)
    return {
      profileKind: 'disk-full',
      observed: 'unavailable',
      faultKind: 'disk-full',
      precondition: prepared.precondition,
      filesystem: {
        errorCode: null,
        originalPreserved: true,
        physical: false,
        injectionAttempted: false,
        synthetic: false,
        boundary: 'bounded-enospc-volume-not-supplied',
      },
      process: { tier: 'packaged-electron-startup-admission', pid: process.pid, closed: true },
      originalFiles: { before, after },
      failure: prepared.precondition.reason,
    }
  }

  const profile = prepared.storeProfile
  let before
  let after
  let fill
  let scenario
  let cleanup = { fillerRemoved: false, profileRemoved: false }
  try {
    await seedOperationalProfile(profile)
    await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
    before = await snapshotProfileFiles(profile)
    fill = await fillBoundedEnospcVolume(profile)
    scenario = await observeNativeStartupFault(
      options,
      profile,
      { app: { asarSha256: null } },
      'disk-full',
      'disk-full',
      before,
      {
        errorCode: fill.errorCode,
        originalPreserved: true,
        physical: true,
        injectionAttempted: true,
        synthetic: false,
        boundary: 'bounded-enospc-volume-startup-write',
        precondition: prepared.precondition,
        fill: {
          targetBytes: fill.targetBytes,
          writtenBytes: fill.writtenBytes,
          errorCode: fill.errorCode,
          fillerPath: fill.fillerPath,
        },
      },
    )
    after = scenario.originalFiles?.after ?? await snapshotProfileFiles(profile)
    scenario.precondition = prepared.precondition
    scenario.filesystem = {
      ...scenario.filesystem,
      physical: true,
      injectionAttempted: true,
      synthetic: false,
      precondition: prepared.precondition,
      fill,
    }
  } catch (error) {
    after = await snapshotProfileFiles(profile, false).catch(() => ({}))
    scenario = {
      profileKind: 'disk-full',
      observed: 'not-observed',
      faultKind: 'disk-full',
      precondition: prepared.precondition,
      filesystem: {
        errorCode: fill?.errorCode ?? null,
        originalPreserved: snapshotsEqual(before, after),
        physical: true,
        injectionAttempted: fill !== undefined,
        synthetic: false,
        boundary: 'bounded-enospc-volume-startup-write',
        fill,
      },
      process: { tier: C01_STARTUP_PROOF_MODE, pid: process.pid, closed: true },
      originalFiles: { before: before ?? {}, after },
      failure: sanitizeError(error, profile),
    }
  } finally {
    if (fill?.fillerPath !== undefined) {
      cleanup.fillerRemoved = await rm(fill.fillerPath, { force: true }).then(() => true).catch(() => false)
    }
    cleanup.profileRemoved = await rm(profile, { recursive: true, force: true }).then(() => true).catch(() => false)
  }
  scenario.cleanup = cleanup
  return scenario
}

/** Validate the reviewed bounded ENOSPC input without touching host storage. */
async function prepareBoundedEnospcVolume(mountPath, evidenceDir) {
  const blocked = (reason, details = {}) => ({
    ready: false,
    precondition: {
      kind: 'bounded-enospc',
      status: 'ENVIRONMENT_BLOCKED',
      observed: false,
      deviceDistinct: details.deviceDistinct === true,
      totalBytes: details.totalBytes ?? null,
      availableBytes: details.availableBytes ?? null,
      reason,
    },
  })
  if (!isAbsolutePath(mountPath)) {
    return blocked('A reviewed absolute bounded writable mount is required via --enospc-mount.')
  }
  let mountInfo
  let evidenceInfo
  let volumeStats
  try {
    mountInfo = await stat(mountPath)
    evidenceInfo = await stat(evidenceDir)
    volumeStats = await statfs(mountPath)
    await access(mountPath)
  } catch (error) {
    return blocked(`Bounded ENOSPC mount could not be inspected: ${error?.code ?? 'unavailable'}.`)
  }
  if (!mountInfo.isDirectory()) return blocked('Bounded ENOSPC input is not a directory.')
  const totalBytes = Number(volumeStats.bsize) * Number(volumeStats.blocks)
  const availableBytes = Number(volumeStats.bsize) * Number(volumeStats.bavail)
  const deviceDistinct = mountInfo.dev !== evidenceInfo.dev
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > 64 * 1024 * 1024) {
    return blocked('Bounded ENOSPC volume must report total capacity at or below 64 MiB.', { totalBytes })
  }
  if (!deviceDistinct) {
    return blocked('Bounded ENOSPC volume must use a device distinct from the evidence filesystem.', {
      totalBytes,
      availableBytes,
    })
  }
  const storeProfile = path.join(mountPath, `.sartracker-c01-enospc-${randomUUID()}`)
  try {
    await mkdir(storeProfile, { recursive: true, mode: 0o700 })
    const afterCreate = await statfs(storeProfile)
    const copyAvailableBytes = Number(afterCreate.bsize) * Number(afterCreate.bavail)
    return {
      ready: true,
      storeProfile,
      precondition: {
        kind: 'bounded-enospc',
        status: 'READY',
        observed: true,
        deviceDistinct,
        totalBytes,
        availableBytes: copyAvailableBytes,
        reason: 'Reviewed bounded writable volume passed capacity and device preflight.',
      },
    }
  } catch (error) {
    await rm(storeProfile, { recursive: true, force: true }).catch(() => undefined)
    return blocked(`Bounded ENOSPC volume could not be prepared: ${error?.code ?? 'unavailable'}.`, {
      totalBytes,
      availableBytes,
      deviceDistinct,
    })
  }
}

/** Fill only the owned bounded volume until the kernel reports ENOSPC. */
async function fillBoundedEnospcVolume(profile) {
  const fillerPath = path.join(profile, '.c01-enospc-filler')
  const chunk = Buffer.alloc(1024 * 1024, 0x43)
  const handle = await open(fillerPath, 'w')
  let writtenBytes = 0
  let errorCode = null
  try {
    while (writtenBytes <= 64 * 1024 * 1024) {
      try {
        await handle.write(chunk)
        writtenBytes += chunk.byteLength
      } catch (error) {
        errorCode = error?.code ?? null
        break
      }
    }
  } finally {
    await handle.close()
  }
  return {
    fillerPath,
    targetBytes: writtenBytes,
    writtenBytes,
    errorCode,
  }
}

/** Classify a held gate that reached the fixed observation bound without an in-bound response. */
export function isBoundedHeldGateTimeoutWithoutAction({ earlyExit }) {
  return earlyExit?.timedOut === true
}

/** Accept a native dialog as actionable only when polling observed it inside the fixed bound. */
export function isActionableHeldGateObservation({ earlyExit, dialogWindowId, dialogObservedAtMs, timeoutMs }) {
  return dialogWindowId !== null
    && earlyExit?.timedOut !== true
    && Number.isFinite(dialogObservedAtMs)
    && dialogObservedAtMs >= 0
    && dialogObservedAtMs <= timeoutMs
}

/** Hold one real startup dependency, then retain the bounded runtime response. */
async function runHeldGateScenario(options, profile, _report, gateKind) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const before = await snapshotProfileFiles(profile)
  const heldPath = gateKind === 'diagnostics'
    ? path.join(profile, 'storage-diagnostics.json')
    : gateKind === 'crash'
      ? path.join(profile, 'crashes', 'crash-log.json')
      : null
  let holder = null
  let appProcess = null
  let cleanup = { heldPathRemoved: false, lockHolderClosed: false }
  let setupFailure = null
  let forcedKill = false
  let appStdout = null
  let appStderr = null
  let observationFailureDetails = null
  try {
    if (heldPath !== null) {
      await mkdir(path.dirname(heldPath), { recursive: true })
      await rm(heldPath, { force: true })
      await execFileAsync('mkfifo', [heldPath])
    } else {
      holder = await startStoreLockHolder(path.join(profile, 'mission-store.sqlite'))
    }
  } catch (error) {
    setupFailure = sanitizeError(error, profile)
  }

  const launchStartedAt = performance.now()
  let earlyExit = null
  let dialogWindowId = null
  let dialogObservedAtMs = null
  let dialogDismissed = false
  let productExit = null
  let observationFailure = setupFailure
  if (setupFailure === null) {
    const appEnvironment = {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
    }
    delete appEnvironment.ELECTRON_RUN_AS_NODE
    delete appEnvironment.ELECTRON_RENDERER_URL
    appProcess = spawn(options.appPath, [
      ...(options.developmentTestHarness ? [path.join(projectRoot, 'electron', 'main.cjs')] : []),
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--ozone-platform=x11',
      '--password-store=basic',
    ], {
      cwd: projectRoot,
      env: appEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    appStdout = collectChildOutput(appProcess.stdout, appProcess)
    appStderr = collectChildOutput(appProcess.stderr, appProcess)
    earlyExit = await waitForOwnedProcessOrTimeout(appProcess, C01_HELD_GATE_TIMEOUT_MS, launchStartedAt)
    dialogWindowId = earlyExit.dialogWindowId
    dialogObservedAtMs = earlyExit.dialogObservedAtMs
    if (earlyExit.timedOut === true && dialogWindowId === null) {
      dialogWindowId = await findSarTrackerErrorDialog(appProcess.pid, 500)
      if (dialogWindowId !== null) {
        dialogObservedAtMs = Math.max(0, Math.round(performance.now() - launchStartedAt))
      }
    }
    if (dialogWindowId !== null) {
      try {
        productExit = await waitForOwnedProcessExitAfterDialog(
          appProcess,
          C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
          async () => {
            const confirmedDismissalAt = await dismissErrorDialog(
              dialogWindowId,
              appProcess.pid,
              options.captureX11Diagnostics === true
                ? { evidenceDir: options.evidenceDir, gateKind, privateRoot: profile }
                : null,
            )
            dialogDismissed = true
            return confirmedDismissalAt
          },
        )
      } catch (error) {
        observationFailure = sanitizeError(error, profile)
        observationFailureDetails = serializeHeldGateObservationError(error, profile)
      }
    }
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      appProcess.kill('SIGTERM')
      await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
    }
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      forcedKill = true
      appProcess.kill('SIGKILL')
    }
  }
  if (appProcess !== null && appProcess.exitCode === null && appProcess.signalCode === null) {
    await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
  }

  const after = await snapshotProfileFiles(profile, false).catch(() => ({}))
  const runtimeLog = await readFile(path.join(profile, 'logs', 'runtime.log'), 'utf8').catch(() => '')
  // Never read the held crash FIFO from the observer; that would create an
  // unbounded reader and turn the calibration itself into the fault.
  const crashLog = gateKind === 'crash'
    ? ''
    : await readFile(path.join(profile, 'crashes', 'crash-log.json'), 'utf8').catch(() => '')
  const actionable = isActionableHeldGateObservation({
    earlyExit, dialogWindowId, dialogObservedAtMs, timeoutMs: C01_HELD_GATE_TIMEOUT_MS,
  })
  const lateDialogAfterTimeout = earlyExit?.timedOut === true && dialogWindowId !== null
  const productExitFailed = actionable && dialogDismissed
    && (productExit === null || productExit.code !== 1 || productExit.signal !== null)
  const processObservation = {
    pid: appProcess?.pid ?? process.pid,
    closed: appProcess === null || appProcess.exitCode !== null || appProcess.signalCode !== null,
    exitCode: appProcess?.exitCode ?? null,
    signal: appProcess?.signalCode ?? null,
    timeoutMs: C01_HELD_GATE_TIMEOUT_MS,
    timedOut: earlyExit?.timedOut ?? null,
    observationElapsedMs: earlyExit?.elapsedMs ?? null,
    forcedKill,
    dialogObserved: dialogWindowId !== null,
    dialogObservedAtMs,
    dialogDismissed,
    productExitCode: productExit?.code ?? null,
    productExitSignal: productExit?.signal ?? null,
    exitAfterDialogMs: productExit?.elapsedMs ?? null,
    lateDialogAfterTimeout,
    faultShellAtMs: actionable ? earlyExit?.elapsedMs ?? null : null,
  }
  if (holder !== null) {
    holder.kill('SIGTERM')
    await waitForChildClose(holder, 2_000).catch(() => undefined)
    cleanup.lockHolderClosed = holder.exitCode !== null || holder.signalCode !== null
  }
  if (heldPath !== null) cleanup.heldPathRemoved = await rm(heldPath, { force: true }).then(() => true).catch(() => false)
  const timedOutWithoutAction = isBoundedHeldGateTimeoutWithoutAction({ earlyExit, dialogWindowId, forcedKill })
  return {
    profileKind: `held-${gateKind}-gate`,
    observed: actionable ? 'actionable-fault' : timedOutWithoutAction ? 'bounded-timeout-no-action' : 'not-observed',
    gate: {
      kind: gateKind,
      held: setupFailure === null,
      bounded: setupFailure === null,
      action: actionable ? 'preserve-profile-and-contact-support' : '',
      synthetic: false,
      timeoutMs: C01_HELD_GATE_TIMEOUT_MS,
      response: actionable
        ? 'native-error-dialog'
        : lateDialogAfterTimeout
          ? 'native-error-dialog-after-bound'
          : 'no-native-dialog-no-shell',
      dialogObserved: dialogWindowId !== null,
      dialogDismissed,
      lateDialogAfterTimeout,
      dependencyPath: heldPath,
      lockHolder: gateKind === 'store' ? { pid: holder?.pid ?? null, closed: cleanup.lockHolderClosed } : null,
    },
    process: processObservation,
    startupLogs: {
      runtimeEvents: parseJsonLines(runtimeLog).map((entry) => entry?.event).filter((event) => typeof event === 'string'),
      crashKinds: readJsonArrayFromString(crashLog).map((entry) => entry?.kind).filter((kind) => typeof kind === 'string'),
      stdoutTail: sanitizeProcessOutput(appStdout?.text),
      stderrTail: sanitizeProcessOutput(appStderr?.text),
    },
    originalFiles: { before, after },
    cleanup,
    ...(observationFailure === null ? {} : { observationFailure }),
    ...(observationFailureDetails === null ? {} : { observationFailureDetails }),
    ...(productExitFailed
      ? { productGap: `C01 ${gateKind} startup showed an in-bound fault dialog but did not produce the required exit code 1 without a signal within ${C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS}ms after dismissal.` }
      : timedOutWithoutAction
        ? { productGap: `C01 ${gateKind} startup dependency hold reached the ${C01_HELD_GATE_TIMEOUT_MS}ms bound without an actionable operator response${lateDialogAfterTimeout ? '; a native dialog was observed only after the bound.' : '.'}` }
        : {}),
  }
}

/** Parse one bounded crash-log string without retaining arbitrary detail. */
function readJsonArrayFromString(contents) {
  try {
    const parsed = JSON.parse(contents)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Retain only a short sanitized process tail for startup-fault diagnosis. */
function sanitizeProcessOutput(value) {
  return sanitizeError(value ?? '')
}

/** Hold SQLite with the controller's native ABI; this fixture process is not application proof. */
async function startStoreLockHolder(databasePath) {
  const code = [
    "const Database=require('better-sqlite3')",
    'const db=new Database(process.argv[1])',
    "db.exec('BEGIN EXCLUSIVE')",
    "process.stdout.write('C01_STORE_LOCK_READY\\n')",
    'process.stdin.resume()',
  ].join(';')
  const child = spawn(process.execPath, ['--input-type=commonjs', '-e', code, databasePath], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stdout = collectChildOutput(child.stdout, child)
  collectChildOutput(child.stderr, child)
  try {
    await waitForChildOutput(stdout, 'C01_STORE_LOCK_READY', C01_STORE_LOCK_READY_TIMEOUT_MS)
  } catch (error) {
    child.kill('SIGTERM')
    await waitForChildClose(child, 2_000).catch(() => undefined)
    throw error
  }
  return child
}

/** Wait for a child process marker without allowing an unbounded startup hold. */
async function waitForChildOutput(output, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (output.text.includes(marker)) return
    if (output.child.exitCode !== null || output.child.signalCode !== null) {
      throw new Error(`C01 store lock holder exited before readiness: ${output.text.slice(-200)}`)
    }
    await delay(50)
  }
  throw new Error('C01 store lock holder did not report readiness within the bounded timeout.')
}

/** Collect bounded child output for diagnostics without retaining arbitrary secrets. */
function collectChildOutput(stream, child) {
  const output = { text: '', child }
  if (stream === null || stream === undefined) return output
  stream.on('data', (chunk) => {
    output.text = `${output.text}${String(chunk)}`.slice(-2_000)
  })
  return output
}

/** Wait for an owned process or an in-bound native dialog without exceeding the fixed observation bound. */
export async function waitForOwnedProcessOrTimeout(child, timeoutMs, startedAt = performance.now(), dependencies = {}) {
  const now = dependencies.now ?? (() => performance.now())
  const findDialog = dependencies.findDialog ?? findSarTrackerErrorDialog
  const wait = dependencies.wait ?? delay
  const deadline = startedAt + timeoutMs
  while (now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return {
        timedOut: false,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        dialogWindowId: null,
        dialogObservedAtMs: null,
      }
    }
    const dialogWindowId = await findDialog(child.pid, Math.min(250, Math.max(1, deadline - now())))
    const observedAtMs = now() - startedAt
    if (dialogWindowId !== null && observedAtMs <= timeoutMs) {
      const roundedObservationMs = Math.max(0, Math.round(observedAtMs))
      return {
        timedOut: false,
        elapsedMs: roundedObservationMs,
        dialogWindowId,
        dialogObservedAtMs: roundedObservationMs,
      }
    }
    if (now() >= deadline) break
    if (child.exitCode !== null || child.signalCode !== null) {
      return {
        timedOut: false,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        dialogWindowId: null,
        dialogObservedAtMs: null,
      }
    }
    await wait(Math.min(100, deadline - now()))
  }
  return {
    timedOut: true,
    elapsedMs: Math.max(0, Math.round(now() - startedAt)),
    dialogWindowId: null,
    dialogObservedAtMs: null,
  }
}

/** Confirm the native startup dialog is no longer visible after sending its dismissal click. */
export async function waitForDialogDismissal(isDialogVisible, timeoutMs, dependencies = {}) {
  const now = dependencies.now ?? (() => performance.now())
  const wait = dependencies.wait ?? delay
  const deadline = now() + timeoutMs
  while (true) {
    const remainingMs = deadline - now()
    if (remainingMs <= 0) break
    const visible = await isDialogVisible(remainingMs)
    const confirmedAt = now()
    if (!visible && confirmedAt <= deadline) return confirmedAt
    const remainingAfterProbeMs = deadline - confirmedAt
    if (remainingAfterProbeMs <= 0) break
    await wait(Math.min(50, remainingAfterProbeMs))
  }
  throw new Error('C01 could not confirm the startup error dialog closed after the dismissal click.')
}

/** Identify xdotool's empty, exit-code-one result for a search with no matching windows. */
export function isNoVisibleX11WindowSearchResult(error) {
  return error?.code === 1
    && String(error.stdout ?? '').trim() === ''
    && String(error.stderr ?? '').trim() === ''
}

/** Parse a successful xdotool search, rejecting empty or malformed window evidence. */
export function isWindowInVisibleX11Search(stdout, windowId) {
  const output = String(stdout ?? '').trim()
  if (output === '') throw new Error('C01 X11 visible-window search returned no window IDs.')
  const windowIds = output.split(/\s+/u)
  if (windowIds.some((id) => !/^\d+$/u.test(id))) {
    throw new Error('C01 X11 visible-window search returned malformed window IDs.')
  }
  return windowIds.includes(windowId)
}

/** Bound one X11 query to the smaller of its remaining budget and the full dismissal window. */
export function boundedX11SearchTimeoutMs(remainingMs) {
  const finiteRemainingMs = Number.isFinite(remainingMs) ? remainingMs : 0
  return Math.max(1, Math.floor(Math.min(DIALOG_DISMISSAL_TIMEOUT_MS, finiteRemainingMs)))
}

/** Run one best-effort X11 diagnostic command with a strict child-process timeout. */
export async function runBoundedX11DiagnosticCommand(
  command,
  args,
  timeoutMs,
  execute = execFileAsync,
  privateRoot = '',
) {
  const boundedTimeoutMs = Math.max(1, Math.floor(Number.isFinite(timeoutMs) ? timeoutMs : 1))
  const startedAt = performance.now()
  try {
    const { stdout = '', stderr = '' } = await execute(command, args, {
      timeout: boundedTimeoutMs,
      killSignal: 'SIGKILL',
    })
    return {
      command,
      args: args.map((value) => sanitizeError(value, privateRoot)),
      timeoutMs: boundedTimeoutMs,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      code: 0,
      signal: null,
      killed: false,
      stdout: sanitizeError(stdout, privateRoot),
      stderr: sanitizeError(stderr, privateRoot),
    }
  } catch (error) {
    const details = error !== null && typeof error === 'object' ? error : {}
    const code = typeof details.code === 'number' || typeof details.code === 'string'
      ? details.code
      : null
    return {
      command,
      args: args.map((value) => sanitizeError(value, privateRoot)),
      timeoutMs: boundedTimeoutMs,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      code,
      signal: typeof details.signal === 'string' ? details.signal : null,
      killed: details.killed === true,
      stdout: sanitizeError(details.stdout ?? '', privateRoot),
      stderr: sanitizeError(details.stderr ?? '', privateRoot),
    }
  }
}

/** Preserve sanitized process details when a held-gate dismissal observation fails. */
export function serializeHeldGateObservationError(error, privateRoot = '') {
  const details = error !== null && typeof error === 'object' ? error : {}
  const code = typeof details.code === 'number' || typeof details.code === 'string'
    ? details.code
    : null
  return {
    message: sanitizeError(error, privateRoot),
    code,
    signal: typeof details.signal === 'string' ? details.signal : null,
    killed: details.killed === true,
    stdout: sanitizeError(details.stdout ?? '', privateRoot),
    stderr: sanitizeError(details.stderr ?? '', privateRoot),
  }
}

/** Observe a product-owned exit after the held-gate dialog has been dismissed. */
export async function waitForOwnedProcessExitAfterDialog(
  child,
  timeoutMs,
  dismissDialog,
  now = () => performance.now(),
) {
  if (child.exitCode !== null || child.signalCode !== null) return null
  let dismissedAt
  let observedExit
  let timer
  let resolveExit
  const exitPromise = new Promise((resolve) => { resolveExit = resolve })
  const handleExit = (code, signal) => {
    observedExit = { code, signal, at: now() }
    if (dismissedAt !== undefined) resolveExit(observedExit)
  }
  child.once('exit', handleExit)
  try {
    const confirmedDismissalAt = await dismissDialog()
    dismissedAt = Number.isFinite(confirmedDismissalAt)
      ? Math.min(now(), confirmedDismissalAt)
      : now()
    if (observedExit !== undefined) {
      return {
        code: observedExit.code,
        signal: observedExit.signal,
        elapsedMs: Math.max(0, Math.round(observedExit.at - dismissedAt)),
      }
    }
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const exit = await Promise.race([exitPromise, timeoutPromise])
    return exit === null
      ? null
      : {
        code: exit.code,
        signal: exit.signal,
        elapsedMs: Math.max(0, Math.round(exit.at - dismissedAt)),
      }
  } finally {
    clearTimeout(timer)
    child.removeListener('exit', handleExit)
  }
}

/** Await a child close without extending the bounded observation window. */
async function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Return the owned SAR Tracker error dialog when startup produced one. */
async function findSarTrackerErrorDialog(pid, timeoutMs = 1_000) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs))
  const deadline = Date.now() + boundedTimeoutMs
  try {
    const commandOptions = { timeout: boundedTimeoutMs, killSignal: 'SIGKILL' }
    const { stdout } = await execFileAsync(
      'xdotool', ['search', '--all', '--onlyvisible', '--pid', String(pid), '--name', '^Error$'], commandOptions,
    )
    for (const windowId of stdout.trim().split(/\s+/u)) {
      if (Date.now() >= deadline) break
      const remainingMs = Math.max(1, deadline - Date.now())
      if (/^\d+$/u.test(windowId) && await isSarTrackerErrorDialog(windowId, remainingMs)) return windowId
    }
  } catch {
    // Headless environments retain the absence as raw evidence.
  }
  return null
}

/** Observe native refusal, renderer absence, logs and profile preservation independently. */
async function observeNativeStartupFault(options, profile, report, profileKind, faultKind, before, filesystem = {}) {
  const port = await findFreePort()
  const appProcess = spawn(options.appPath, [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--ozone-platform=x11',
    '--password-store=basic',
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
    },
    stdio: 'ignore',
  })
  const rendererMonitor = startRendererProcessMonitor(appProcess.pid)
  const launchStartedAt = Date.now()
  let dialogWindowId = null
  let rendererCdpSnapshot = { available: false, pageCount: null }
  let processExit = null
  let dialogAtMs = null
  let observationFailure = null
  try {
    dialogWindowId = await waitForDialogWindow(appProcess, DIALOG_TIMEOUT_MS)
    dialogAtMs = Date.now() - launchStartedAt
    rendererCdpSnapshot = await inspectRendererPages(port)
    await dismissErrorDialog(dialogWindowId, appProcess.pid)
    processExit = await waitForProcessExit(appProcess, 10_000)
  } catch (error) {
    observationFailure = sanitizeError(error, profile)
  } finally {
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGTERM')
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
    }
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGKILL')
  }
  const renderer = await rendererMonitor.stop()
  const after = await snapshotProfileFiles(profile, false)
  const runtimeLog = await readFile(path.join(profile, 'logs', 'runtime.log'), 'utf8').catch(() => '')
  const parsedLog = parseJsonLines(runtimeLog)
  return {
    profileKind,
    observed: dialogWindowId === null ? 'not-observed' : 'native-startup-fault',
    faultKind,
    dialog: {
      observed: dialogWindowId !== null,
      windowName: 'Error',
      operatorTitle: 'SAR Tracker could not start',
    },
    process: {
      pid: appProcess.pid,
      exitCode: processExit?.code ?? appProcess.exitCode,
      signal: processExit?.signal ?? appProcess.signalCode,
      dialogAtMs,
      exitAfterDialogMs: processExit === null || dialogAtMs === null
        ? null
        : Math.max(0, Date.now() - launchStartedAt - dialogAtMs),
    },
    renderer: {
      cdpAvailable: rendererCdpSnapshot.available,
      pageCount: rendererCdpSnapshot.pageCount,
      ...renderer,
    },
    startupLogs: {
      runtimeStartupFailureRecorded: parsedLog.some((entry) => entry?.event === 'startup_failure'),
      unhandledRejectionAbsent: !parsedLog.some((entry) => entry?.event === 'unhandled_rejection'),
    },
    originalFiles: { before, after },
    filesystem,
    ...(observationFailure === null ? {} : { observationFailure }),
  }
}

/** Seed and run the undecryptable legacy-secret profile against the packaged API. */
async function runBadSecretScenario(options, profile, evidenceDir, report) {
  await seedOperationalProfile(profile)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(true))
  await writeJson(path.join(profile, 'secrets.json'), {
    basic: { encrypted: Buffer.from(LEGACY_SECRET_CANARY, 'utf8').toString('base64') },
  })
  const before = await snapshotProfileFiles(profile)
  const schemaVersion = readProfileSchemaVersion(profile)
  let app = null
  let pid = null
  let scenario = null
  const launchStartedAt = Date.now()
  try {
    app = await launchPackaged(options.appPath, profile)
    pid = app.process()?.pid ?? null
    const runtime = await readRuntimeIdentity(app)
    applyRuntimeIdentity(report, runtime, options.appPath)
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 45_000 })
    const shellAtMs = Date.now() - launchStartedAt
    const runtimeFaultVisible = await page.getByTestId('runtime-failed-shell').isVisible().catch(() => false)
    const warning = page.getByTestId('tracking-warning')
    await warning.waitFor({ state: 'attached', timeout: 15_000 })
    const warningText = (await warning.textContent())?.trim() ?? ''
    if (warningText !== BAD_SECRET_WARNING) throw new Error('C01 bad-secret warning text did not match.')
    await page.screenshot({ path: path.join(evidenceDir, 'c01-bad-secret-normal-shell.png'), fullPage: true })
    const settingsBridge = await page.evaluate(async () => {
      const settings = await window.sartrackerElectron?.loadAppSettings?.()
      return {
        available: settings !== undefined,
        secretPresent: settings?.dataSource?.secretPresent === true,
      }
    })
    await page.getByTestId('open-settings-workspace').click({ force: true })
    await page.getByTestId('settings-workspace').waitFor({ state: 'attached', timeout: 15_000 })
    const replacementField = page.getByTestId('settings-provider-secret')
    await replacementField.waitFor({ state: 'visible', timeout: 10_000 })
    await replacementField.fill(REENTRY_SECRET_CANARY)
    await page.screenshot({ path: path.join(evidenceDir, 'c01-bad-secret-reentry.png'), fullPage: true })
    scenario = {
      profileKind: 'legacy-bad-secret',
      store: { schemaVersion },
      shellReached: true,
      runtimeFaultVisible,
      warning: {
        exactText: warningText,
        actionable: true,
        actions: ['open-settings-workspace', 'settings-provider-secret'],
      },
      settingsBridge: {
        ...settingsBridge,
        replacementFieldVisible: true,
      },
      provider: { networkContactAttempted: false },
      originalFiles: { before, after: before },
      process: { pid, shellAtMs, closed: false },
    }
  } finally {
    const closed = await closeElectronApp(app)
    const after = await snapshotProfileFiles(profile)
    // The profile is disposable, but the raw unchanged file set is retained in
    // the scenario object. The caller receives no profile path or secret bytes.
    if (scenario !== null) {
      scenario.process.closed = closed
      scenario.originalFiles.after = after
    }
  }
  return scenario ?? { profileKind: 'legacy-bad-secret', failure: 'C01 bad-secret profile did not produce observations.' }
}

/** Seed and run malformed settings through the renderer fault/export boundary. */
async function runCorruptSettingsScenario(options, profile, evidenceDir, report) {
  await seedOperationalProfile(profile)
  await writeFile(path.join(profile, 'settings.json'), '{"unterminated":', 'utf8')
  const before = await snapshotProfileFiles(profile)
  const schemaVersion = readProfileSchemaVersion(profile)
  let app = null
  let pid = null
  let scenario = null
  const launchStartedAt = Date.now()
  try {
    app = await launchPackaged(options.appPath, profile)
    pid = app.process()?.pid ?? null
    const runtime = await readRuntimeIdentity(app)
    applyRuntimeIdentity(report, runtime, options.appPath)
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('runtime-failed-shell').waitFor({ state: 'attached', timeout: 45_000 })
    const faultShellAtMs = Date.now() - launchStartedAt
    const faultMessage = (await page.getByTestId('runtime-fault-detail').textContent())?.trim() ?? ''
    await page.getByTestId('runtime-fault-export-support-bundle').click()
    const exportPathElement = page.getByTestId('runtime-fault-export-path')
    await exportPathElement.waitFor({ state: 'visible', timeout: 15_000 })
    const exportedPath = (await exportPathElement.textContent())?.trim() ?? ''
    const relativePath = path.relative(profile, exportedPath)
    const supportText = await readFile(exportedPath, 'utf8')
    await page.screenshot({ path: path.join(evidenceDir, 'c01-corrupt-settings-fault-export.png'), fullPage: true })
    scenario = {
      profileKind: 'corrupt-settings',
      store: { schemaVersion },
      shellReached: true,
      faultShellVisible: true,
      faultMessagePresent: faultMessage !== '',
      supportExport: {
        attempted: true,
        completed: true,
        pathRelative: relativePath,
        settingsStatus: supportText.includes('settings status: unavailable') ? 'unavailable' : 'unknown',
        startupFaultSection: supportText.includes('[startup-fault]'),
        rawSettingsRetained: supportText.includes('{"unterminated":'),
      },
      originalFiles: { before, after: before },
      process: { pid, faultShellAtMs, closed: false },
    }
  } finally {
    const closed = await closeElectronApp(app)
    const after = await snapshotProfileFiles(profile)
    if (scenario !== null) {
      scenario.process.closed = closed
      scenario.originalFiles.after = after
    }
  }
  return scenario ?? { profileKind: 'corrupt-settings', failure: 'C01 corrupt-settings profile did not produce observations.' }
}

/** Run the native newer-schema refusal with an independent process/renderer observer. */
async function runNewerSchemaScenario(options, profile, report) {
  await seedNewerSchemaProfile(profile, CURRENT_SCHEMA_VERSION + 1)
  await writeJson(path.join(profile, 'settings.json'), syntheticSettings(false))
  const before = await snapshotProfileFiles(profile)
  const port = await findFreePort()
  const appProcess = spawn(options.appPath, [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--ozone-platform=x11',
    '--password-store=basic',
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
    },
    stdio: 'ignore',
  })
  const rendererMonitor = startRendererProcessMonitor(appProcess.pid)
  const launchStartedAt = Date.now()
  let dialogWindowId = null
  let rendererCdpSnapshot = { available: false, pageCount: null }
  let processExit = null
  let dialogAtMs = null
  try {
    dialogWindowId = await waitForDialogWindow(appProcess, DIALOG_TIMEOUT_MS)
    dialogAtMs = Date.now() - launchStartedAt
    rendererCdpSnapshot = await inspectRendererPages(port)
    await dismissErrorDialog(dialogWindowId, appProcess.pid)
    processExit = await waitForProcessExit(appProcess, 10_000)
  } finally {
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGTERM')
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
    }
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGKILL')
  }
  const renderer = await rendererMonitor.stop()
  const after = await snapshotProfileFiles(profile)
  const expectedMessage = `Cannot open mission store created by newer mission store schema ${CURRENT_SCHEMA_VERSION + 1}; this build supports schema ${CURRENT_SCHEMA_VERSION}.`
  const crashEntries = await readJsonArray(path.join(profile, 'crashes', 'crash-log.json'))
  const runtimeLog = await readFile(path.join(profile, 'logs', 'runtime.log'), 'utf8').catch(() => '')
  const parsedLog = parseJsonLines(runtimeLog)
  return {
    profileKind: 'newer-schema',
    store: { schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
    newerSchemaVersion: CURRENT_SCHEMA_VERSION + 1,
    supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
    dialog: {
      observed: dialogWindowId !== null,
      windowName: 'Error',
      operatorTitle: 'SAR Tracker could not start',
    },
    process: {
      exitCode: processExit?.code ?? appProcess.exitCode,
      signal: processExit?.signal ?? appProcess.signalCode,
      dialogAtMs,
      exitAfterDialogMs: processExit === null || dialogAtMs === null
        ? null
        : Math.max(0, Date.now() - launchStartedAt - dialogAtMs),
    },
    renderer: {
      cdpAvailable: rendererCdpSnapshot.available,
      pageCount: rendererCdpSnapshot.pageCount,
      ...renderer,
    },
    startupLogs: {
      expectedMessagePresent: crashEntries.some((entry) =>
        entry?.kind === 'startupFailure' && typeof entry?.summary === 'string' && entry.summary.includes(expectedMessage)),
      runtimeStartupFailureRecorded: parsedLog.some((entry) => entry?.event === 'startup_failure'),
      unhandledRejectionAbsent: !parsedLog.some((entry) => entry?.event === 'unhandled_rejection'),
    },
    originalFiles: { before, after },
  }
}

/** Seed a current valid mission store and its rolling backup without operational rows. */
async function seedOperationalProfile(profile) {
  await mkdir(profile, { recursive: true })
  const store = createElectronMissionStore({ userDataPath: profile })
  try {
    await store.syncBackup('c01-startup-profile-seed')
  } finally {
    await store.prepareClose()
    store.close()
  }
}

/** Seed only the metadata needed for a real newer-schema refusal. */
async function seedNewerSchemaProfile(profile, schemaVersion) {
  await mkdir(profile, { recursive: true })
  const databasePath = path.join(profile, 'mission-store.sqlite')
  const database = new Database(databasePath)
  try {
    database.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('schema_version', String(schemaVersion))
  } finally {
    database.close()
  }
}

/** Read only the bounded metadata schema marker from a disposable profile. */
function readProfileSchemaVersion(profile) {
  const database = new Database(path.join(profile, 'mission-store.sqlite'), {
    readonly: true,
    fileMustExist: true,
  })
  try {
    const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
    const schemaVersion = Number(row?.value)
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error('C01 profile schema metadata is missing or invalid.')
    }
    return schemaVersion
  } finally {
    database.close()
  }
}

/** Return synthetic settings that cannot contact a real provider. */
function syntheticSettings(autoConnect) {
  return {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 30,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl: SYNTHETIC_BASE_URL,
      authMode: 'basic',
      email: 'c01-synthetic-operator',
      autoConnect,
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
  }
}

/** Launch the exact supplied executable with network and user-data custody fixed. */
async function launchPackaged(appPath, userDataDir) {
  return electron.launch({
    executablePath: appPath,
    args: ['--ignore-gpu-blocklist'],
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
    timeout: 30_000,
  })
}

/** Read the packaged Electron identity from the real main-process API. */
async function readRuntimeIdentity(app) {
  const runtime = await app.evaluate(({ app: runningApp }) => ({
    appPath: runningApp.getAppPath(),
    isPackaged: runningApp.isPackaged,
    electron: process.versions.electron,
    node: process.versions.node,
    modules: process.versions.modules,
  }))
  if (runtime.isPackaged !== true || !isAbsolutePath(runtime.appPath) || !runtime.appPath.endsWith('.asar')) {
    throw new Error('C01 startup probe requires a packaged Electron ASAR runtime.')
  }
  return {
    ...runtime,
    asarSha256: await sha256File(runtime.appPath),
  }
}

/** Store one runtime identity and archive digest from the first real package session. */
function applyRuntimeIdentity(report, runtime, executablePath) {
  report.runtime ??= {
    electron: runtime.electron,
    node: runtime.node,
    modules: runtime.modules,
  }
  report.app.isPackaged = runtime.isPackaged
  report.app.appPath = runtime.appPath
  report.app.asarSha256 = runtime.asarSha256
  report.app.executableSha256 = report.app.executableSha256 || executablePath
}

/** Capture only the mission-store, backup, settings and legacy credential file set. */
async function snapshotProfileFiles(profile, requireDatabase = true) {
  const entries = await readdir(profile, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && (
      entry.name.startsWith('mission-store') ||
      entry.name === 'settings.json' ||
      entry.name === 'secrets.json'
    ))
    .map((entry) => entry.name)
    .sort()
  const snapshot = {}
  for (const name of names) {
    const filePath = path.join(profile, name)
    const fileStats = await stat(filePath)
    snapshot[name] = {
      bytes: fileStats.size,
      sha256: await sha256File(filePath),
    }
  }
  if (requireDatabase && !Object.hasOwn(snapshot, 'mission-store.sqlite')) {
    throw new Error('C01 disposable profile has no mission-store.sqlite.')
  }
  return snapshot
}

/** Compare bounded profile snapshots without reading operational file contents. */
function snapshotsEqual(before, after) {
  return JSON.stringify(before ?? {}) === JSON.stringify(after ?? {})
}

/** Close only the Electron process owned by this probe. */
async function closeElectronApp(app) {
  if (app === null) return false
  const processHandle = app.process()
  let timer
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('C01 packaged process did not close within the bounded timeout.')), APP_CLOSE_TIMEOUT_MS)
      }),
    ])
    return true
  } catch {
    if (processHandle && !processHandle.killed) processHandle.kill('SIGTERM')
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Monitor all Linux renderer descendants below the native refusal process. */
function startRendererProcessMonitor(rootPid) {
  let stopped = false
  let maximum = 0
  let scanCount = 0
  let scanError = null
  const completion = (async () => {
    while (!stopped) {
      try {
        const processes = await readLinuxProcessTable()
        maximum = Math.max(maximum, countDescendantElectronRenderers(processes, rootPid))
        scanCount += 1
      } catch (error) {
        scanError = sanitizeError(error)
        stopped = true
      }
      if (!stopped) await delay(50)
    }
  })()
  return {
    async stop() {
      stopped = true
      await completion
      return { maximum, scanCount, scanError }
    },
  }
}

/** Read the process table without shell interpolation. */
async function readLinuxProcessTable() {
  const entries = await readdir('/proc', { withFileTypes: true })
  const processes = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map(async (entry) => {
      try {
        const [stat, commandLine] = await Promise.all([
          readFile(path.join('/proc', entry.name, 'stat'), 'utf8'),
          readFile(path.join('/proc', entry.name, 'cmdline'), 'utf8'),
        ])
        const commandEnd = stat.lastIndexOf(') ')
        const fields = commandEnd === -1 ? [] : stat.slice(commandEnd + 2).trim().split(/\s+/u)
        const parentPid = Number(fields[1])
        return Number.isInteger(parentPid) ? {
          pid: Number(entry.name),
          parentPid,
          command: commandLine.replaceAll('\u0000', ' ').trim(),
        } : null
      } catch {
        return null
      }
    }))
  return processes.filter((entry) => entry !== null)
}

/** Wait for the SAR Tracker native startup refusal dialog. */
async function waitForDialog(appProcess, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error('C01 newer-schema process exited before its native refusal dialog appeared.')
    }
    try {
      if (!Number.isSafeInteger(appProcess.pid) || appProcess.pid <= 0) throw new Error('Owned startup process PID is unavailable.')
      const { stdout } = await execFileAsync('xdotool', ['search', '--all', '--onlyvisible', '--pid', String(appProcess.pid), '--name', '^Error$'])
      for (const windowId of stdout.trim().split(/\s+/u)) {
        if (/^\d+$/u.test(windowId) && await isSarTrackerErrorDialog(windowId)) return windowId
      }
    } catch {
      // Retry until the bounded native-dialog deadline.
    }
    await delay(250)
  }
  throw new Error('C01 timed out waiting for the newer-schema refusal dialog.')
}

/** Keep the historical helper name used by native-fault observers. */
async function waitForDialogWindow(appProcess, timeoutMs) {
  return waitForDialog(appProcess, timeoutMs)
}

/** Wait for one owned child process to exit without extending the observation window. */
async function waitForProcessExit(appProcess, timeoutMs) {
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
    return { code: appProcess.exitCode, signal: appProcess.signalCode }
  }
  return new Promise((resolve, reject) => {
    let timer
    const finish = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
    appProcess.once('exit', (code, signal) => finish({ code, signal }))
    timer = setTimeout(() => reject(new Error('C01 native startup process did not exit within the bounded timeout.')), timeoutMs)
  })
}

/** Reject unrelated desktop error windows by class and minimum geometry. */
async function isSarTrackerErrorDialog(windowId, timeoutMs = 1_000) {
  try {
    const commandOptions = { timeout: timeoutMs, killSignal: 'SIGKILL' }
    const [{ stdout: windowClass }, { stdout: geometry }] = await Promise.all([
      execFileAsync('xprop', ['-id', windowId, 'WM_CLASS'], commandOptions),
      execFileAsync('xdotool', ['getwindowgeometry', '--shell', windowId], commandOptions),
    ])
    const width = Number(/^WIDTH=(\d+)$/mu.exec(geometry)?.[1])
    const height = Number(/^HEIGHT=(\d+)$/mu.exec(geometry)?.[1])
    return /"sartracker-web",\s*"Sartracker-web"/u.test(windowClass) && width >= 300 && height >= 100
  } catch {
    return false
  }
}

/** Dismiss the native dialog using verified window-relative geometry. */
async function dismissErrorDialog(windowId, pid, diagnostics = null) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Refusal dialog requires the owned process PID.')
  const { stdout: observedPid } = await execFileAsync('xdotool', ['getwindowpid', windowId])
  if (observedPid.trim() !== String(pid)) throw new Error('Refusing to dismiss another process\'s dialog.')
  const { stdout: geometry } = await execFileAsync('xdotool', ['getwindowgeometry', '--shell', windowId])
  const width = Number(/^WIDTH=(\d+)$/mu.exec(geometry)?.[1])
  const height = Number(/^HEIGHT=(\d+)$/mu.exec(geometry)?.[1])
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('C01 could not read refusal dialog geometry.')
  const diagnosticRecord = diagnostics === null ? null : {
    schema: 'sartracker-c01-x11-dismissal-diagnostics-v1',
    gateKind: diagnostics.gateKind,
    pid,
    windowId,
    geometry: { width, height },
    click: { x: width - 52, y: height - 42 },
    beforeClickScreenshot: await captureX11RootScreenshot(
      diagnostics.evidenceDir,
      `x11-${diagnostics.gateKind}-before-click.png`,
      diagnostics.privateRoot,
    ),
  }
  await execFileAsync('xdotool', [
    'mousemove', '--window', windowId, String(width - 52), String(height - 42), 'click', '1',
  ])
  try {
    return await waitForDialogDismissal(
      (remainingMs) => isErrorDialogVisible(windowId, pid, remainingMs),
      DIALOG_DISMISSAL_TIMEOUT_MS,
    )
  } catch (error) {
    if (diagnosticRecord !== null) {
      diagnosticRecord.observationFailure = serializeHeldGateObservationError(error, diagnostics.privateRoot)
      diagnosticRecord.afterClickScreenshot = await captureX11RootScreenshot(
        diagnostics.evidenceDir,
        `x11-${diagnostics.gateKind}-after-click.png`,
        diagnostics.privateRoot,
      )
      diagnosticRecord.postFailureCommands = await Promise.all([
        runBoundedX11DiagnosticCommand(
          'xdotool', ['search', '--all', '--onlyvisible', '--pid', String(pid), '--name', '^Error$'], 350,
          execFileAsync, diagnostics.privateRoot,
        ),
        runBoundedX11DiagnosticCommand(
          'xdotool', ['getwindowgeometry', '--shell', windowId], 350, execFileAsync, diagnostics.privateRoot,
        ),
        runBoundedX11DiagnosticCommand(
          'xprop', ['-id', windowId, 'WM_NAME', 'WM_CLASS', 'WM_STATE', '_NET_WM_PID'], 350,
          execFileAsync, diagnostics.privateRoot,
        ),
        runBoundedX11DiagnosticCommand(
          'xwininfo', ['-id', windowId], 350, execFileAsync, diagnostics.privateRoot,
        ),
      ])
      await writeJson(
        path.join(diagnostics.evidenceDir, 'x11-dismissal-diagnostics.json'), diagnosticRecord,
      ).catch(() => undefined)
    }
    throw error
  }
}

/** Capture the synthetic C01 display without allowing image inspection to block the probe. */
async function captureX11RootScreenshot(evidenceDir, filename, privateRoot) {
  return runBoundedX11DiagnosticCommand(
    'import', ['-window', 'root', path.join(evidenceDir, filename)], 750, execFileAsync, privateRoot,
  )
}

/** Search for the owned visible X11 error dialog so a successful click is not mistaken for dismissal. */
async function isErrorDialogVisible(windowId, pid, remainingMs) {
  try {
    const { stdout } = await execFileAsync('xdotool', [
      'search', '--all', '--onlyvisible', '--pid', String(pid), '--name', '^Error$',
    ], {
        timeout: boundedX11SearchTimeoutMs(remainingMs),
        killSignal: 'SIGKILL',
      })
    return isWindowInVisibleX11Search(stdout, windowId)
  } catch (error) {
    if (isNoVisibleX11WindowSearchResult(error)) return false
    throw error
  }
}

/** Count renderer pages exposed by the live CDP endpoint. */
async function inspectRendererPages(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return { available: false, pageCount: null }
    const targets = await response.json()
    return Array.isArray(targets)
      ? { available: true, pageCount: targets.filter((target) => target?.type === 'page').length }
      : { available: false, pageCount: null }
  } catch {
    return { available: false, pageCount: null }
  }
}

/** Read crash history as a bounded array, retaining malformed absence as empty. */
async function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Parse durable runtime log lines without retaining private detail. */
function parseJsonLines(contents) {
  return contents.split('\n').filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line)
      return [parsed]
    } catch {
      return []
    }
  })
}

/** Allocate an isolated local CDP port. */
async function findFreePort() {
  const net = await import('node:net')
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address !== 'object' || address === null) throw new Error('C01 could not allocate a CDP port.')
  return address.port
}

/** Verify the supplied probe options before creating any profile or process. */
function validateOptions(options) {
  if (!isAbsolutePath(options?.appPath) || !isAbsolutePath(options?.evidenceDir)
      || !SHA1.test(options?.expectedHead ?? '') || !SHA256.test(options?.expectedAppSha256 ?? '')) {
    throw new Error('C01 startup probe options are invalid.')
  }
  if (options?.enospcMount !== undefined && !isAbsolutePath(options.enospcMount)) {
    throw new Error('C01 startup probe --enospc-mount must be absolute when supplied.')
  }
}

/** Reject an evidence directory that could conceal stale files or a symlink. */
async function assertFreshEvidenceDirectory(directory) {
  await mkdir(directory, { recursive: true })
  if ((await readdir(directory)).length > 0) throw new Error('C01 evidence directory must be empty.')
}

/** Read source identity without exposing the checkout path. */
export function readStartupSourceIdentity(expectedHead) {
  const head = gitValue(['rev-parse', 'HEAD'])
  const tree = gitValue(['rev-parse', 'HEAD^{tree}'])
  const dirty = gitValue(['status', '--porcelain'])
  return { head, expectedHead, tree, dirty: dirty !== '' }
}

/** Hash one regular file without returning its contents. */
async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

/** Execute one bounded git identity read. */
function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** Write deterministic JSON evidence. */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Read one required argument value. */
function readArgument(argv, index, name) {
  const value = argv[index]
  if (typeof value !== 'string' || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

/** Return whether a path is absolute on POSIX or Windows. */
function isAbsolutePath(value) {
  return typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/])/u.test(value)
}

/** Replace private disposable profile paths and bound error output. */
function sanitizeError(error, privateRoot = '') {
  const message = String(error instanceof Error ? error.message : error)
  return (privateRoot === '' ? message : message.replaceAll(privateRoot, '[disposable-profile]'))
    .replaceAll(LEGACY_SECRET_CANARY, '[legacy-ciphertext-redacted]')
    .replaceAll(REENTRY_SECRET_CANARY, '[reentry-secret-redacted]')
    .replace(/\s+/gu, ' ')
    .slice(0, 500)
}

/** Sleep for one bounded polling interval. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Run the producer only when invoked as its CLI entry point. */
async function main() {
  const options = parseStartupProbeArgs(process.argv.slice(2))
  const outcome = await runStartupAdmissionProbe(options)
  console.log(JSON.stringify({ result: outcome.validation.status, receipt: path.join(options.evidenceDir, 'receipt.json') }))
  if (!outcome.validation.valid) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The top-level catch above retains a bounded CLI error without exposing
  // fixture secret values.
  main().catch((error) => {
    console.error(`C01 startup probe: ${sanitizeError(error)}`)
    process.exitCode = 1
  })
}
