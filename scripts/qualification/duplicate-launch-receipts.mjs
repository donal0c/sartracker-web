import path from 'node:path'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const REPORT_KEYS = Object.freeze([
  'app', 'contractId', 'invocation', 'network', 'persistence', 'primary', 'profile',
  'proofKind', 'schemaVersion', 'secondary', 'source',
])
const EXPECTED_KEYS = Object.freeze(['appPath', 'appSha256', 'evidencePath', 'profilePath', 'sourceHead'])
const SOURCE_KEYS = Object.freeze(['dirty', 'expectedHead', 'observedHead'])
const APP_KEYS = Object.freeze(['path', 'sha256', 'sizeBytes'])
const INVOCATION_KEYS = Object.freeze(['app', 'evidence', 'expectedHead', 'networkBlocked', 'userDataPath'])
const PROFILE_KEYS = Object.freeze(['observedUserDataPaths', 'path', 'removed', 'usedSystemUserProfile', 'userDataPath'])
const PRIMARY_KEYS = Object.freeze(['afterSecondary', 'first', 'firstExit', 'restart', 'restartExit'])
const LAUNCH_KEYS = Object.freeze(['pid', 'ready', 'stderr', 'windowCount'])
const EXIT_KEYS = Object.freeze(['exitCode', 'signal'])
const SECONDARY_KEYS = Object.freeze([
  'exitCode', 'exited', 'missionWriteAttempted', 'pid', 'signal', 'singleInstanceRejected',
  'started', 'stderr', 'windowCount',
])
const AFTER_SECONDARY_KEYS = Object.freeze(['pageResponsive', 'windowCount'])
const PERSISTENCE_KEYS = Object.freeze(['afterRestart', 'afterSecondary', 'authoritative', 'initial', 'missionId'])
const SNAPSHOT_KEYS = Object.freeze(['auditTypes', 'missionIds'])
const AUTHORITATIVE_KEYS = Object.freeze([
  'duplicateMissionCreatedAudits', 'duplicateMissions', 'mainProcesses', 'missionCreatedAudits', 'missions',
])
const NETWORK_KEYS = Object.freeze(['blocked', 'httpRequests', 'httpsRequests'])
const STDERR_KEYS = Object.freeze(['byteLength', 'lines', 'sha256'])

/** Independently validate one exact duplicate-launch receipt. */
export function validateDuplicateLaunchReceipt(report, expected) {
  const failures = []
  const binding = readExpected(expected, failures)
  if (binding !== null) validateReport(report, binding, failures)
  const passed = failures.length === 0
  return Object.freeze({
    contractId: 'C26',
    status: passed ? 'PASS' : 'INVALID_EVIDENCE',
    valid: passed,
    passed,
    releaseEligible: false,
    sourceHead: binding?.sourceHead ?? null,
    appPath: binding?.appPath ?? null,
    profilePath: binding?.profilePath ?? null,
    primary: clone(report?.primary),
    secondary: clone(report?.secondary),
    persistence: clone(report?.persistence),
    network: clone(report?.network),
    failureReasons: Object.freeze([...new Set(failures)]),
  })
}

/** Read and validate the controller-owned artifact/source/profile identities. */
function readExpected(expected, failures) {
  if (!hasExactKeys(expected, EXPECTED_KEYS)) {
    failures.push('C26 expected binding has missing or unsupported fields.')
    return null
  }
  if (!SHA256.test(expected.appSha256)) failures.push('C26 expected app SHA-256 is invalid.')
  if (!SHA1.test(expected.sourceHead)) failures.push('C26 expected source head is invalid.')
  validateAbsolutePath(expected.appPath, 'C26 expected app path', failures)
  validateAbsolutePath(expected.evidencePath, 'C26 expected evidence path', failures)
  validateAbsolutePath(expected.profilePath, 'C26 expected profile path', failures)
  if (!expected.profilePath.startsWith(`${expected.evidencePath}${path.sep}`)) {
    failures.push('C26 disposable profile escaped the evidence directory.')
  }
  return expected
}

/** Validate the closed report schema and every observed predicate. */
function validateReport(report, expected, failures) {
  if (!hasExactKeys(report, REPORT_KEYS)) {
    failures.push('C26 duplicate-launch report has missing or unsupported fields.')
    return
  }
  if (report.schemaVersion !== 1 || report.proofKind !== 'duplicate-launch-v1' || report.contractId !== 'C26') {
    failures.push('C26 report identity is invalid.')
  }
  validateSource(report.source, expected.sourceHead, failures)
  validateApp(report.app, expected, failures)
  validateInvocation(report.invocation, expected, failures)
  validateProfile(report.profile, expected.profilePath, failures)
  const pids = validatePrimary(report.primary, failures)
  validateSecondary(report.secondary, pids, failures)
  validatePersistence(report.persistence, failures)
  validateNetwork(report.network, failures)
}

/** Require the exact expected source head and a clean source tree. */
function validateSource(source, expectedHead, failures) {
  if (!hasExactKeys(source, SOURCE_KEYS) || source.expectedHead !== expectedHead
      || source.observedHead !== expectedHead || source.dirty !== false) {
    failures.push('C26 source head or clean-tree evidence is missing or substituted.')
  }
}

/** Require the exact packaged executable path and digest supplied by the controller. */
function validateApp(app, expected, failures) {
  if (!hasExactKeys(app, APP_KEYS) || app.path !== expected.appPath || app.sha256 !== expected.appSha256) {
    failures.push('C26 executable path or SHA-256 differs from the expected artifact.')
  }
  if (hasExactKeys(app, APP_KEYS) && !SHA256.test(app.sha256)) failures.push('C26 app SHA-256 is invalid.')
  if (hasExactKeys(app, APP_KEYS) && (!Number.isSafeInteger(app.sizeBytes) || app.sizeBytes < 1)) {
    failures.push('C26 app size is invalid.')
  }
}

/** Ensure the probe reported the exact bounded command and disposable user-data binding. */
function validateInvocation(invocation, expected, failures) {
  if (!hasExactKeys(invocation, INVOCATION_KEYS)
      || invocation.app !== '--app' || invocation.evidence !== '--evidence'
      || invocation.expectedHead !== '--expected-head' || invocation.networkBlocked !== true
      || invocation.userDataPath !== expected.profilePath) {
    failures.push('C26 invocation did not retain the exact app/evidence/head and blocked-network binding.')
  }
}

/** Reject use of the operator user profile and require disposable-profile removal. */
function validateProfile(profile, expectedPath, failures) {
  if (!hasExactKeys(profile, PROFILE_KEYS)
      || profile.path !== expectedPath || profile.userDataPath !== expectedPath
      || !Array.isArray(profile.observedUserDataPaths)
      || profile.observedUserDataPaths.length !== 2
      || profile.observedUserDataPaths.some((value) => value !== expectedPath)
      || profile.removed !== true || profile.usedSystemUserProfile !== false) {
    failures.push('C26 profile custody is not disposable, exact, and removed.')
  }
}

/** Validate both primary launches and return their distinct process identities. */
function validatePrimary(primary, failures) {
  if (!hasExactKeys(primary, PRIMARY_KEYS)) {
    failures.push('C26 primary process facts are incomplete.')
    return []
  }
  const pids = []
  for (const field of ['first', 'restart']) {
    if (!hasExactKeys(primary[field], LAUNCH_KEYS)) {
      failures.push(`C26 primary ${field} launch facts are incomplete.`)
      continue
    }
    validateLaunch(primary[field], `C26 primary ${field}`, failures)
    pids.push(primary[field].pid)
  }
  for (const field of ['firstExit', 'restartExit']) validateExit(primary[field], `C26 primary ${field}`, failures)
  validateAfterSecondary(primary.afterSecondary, failures)
  if (pids.length === 2 && (pids[0] === pids[1] || new Set(pids).size !== pids.length)) {
    failures.push('C26 primary and restart were not distinct owned processes.')
  }
  if (pids.length === 2 && pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)) {
    failures.push('C26 primary process identity is invalid.')
  }
  return pids
}

/** Validate one ready primary launch and its raw stderr fact. */
function validateLaunch(launch, label, failures) {
  if (!Number.isSafeInteger(launch.pid) || launch.pid < 1 || launch.ready !== true || launch.windowCount !== 1) {
    failures.push(`${label} did not prove one ready operational window.`)
  }
  validateStderr(launch.stderr, `${label} stderr`, failures)
}

/** Validate the first primary's liveness after the duplicate launch. */
function validateAfterSecondary(value, failures) {
  if (!hasExactKeys(value, AFTER_SECONDARY_KEYS) || value.pageResponsive !== true || value.windowCount !== 1) {
    failures.push('C26 primary was not shown responsive with one window after duplicate launch.')
  }
}

/** Validate one raw process exit fact without accepting a producer pass flag. */
function validateExit(value, label, failures) {
  if (!hasExactKeys(value, EXIT_KEYS) || value.exitCode !== 0 || value.signal !== null) {
    failures.push(`${label} did not exit cleanly.`)
  }
}

/** Validate the secondary process rejection and ensure it never wrote mission state. */
function validateSecondary(secondary, primaryPids, failures) {
  if (!hasExactKeys(secondary, SECONDARY_KEYS)) {
    failures.push('C26 secondary process facts are incomplete.')
    return
  }
  if (!Number.isSafeInteger(secondary.pid) || secondary.pid < 1 || primaryPids.includes(secondary.pid)
      || secondary.started !== true || secondary.exited !== true || secondary.exitCode !== 0
      || secondary.signal !== null || secondary.singleInstanceRejected !== true
      || secondary.windowCount !== 0 || secondary.missionWriteAttempted !== false) {
    failures.push('C26 secondary launch did not prove one rejected duplicate process with no writer.')
  }
  validateStderr(secondary.stderr, 'C26 secondary stderr', failures)
}

/** Validate the exact persisted mission and audit inventory across all phases. */
function validatePersistence(persistence, failures) {
  if (!hasExactKeys(persistence, PERSISTENCE_KEYS)
      || typeof persistence.missionId !== 'string' || persistence.missionId.length < 1) {
    failures.push('C26 persistence evidence is incomplete.')
    return
  }
  for (const phase of ['initial', 'afterSecondary', 'afterRestart']) {
    validateSnapshot(persistence[phase], persistence.missionId, `C26 persistence ${phase}`, failures)
  }
  if (!hasExactKeys(persistence.authoritative, AUTHORITATIVE_KEYS)
      || persistence.authoritative.mainProcesses !== 1
      || persistence.authoritative.missions !== 1
      || persistence.authoritative.missionCreatedAudits !== 1
      || persistence.authoritative.duplicateMissions !== 0
      || persistence.authoritative.duplicateMissionCreatedAudits !== 0) {
    failures.push('C26 authoritative mission/audit counts prove duplication or are incomplete.')
  }
}

/** Require one exact mission ID and one mission-created audit at every checkpoint. */
function validateSnapshot(snapshot, missionId, label, failures) {
  if (!hasExactKeys(snapshot, SNAPSHOT_KEYS) || !Array.isArray(snapshot.missionIds)
      || !Array.isArray(snapshot.auditTypes) || snapshot.missionIds.length !== 1
      || snapshot.missionIds[0] !== missionId || snapshot.auditTypes.length !== 1
      || snapshot.auditTypes[0] !== 'mission_created') {
    failures.push(`${label} is not one stable mission with one mission-created audit.`)
  }
}

/** Require network blocking and no HTTP(S) request attempts. */
function validateNetwork(network, failures) {
  if (!hasExactKeys(network, NETWORK_KEYS) || network.blocked !== true
      || network.httpRequests !== 0 || network.httpsRequests !== 0) {
    failures.push('C26 network boundary was not blocked or recorded zero HTTP(S) attempts.')
  }
}

/** Validate bounded raw stderr facts while retaining their digest and lines. */
function validateStderr(stderr, label, failures) {
  if (!hasExactKeys(stderr, STDERR_KEYS) || !SHA256.test(stderr.sha256)
      || !Number.isSafeInteger(stderr.byteLength) || stderr.byteLength < 0
      || !Array.isArray(stderr.lines) || stderr.lines.some((line) => typeof line !== 'string')) {
    failures.push(`${label} is not a bounded raw process fact.`)
  }
}

/** Validate one canonical absolute path. */
function validateAbsolutePath(value, label, failures) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    failures.push(`${label} is invalid.`)
  }
}

/** Return whether an object has exactly the requested own keys. */
function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

/** Clone report facts before returning them from the validator. */
function clone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}
