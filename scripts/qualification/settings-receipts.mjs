const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROOF_MODE = 'packaged-electron-disposable-settings'
const PROFILE_ID = 'synthetic-disposable-settings'
const WARNING_TEXT =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
const URL_CREDENTIALS_ERROR =
  'Provider URL must not include embedded credentials. Enter credentials in the authentication fields.'

/** Describe the only executable C16 producer currently available. */
export const SETTINGS_PROBE_DESCRIPTOR = Object.freeze({
  contractIds: Object.freeze(['C16']),
  producer: 'scripts/qualification/settings-probe.mjs',
  reportPath: 'receipt.json',
  cli: Object.freeze({
    required: Object.freeze(['--app', '--evidence', '--expected-head']),
    repeatable: Object.freeze(['--app-arg']),
  }),
  coverage: Object.freeze([
    'synthetic disposable profile with no real provider or credential',
    'bad-secret startup recovery warning and Settings action',
    'save, packaged restart and settings read-back',
    'authoritative credential clear, restart and secret re-entry',
    'provider URL embedded-credential rejection',
  ]),
  uncoveredAxes: Object.freeze([
    'real provider authentication, network availability and operator credentials',
    'field machine, installed-deb/AppImage custody wrapper and source-clean release binding',
    'concurrent writers, profile corruption, power loss and filesystem permission faults',
    'all mission settings combinations and cross-platform keyring migration variants',
  ]),
})

/** Validate one C16 settings receipt against controller-owned source and artifact facts. */
export function validateSettingsContractEvidence(contractId, report, expected) {
  if (contractId !== 'C16') throw new Error('Settings receipt contract must be C16.')
  const binding = validateExpected(expected)
  const failures = []
  const predicates = {
    identity: false,
    startupRecovery: false,
    saveRestartReadback: false,
    clearSecretRestart: false,
    reentryRestart: false,
    urlCredentialRejection: false,
    custody: false,
  }

  if (!isRecord(report) || report.schemaVersion !== 1 || report.proofKind !== 'sartracker-settings-probe-v1') {
    failures.push('C16 requires the packaged settings probe schema v1 report.')
  }

  if (isRecord(report)) {
    predicates.identity = validateIdentity(report, binding, failures)
    predicates.startupRecovery = validateStartup(report, failures)
    const sessions = isRecord(report.sessions) ? report.sessions : {}
    predicates.saveRestartReadback = validateSession(
      sessions.saveRestartReadback,
      { before: 'legacy', after: 'present', label: 'save/restart read-back' },
      failures,
    )
    predicates.clearSecretRestart = validateSession(
      sessions.clearSecretRestart,
      { before: 'present', after: 'cleared', label: 'clear-secret/restart' },
      failures,
    )
    predicates.reentryRestart = validateSession(
      sessions.reentrySecretRestart,
      { before: 'cleared', after: 'present', label: 'secret re-entry/restart' },
      failures,
    )
    predicates.urlCredentialRejection = validateUrlCredentials(report, failures)
    predicates.custody = validateCustody(report, failures)
  } else {
    failures.push('C16 settings report must be an object.')
  }

  const uniqueFailures = [...new Set(failures)]
  const passed = uniqueFailures.length === 0 && Object.values(predicates).every(Boolean)
  return Object.freeze({
    contractId,
    status: passed ? 'PASS' : 'INVALID_EVIDENCE',
    valid: passed,
    passed,
    proofMode: PROOF_MODE,
    recomputedPredicates: Object.freeze(predicates),
    coverageComplete: false,
    qualificationEligible: false,
    releaseEligible: false,
    uncoveredAxes: SETTINGS_PROBE_DESCRIPTOR.uncoveredAxes,
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Alias used by callers that name the producer rather than the contract. */
export const validateSettingsProbeEvidence = validateSettingsContractEvidence
export const validateSettingsProbeReceipt = validateSettingsContractEvidence
export const SETTINGS_RECEIPT_DESCRIPTOR = SETTINGS_PROBE_DESCRIPTOR

/** Validate controller-owned identity, workload and process facts before report comparison. */
function validateExpected(expected) {
  if (!isRecord(expected)) throw new Error('Expected C16 settings binding must be an object.')
  if (expected.proofMode !== PROOF_MODE) throw new Error('Expected C16 proof mode is not the packaged settings probe.')
  if (!isRecord(expected.source) || !SHA1.test(expected.source.expectedHead)
      || !SHA1.test(expected.source.tree)) {
    throw new Error('Expected C16 source binding requires SHA-1 head and tree values.')
  }
  if (!isRecord(expected.artifact)
      || !SHA256.test(expected.artifact.packagedApplicationArchiveSha256)
      || !SHA256.test(expected.artifact.packagedExecutableSha256)) {
    throw new Error('Expected C16 artifact binding requires packaged archive and executable SHA-256 values.')
  }
  if (!isRecord(expected.workload)
      || expected.workload.profileId !== PROFILE_ID
      || expected.workload.providerType !== 'traccar_http'
      || !SHA256.test(expected.workload.baseUrlSha256)) {
    throw new Error('Expected C16 workload binding must name the synthetic settings profile and URL digest.')
  }
  if (!isRecord(expected.process) || expected.process.tier !== PROOF_MODE) {
    throw new Error('Expected C16 process binding must use the packaged disposable-settings tier.')
  }
  return expected
}

/** Compare source, archive, executable, workload and process identity facts. */
function validateIdentity(report, expected, failures) {
  const source = report.source
  const build = report.buildIdentity
  const workload = report.workload
  const process = report.process
  let passed = true
  if (!isRecord(source) || source.head !== expected.source.expectedHead || source.tree !== expected.source.tree) {
    failures.push('C16 source head/tree is not independently bound to the expected source.')
    passed = false
  }
  if (!isRecord(build) || build.packaged !== true
      || build.asarSha256 !== expected.artifact.packagedApplicationArchiveSha256
      || build.executableSha256 !== expected.artifact.packagedExecutableSha256) {
    failures.push('C16 packaged archive/executable identity is missing or differs from the expected artifact.')
    passed = false
  }
  if (!isRecord(workload) || workload.profileId !== expected.workload.profileId
      || workload.providerType !== expected.workload.providerType
      || workload.baseUrlSha256 !== expected.workload.baseUrlSha256
      || workload.networkContactAttempted !== false) {
    failures.push('C16 workload identity is missing, differs, or records provider contact.')
    passed = false
  }
  if (!isRecord(process) || process.tier !== expected.process.tier) {
    failures.push('C16 launched process tier is missing or differs from the expected packaged tier.')
    passed = false
  }
  return passed
}

/** Recompute the startup recovery warning and Settings action predicates. */
function validateStartup(report, failures) {
  const startup = report.startup
  if (!isRecord(startup) || startup.shellReached !== true || startup.runtimeFaultVisible !== false) {
    failures.push('C16 bad-secret startup did not reach the normal shell without a runtime fault.')
    return false
  }
  const warning = startup.trackingWarning
  const actions = Array.isArray(warning?.actions) ? warning.actions : []
  const actionSet = new Set(actions)
  const initial = startup.initialSettings
  let passed = true
  if (!isRecord(warning) || warning.exactText !== WARNING_TEXT || warning.actionable !== true
      || !actionSet.has('open-settings-workspace') || !actionSet.has('settings-provider-secret')) {
    failures.push('C16 startup recovery warning or re-entry action is incomplete.')
    passed = false
  }
  if (!isRecord(initial) || initial.secretPresent !== true || initial.providerType !== 'traccar_http') {
    failures.push('C16 startup did not expose the undecryptable synthetic credential as recoverable settings state.')
    passed = false
  }
  return passed
}

/** Validate one save/restart transition using raw file generations and secret states. */
function validateSession(session, shape, failures) {
  if (!isRecord(session)) {
    failures.push(`C16 ${shape.label} observation is missing.`)
    return false
  }
  const before = validateSnapshot(session.before, `${shape.label} before`, failures)
  const afterSave = validateSnapshot(session.afterSave, `${shape.label} after save`, failures)
  const afterRestart = validateSnapshot(session.afterRestart, `${shape.label} after restart`, failures)
  let passed = before !== null && afterSave !== null && afterRestart !== null
  if (!passed) return false

  if (before.secretState !== shape.before || afterSave.secretState !== shape.after) {
    failures.push(`C16 ${shape.label} has the wrong before/after credential state.`)
    passed = false
  }
  if (!samePersistenceState(afterSave, afterRestart)) {
    failures.push(`C16 ${shape.label} restart did not read back the saved settings and credential generation.`)
    passed = false
  }
  if (before.settingsFile.credentialGeneration === afterSave.settingsFile.credentialGeneration) {
    failures.push(`C16 ${shape.label} did not record a new settings credential generation.`)
    passed = false
  }
  if (afterSave.settingsFile.credentialGeneration !== afterSave.credentialsFile.generation) {
    failures.push(`C16 ${shape.label} settings and credentials generations do not match.`)
    passed = false
  }
  if (shape.after === 'present') {
    if (afterSave.view.secretPresent !== true || !SHA256.test(afterSave.credentialsFile.secretSha256 ?? '')) {
      failures.push(`C16 ${shape.label} lacks a hashed stored secret observation.`)
      passed = false
    }
  } else if (afterSave.view.secretPresent !== false || afterSave.credentialsFile.secretSha256 !== null) {
    failures.push(`C16 ${shape.label} clear state still exposes a stored secret.`)
    passed = false
  }
  return passed
}

/** Validate one redacted settings/profile observation and its generation shape. */
function validateSnapshot(snapshot, label, failures) {
  if (!isRecord(snapshot) || !isRecord(snapshot.settingsFile)
      || !isRecord(snapshot.credentialsFile) || !isRecord(snapshot.view)) {
    failures.push(`C16 ${label} snapshot is incomplete.`)
    return null
  }
  const settings = snapshot.settingsFile
  const credentials = snapshot.credentialsFile
  const view = snapshot.view
  let valid = true
  if (settings.present !== true || !SHA256.test(settings.sha256 ?? '')) {
    failures.push(`C16 ${label} settings file digest is missing.`)
    valid = false
  }
  if (settings.credentialGeneration !== null && !UUID.test(settings.credentialGeneration ?? '')) {
    failures.push(`C16 ${label} settings credential generation is invalid.`)
    valid = false
  }
  if (credentials.present === true) {
    if (!SHA256.test(credentials.sha256 ?? '') || credentials.version !== 2
        || credentials.authMode !== 'basic' || !UUID.test(credentials.generation ?? '')) {
      failures.push(`C16 ${label} app-owned credential file identity is invalid.`)
      valid = false
    }
  } else if (credentials.secretState !== 'legacy' || credentials.sha256 !== null
      || credentials.generation !== null) {
    failures.push(`C16 ${label} legacy credential state is not explicitly redacted.`)
    valid = false
  }
  if (!['legacy', 'present', 'cleared'].includes(credentials.secretState)) {
    failures.push(`C16 ${label} secret state is invalid.`)
    valid = false
  }
  if (credentials.secretSha256 !== null && !SHA256.test(credentials.secretSha256 ?? '')) {
    failures.push(`C16 ${label} secret digest is invalid.`)
    valid = false
  }
  if (settings.dataSource?.providerType !== 'traccar_http'
      || settings.dataSource?.authMode !== 'basic'
      || settings.dataSource?.baseUrlSha256 !== view.baseUrlSha256
      || settings.dataSource?.emailSha256 !== view.emailSha256
      || settings.dataSource?.autoConnect !== false
      || settings.dataSource?.trackingCacheEnabled !== true
      || view.providerType !== 'traccar_http'
      || view.authMode !== 'basic'
      || typeof view.secretPresent !== 'boolean') {
    failures.push(`C16 ${label} settings view is not coherent with the persisted provider state.`)
    valid = false
  }
  if (credentials.secretState === 'legacy' && view.secretPresent !== true) {
    failures.push(`C16 ${label} legacy startup state does not preserve stored-secret presence for re-entry.`)
    valid = false
  }
  return valid ? { ...snapshot, secretState: credentials.secretState } : null
}

/** Compare state that must survive restart while allowing future receipt metadata to grow. */
function samePersistenceState(left, right) {
  return JSON.stringify({
    settings: left.settingsFile,
    credentials: left.credentialsFile,
    view: left.view,
  }) === JSON.stringify({
    settings: right.settingsFile,
    credentials: right.credentialsFile,
    view: right.view,
  })
}

/** Recompute the URL-credential rejection, preserving the exact user-facing message. */
function validateUrlCredentials(report, failures) {
  const observation = report.urlCredentials
  if (!isRecord(observation) || observation.attempted !== true || observation.rejected !== true
      || observation.saveDisabled !== true || observation.message !== URL_CREDENTIALS_ERROR) {
    failures.push('C16 provider URL credentials were not independently rejected with the exact actionable message.')
    return false
  }
  return true
}

/** Ensure the receipt contains only redacted secret observations. */
function validateCustody(report, failures) {
  const custody = report.custody
  if (!isRecord(custody) || custody.rawSecretValuesIncluded !== false
      || custody.secretCanaryAbsent !== true || custody.legacyCiphertextCanaryAbsent !== true) {
    failures.push('C16 receipt custody does not prove that fixture secrets and legacy ciphertext are absent from output.')
    return false
  }
  return true
}

/** Identify record-like values without accepting arrays as evidence objects. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
