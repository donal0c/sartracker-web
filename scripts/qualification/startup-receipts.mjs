const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/u

/** The bounded packaged C01 startup-admission proof tier. */
export const C01_STARTUP_PROOF_MODE = 'packaged-electron-startup-admission'

/** Fixed observation bound for deliberately held startup dependencies. */
export const C01_HELD_GATE_TIMEOUT_MS = 20_000

/** Allows evidence writes and process shutdown to settle after dialog dismissal. */
export const C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS = 12_000

/** Fixed C01 startup matrix; every entry must have an independent observation. */
export const C01_STARTUP_PROFILE_KINDS = Object.freeze([
  'absent-schema',
  'valid-schema',
  'legacy-bad-secret',
  'corrupt-settings',
  'corrupt-schema',
  'newer-schema',
  'oversized-store',
  'permission-fault',
  'disk-full',
  'held-diagnostics-gate',
  'held-crash-gate',
  'held-store-gate',
  'active-recoverable',
])

/** Fixed logical size boundaries for the C01 oversized admission lane. */
export const C01_OVERSIZED_STORE_BYTES = Object.freeze([
  8 * 1024 * 1024,
  3_700_000_000,
])

const BAD_SECRET_WARNING =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'

/** Describes the real C01 producer and the axes it deliberately leaves open. */
export const STARTUP_PROBE_DESCRIPTOR = Object.freeze({
  contractId: 'C01',
  proofMode: C01_STARTUP_PROOF_MODE,
  schema: 'sartracker-c01-startup-admission-v3',
  producer: 'scripts/qualification/startup-probe.mjs',
  reportPath: 'receipt.json',
  profileKinds: C01_STARTUP_PROFILE_KINDS,
  cli: Object.freeze({
    required: Object.freeze([
      '--app',
      '--evidence',
      '--expected-head',
      '--expected-app-sha256',
    ]),
    optional: Object.freeze(['--enospc-mount']),
    repeatable: Object.freeze([]),
  }),
  coverage: Object.freeze([
    'packaged absent-schema and valid-schema profiles reach the normal shell with the expected current schema',
    'packaged disposable profile with an undecryptable legacy credential reaches the normal shell',
    'packaged corrupt-settings profile reaches the runtime fault shell and exports a bounded support bundle',
    'packaged corrupt-schema profile reaches the native startup refusal without renderer work',
    'packaged newer-schema profile shows the native refusal, exits once, starts no renderer and preserves profile bytes',
    'packaged oversized profile generates, hashes and launches the fixed 8 MiB and 3.7 GB stores through separate disposable package profiles; other fault paths retain explicit observations or failed attempts',
    'packaged active-recoverable profile exposes the existing mission without data loss',
    'source HEAD/tree, supplied executable, packaged ASAR and Electron runtime identity are retained',
  ]),
  uncoveredAxes: Object.freeze([
    'physical field-host and provider acceptance beyond the disposable packaged 3.7 GB launch; the field process path is implemented but not executed in development tests',
    'development or candidate execution of the physical bounded-volume ENOSPC and FIFO/SQLite held-gate probes; any timeout without an actionable product response remains an explicit gap',
    'field-scale Ubuntu admission with genuinely allocated 3.7 GB operational data',
    'real provider/current polling request continuity and AppImage/deb installation parity',
    'browser-only boot states and WAR-13B/publication or field acceptance evidence',
    'synchronous mission-store SQLite open, pragmas and migration run on Electron main thread; the held-store lock profile does not prove bounded open or migration',
    'Electron bootstrap that never reaches app readiness; the 20-second held-dependency observation starts before process launch, but no profile holds Electron readiness, so C01 does not prove bounded recovery here. The C01 contract forbids indefinite blank startup; a Linux GUI failure before Electron readiness requires a system-level bootstrap outside Electron',
  ]),
})

/** Validate raw packaged C01 observations against controller-owned identity facts. */
export function validateStartupContractEvidence(contractId, report, expected) {
  if (contractId !== 'C01') throw new Error('Startup receipt contract must be C01.')
  const failures = []
  const binding = validateExpected(expected, failures)
  const predicates = {
    identity: false,
    absentSchemaAdmission: false,
    validSchemaNormalShell: false,
    badSecretNormalShell: false,
    corruptSettingsFaultExport: false,
    corruptSchemaRefusal: false,
    newerSchemaRefusal: false,
    oversizedAdmission: false,
    permissionFault: false,
    diskFullFault: false,
    heldDiagnosticsGate: false,
    heldCrashGate: false,
    heldStoreGate: false,
    activeRecoverableMission: false,
    custody: false,
  }

  if (!isRecord(report)) {
    failures.push('C01 startup report is missing or is not an object.')
    return makeResult(predicates, failures)
  }
  if (
    report.schema !== STARTUP_PROBE_DESCRIPTOR.schema ||
    report.contractId !== 'C01' ||
    report.proofMode !== C01_STARTUP_PROOF_MODE
  ) {
    failures.push('C01 startup report schema or contract identity is invalid.')
  }
  if (!Array.isArray(report.failures) || report.failures.length !== 0) {
    failures.push('C01 producer failure accounting is missing or records a failed operation or cleanup.')
  }

  predicates.identity = validateIdentity(report, binding, failures)
  predicates.absentSchemaAdmission = validateAbsentSchema(
    scenarioFor(report, 'absent-schema'),
    binding,
    failures,
  )
  predicates.validSchemaNormalShell = validateNormalShell(
    scenarioFor(report, 'valid-schema'),
    binding,
    failures,
    'valid-schema',
  )
  predicates.badSecretNormalShell = validateBadSecret(
    scenarioFor(report, 'legacy-bad-secret', 'badSecret'),
    binding,
    failures,
  )
  predicates.corruptSettingsFaultExport = validateCorruptSettings(
    scenarioFor(report, 'corrupt-settings', 'corruptSettings'),
    binding,
    failures,
  )
  predicates.corruptSchemaRefusal = validateNativeRefusal(
    scenarioFor(report, 'corrupt-schema'),
    'corrupt-schema',
    'corrupt-store',
    failures,
  )
  predicates.newerSchemaRefusal = validateNewerSchema(
    scenarioFor(report, 'newer-schema', 'newerSchema'),
    binding,
    failures,
  )
  predicates.oversizedAdmission = validateOversizedStore(
    scenarioFor(report, 'oversized-store'),
    failures,
  )
  predicates.permissionFault = validateNativeRefusal(
    scenarioFor(report, 'permission-fault'),
    'permission-fault',
    'permission',
    failures,
  )
  const diskFullScenario = scenarioFor(report, 'disk-full')
  predicates.diskFullFault = diskFullScenario?.observed === 'synthetic-filesystem-fault'
    ? validateSyntheticDiskFull(diskFullScenario, failures)
    : validateNativeRefusal(diskFullScenario, 'disk-full', 'disk-full', failures)
  predicates.heldDiagnosticsGate = validateHeldGate(
    scenarioFor(report, 'held-diagnostics-gate'),
    'diagnostics',
    failures,
  )
  predicates.heldCrashGate = validateHeldGate(
    scenarioFor(report, 'held-crash-gate'),
    'crash',
    failures,
  )
  predicates.heldStoreGate = validateHeldGate(
    scenarioFor(report, 'held-store-gate'),
    'store',
    failures,
  )
  predicates.activeRecoverableMission = validateActiveRecoverable(
    scenarioFor(report, 'active-recoverable'),
    binding,
    failures,
  )
  predicates.custody = validateCustody(report, failures)
  rejectUnsupportedClaims(report, failures)

  const uniqueFailures = [...new Set(failures)]
  const passed = uniqueFailures.length === 0 && Object.values(predicates).every(Boolean)
  return makeResult(predicates, uniqueFailures, passed ? 'PASS' : 'INVALID_EVIDENCE')
}

/** Alias for callers that use the producer name. */
export const validateStartupProbeEvidence = validateStartupContractEvidence
export const validateStartupProbeReceipt = validateStartupContractEvidence
export const STARTUP_RECEIPT_DESCRIPTOR = STARTUP_PROBE_DESCRIPTOR

/** Validate the controller-owned source, artifact and runtime binding. */
function validateExpected(expected, failures) {
  if (
    !isRecord(expected) ||
    expected.proofMode !== C01_STARTUP_PROOF_MODE ||
    !isRecord(expected.source) ||
    !SHA1.test(expected.source.expectedHead ?? '') ||
    !SHA1.test(expected.source.tree ?? '') ||
    !isRecord(expected.artifact) ||
    !SHA256.test(expected.artifact.packagedExecutableSha256 ?? '') ||
    !SHA256.test(expected.artifact.packagedApplicationArchiveSha256 ?? '') ||
    !isRecord(expected.process) ||
    expected.process.tier !== C01_STARTUP_PROOF_MODE ||
    !isRecord(expected.workload) ||
    !Number.isSafeInteger(expected.workload.supportedSchemaVersion) ||
    !Array.isArray(expected.workload.profileKinds) ||
    expected.workload.profileKinds.length !== C01_STARTUP_PROFILE_KINDS.length ||
    new Set(expected.workload.profileKinds).size !== C01_STARTUP_PROFILE_KINDS.length ||
    C01_STARTUP_PROFILE_KINDS.some((kind, index) => expected.workload.profileKinds[index] !== kind)
  ) {
    failures.push('Expected C01 binding requires source, packaged artifact, process and workload facts.')
    return null
  }
  if (expected.app !== undefined && !isRecord(expected.app)) {
    failures.push('Expected C01 app binding must be an object when supplied.')
    return null
  }
  if (expected.app?.suppliedPath !== undefined && !isAbsolutePath(expected.app.suppliedPath)) {
    failures.push('Expected C01 app binding suppliedPath must be absolute.')
    return null
  }
  return expected
}

/** Recompute source, exact executable/archive and packaged runtime identity. */
function validateIdentity(report, expected, failures) {
  const source = report.source
  const app = report.app
  const runtime = report.runtime
  const process = report.process
  let passed = true
  if (
    expected === null ||
    !isRecord(source) ||
    source.head !== expected.source.expectedHead ||
    source.expectedHead !== expected.source.expectedHead ||
    source.tree !== expected.source.tree ||
    source.dirty !== false
  ) {
    failures.push('C01 source HEAD/tree is not independently bound to the expected clean source.')
    passed = false
  }
  if (
    expected === null ||
    !isRecord(app) ||
    !isAbsolutePath(app.suppliedPath) ||
    (expected.app?.suppliedPath !== undefined && app.suppliedPath !== expected.app.suppliedPath) ||
    app.executableSha256 !== expected.artifact.packagedExecutableSha256 ||
    app.isPackaged !== true ||
    !isAbsolutePath(app.appPath) ||
    !app.appPath.endsWith('.asar') ||
    app.asarSha256 !== expected.artifact.packagedApplicationArchiveSha256
  ) {
    failures.push('C01 packaged executable/ASAR identity is missing or differs from the expected artifact.')
    passed = false
  }
  if (
    !isRecord(runtime) ||
    !nonEmptyString(runtime.electron) ||
    !nonEmptyString(runtime.node) ||
    !nonEmptyString(runtime.modules)
  ) {
    failures.push('C01 packaged Electron runtime identity is missing.')
    passed = false
  }
  if (!isRecord(process) || process.tier !== C01_STARTUP_PROOF_MODE) {
    failures.push('C01 process tier is missing or differs from the packaged startup-admission tier.')
    passed = false
  }
  return passed
}

/** Select a canonical scenario while accepting the two historical C01 keys. */
function scenarioFor(report, profileKind, legacyKey = profileKind) {
  const scenarios = report?.scenarios
  if (!isRecord(scenarios)) return undefined
  return scenarios[profileKind] ?? scenarios[legacyKey]
}

/** Recompute a normal shell launch for a profile with a current schema. */
function validateNormalShell(scenario, expected, failures, label) {
  if (!isRecord(scenario) || scenario.profileKind !== label) {
    failures.push('C01 ' + label + ' profile is missing.')
    return false
  }
  let passed = scenario.observed === 'normal-shell'
    && scenario.shellReached === true
    && scenario.runtimeFaultVisible === false
  if (!passed) failures.push('C01 ' + label + ' profile did not reach the normal shell.')
  if (expected === null || scenario.store?.schemaVersion !== expected.workload.supportedSchemaVersion) {
    failures.push('C01 ' + label + ' profile did not expose the expected current SQLite schema metadata.')
    passed = false
  }
  if (scenario.provider?.networkContactAttempted !== false) {
    failures.push('C01 ' + label + ' profile records provider contact.')
    passed = false
  }
  if (!validateClosedProcess(scenario.process, label + ' profile', failures, 'shellAtMs')) passed = false
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 ' + label + ' profile', failures)) passed = false
  return passed
}

/** Recompute creation of a missing database without treating a generic pass as proof. */
function validateAbsentSchema(scenario, expected, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'absent-schema') {
    failures.push('C01 absent-schema profile is missing.')
    return false
  }
  let passed = scenario.observed === 'created-current-schema'
    && scenario.shellReached === true
    && scenario.runtimeFaultVisible === false
    && scenario.beforeFiles?.database === false
    && scenario.afterStore?.databaseCreated === true
  if (!passed) failures.push('C01 absent-schema profile did not prove bounded current-schema creation.')
  if (expected === null || scenario.afterStore?.schemaVersion !== expected.workload.supportedSchemaVersion) {
    failures.push('C01 absent-schema profile did not expose the expected current SQLite schema metadata.')
    passed = false
  }
  if (scenario.provider?.networkContactAttempted !== false) {
    failures.push('C01 absent-schema profile records provider contact.')
    passed = false
  }
  if (!validateClosedProcess(scenario.process, 'absent-schema profile', failures, 'shellAtMs')) passed = false
  return passed
}

/** Recompute a native startup fault without trusting a producer verdict field. */
function validateNativeRefusal(scenario, label, faultKind, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== label) {
    failures.push('C01 ' + label + ' profile is missing.')
    return false
  }
  let passed = scenario.observed === 'native-startup-fault'
    && scenario.faultKind === faultKind
    && scenario.dialog?.observed === true
    && scenario.dialog?.windowName === 'Error'
    && scenario.dialog?.operatorTitle === 'SAR Tracker could not start'
  if (!passed) failures.push('C01 ' + label + ' native fault observation is incomplete.')
  if (!validateClosedProcess(scenario.process, label + ' profile', failures, 'dialogAtMs', true)) passed = false
  const renderer = scenario.renderer
  if (!isRecord(renderer) || renderer.maximum !== 0 || renderer.scanCount < 1 || renderer.scanError !== null
      || (renderer.cdpAvailable === true && renderer.pageCount !== 0)) {
    failures.push('C01 ' + label + ' profile shows renderer work after fail-closed refusal.')
    passed = false
  }
  if (scenario.startupLogs?.runtimeStartupFailureRecorded !== true
      || scenario.startupLogs?.unhandledRejectionAbsent !== true) {
    failures.push('C01 ' + label + ' startup failure logs are incomplete.')
    passed = false
  }
  if (faultKind === 'permission') {
    if (scenario.filesystem?.databaseMode !== 0o444
        || scenario.filesystem?.directoryMode !== 0o555
        || scenario.filesystem?.restored !== true) {
      failures.push('C01 permission-fault profile did not retain the bounded read-only filesystem setup.')
      passed = false
    }
  }
  if (faultKind === 'disk-full') {
    if (scenario.filesystem?.errorCode !== 'ENOSPC' || scenario.filesystem?.originalPreserved !== true) {
      failures.push('C01 disk-full profile did not expose an independently observed ENOSPC boundary.')
      passed = false
    }
    if (!validatePhysicalDiskFull(scenario, failures)) passed = false
  }
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 ' + label + ' profile', failures)) passed = false
  return passed
}

/** Require a reviewed bounded volume and a real kernel ENOSPC observation. */
function validatePhysicalDiskFull(scenario, failures) {
  const precondition = scenario?.precondition ?? scenario?.filesystem?.precondition
  let passed = scenario?.filesystem?.physical === true
    && scenario?.filesystem?.synthetic !== true
    && scenario?.filesystem?.injectionAttempted === true
    && isRecord(precondition)
    && precondition.kind === 'bounded-enospc'
    && precondition.status === 'READY'
    && precondition.observed === true
    && precondition.deviceDistinct === true
    && Number.isSafeInteger(precondition.totalBytes)
    && precondition.totalBytes > 0
    && precondition.totalBytes <= 64 * 1024 * 1024
    && scenario?.filesystem?.fill?.errorCode === 'ENOSPC'
    && Number.isSafeInteger(scenario?.filesystem?.fill?.writtenBytes)
    && scenario.filesystem.fill.writtenBytes >= 0
  if (!passed) {
    failures.push('C01 disk-full profile lacks a reviewed bounded volume and independently observed physical ENOSPC boundary.')
  }
  if (scenario.cleanup?.fillerRemoved !== true || scenario.cleanup?.profileRemoved !== true) {
    failures.push('C01 disk-full cleanup did not remove the owned filler and disposable profile.')
    passed = false
  }
  return passed
}

/** Validate a producer-owned ENOSPC simulation without treating it as physical disk proof. */
function validateSyntheticDiskFull(scenario, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'disk-full' || scenario.observed !== 'synthetic-filesystem-fault') {
    return false
  }
  let passed = scenario.faultKind === 'disk-full'
    && scenario.process?.tier === 'producer-owned-synthetic'
    && Number.isSafeInteger(scenario.process?.pid)
    && scenario.filesystem?.errorCode === 'ENOSPC'
    && scenario.filesystem?.synthetic === true
    && scenario.filesystem?.injectionAttempted === true
    && scenario.filesystem?.originalPreserved === true
  if (!passed) failures.push('C01 synthetic disk-full observation is incomplete.')
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 synthetic disk-full profile', failures)) passed = false
  return passed
}

/** Recompute bounded admission for both fixed logical oversized-store boundaries. */
function validateOversizedStore(scenario, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'oversized-store') {
    failures.push('C01 oversized-store profile is missing.')
    return false
  }
  const observations = scenario.workload?.observations
  let passed = scenario.observed === 'bounded-admission'
    && ['actionable-fault', 'normal-shell'].includes(scenario.admission?.status)
    && scenario.admission?.originalPreserved === true
    && scenario.admission?.bounded === true
    && Array.isArray(observations)
    && observations.length === C01_OVERSIZED_STORE_BYTES.length
  if (!passed) failures.push('C01 oversized-store admission observations are incomplete.')
  if (passed) {
    for (const [index, expectedBytes] of C01_OVERSIZED_STORE_BYTES.entries()) {
      const observation = observations[index]
      if (!isRecord(observation)
          || observation.requestedBytes !== expectedBytes
          || !Number.isSafeInteger(observation.observedBytes)
          || observation.observedBytes < expectedBytes
          || !['actionable-fault', 'normal-shell'].includes(observation.outcome)) {
        failures.push('C01 oversized-store boundary ' + expectedBytes + ' bytes was not independently observed.')
        passed = false
      }
    }
  }
  const timingField = scenario.process?.faultShellAtMs === undefined ? 'shellAtMs' : 'faultShellAtMs'
  if (!validateClosedProcess(scenario.process, 'oversized-store profile', failures, timingField)) passed = false
  const fieldTimingField = scenario.fieldProcess?.faultShellAtMs === undefined ? 'shellAtMs' : 'faultShellAtMs'
  if (!validateClosedProcess(scenario.fieldProcess, 'oversized-store field profile', failures, fieldTimingField)) passed = false
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 oversized-store profile', failures)) passed = false
  return passed
}

/** Recompute one deliberately held startup gate and its actionable recovery state. */
function validateHeldGate(scenario, gateKind, failures) {
  const label = 'held-' + gateKind + '-gate'
  if (!isRecord(scenario) || scenario.profileKind !== label) {
    failures.push('C01 ' + label + ' profile is missing.')
    return false
  }
  let passed = scenario.observed === 'actionable-fault'
    && scenario.gate?.kind === gateKind
    && scenario.gate?.held === true
    && scenario.gate?.bounded === true
    && nonEmptyString(scenario.gate?.action)
    && scenario.gate?.synthetic !== true
  if (!passed) failures.push('C01 ' + label + ' did not expose a bounded actionable gate.')
  const cleanupPassed = gateKind === 'store'
    ? scenario.cleanup?.lockHolderClosed === true
      && scenario.gate?.lockHolder?.closed === true
      && Number.isSafeInteger(scenario.gate?.lockHolder?.pid)
      && scenario.gate.lockHolder.pid > 0
    : scenario.cleanup?.heldPathRemoved === true
  if (!cleanupPassed) {
    failures.push('C01 ' + label + ' cleanup was not positively verified.')
    passed = false
  }
  if (!validateHeldGateResponse(scenario, label, failures)) passed = false
  if (!validateClosedProcess(scenario.process, label + ' profile', failures, 'faultShellAtMs', true)) passed = false
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 ' + label + ' profile', failures)) passed = false
  return passed
}

/** Recompute that the held-gate dialog was observed inside the producer's fixed window. */
function validateHeldGateResponse(scenario, label, failures) {
  const observedAtMs = scenario.process?.dialogObservedAtMs
  const passed = scenario.gate?.timeoutMs === C01_HELD_GATE_TIMEOUT_MS
    && scenario.gate?.response === 'native-error-dialog'
    && scenario.gate?.dialogObserved === true
    && scenario.gate?.lateDialogAfterTimeout === false
    && scenario.process?.timeoutMs === C01_HELD_GATE_TIMEOUT_MS
    && scenario.process?.timedOut === false
    && scenario.process?.dialogObserved === true
    && scenario.process?.dialogDismissed === true
    && scenario.process?.lateDialogAfterTimeout === false
    && scenario.process?.forcedKill === false
    && scenario.process?.productExitCode === 1
    && scenario.process?.productExitSignal === null
    && Number.isSafeInteger(scenario.process?.exitAfterDialogMs)
    && scenario.process.exitAfterDialogMs >= 0
    && scenario.process.exitAfterDialogMs <= C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS
    && Number.isSafeInteger(observedAtMs)
    && observedAtMs >= 0
    && observedAtMs <= C01_HELD_GATE_TIMEOUT_MS
    && scenario.process?.faultShellAtMs === observedAtMs
  if (!passed) {
    failures.push('C01 ' + label + ' dialog response did not satisfy the fixed 20000 ms observation bound.')
  }
  return passed
}

/** Recompute active/recoverable mission visibility and preservation at startup. */
function validateActiveRecoverable(scenario, expected, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'active-recoverable') {
    failures.push('C01 active-recoverable profile is missing.')
    return false
  }
  let passed = scenario.observed === 'recoverable-mission'
    && scenario.shellReached === true
    && scenario.runtimeFaultVisible === false
    && ['active', 'paused'].includes(scenario.store?.missionStatus)
    && scenario.recovery?.activeMissionVisible === true
    && scenario.recovery?.missionId === scenario.store?.missionId
    && scenario.recovery?.noDataLoss === true
  if (!passed) failures.push('C01 active-recoverable profile did not expose the preserved mission state.')
  if (expected === null || scenario.store?.schemaVersion !== expected.workload.supportedSchemaVersion) {
    failures.push('C01 active-recoverable profile did not expose the expected current SQLite schema metadata.')
    passed = false
  }
  if (!validateClosedProcess(scenario.process, 'active-recoverable profile', failures, 'shellAtMs')) passed = false
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 active-recoverable profile', failures)) passed = false
  return passed
}

/** Validate one owned process close and its bounded startup timing. */
function validateClosedProcess(process, label, failures, timingField, requireExit = false) {
  if (!isRecord(process)) {
    failures.push('C01 ' + label + ' process observation is missing.')
    return false
  }
  let passed = Number.isSafeInteger(process.pid) && process.pid > 0
    && (requireExit ? process.exitCode === 1 && process.signal === null : process.closed === true)
    && boundedDuration(process[timingField])
  if (!passed) failures.push('C01 ' + label + ' process ownership/closure observation is incomplete.')
  if (requireExit && !boundedDuration(process.exitAfterDialogMs)) {
    failures.push('C01 ' + label + ' process exit timing is missing or outside the observation window.')
    passed = false
  }
  return passed
}

/** Recompute normal-shell recovery for an undecryptable legacy credential. */
function validateBadSecret(scenario, expected, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'legacy-bad-secret') {
    failures.push('C01 undecryptable legacy-secret profile is missing.')
    return false
  }
  let passed = true
  if (scenario.shellReached !== true || scenario.runtimeFaultVisible !== false) {
    failures.push('C01 bad-secret profile did not reach a normal shell without a runtime fault.')
    passed = false
  }
  const warning = scenario.warning
  const actions = new Set(Array.isArray(warning?.actions) ? warning.actions : [])
  if (
    !isRecord(warning) ||
    warning.exactText !== BAD_SECRET_WARNING ||
    warning.actionable !== true ||
    !actions.has('open-settings-workspace') ||
    !actions.has('settings-provider-secret')
  ) {
    failures.push('C01 bad-secret warning or re-entry action is incomplete.')
    passed = false
  }
  const bridge = scenario.settingsBridge
  if (
    !isRecord(bridge) ||
    bridge.available !== true ||
    bridge.secretPresent !== true ||
    bridge.replacementFieldVisible !== true
  ) {
    failures.push('C01 bad-secret profile lacks an observed Settings bridge re-entry state.')
    passed = false
  }
  if (scenario.provider?.networkContactAttempted !== false) {
    failures.push('C01 bad-secret profile records provider contact.')
    passed = false
  }
  if (expected === null || scenario.store?.schemaVersion !== expected.workload.supportedSchemaVersion) {
    failures.push('C01 bad-secret profile did not expose the expected current SQLite schema metadata.')
    passed = false
  }
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 bad-secret profile', failures)) passed = false
  if (!isRecord(scenario.process) || !Number.isSafeInteger(scenario.process.pid) || scenario.process.closed !== true) {
    failures.push('C01 bad-secret process ownership/closure observation is incomplete.')
    passed = false
  }
  if (!boundedDuration(scenario.process?.shellAtMs)) {
    failures.push('C01 bad-secret shell timing is missing or outside the bounded observation window.')
    passed = false
  }
  return passed
}

/** Recompute the corrupt-settings runtime fault and support export boundary. */
function validateCorruptSettings(scenario, expected, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'corrupt-settings') {
    failures.push('C01 corrupt-settings profile is missing.')
    return false
  }
  let passed = true
  if (scenario.shellReached !== true || scenario.faultShellVisible !== true || scenario.faultMessagePresent !== true) {
    failures.push('C01 corrupt-settings profile did not expose a visible actionable fault shell.')
    passed = false
  }
  if (expected === null || scenario.store?.schemaVersion !== expected.workload.supportedSchemaVersion) {
    failures.push('C01 corrupt-settings profile did not expose the expected current SQLite schema metadata.')
    passed = false
  }
  const support = scenario.supportExport
  if (
    !isRecord(support) ||
    support.attempted !== true ||
    support.completed !== true ||
    !relativeReceiptPath(support.pathRelative) ||
    support.settingsStatus !== 'unavailable' ||
    support.startupFaultSection !== true ||
    support.rawSettingsRetained !== false
  ) {
    failures.push('C01 corrupt-settings profile lacks a bounded sanitized support export.')
    passed = false
  }
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 corrupt-settings profile', failures)) passed = false
  if (!isRecord(scenario.process) || !Number.isSafeInteger(scenario.process.pid) || scenario.process.closed !== true) {
    failures.push('C01 corrupt-settings process ownership/closure observation is incomplete.')
    passed = false
  }
  if (!boundedDuration(scenario.process?.faultShellAtMs)) {
    failures.push('C01 corrupt-settings fault-shell timing is missing or outside the bounded observation window.')
    passed = false
  }
  return passed
}

/** Recompute the native newer-schema refusal and byte-preserving close. */
function validateNewerSchema(scenario, expected, failures) {
  if (!isRecord(scenario) || scenario.profileKind !== 'newer-schema') {
    failures.push('C01 newer-schema profile is missing.')
    return false
  }
  let passed = true
  if (
    expected === null ||
    scenario.newerSchemaVersion !== expected.workload.supportedSchemaVersion + 1 ||
    scenario.supportedSchemaVersion !== expected.workload.supportedSchemaVersion
  ) {
    failures.push('C01 newer-schema versions are not bound to the supported packaged schema.')
    passed = false
  }
  const dialog = scenario.dialog
  if (
    !isRecord(dialog) ||
    dialog.observed !== true ||
    dialog.windowName !== 'Error' ||
    dialog.operatorTitle !== 'SAR Tracker could not start'
  ) {
    failures.push('C01 newer-schema native refusal dialog observation is incomplete.')
    passed = false
  }
  if (!isRecord(scenario.process) || scenario.process.exitCode !== 1 || scenario.process.signal !== null) {
    failures.push('C01 newer-schema process did not exit once with code 1.')
    passed = false
  }
  if (!boundedDuration(scenario.process?.dialogAtMs) || !boundedDuration(scenario.process?.exitAfterDialogMs)) {
    failures.push('C01 newer-schema dialog/exit timing is missing or outside the bounded observation window.')
    passed = false
  }
  const renderer = scenario.renderer
  if (
    !isRecord(renderer) ||
    renderer.maximum !== 0 ||
    renderer.scanCount < 1 ||
    renderer.scanError !== null ||
    (renderer.cdpAvailable === true && renderer.pageCount !== 0)
  ) {
    failures.push('C01 newer-schema profile shows renderer work after fail-closed refusal.')
    passed = false
  }
  const logs = scenario.startupLogs
  if (
    !isRecord(logs) ||
    logs.expectedMessagePresent !== true ||
    logs.runtimeStartupFailureRecorded !== true ||
    logs.unhandledRejectionAbsent !== true
  ) {
    failures.push('C01 newer-schema startup failure logs are incomplete.')
    passed = false
  }
  if (!validateUnchangedFiles(scenario.originalFiles, 'C01 newer-schema profile', failures)) passed = false
  return passed
}

/** Require exact file-set and byte/digest equality for every retained profile snapshot. */
function validateUnchangedFiles(observation, label, failures) {
  if (!isRecord(observation) || !isRecord(observation.before) || !isRecord(observation.after)) {
    failures.push(`${label} original file snapshots are missing.`)
    return false
  }
  const beforeNames = Object.keys(observation.before).sort()
  const afterNames = Object.keys(observation.after).sort()
  let passed = beforeNames.length > 0 && beforeNames.join('\u0000') === afterNames.join('\u0000')
  if (!passed) failures.push(`${label} original file set changed.`)
  for (const name of beforeNames) {
    const before = observation.before[name]
    const after = observation.after[name]
    if (
      !isRecord(before) ||
      !isRecord(after) ||
      !Number.isSafeInteger(before.bytes) ||
      before.bytes < 0 ||
      !SHA256.test(before.sha256 ?? '') ||
      before.bytes !== after.bytes ||
      before.sha256 !== after.sha256
    ) {
      failures.push(`${label} original file ${name} was not preserved byte-for-byte.`)
      passed = false
    }
  }
  return passed
}

/** Verify that no secret/network claim escapes the disposable profiles. */
function validateCustody(report, failures) {
  const custody = report.custody
  const serialized = safeJsonStringify(report)
  if (
    !isRecord(custody) ||
    custody.rawSecretsIncluded !== false ||
    custody.networkContactAttempted !== false ||
    custody.profilesDisposable !== true ||
    custody.sourceProfileRetained !== false
  ) {
    failures.push('C01 custody does not prove disposable, network-blocked, secret-free profiles.')
    return false
  }
  if (serialized.includes('C01_SYNTHETIC_') || serialized.includes('LEGACY_CIPHERTEXT')) {
    failures.push('C01 startup report contains a fixture secret canary.')
    return false
  }
  return true
}

/** Reject an adapter that quietly upgrades this bounded probe to unsupported coverage. */
function rejectUnsupportedClaims(report, failures) {
  const newer = report.scenarios?.newerSchema
  const scenarios = report.scenarios
  if (
    newer?.fieldScale === true ||
    newer?.oversizedBytes !== undefined ||
    scenarios?.['oversized-store']?.fieldScale === true ||
    scenarios?.['oversized-store']?.allocatedBytes !== undefined ||
    scenarios?.['active-recoverable']?.realProvider === true ||
    scenarios?.['disk-full']?.filesystem?.synthetic === true
  ) {
    failures.push('C01 startup report includes synthetic-only or unsupported field admission evidence.')
  }
}

/** Build the immutable validator result; embedded producer result is ignored. */
function makeResult(predicates, failures, status = 'INVALID_EVIDENCE') {
  const uniqueFailures = [...new Set(failures)]
  const valid = uniqueFailures.length === 0 && status === 'PASS'
  return Object.freeze({
    contractId: 'C01',
    proofMode: C01_STARTUP_PROOF_MODE,
    status: valid ? 'PASS' : 'INVALID_EVIDENCE',
    valid,
    passed: valid,
    recomputedPredicates: Object.freeze({ ...predicates }),
    // This matrix can be valid while full C01 coverage and qualification remain
    // false; pre-readiness and synchronous store open/migration are not covered.
    coverageComplete: false,
    qualificationEligible: false,
    releaseEligible: false,
    nonQualificationReason: 'The packaged startup matrix does not cover an Electron bootstrap that never reaches app readiness or synchronous mission-store SQLite open and migration on the main thread.',
    uncoveredAxes: STARTUP_PROBE_DESCRIPTOR.uncoveredAxes,
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Return whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return whether a string is non-empty after trimming. */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** Return whether a path is absolute on POSIX or Windows. */
function isAbsolutePath(value) {
  return typeof value === 'string' && ABSOLUTE_PATH.test(value)
}

/** Keep retained support paths relative to the attempt directory. */
function relativeReceiptPath(value) {
  return typeof value === 'string' && value !== '' && !isAbsolutePath(value) && !value.includes('..')
}

/** Require a non-negative integer timing captured by the producer's deadline. */
function boundedDuration(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 120_000
}

/** Serialize a report for canary scanning without allowing malformed values to escape validation. */
function safeJsonStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}
