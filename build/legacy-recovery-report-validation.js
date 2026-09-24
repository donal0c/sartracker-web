import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { validateMainPhaseEvidence } from './main-event-loop-probe.js'
import checkpointContract from '../electron/legacy-evidence-backfill-checkpoint.cjs'

const { validateLegacyEvidenceBackfillCheckpoint } = checkpointContract

const EXPECTED_BASELINE_ROWS = 50_000
const SOURCE_FILES = {
  scriptSha256: 'scripts/electron-legacy-object-recovery-smoke.mjs',
  mainTimerSha256: 'build/main-event-loop-probe.js',
  custodyOracleSha256: 'build/electron-legacy-object-recovery-custody.js',
}
const PACKAGED_FILES = [
  'electron/legacy-evidence-backfill-runner.cjs',
  'electron/legacy-evidence-backfill-worker.cjs',
  'electron/legacy-evidence-backfill-checkpoint.cjs',
  'electron/mission-evidence-version-store.cjs',
  'electron/mission-store.cjs',
  'electron/mission-worker.cjs',
  'electron/responsive-mission-writer.cjs',
]

/**
 * Validates one terminal packaged legacy-recovery report against the current
 * checkout. The report's own `passed` flag is treated as untrusted input.
 */
export function validateLegacyRecoveryReport(report, options = {}) {
  const failures = []
  const projectRoot = options.projectRoot ?? process.cwd()
  const expectedSourceSha = options.expectedSourceSha ?? process.env.EXPECTED_SOURCE_SHA

  if (!isSha(expectedSourceSha, 40)) {
    failures.push('EXPECTED_SOURCE_SHA must be a 40-character lowercase commit SHA.')
  }

  if (!isObject(report)) {
    return ['Legacy recovery report is missing or is not a JSON object.']
  }

  if (report.issue !== 'DON-254') failures.push('Report issue is not DON-254.')
  if (report.proofTier !== 'diagnostic-only second disposable mission store using packaged production store/runner via an injected factory; no default app wiring or operator-load qualification') {
    failures.push('Report proof tier must retain the diagnostic-only injected-store scope.')
  }
  if (report.passed !== true) failures.push('Packaged legacy recovery report did not pass.')
  if (report.failure !== undefined && report.failure !== null) failures.push('Report contains a failure alongside passed=true.')
  if (report.expectedBaselineRows !== EXPECTED_BASELINE_ROWS) {
    failures.push('Report expected baseline is not exactly 50,000 rows.')
  }
  if (!['linux', 'darwin', 'win32'].includes(report.hostPlatform)) {
    failures.push('Report host platform is missing or unsupported.')
  }

  const source = readGitSource(projectRoot, failures)
  if (typeof expectedSourceSha === 'string' && source.head !== null && source.head !== expectedSourceSha) {
    failures.push(`Checkout HEAD ${source.head} does not match EXPECTED_SOURCE_SHA ${expectedSourceSha}.`)
  }
  if (source.head !== null && report.sourceHead !== source.head) {
    failures.push('Report sourceHead does not match the checked-out HEAD.')
  }
  if (source.tree !== null && report.sourceTree !== source.tree) {
    failures.push('Report sourceTree does not match the checked-out tree.')
  }
  if (report.sourceDirty !== false) failures.push('Report source tree is dirty.')

  validateProbeHashes(report, projectRoot, failures)
  validatePackagedIdentity(report, projectRoot, failures)
  validateFixture(report, failures)
  validateFirstLaunch(report, failures)
  validateRestart(report, failures)
  if (!Array.isArray(report.cleanupFailures) || report.cleanupFailures.length !== 0) {
    failures.push('Packaged legacy recovery cleanup reported failures.')
  }
  return failures
}

/** Reads the immutable Git identity needed to bind a terminal report. */
function readGitSource(projectRoot, failures) {
  try {
    return {
      head: gitValue(projectRoot, ['rev-parse', 'HEAD']),
      tree: gitValue(projectRoot, ['rev-parse', 'HEAD^{tree}']),
    }
  } catch (error) {
    failures.push(`Could not read checked-out Git identity: ${error.message}`)
    return { head: null, tree: null }
  }
}

/** Runs one Git query and trims its single scalar result. */
function gitValue(projectRoot, args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
}

/** Checks every independently hashed probe input against the checkout. */
function validateProbeHashes(report, projectRoot, failures) {
  const probeSource = objectValue(report.probeSource)
  if (probeSource === null) {
    failures.push('Probe source hashes are missing.')
    return
  }
  for (const [key, relativePath] of Object.entries(SOURCE_FILES)) {
    const reported = probeSource[key]
    if (!isSha(reported)) {
      failures.push(`Probe source hash ${key} is missing or malformed.`)
      continue
    }
    try {
      const actual = sha256File(path.join(projectRoot, relativePath))
      if (reported !== actual) failures.push(`Probe source hash ${key} does not match ${relativePath}.`)
    } catch (error) {
      failures.push(`Probe source ${relativePath} could not be hashed: ${error.message}`)
    }
  }
}

/** Checks packaged identity and all seven production source hashes. */
function validatePackagedIdentity(report, projectRoot, failures) {
  const packaged = objectValue(report.packaged)
  if (packaged === null) {
    failures.push('Packaged identity evidence is missing.')
    return
  }
  if (typeof packaged.bindingScope !== 'string' || packaged.bindingScope.length === 0) {
    failures.push('Packaged binding scope is missing.')
  }
  if (!isSha(packaged.executableSha256)) failures.push('Packaged executable hash is missing or malformed.')
  if (!isSha(packaged.asarSha256)) failures.push('Packaged ASAR hash is missing or malformed.')
  const files = objectValue(packaged.files)
  if (files === null) {
    failures.push('Packaged production source hashes are missing.')
    return
  }
  for (const relativePath of PACKAGED_FILES) {
    const entry = objectValue(files[relativePath])
    if (entry === null) {
      failures.push(`Packaged source hash entry is missing for ${relativePath}.`)
      continue
    }
    if (!isSha(entry.checkoutSha256) || !isSha(entry.packagedSha256)) {
      failures.push(`Packaged source hashes are malformed for ${relativePath}.`)
      continue
    }
    if (entry.checkoutSha256 !== entry.packagedSha256) {
      failures.push(`Packaged source differs from checkout for ${relativePath}.`)
    }
    try {
      if (entry.checkoutSha256 !== sha256File(path.join(projectRoot, relativePath))) {
        failures.push(`Packaged checkout hash does not match current ${relativePath}.`)
      }
    } catch (error) {
      failures.push(`Packaged source ${relativePath} could not be hashed: ${error.message}`)
    }
  }
}

/** Validates the disposable fixture identity and cross-phase baseline digest. */
function validateFixture(report, failures) {
  const fixture = objectValue(report.fixture)
  if (fixture === null) {
    failures.push('Recovery fixture evidence is missing.')
  } else {
    if (typeof fixture.missionId !== 'string' || fixture.missionId.length === 0) failures.push('Recovery fixture mission ID is missing.')
    if (fixture.baselineMarkerRows !== EXPECTED_BASELINE_ROWS) failures.push('Recovery fixture baseline is not exactly 50,000 markers.')
    if (!isSha(fixture.sqliteSha256)) failures.push('Recovery fixture SQLite hash is missing or malformed.')
  }
  if (!isSha(report.seededMarkerDigest)) failures.push('Seeded marker digest is missing or malformed.')
  if (!isSha(report.settledBaselineDigest)) failures.push('Settled baseline digest is missing or malformed.')
}

/** Validates the first launch's worker, fail-closed, timing, and row evidence. */
function validateFirstLaunch(report, failures) {
  const launch = objectValue(report.firstLaunch)
  if (launch === null) {
    failures.push('First-launch recovery evidence is missing.')
    return
  }
  validateUnderThreshold(launch.openMs, 'first-launch store open', failures)
  validateUnderThreshold(launch.currentWriteMs, 'first-launch current write', failures)
  if (launch.workerCount !== 1) failures.push('First launch did not start exactly one recovery worker.')
  validateThreadIdentity(launch, failures, 'first launch')
  const observer = objectValue(launch.observer)
  if (observer === null) {
    failures.push('First-launch off-main observer evidence is missing.')
  } else {
    if (observer.count !== EXPECTED_BASELINE_ROWS) failures.push('Off-main observer did not reach exactly 50,000 rows.')
    if (observer.observerRealm !== 'controller-process') failures.push('Off-main observer realm is missing or not the controller process.')
    validatePositiveInteger(observer.samples, 'off-main observer samples', failures)
    validateDuration(observer.maximumQueryMs, 'off-main observer maximum query', failures)
  }
  validateMainTimer(launch.mainTimer, 'first-launch recovery timer', failures)
  validateRows(launch.rows, report.seededMarkerDigest, report.settledBaselineDigest, EXPECTED_BASELINE_ROWS, 'first-launch rows', failures)
  validateFailClosed(report.failClosedBeforeSettlement, failures)
  const close = objectValue(launch.close)
  if (close === null) {
    failures.push('First-launch close evidence is missing.')
  } else {
    validateDuration(close.prepareCloseMs, 'first-launch prepareClose', failures)
    validateDuration(close.closeMs, 'first-launch close', failures)
    validateMainTimer(close.timer, 'first-launch close timer', failures)
  }
  validateCleanExit(launch.appClose, 'first launch', failures)
}

/** Validates restart timing, baseline preservation, and post-settlement custody. */
function validateRestart(report, failures) {
  const restart = objectValue(report.restart)
  const first = objectValue(report.firstLaunch)
  if (restart === null) {
    failures.push('Restart recovery evidence is missing.')
    return
  }
  validateUnderThreshold(restart.openMs, 'restart store open', failures)
  if (restart.workerCount !== 0) failures.push('Restart unexpectedly started another recovery worker.')
  validateThreadIdentity(restart, failures, 'restart', restart.workerCount === 1)
  validateMainTimer(restart.openTimer, 'restart open timer', failures)
  const seededDigest = report.seededMarkerDigest
  const settledDigest = report.settledBaselineDigest
  validateRows(restart.rowsBeforeMutation, seededDigest, settledDigest, EXPECTED_BASELINE_ROWS, 'restart pre-mutation rows', failures)
  validateRows(restart.rowsAfterMutation, seededDigest, settledDigest, EXPECTED_BASELINE_ROWS, 'restart post-mutation baseline rows', failures, EXPECTED_BASELINE_ROWS + 1)
  const mutation = objectValue(restart.postSettlementMutation)
  if (mutation === null) {
    failures.push('Post-settlement mutation evidence is missing.')
  } else {
    if (typeof mutation.markerId !== 'string' || mutation.markerId.length === 0) failures.push('Post-settlement marker ID is missing.')
    validateMainTimer(mutation.timer, 'post-settlement mutation timer', failures)
    failures.push(...validateMainPhaseEvidence(
      mutation.phaseTimings,
      ['marker-mutation', 'prepare-close', 'close'],
      report.hostPlatform,
    ))
  }
  validateCustody(restart.postSettlementCustody, mutation?.markerId, failures)
  validateCleanExit(restart.appClose, 'restart', failures)
  const before = objectValue(restart.rowsBeforeMutation)
  const firstRows = first === null ? null : objectValue(first.rows)
  if (before !== null && firstRows !== null) {
    if (before.markerDigest !== firstRows.markerDigest) failures.push('Restart changed the baseline marker digest.')
    if (before.baselineDigest !== firstRows.baselineDigest) failures.push('Restart changed the settled baseline digest.')
  }
}

/** Validates one worker/main identity pair from a real production report. */
function validateThreadIdentity(launch, failures, phase, requiresCompletion = true) {
  if (!isNonnegativeSafeInteger(launch.parentThreadId)) {
    failures.push(`${phase} parent thread ID is missing or malformed.`)
  }
  if (!requiresCompletion) return
  const completions = launch.workerCompletion
  if (!Array.isArray(completions) || completions.length !== 1) {
    failures.push(`${phase} worker completion evidence is missing or duplicated.`)
    return
  }
  const completion = objectValue(completions[0])
  if (completion === null || !isPositiveSafeInteger(completion.workerThreadId)) {
    failures.push(`${phase} worker thread ID is missing or malformed.`)
  } else if (completion.workerThreadId === launch.parentThreadId) {
    failures.push(`${phase} recovery worker reported the caller's thread.`)
  }
  validateCheckpointReceipt(completion?.checkpoint, `${phase} WAL checkpoint receipt`, failures)
  if (completion?.stopped === true) failures.push(`${phase} recovery worker was stopped before completion.`)
}

/** Requires a completed, durable WAL checkpoint receipt from the recovery worker. */
function validateCheckpointReceipt(value, label, failures) {
  const checkpoint = objectValue(value)
  const reason = validateLegacyEvidenceBackfillCheckpoint(
    checkpoint,
    checkpoint?.walSidecarBytes,
    { requireComplete: true },
  )
  if (reason !== null) failures.push(`${label} is missing or invalid: ${reason}`)
}

/** Validates all exact 50,000-row custody counters and cross-phase digests. */
function validateRows(rowsValue, markerDigest, baselineDigest, expectedMarkerCount, label, failures, expectedTotalMarkerCount = expectedMarkerCount) {
  const rows = objectValue(rowsValue)
  if (rows === null) {
    failures.push(`${label} are missing.`)
    return
  }
  for (const key of ['markerCount', 'versionCount', 'distinctVersionCount', 'baselineCount']) {
    if (rows[key] !== expectedMarkerCount) failures.push(`${label} ${key} is not exactly ${expectedMarkerCount}.`)
  }
  if (rows.totalMarkerCount !== expectedTotalMarkerCount) failures.push(`${label} total marker count is not exactly ${expectedTotalMarkerCount}.`)
  if (rows.missingCustody !== 0) failures.push(`${label} contains missing custody rows.`)
  if (rows.duplicateObjects !== 0) failures.push(`${label} contains duplicate custody rows.`)
  if (rows.markerDigest !== markerDigest) failures.push(`${label} marker digest does not match the seeded fixture.`)
  if (rows.baselineDigest !== baselineDigest) failures.push(`${label} baseline digest does not match settled recovery.`)
}

/** Requires the original fail-closed errors to remain visible before settlement. */
function validateFailClosed(value, failures) {
  const failClosed = objectValue(value)
  if (failClosed === null) {
    failures.push('Pre-settlement fail-closed evidence is missing.')
    return
  }
  for (const key of ['listVersions', 'upsertMarker']) {
    if (typeof failClosed[key] !== 'string' || !/background|reconstruct|preparation/iu.test(failClosed[key])) {
      failures.push(`Pre-settlement fail-closed ${key} evidence is missing or incomplete.`)
    }
  }
}

/** Requires a clean native application exit with no signal. */
function validateCleanExit(value, phase, failures) {
  const exit = objectValue(value)
  if (exit === null || exit.code !== 0 || exit.signal !== null) {
    failures.push(`${phase} packaged application did not exit cleanly.`)
  }
}

/** Validates one full main-loop timer record and rejects the 200 ms threshold. */
function validateMainTimer(value, label, failures) {
  const timer = objectValue(value)
  if (timer === null || timer.intervalMs !== 50 || !isPositiveSafeInteger(timer.samples)
    || !isFiniteNonnegative(timer.startedAtMs) || !isFiniteNonnegative(timer.stoppedAtMs)
    || timer.stoppedAtMs <= timer.startedAtMs || !isFiniteNonnegative(timer.maximumGapMs)) {
    failures.push(`${label} is missing or malformed.`)
    return
  }
  if (timer.maximumGapMs >= 200) failures.push(`${label} reached the 200 ms stall threshold.`)
}

/** Validates one nonnegative operation duration without imposing a new gate. */
function validateDuration(value, label, failures) {
  if (!isFiniteNonnegative(value)) failures.push(`${label} is missing or malformed.`)
}

/** Rejects a measured operation at or above the unchanged 200 ms gate. */
function validateUnderThreshold(value, label, failures) {
  validateDuration(value, label, failures)
  if (isFiniteNonnegative(value) && value >= 200) failures.push(`${label} reached the 200 ms gate.`)
}

/** Requires a positive safe integer and emits a phase-specific error. */
function validatePositiveInteger(value, label, failures) {
  if (!isPositiveSafeInteger(value)) failures.push(`${label} is missing or malformed.`)
}

/** Validates the exact created/complete version and linked audit event. */
function validateCustody(value, expectedMarkerId, failures) {
  const custody = objectValue(value)
  if (custody === null) {
    failures.push('Post-settlement marker custody evidence is missing.')
    return
  }
  if (typeof expectedMarkerId !== 'string' || expectedMarkerId.length === 0 || custody.markerId !== expectedMarkerId) {
    failures.push('Post-settlement custody does not identify the created marker.')
  }
  if (typeof custody.versionId !== 'string' || custody.versionId.length === 0) failures.push('Post-settlement version identity is missing.')
  if (custody.versionSequence !== 1) failures.push('Post-settlement custody version sequence is not 1.')
  if (custody.operation !== 'created') failures.push('Post-settlement custody operation is not created.')
  if (custody.completeness !== 'complete') failures.push('Post-settlement custody is incomplete.')
  if (typeof custody.auditEventId !== 'string' || custody.auditEventId.length === 0) failures.push('Post-settlement audit identity is missing.')
  if (custody.auditEventType !== 'marker_created') failures.push('Post-settlement audit event is not marker_created.')
  if (custody.stateMatchesProjection !== true || custody.auditMatchesProjection !== true) {
    failures.push('Post-settlement marker or audit projection does not match custody.')
  }
}

/** Returns a plain object while keeping malformed report input rejectable. */
function objectValue(value) {
  return isObject(value) ? value : null
}

/** Checks a JSON value for a plain object shape sufficient for field reads. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Checks a lowercase hexadecimal digest of the requested length. */
function isSha(value, length = 64) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value)
}

/** Checks a safe integer greater than zero. */
function isPositiveSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Checks a safe integer at or above zero. */
function isNonnegativeSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Checks a finite nonnegative duration. */
function isFiniteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Computes a SHA-256 digest for one checkout file. */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}
