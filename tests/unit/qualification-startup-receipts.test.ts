import { describe, expect, it } from 'vitest'

import {
  C01_STARTUP_PROOF_MODE,
  C01_STARTUP_PROFILE_KINDS,
  STARTUP_PROBE_DESCRIPTOR,
  validateStartupContractEvidence,
} from '../../scripts/qualification/startup-receipts.mjs'
import {
  isActionableHeldGateObservation,
  isBoundedHeldGateTimeoutWithoutAction,
  parseStartupProbeArgs,
  waitForOwnedProcessOrTimeout,
} from '../../scripts/qualification/startup-probe.mjs'
import { validateLegacyStartupReceipt } from '../../scripts/qualification/legacy-startup-receipts.mjs'

const SHA1 = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const EXECUTABLE = 'c'.repeat(64)
const ASAR = 'd'.repeat(64)
const DB = 'e'.repeat(64)
const BACKUP = 'f'.repeat(64)

const expected = {
  proofMode: C01_STARTUP_PROOF_MODE,
  source: { expectedHead: SHA1, tree: TREE },
  artifact: {
    packagedExecutableSha256: EXECUTABLE,
    packagedApplicationArchiveSha256: ASAR,
  },
  process: { tier: C01_STARTUP_PROOF_MODE },
  workload: {
    supportedSchemaVersion: 13,
    profileKinds: [...C01_STARTUP_PROFILE_KINDS],
  },
}

function snapshots(databaseSha256 = DB, backupSha256 = BACKUP) {
  return {
    'mission-store.sqlite': { bytes: 4096, sha256: databaseSha256 },
    'mission-store.backup.sqlite': { bytes: 4096, sha256: backupSha256 },
  }
}

function normalScenario(profileKind: string, overrides: Record<string, unknown> = {}) {
  return {
    profileKind,
    observed: 'normal-shell',
    shellReached: true,
    runtimeFaultVisible: false,
    store: { schemaVersion: 13 },
    provider: { networkContactAttempted: false },
    originalFiles: { before: snapshots(), after: snapshots() },
    process: { pid: 103, shellAtMs: 1400, closed: true },
    ...overrides,
  }
}

function nativeFaultScenario(profileKind: string, faultKind: string, overrides: Record<string, unknown> = {}) {
  return {
    profileKind,
    observed: 'native-startup-fault',
    faultKind,
    dialog: {
      observed: true,
      windowName: 'Error',
      operatorTitle: 'SAR Tracker could not start',
    },
    process: { pid: 110, exitCode: 1, signal: null, dialogAtMs: 1000, exitAfterDialogMs: 220 },
    renderer: { cdpAvailable: true, pageCount: 0, maximum: 0, scanCount: 3, scanError: null },
    startupLogs: {
      runtimeStartupFailureRecorded: true,
      unhandledRejectionAbsent: true,
    },
    originalFiles: { before: snapshots(), after: snapshots() },
    ...overrides,
  }
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schema: STARTUP_PROBE_DESCRIPTOR.schema,
    contractId: 'C01',
    proofMode: C01_STARTUP_PROOF_MODE,
    failures: [],
    source: { head: SHA1, expectedHead: SHA1, tree: TREE, dirty: false },
    app: {
      suppliedPath: '/evidence/SARTracker.deb/usr/bin/sartracker-web',
      executableSha256: EXECUTABLE,
      isPackaged: true,
      appPath: '/evidence/SARTracker.deb/resources/app.asar',
      asarSha256: ASAR,
    },
    runtime: { electron: '37.0.0', node: '22.0.0', modules: '138' },
    process: { tier: C01_STARTUP_PROOF_MODE },
    scenarios: {
      'absent-schema': {
        profileKind: 'absent-schema',
        observed: 'created-current-schema',
        beforeFiles: { settings: true, database: false },
        afterStore: { schemaVersion: 13, databaseCreated: true },
        shellReached: true,
        runtimeFaultVisible: false,
        provider: { networkContactAttempted: false },
        process: { pid: 104, shellAtMs: 1500, closed: true },
      },
      'valid-schema': normalScenario('valid-schema'),
      badSecret: {
        profileKind: 'legacy-bad-secret',
        store: { schemaVersion: 13 },
        shellReached: true,
        runtimeFaultVisible: false,
        warning: {
          exactText:
            'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.',
          actionable: true,
          actions: ['open-settings-workspace', 'settings-provider-secret'],
        },
        settingsBridge: { available: true, secretPresent: true, replacementFieldVisible: true },
        provider: { networkContactAttempted: false },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 101, shellAtMs: 1200, closed: true },
      },
      corruptSettings: {
        profileKind: 'corrupt-settings',
        store: { schemaVersion: 13 },
        shellReached: true,
        faultShellVisible: true,
        faultMessagePresent: true,
        supportExport: {
          attempted: true,
          completed: true,
          pathRelative: 'diagnostics/startup-fault-support-bundle-2026.txt',
          settingsStatus: 'unavailable',
          startupFaultSection: true,
          rawSettingsRetained: false,
        },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 102, faultShellAtMs: 1300, closed: true },
      },
      'corrupt-schema': nativeFaultScenario('corrupt-schema', 'corrupt-store'),
      newerSchema: {
        profileKind: 'newer-schema',
        newerSchemaVersion: 14,
        supportedSchemaVersion: 13,
        dialog: {
          observed: true,
          windowName: 'Error',
          operatorTitle: 'SAR Tracker could not start',
        },
        process: { exitCode: 1, signal: null, dialogAtMs: 900, exitAfterDialogMs: 220 },
        renderer: { cdpAvailable: true, pageCount: 0, maximum: 0, scanCount: 3, scanError: null },
        startupLogs: {
          expectedMessagePresent: true,
          runtimeStartupFailureRecorded: true,
          unhandledRejectionAbsent: true,
        },
        originalFiles: { before: snapshots(), after: snapshots() },
      },
      'oversized-store': {
        profileKind: 'oversized-store',
        observed: 'bounded-admission',
        admission: { status: 'actionable-fault', originalPreserved: true, bounded: true },
        workload: {
          observations: [
            { requestedBytes: 8 * 1024 * 1024, observedBytes: 8 * 1024 * 1024, outcome: 'actionable-fault' },
            { requestedBytes: 3_700_000_000, observedBytes: 3_700_000_000, outcome: 'actionable-fault' },
          ],
        },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 105, closed: true, faultShellAtMs: 1700 },
        fieldProcess: { pid: 111, closed: true, shellAtMs: 1900 },
      },
      'permission-fault': nativeFaultScenario('permission-fault', 'permission', {
        filesystem: { databaseMode: 0o444, directoryMode: 0o555, restored: true },
      }),
      'disk-full': nativeFaultScenario('disk-full', 'disk-full', {
        cleanup: { fillerRemoved: true, profileRemoved: true },
        precondition: {
          kind: 'bounded-enospc',
          status: 'READY',
          observed: true,
          deviceDistinct: true,
          totalBytes: 16 * 1024 * 1024,
          availableBytes: 8 * 1024 * 1024,
        },
        filesystem: {
          errorCode: 'ENOSPC',
          originalPreserved: true,
          physical: true,
          injectionAttempted: true,
          synthetic: false,
          fill: { errorCode: 'ENOSPC', writtenBytes: 8 * 1024 * 1024 },
        },
      }),
      'held-store-gate': {
        profileKind: 'held-store-gate',
        observed: 'actionable-fault',
        gate: { kind: 'store', held: true, bounded: true, action: 'reload-or-contact-support', timeoutMs: 20_000, response: 'native-error-dialog', dialogObserved: true, dialogDismissed: true, lateDialogAfterTimeout: false, lockHolder: { pid: 110, closed: true } },
        cleanup: { lockHolderClosed: true, heldPathRemoved: false },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 106, closed: true, exitCode: 1, signal: null, productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50, timeoutMs: 20_000, timedOut: false, observationElapsedMs: 1800, forcedKill: false, dialogObserved: true, dialogDismissed: true, dialogObservedAtMs: 1800, lateDialogAfterTimeout: false, faultShellAtMs: 1800 },
      },
      'held-diagnostics-gate': {
        profileKind: 'held-diagnostics-gate',
        observed: 'actionable-fault',
        gate: { kind: 'diagnostics', held: true, bounded: true, action: 'reload-or-contact-support', timeoutMs: 20_000, response: 'native-error-dialog', dialogObserved: true, dialogDismissed: true, lateDialogAfterTimeout: false },
        cleanup: { heldPathRemoved: true, lockHolderClosed: false },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 108, closed: true, exitCode: 1, signal: null, productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50, timeoutMs: 20_000, timedOut: false, observationElapsedMs: 1800, forcedKill: false, dialogObserved: true, dialogDismissed: true, dialogObservedAtMs: 1800, lateDialogAfterTimeout: false, faultShellAtMs: 1800 },
      },
      'held-crash-gate': {
        profileKind: 'held-crash-gate',
        observed: 'actionable-fault',
        gate: { kind: 'crash', held: true, bounded: true, action: 'reload-or-contact-support', timeoutMs: 20_000, response: 'native-error-dialog', dialogObserved: true, dialogDismissed: true, lateDialogAfterTimeout: false },
        cleanup: { heldPathRemoved: true, lockHolderClosed: false },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 109, closed: true, exitCode: 1, signal: null, productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50, timeoutMs: 20_000, timedOut: false, observationElapsedMs: 1800, forcedKill: false, dialogObserved: true, dialogDismissed: true, dialogObservedAtMs: 1800, lateDialogAfterTimeout: false, faultShellAtMs: 1800 },
      },
      'active-recoverable': {
        profileKind: 'active-recoverable',
        observed: 'recoverable-mission',
        shellReached: true,
        runtimeFaultVisible: false,
        store: { schemaVersion: 13, missionStatus: 'active', missionId: 'c01-active-mission' },
        recovery: { activeMissionVisible: true, missionId: 'c01-active-mission', noDataLoss: true },
        originalFiles: { before: snapshots(), after: snapshots() },
        process: { pid: 107, shellAtMs: 1600, closed: true },
      },
    },
    custody: {
      rawSecretsIncluded: false,
      networkContactAttempted: false,
      profilesDisposable: true,
      sourceProfileRetained: false,
    },
    ...overrides,
    result: 'forged-pass',
  }
}

describe('qualification C01 startup receipt validator', () => {
  it('versions the stronger held-gate and uncovered-axis observations as C01 v3', () => {
    expect(STARTUP_PROBE_DESCRIPTOR.schema).toBe('sartracker-c01-startup-admission-v3')
    const previousVersion = report({ schema: 'sartracker-c01-startup-admission-v2' })

    const result = validateStartupContractEvidence('C01', previousVersion, expected)

    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/schema or contract identity is invalid/iu)
  })

  it('rejects held-gate dialogs first observed after the fixed response deadline', () => {
    const late = report()
    const scenario = (late.scenarios as Record<string, Record<string, Record<string, unknown>>>)['held-store-gate']!
    scenario.process!.dialogObservedAtMs = 20_001
    scenario.process!.faultShellAtMs = 20_001

    const result = validateStartupContractEvidence('C01', late, expected)

    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/held-store-gate.*20.?000|20.?000.*held-store-gate/iu)
  })

  it.each([
    ['harness signal termination', { exitCode: null, signal: 'SIGTERM', forcedKill: false }],
    ['a forced kill', { exitCode: 1, signal: null, forcedKill: true }],
    ['a non-failure application exit', { exitCode: 0, signal: null, forcedKill: false }],
    ['a missing post-dismissal exit time', { exitCode: 1, signal: null, forcedKill: false, exitAfterDialogMs: null }],
  ])('rejects held-gate evidence without the product-owned exit (%s)', (_label, overrides) => {
    const held = report()
    const scenario = (held.scenarios as Record<string, Record<string, Record<string, unknown>>>)['held-store-gate']!
    scenario.process = { ...scenario.process, ...overrides }

    const result = validateStartupContractEvidence('C01', held, expected)

    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/held-store-gate|exit/iu)
  })

  it('requires the observed timeout and preserves late-dialog timeout negatives', () => {
    expect(isBoundedHeldGateTimeoutWithoutAction({
      earlyExit: { timedOut: false }, dialogWindowId: null, forcedKill: true,
    })).toBe(false)
    expect(isBoundedHeldGateTimeoutWithoutAction({
      earlyExit: { timedOut: true }, dialogWindowId: null, forcedKill: false,
    })).toBe(true)
    expect(isBoundedHeldGateTimeoutWithoutAction({
      earlyExit: { timedOut: true }, dialogWindowId: '123', forcedKill: false,
    })).toBe(true)
    expect(isBoundedHeldGateTimeoutWithoutAction({
      earlyExit: { timedOut: false }, dialogWindowId: '123', forcedKill: true,
    })).toBe(false)
    expect(isBoundedHeldGateTimeoutWithoutAction({
      earlyExit: { timedOut: false }, dialogWindowId: null, forcedKill: false,
    })).toBe(false)
  })

  it('accepts only a dialog observed within the supplied polling bound', () => {
    const observed = { earlyExit: { timedOut: false }, dialogWindowId: '123', timeoutMs: 5_000 }
    expect(isActionableHeldGateObservation({ ...observed, dialogObservedAtMs: 4_999 })).toBe(true)
    expect(isActionableHeldGateObservation({ ...observed, dialogObservedAtMs: 5_001 })).toBe(false)
    expect(isActionableHeldGateObservation({ ...observed, earlyExit: { timedOut: true }, dialogObservedAtMs: 1_000 })).toBe(false)
    expect(isActionableHeldGateObservation({ ...observed, dialogWindowId: null, dialogObservedAtMs: null })).toBe(false)
  })

  it('polls the owned dialog boundary before deciding the held-gate outcome', async () => {
    let now = 0
    const clock = () => now
    const wait = async (milliseconds: number) => { now += milliseconds }
    const liveChild = { pid: 101, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null }
    const inBound = await waitForOwnedProcessOrTimeout(liveChild, 5_000, 0, {
      now: clock, wait, findDialog: async () => { now = 1_000; return '501' },
    })
    expect(inBound).toMatchObject({ timedOut: false, dialogWindowId: '501', dialogObservedAtMs: 1_000 })
    expect(isActionableHeldGateObservation({ earlyExit: inBound, dialogWindowId: inBound.dialogWindowId, dialogObservedAtMs: inBound.dialogObservedAtMs, timeoutMs: 5_000 })).toBe(true)

    now = 0
    const late = await waitForOwnedProcessOrTimeout(liveChild, 5_000, 0, {
      now: clock, wait, findDialog: async () => { now = 5_001; return '502' },
    })
    expect(late).toMatchObject({ timedOut: true, dialogWindowId: null, dialogObservedAtMs: null })
    expect(isBoundedHeldGateTimeoutWithoutAction({ earlyExit: late })).toBe(true)

    now = 0
    const exitedChild = { pid: 103, exitCode: 0, signalCode: null as NodeJS.Signals | null }
    const earlyExit = await waitForOwnedProcessOrTimeout(exitedChild, 5_000, 0, {
      now: clock, wait, findDialog: async () => null,
    })
    expect(earlyExit).toMatchObject({ timedOut: false, dialogWindowId: null })
    expect(isBoundedHeldGateTimeoutWithoutAction({ earlyExit })).toBe(false)
  })

  it('accepts only the fixed packaged invocation and rejects arbitrary app flags', () => {
    expect(parseStartupProbeArgs([
      '--app', '/tmp/app',
      '--evidence', '/tmp/evidence',
      '--expected-head', SHA1,
      '--expected-app-sha256', EXECUTABLE,
    ])).toEqual({
      appPath: '/tmp/app',
      evidenceDir: '/tmp/evidence',
      expectedHead: SHA1,
      expectedAppSha256: EXECUTABLE,
    })
    expect(parseStartupProbeArgs([
      '--app', '/tmp/app',
      '--evidence', '/tmp/evidence',
      '--expected-head', SHA1,
      '--expected-app-sha256', EXECUTABLE,
      '--enospc-mount', '/Volumes/c01-bounded-enospc',
    ])).toEqual({
      appPath: '/tmp/app',
      evidenceDir: '/tmp/evidence',
      expectedHead: SHA1,
      expectedAppSha256: EXECUTABLE,
      enospcMount: '/Volumes/c01-bounded-enospc',
    })
    expect(() => parseStartupProbeArgs([
      '--app', '/tmp/app',
      '--evidence', '/tmp/evidence',
      '--expected-head', SHA1,
      '--expected-app-sha256', EXECUTABLE,
      '--app-arg', '--no-sandbox',
    ])).toThrow(/unknown|arbitrary/iu)
  })

  it('describes the actual packaged producer and explicit uncovered axes', () => {
    expect(STARTUP_PROBE_DESCRIPTOR.contractId).toBe('C01')
    expect(STARTUP_PROBE_DESCRIPTOR.cli.required).toEqual([
      '--app',
      '--evidence',
      '--expected-head',
      '--expected-app-sha256',
    ])
    expect(STARTUP_PROBE_DESCRIPTOR.reportPath).toBe('receipt.json')
    expect(STARTUP_PROBE_DESCRIPTOR.coverage.join('\n')).toMatch(/newer.*schema|corrupt.*settings|bad.*secret/iu)
    expect(STARTUP_PROBE_DESCRIPTOR.profileKinds).toEqual([...C01_STARTUP_PROFILE_KINDS])
    expect(STARTUP_PROBE_DESCRIPTOR.uncoveredAxes.join('\n')).toMatch(/field|AppImage|provider/iu)
    expect(STARTUP_PROBE_DESCRIPTOR.uncoveredAxes.join('\n'))
      .toMatch(/Electron bootstrap.*never reaches app readiness.*20-second.*does not prove bounded recovery.*C01 contract forbids indefinite blank.*system-level bootstrap/iu)
  })

  it('recomputes each packaged profile from observations and ignores forged result', () => {
    const result = validateStartupContractEvidence('C01', report(), expected)
    expect(result.passed).toBe(true)
    expect(result.recomputedPredicates).toEqual({
      absentSchemaAdmission: true,
      validSchemaNormalShell: true,
      identity: true,
      badSecretNormalShell: true,
      corruptSettingsFaultExport: true,
      corruptSchemaRefusal: true,
      newerSchemaRefusal: true,
      oversizedAdmission: true,
      permissionFault: true,
      diskFullFault: true,
      heldDiagnosticsGate: true,
      heldCrashGate: true,
      heldStoreGate: true,
      activeRecoverableMission: true,
      custody: true,
    })
    expect(result.coverageComplete).toBe(false)
    expect(result.qualificationEligible).toBe(false)
    expect(result.releaseEligible).toBe(false)
    expect(result.nonQualificationReason).toMatch(/never reaches app readiness/iu)
    expect(result.nonQualificationReason).toMatch(/synchronous mission-store.*migration.*main thread/iu)
    expect(result.uncoveredAxes.join('\n')).toMatch(/synchronous mission-store.*migration.*main thread/iu)
    expect(result.uncoveredAxes).toEqual([...STARTUP_PROBE_DESCRIPTOR.uncoveredAxes])
  })

  it('rejects forged pass when the newer-schema profile changes a retained byte', () => {
    const tampered = report() as { scenarios: { newerSchema: { originalFiles: { after: Record<string, unknown> } } } }
    tampered.scenarios.newerSchema.originalFiles.after = snapshots('0'.repeat(64))
    const result = validateStartupContractEvidence('C01', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/unchanged|preserv|byte|digest/iu)
  })

  it('rejects reports that expose fixture secrets or claim omitted scale axes', () => {
    const result = validateStartupContractEvidence(
      'C01',
      report({
        custody: {
          rawSecretsIncluded: true,
          networkContactAttempted: false,
          profilesDisposable: true,
          sourceProfileRetained: false,
        },
        scenarios: {
          ...report().scenarios,
          newerSchema: {
            ...report().scenarios.newerSchema,
            fieldScale: true,
          },
        },
      }),
      expected,
    )
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/secret|scale|unsupported|uncovered/iu)
  })

  it('rejects a secret canary embedded in an otherwise plausible receipt', () => {
    const leaked = report({
      scenarios: {
        ...report().scenarios,
        badSecret: {
          ...report().scenarios.badSecret,
          diagnosticNote: 'C01_SYNTHETIC_LEGACY_CIPHERTEXT_DO_NOT_EXPORT',
        },
      },
    })
    const result = validateStartupContractEvidence('C01', leaked, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/secret|canary/iu)
  })

  it('rejects a partial fixed matrix even when the producer result says pass', () => {
    const partial = report()
    delete (partial.scenarios as Record<string, unknown>)['disk-full']
    const result = validateStartupContractEvidence('C01', partial, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/disk-full|profile|missing/iu)
  })

  it('rejects a disk-full claim without an independently observed ENOSPC boundary', () => {
    const forged = report()
    ;(forged.scenarios as Record<string, Record<string, unknown>>)['disk-full'].filesystem = {
      errorCode: 'EACCES',
      originalPreserved: true,
    }
    const result = validateStartupContractEvidence('C01', forged, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/disk|ENOSPC|fault/iu)
  })

  it('rejects a native-looking disk-full refusal without a reviewed physical volume binding', () => {
    const forged = report()
    const diskFull = (forged.scenarios as Record<string, Record<string, unknown>>)['disk-full']
    diskFull.filesystem = {
      ...(diskFull.filesystem as Record<string, unknown>),
      physical: false,
    }
    const result = validateStartupContractEvidence('C01', forged, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/physical|bounded|ENOSPC/iu)
  })

  it.each(['fillerRemoved', 'profileRemoved'])('rejects physical disk-full evidence without %s cleanup', (field) => {
    for (const value of [false, undefined]) {
      const forged = report()
      const diskFull = (forged.scenarios as Record<string, Record<string, unknown>>)['disk-full']
      diskFull.cleanup = { fillerRemoved: true, profileRemoved: true, [field]: value }
      const result = validateStartupContractEvidence('C01', forged, expected)
      expect(result.passed).toBe(false)
      expect(result.failureReasons.join('\n')).toMatch(/cleanup/iu)
    }
  })

  it.each([['diagnostics', 'heldPathRemoved'], ['crash', 'heldPathRemoved'], ['store', 'lockHolderClosed']])(
    'rejects a held %s gate without %s cleanup', (kind, field) => {
      for (const value of [false, undefined]) {
        const forged = report()
        const scenario = (forged.scenarios as Record<string, Record<string, unknown>>)[`held-${kind}-gate`]
        scenario.cleanup = { ...(scenario.cleanup as Record<string, unknown>), [field]: value }
        const result = validateStartupContractEvidence('C01', forged, expected)
        expect(result.passed).toBe(false)
        expect(result.failureReasons.join('\n')).toMatch(/cleanup/iu)
      }
    },
  )

  it('rejects contradictory or missing store lock-holder closure evidence', () => {
    for (const lockHolder of [undefined, { pid: 110, closed: false }, { pid: null, closed: true }]) {
      const forged = report()
      const scenario = (forged.scenarios as Record<string, Record<string, unknown>>)['held-store-gate']
      scenario.gate = { ...(scenario.gate as Record<string, unknown>), lockHolder }
      expect(validateStartupContractEvidence('C01', forged, expected).passed).toBe(false)
    }
  })

  it.each([
    { failures: ['Disposable C01 profile cleanup failed: EACCES'] },
    { failures: undefined },
    { failures: 'invalid' },
  ])('rejects producer failures or absent failure accounting: $failures', ({ failures }) => {
    const result = validateStartupContractEvidence('C01', report({ failures }), expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/producer|failure/iu)
  })

  it('retains an actual held-gate timeout as a product gap instead of promoting it', () => {
    const timedOut = report()
    ;(timedOut.scenarios as Record<string, Record<string, unknown>>)['held-store-gate'] = {
      profileKind: 'held-store-gate',
      observed: 'bounded-timeout-no-action',
      gate: {
        kind: 'store',
        held: true,
        bounded: true,
        action: '',
        synthetic: false,
        timeoutMs: 2_000,
        response: 'no-native-dialog-no-shell',
      },
      process: { pid: 106, closed: true, timeoutMs: 2_000 },
      originalFiles: { before: snapshots(), after: snapshots() },
      productGap: 'Startup has no bounded actionable response to the held store gate.',
    }
    const result = validateStartupContractEvidence('C01', timedOut, expected)
    expect(result.passed).toBe(false)
    expect(result.recomputedPredicates.heldStoreGate).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/actionable|held|gate/iu)
  })

  it('does not treat a synthetic held-gate marker as packaged fault evidence', () => {
    const synthetic = report()
    ;(synthetic.scenarios as Record<string, Record<string, unknown>>)['held-store-gate'].gate = {
      kind: 'store',
      held: true,
      bounded: true,
      action: 'reload-or-contact-support',
      synthetic: true,
    }
    const result = validateStartupContractEvidence('C01', synthetic, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/held|synthetic|gate/iu)
  })

  it('retains synthetic ENOSPC as a separate diagnostic without passing C01', () => {
    const synthetic = report()
    ;(synthetic.scenarios as Record<string, Record<string, unknown>>)['disk-full'] = {
      profileKind: 'disk-full',
      observed: 'synthetic-filesystem-fault',
      faultKind: 'disk-full',
      filesystem: {
        errorCode: 'ENOSPC',
        originalPreserved: true,
        injectionAttempted: true,
        synthetic: true,
      },
      process: { tier: 'producer-owned-synthetic', pid: 112 },
      originalFiles: { before: snapshots(), after: snapshots() },
    }
    const result = validateStartupContractEvidence('C01', synthetic, expected)
    expect(result.passed).toBe(false)
    expect(result.recomputedPredicates.diskFullFault).toBe(true)
    expect(result.failureReasons.join('\n')).toMatch(/synthetic|unsupported|physical/iu)
  })

  it('applies C19 legacy startup boundaries to the shared C01 observations', () => {
    const valid = validateLegacyStartupReceipt(report(), expected)
    expect(valid.passed).toBe(true)

    const missingPermission = report()
    delete (missingPermission.scenarios as Record<string, unknown>)['permission-fault']
    const permissionResult = validateLegacyStartupReceipt(missingPermission, expected)
    expect(permissionResult.passed).toBe(false)
    expect(permissionResult.failureReasons.join('\n')).toMatch(/permission/iu)

    const missingDiskFull = report()
    delete (missingDiskFull.scenarios as Record<string, unknown>)['disk-full']
    const diskResult = validateLegacyStartupReceipt(missingDiskFull, expected)
    expect(diskResult.passed).toBe(false)
    expect(diskResult.failureReasons.join('\n')).toMatch(/diskfullfault|disk-full|ENOSPC/iu)

    const heldGateOnly = report()
    ;(heldGateOnly.scenarios as Record<string, Record<string, unknown>>)['held-store-gate'].gate = {
      kind: 'store', held: false, bounded: true, action: 'reload-or-contact-support',
    }
    const heldResult = validateLegacyStartupReceipt(heldGateOnly, expected)
    expect(heldResult.passed).toBe(true)
    expect(heldResult.failureReasons).toEqual([])
  })
})
