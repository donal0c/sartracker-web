import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { closeSync, lstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  validateC28VariantCoverage,
} from './composite-coverage.mjs'
import { selectPagingSource } from './paging-source.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const COMPOSITE_FAMILY_CONTRACTS = new Set(['C03', 'C11', 'C17'])
const PHASE_NAMES = Object.freeze([
  'settingsBootstrap',
  'missionOutingParticipants',
  'gpxDatedUndated',
  'markerSearch',
  'coverageReplay',
  'pauseRestart',
  'finishFinalizeArchive',
  'archiveReviewRestore',
  'sanitizedDiagnostics',
])
const REPORT_KEYS = Object.freeze([
  'app', 'contractId', 'diagnostics', 'gaps', 'invocation', 'mission', 'network',
  'phases', 'profile', 'proofKind', 'run', 'schemaVersion', 'source', 'stderr',
])
const EXPECTED_KEYS = Object.freeze([
  'appPath', 'appSha256', 'evidencePath', 'profilePath', 'sourceHead', 'sourceManifest', 'sourceRoot',
])
const FAILURE_VARIANT_OPERATIONS = Object.freeze({
  'failure-settings-bootstrap': 'saveAppSettings.invalid-shape',
  'failure-mission-outing': 'createOuting.overlapping-active',
  'failure-gpx': 'importGpxEvidencePaths.malformed',
  'failure-marker-search': 'upsertMarker.invalid-coordinate',
  'failure-coverage-replay': 'readMissionReplay.invalid-selected-time',
  'failure-pause-restart': 'resumeMission.finished-mission',
  'failure-finish-finalize-archive': 'finalizeMission.invalid-recovery',
  'failure-archive-review-restore': 'archiveReview.open.wrong-secret',
  'failure-sanitized-diagnostics': 'exportDiagnosticsReport.invalid-file-name',
})
const FAILURE_VARIANT_PHASES = Object.freeze({
  'failure-settings-bootstrap': 'settingsBootstrap',
  'failure-mission-outing': 'missionOutingParticipants',
  'failure-gpx': 'gpxDatedUndated',
  'failure-marker-search': 'markerSearch',
  'failure-coverage-replay': 'coverageReplay',
  'failure-pause-restart': 'pauseRestart',
  'failure-finish-finalize-archive': 'finishFinalizeArchive',
  'failure-archive-review-restore': 'archiveReviewRestore',
  'failure-sanitized-diagnostics': 'sanitizedDiagnostics',
})

/** Independently validates one packaged composite report against controller bindings. */
export function validateCompositeReceipt(report, expected) {
  const failures = []
  const binding = readExpected(expected, failures)
  if (binding !== null) validateReport(report, binding, failures)
  const uniqueFailures = [...new Set(failures)]
  const complete = uniqueFailures.length === 0
    && Array.isArray(report?.gaps)
    && report.gaps.length === 0
  return Object.freeze({
    contractId: 'C28',
    status: uniqueFailures.length > 0 ? 'INVALID_EVIDENCE' : complete ? 'PASS' : 'PASS_WITH_GAPS',
    valid: uniqueFailures.length === 0,
    passed: uniqueFailures.length === 0,
    complete,
    releaseEligible: false,
    sourceHead: binding?.sourceHead ?? null,
    appPath: binding?.appPath ?? null,
    profilePath: binding?.profilePath ?? null,
    mission: clone(report?.mission),
    phases: clone(report?.phases),
    gaps: clone(report?.gaps),
    diagnostics: clone(report?.diagnostics),
    network: clone(report?.network),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/**
 * Validates a C28 variant extension while keeping the routine receipt schema
 * compatible. The base receipt is validated after removing only this explicit
 * extension; all variant facts remain independently checked below.
 */
export function validateCompositeVariantReceipt(report, expected) {
  const failures = []
  const variant = report?.variant
  const binding = expected !== null && typeof expected === 'object' ? { ...expected } : expected
  if (binding !== null && typeof binding === 'object') delete binding.variantId
  const baseReport = report !== null && typeof report === 'object' ? { ...report } : report
  if (baseReport !== null && typeof baseReport === 'object') delete baseReport.variant
  const base = validateCompositeReceipt(baseReport, binding)
  failures.push(...base.failureReasons)
  const coverage = validateC28VariantCoverage({
    variantId: variant?.variantId,
    coveredAxes: variant?.coveredAxes,
    missingAxes: variant?.missingAxes,
    ...(variant !== null && typeof variant === 'object' && Object.hasOwn(variant, 'familyComplete')
      ? { familyComplete: variant.familyComplete }
      : {}),
  }, { contractId: 'C28', variantId: expected?.variantId })
  failures.push(...coverage.failureReasons)
  validateVariantFacts(variant?.variantId, variant?.facts, binding, failures)
  const uniqueFailures = [...new Set(failures)]
  const complete = uniqueFailures.length === 0 && base.complete
  return Object.freeze({
    ...base,
    status: uniqueFailures.length > 0 ? 'INVALID_EVIDENCE' : complete ? 'PASS' : 'PASS_WITH_GAPS',
    valid: uniqueFailures.length === 0,
    passed: uniqueFailures.length === 0,
    complete,
    variant: clone(variant),
    variantCoverage: coverage,
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Validates the actual raw facts owned by each fixed C28 variant. */
function validateVariantFacts(variantId, facts, expected, failures) {
  if (variantId === 'field-scale-seed') {
    if (!hasExactKeys(facts, [
      'backfillCheckpointCount', 'deviceCount', 'outingCount', 'participantCount', 'positionCount',
    ]) || facts.deviceCount !== 100 || facts.outingCount !== 12
      || facts.positionCount !== 100 || facts.participantCount !== 100
      || facts.backfillCheckpointCount !== 100) {
      failures.push('C28 field-scale facts do not prove the fixed 100-device, 12-outing workload.')
    }
    return
  }
  if (variantId === 'failure-injection') {
    if (!hasExactKeys(facts, [
      'afterCount', 'beforeCount', 'errorCode', 'errorMessage', 'errorMessageSha256',
      'errorName', 'mutationPreserved', 'operation', 'rejected',
    ]) || facts.operation !== 'addPosition.invalid-latitude' || facts.rejected !== true
      || facts.mutationPreserved !== true || facts.beforeCount !== facts.afterCount
      || !Number.isSafeInteger(facts.beforeCount) || facts.beforeCount < 0
      || typeof facts.errorName !== 'string' || facts.errorName.trim() === ''
      || (facts.errorCode !== null && typeof facts.errorCode !== 'string')
      || typeof facts.errorMessage !== 'string' || facts.errorMessage.trim() === ''
      || !SHA256.test(facts.errorMessageSha256)
      || sha256(Buffer.from(facts.errorMessage, 'utf8')) !== facts.errorMessageSha256) {
      failures.push('C28 failure-injection facts do not retain the actual rejection and mutation boundary.')
    }
    return
  }
  if (Object.hasOwn(FAILURE_VARIANT_OPERATIONS, variantId)) {
    const expectedOperation = FAILURE_VARIANT_OPERATIONS[variantId]
    if (!hasExactKeys(facts, [
      'afterState', 'afterStateSha256', 'beforeState', 'beforeStateSha256', 'errorCode',
      'errorMessage', 'errorMessageSha256', 'errorName', 'mutationPreserved', 'operation',
      'phase', 'rejected',
    ]) || facts.phase !== FAILURE_VARIANT_PHASES[variantId] || facts.operation !== expectedOperation
      || facts.rejected !== true || facts.mutationPreserved !== true
      || typeof facts.beforeState !== 'string' || typeof facts.afterState !== 'string'
      || facts.beforeState !== facts.afterState
      || !SHA256.test(facts.beforeStateSha256) || !SHA256.test(facts.afterStateSha256)
      || sha256(Buffer.from(facts.beforeState, 'utf8')) !== facts.beforeStateSha256
      || sha256(Buffer.from(facts.afterState, 'utf8')) !== facts.afterStateSha256
      || typeof facts.errorName !== 'string' || facts.errorName.trim() === ''
      || (facts.errorCode !== null && typeof facts.errorCode !== 'string')
      || typeof facts.errorMessage !== 'string' || facts.errorMessage.trim() === ''
      || !SHA256.test(facts.errorMessageSha256)
      || sha256(Buffer.from(facts.errorMessage, 'utf8')) !== facts.errorMessageSha256) {
      failures.push(`C28 ${variantId} facts do not retain the exact phase rejection and unchanged state boundary.`)
    }
    return
  }
  if (variantId === 'field-scale-960k' || variantId === 'field-scale-2m') {
    validateFieldScaleFacts(variantId, facts, expected?.fieldScaleFixture, expected?.evidencePath, failures)
    return
  }
  if (variantId === 'archive-revision-supplement') {
    if (!hasExactKeys(facts, [
      'archiveCount', 'firstArchiveId', 'previousArchiveId', 'previousArchiveSha256',
      'predecessorStatus', 'revisionCount', 'revisionSequence', 'secondArchiveId',
      'supplementAuthority', 'supplementReason',
    ]) || !nonEmpty(facts.firstArchiveId) || !nonEmpty(facts.secondArchiveId)
      || facts.firstArchiveId === facts.secondArchiveId
      || facts.previousArchiveId !== facts.firstArchiveId || !SHA256.test(facts.previousArchiveSha256)
      || facts.revisionSequence !== 2 || facts.revisionCount !== 2
      || facts.archiveCount !== 2 || facts.predecessorStatus !== 'superseded'
      || facts.supplementAuthority !== 'C28 Composite Admin'
      || facts.supplementReason !== 'C28 composite correction restore proof') {
      failures.push('C28 archive revision facts do not prove a predecessor-linked supplement chain.')
    }
    return
  }
  if (variantId === 'routine') {
    if (facts !== undefined) failures.push('C28 routine variant cannot carry unreviewed variant facts.')
    return
  }
  failures.push('C28 variant facts are unavailable for the requested producer variant.')
}

/** Re-opens the independently copied BCP source and binds every field-scale fact to it. */
function validateFieldScaleFacts(variantId, facts, fixture, evidencePath, failures) {
  const expectedRows = variantId === 'field-scale-960k' ? 960_000 : 2_000_000
  const requiredFactKeys = [
    'appDeviceCount', 'appOutingCount', 'appPositionCount', 'fixtureManifestPath',
    'fixtureCopyPath', 'fixtureCopySha256', 'fixtureManifestSha256', 'fixturePath', 'fixtureSha256', 'preset',
    'sourceInventory', 'sourceLegacyPositionCount', 'sourcePositionCount',
  ]
  if (!hasExactKeys(facts, requiredFactKeys) || facts.preset !== (variantId === 'field-scale-960k' ? 'bcp-960k' : 'bcp-2m')
    || facts.sourcePositionCount !== expectedRows || facts.sourceLegacyPositionCount !== 12
    || facts.appDeviceCount !== 100 || facts.appOutingCount !== 12
    || !Number.isSafeInteger(facts.appPositionCount) || facts.appPositionCount < expectedRows - 12
    || !SHA256.test(facts.fixtureSha256) || !SHA256.test(facts.fixtureManifestSha256)
    || !SHA256.test(facts.fixtureCopySha256)
    || typeof facts.fixturePath !== 'string' || typeof facts.fixtureCopyPath !== 'string'
    || typeof facts.fixtureManifestPath !== 'string') {
    failures.push(`C28 ${variantId} facts do not prove the exact 100-device, 12-outing, ${expectedRows}-row workload.`)
    return
  }
  if (!fixture || !hasExactKeys(fixture, ['copyPath', 'manifestPath', 'path', 'preset', 'rows'])
    || fixture.path !== facts.fixturePath || fixture.manifestPath !== facts.fixtureManifestPath
    || fixture.copyPath !== facts.fixtureCopyPath || fixture.preset !== facts.preset || fixture.rows !== expectedRows) {
    failures.push(`C28 ${variantId} fixture binding is missing or differs from the controller input.`)
    return
  }
  if (typeof fixture.path !== 'string' || typeof fixture.manifestPath !== 'string'
    || typeof fixture.copyPath !== 'string' || !path.isAbsolute(fixture.path)
    || !path.isAbsolute(fixture.manifestPath) || !path.isAbsolute(fixture.copyPath)
    || path.resolve(fixture.path) !== fixture.path || path.resolve(fixture.manifestPath) !== fixture.manifestPath
    || path.resolve(fixture.copyPath) !== fixture.copyPath) {
    failures.push(`C28 ${variantId} fixture paths are not canonical absolute paths.`)
    return
  }
  if (typeof evidencePath !== 'string'
    || !fixture.path.startsWith(`${path.resolve(evidencePath)}${path.sep}`)
    || !fixture.manifestPath.startsWith(`${path.resolve(evidencePath)}${path.sep}`)
    || !fixture.copyPath.startsWith(`${path.resolve(evidencePath)}${path.sep}`)) {
    failures.push(`C28 ${variantId} fixture escaped the disposable evidence directory.`)
    return
  }
  const fixtureRoot = path.resolve(fixture.path)
  const fixtureCopyRoot = path.resolve(fixture.copyPath)
  const manifestRoot = path.resolve(fixture.manifestPath)
  let database
  try {
    const manifestBytes = readFileSync(manifestRoot)
    assertClosedFixture(fixtureRoot)
    assertClosedFixture(fixtureCopyRoot)
    const sourceIdentity = hashFileBounded(fixtureRoot)
    const copyIdentity = hashFileBounded(fixtureCopyRoot)
    if (sourceIdentity.sha256 !== facts.fixtureSha256 || sourceIdentity.bytes !== sourceIdentity.expectedBytes
      || copyIdentity.sha256 !== facts.fixtureCopySha256 || copyIdentity.bytes !== copyIdentity.expectedBytes
      || copyIdentity.sha256 !== sourceIdentity.sha256 || copyIdentity.bytes !== sourceIdentity.bytes
      || sha256(manifestBytes) !== facts.fixtureManifestSha256) {
      failures.push(`C28 ${variantId} fixture bytes differ from the retained receipt identities.`)
      return
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const expectedPreset = expectedRows === 960_000 ? 'bcp-960k' : 'bcp-2m'
    if (manifest.syntheticDataOnly !== true || manifest.preset !== expectedPreset) {
      failures.push(`C28 ${variantId} fixture manifest is not the reviewed synthetic preset.`)
      return
    }
    if (manifest.workload?.realPositionRows !== expectedRows
      || manifest.rows?.byTable?.devices !== 101 || manifest.rows?.byTable?.outings !== 12
      || manifest.rows?.byTable?.positions !== expectedRows) {
      failures.push(`C28 ${variantId} fixture manifest workload differs from the fixed field envelope.`)
      return
    }
    database = new Database(fixtureRoot, { readonly: true, fileMustExist: true })
    const sourceInventory = selectPagingSource(database, 'C07')
    const primaryPositionCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM positions
      WHERE mission_id = ? AND timestamp_source = 'fix' AND timestamp >= ?`)
      .get(sourceInventory.primary.id, sourceInventory.primary.start_time).count)
    const primaryDeviceCount = Number(database.prepare('SELECT COUNT(DISTINCT device_id) AS count FROM positions WHERE mission_id = ?')
      .get(sourceInventory.primary.id).count)
    const primaryOutingCount = Number(database.prepare('SELECT COUNT(*) AS count FROM outings WHERE mission_id = ?')
      .get(sourceInventory.primary.id).count)
    if (JSON.stringify(facts.sourceInventory) !== JSON.stringify(sourceInventory)
      || sourceInventory.fixturePositionCount !== expectedRows
      || sourceInventory.legacyPositionCount !== 12
      || facts.sourcePositionCount !== sourceInventory.fixturePositionCount
      || facts.sourceLegacyPositionCount !== sourceInventory.legacyPositionCount
      || facts.appDeviceCount !== primaryDeviceCount
      || facts.appOutingCount !== primaryOutingCount
      || facts.appPositionCount !== primaryPositionCount) {
      failures.push(`C28 ${variantId} source inventory or observed application counts differ from the independent fixture.`)
    }
  } catch (error) {
    failures.push(`C28 ${variantId} independent source fixture could not be re-opened: ${error?.message ?? String(error)}`)
  } finally {
    database?.close()
  }
}

/** Assert that a fixture is a closed standalone SQLite file before opening it. */
function assertClosedFixture(filename) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${filename}${suffix}`
    try {
      lstatSync(candidate)
      if (suffix !== '') throw new Error(`SQLite fixture sidecar is present: ${candidate}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Hash a large regular fixture in bounded chunks without materialising it. */
function hashFileBounded(filename) {
  const before = lstatSync(filename)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Fixture is not a regular file: ${filename}`)
  const descriptor = openSync(filename, 'r')
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024)
  let bytes = 0
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null)
      if (count === 0) break
      digest.update(buffer.subarray(0, count))
      bytes += count
    }
  } finally {
    closeSync(descriptor)
  }
  const after = statSync(filename)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes !== before.size) {
    throw new Error(`Fixture changed while hashing: ${filename}`)
  }
  return { sha256: digest.digest('hex'), bytes, expectedBytes: before.size }
}

/** Validates all externally supplied identities before opening report fields. */
function readExpected(expected, failures) {
  const expectedKeys = expected !== null && typeof expected === 'object'
    ? Object.keys(expected).filter((key) => key !== 'fieldScaleFixture' && key !== 'retainedEvidencePath')
    : []
  if (!hasExactKeys(Object.fromEntries(expectedKeys.map((key) => [key, expected[key]])), EXPECTED_KEYS)) {
    failures.push('C28 expected binding has missing or unsupported fields.')
    return null
  }
  if (expected?.fieldScaleFixture !== undefined
    && !hasExactKeys(expected.fieldScaleFixture, ['copyPath', 'manifestPath', 'path', 'preset', 'rows'])) {
    failures.push('C28 expected field-scale fixture binding is invalid.')
  }
  if (!SHA256.test(expected.appSha256)) failures.push('C28 expected app SHA-256 is invalid.')
  if (!SHA1.test(expected.sourceHead)) failures.push('C28 expected source head is invalid.')
  validateAbsolutePath(expected.appPath, 'C28 expected app path', failures)
  validateAbsolutePath(expected.evidencePath, 'C28 expected evidence path', failures)
  if (expected.retainedEvidencePath !== undefined) {
    validateAbsolutePath(expected.retainedEvidencePath, 'C28 retained evidence path', failures)
  }
  validateAbsolutePath(expected.profilePath, 'C28 expected profile path', failures)
  validateAbsolutePath(expected.sourceRoot, 'C28 expected source root', failures)
  if (typeof expected.profilePath === 'string'
    && typeof expected.evidencePath === 'string'
    && !expected.profilePath.startsWith(`${expected.evidencePath}${path.sep}`)) {
    failures.push('C28 disposable profile escaped the evidence directory.')
  }
  if (typeof expected.sourceRoot === 'string' && path.isAbsolute(expected.sourceRoot)) {
    validateExpectedManifest(expected.sourceManifest, expected.sourceRoot, failures)
  }
  return expected
}

/** Recomputes every expected source identity from the current checkout. */
function validateExpectedManifest(manifest, sourceRoot, failures) {
  if (!Array.isArray(manifest) || manifest.length < 1) {
    failures.push('C28 expected source manifest is empty.')
    return
  }
  const paths = new Set()
  for (const entry of manifest) {
    if (!hasExactKeys(entry, ['relativePath', 'sha256', 'sizeBytes'])
      || typeof entry.relativePath !== 'string'
      || entry.relativePath.length < 1
      || path.isAbsolute(entry.relativePath)
      || entry.relativePath.includes('\\')
      || entry.relativePath.split('/').includes('..')
      || paths.has(entry.relativePath)
      || !SHA256.test(entry.sha256)
      || !Number.isSafeInteger(entry.sizeBytes)
      || entry.sizeBytes < 1) {
      failures.push('C28 expected source manifest entry is invalid or duplicated.')
      continue
    }
    paths.add(entry.relativePath)
    const absolutePath = path.resolve(sourceRoot, entry.relativePath)
    if (!absolutePath.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
      failures.push('C28 source manifest path escaped the expected source root.')
      continue
    }
    try {
      const bytes = readFileSync(absolutePath)
      const observedSha256 = sha256(bytes)
      if (observedSha256 !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
        failures.push(`C28 source manifest identity changed for ${entry.relativePath}.`)
      }
    } catch {
      failures.push(`C28 expected source manifest file is unavailable: ${entry.relativePath}.`)
    }
  }
}

/** Validates the closed report shape and then checks each independent phase predicate. */
function validateReport(report, expected, failures) {
  const familyContract = report?.familyContract
  const isFamilyReport = COMPOSITE_FAMILY_CONTRACTS.has(familyContract)
  const reportKeys = isFamilyReport ? [...REPORT_KEYS, 'familyContract'] : REPORT_KEYS
  const hasBaseKeys = hasExactKeys(report, reportKeys)
  const hasCleanupKeys = hasExactKeys(report, [...reportKeys, 'cleanup'])
  if (!hasBaseKeys && !hasCleanupKeys) {
    failures.push('C28 composite report has missing or unsupported fields.')
    return
  }
  if (familyContract !== undefined && !isFamilyReport) {
    failures.push('C28 composite family selector is unsupported.')
  }
  if (report.schemaVersion !== 1 || report.proofKind !== 'packaged-composite-v1'
    || report.contractId !== 'C28') {
    failures.push('C28 report identity is invalid.')
  }
  validateSource(report.source, expected, failures)
  validateApp(report.app, expected, failures)
  validateInvocation(report.invocation, expected.profilePath, failures)
  validateProfile(report.profile, expected, failures)
  const missionId = validateMission(report.mission, failures)
  validatePhases(report.phases, missionId, expected.profilePath, failures, familyContract)
  validateGaps(report.phases, report.gaps, failures)
  validateDiagnostics(report.diagnostics, expected.profilePath, failures, familyContract)
  validateNetwork(report.network, failures)
  validateRun(report.run, report.stderr, failures)
  if (hasCleanupKeys) validateCleanup(report.cleanup, failures)
}

/** Requires the producer to retain actual close and disposable-profile cleanup outcomes. */
function validateCleanup(value, failures) {
  if (!hasExactKeys(value, [
    'closeAttempted', 'closeSucceeded', 'failure', 'profileRemovalAttempted', 'profileRemoved',
  ]) || value.closeAttempted !== true || value.closeSucceeded !== true
    || value.profileRemovalAttempted !== true || value.profileRemoved !== true
    || value.failure !== null) {
    failures.push('C28 producer cleanup did not prove successful process close and profile removal.')
  }
}

/** Recomputes report source identities and rejects stale or substituted manifests. */
function validateSource(source, expected, failures) {
  if (!hasExactKeys(source, ['dirty', 'expectedHead', 'manifest', 'observedHead'])
    || source.expectedHead !== expected.sourceHead
    || source.observedHead !== expected.sourceHead
    || source.dirty !== false
    || !sameManifest(source.manifest, expected.sourceManifest)) {
    failures.push('C28 source head, clean-tree, or manifest binding is missing or substituted.')
  }
  if (Array.isArray(source?.manifest)) {
    for (const entry of source.manifest) {
      const expectedEntry = Array.isArray(expected.sourceManifest)
        ? expected.sourceManifest.find((candidate) => candidate.relativePath === entry?.relativePath)
        : undefined
      if (expectedEntry === undefined || !hasExactKeys(entry, ['relativePath', 'sha256', 'sizeBytes'])) continue
      try {
        const bytes = readFileSync(path.resolve(expected.sourceRoot, entry.relativePath))
        if (sha256(bytes) !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
          failures.push(`C28 reported source identity changed for ${entry.relativePath}.`)
        }
      } catch {
        failures.push(`C28 reported source file is unavailable: ${entry.relativePath}.`)
      }
    }
  }
}

/** Requires exact artifact identity supplied by the controller. */
function validateApp(app, expected, failures) {
  if (!hasExactKeys(app, [
    'packagedAppPath', 'packagedAppSha256', 'path', 'retainedPackagedAppPath',
    'retainedPackagedAppSha256', 'sha256', 'sizeBytes',
  ])
    || app.path !== expected.appPath || app.sha256 !== expected.appSha256
    || !SHA256.test(app.sha256)
    || !Number.isSafeInteger(app.sizeBytes) || app.sizeBytes < 1
    || typeof app.packagedAppPath !== 'string' || !path.isAbsolute(app.packagedAppPath)
    || path.resolve(app.packagedAppPath) !== app.packagedAppPath
    || !app.packagedAppPath.endsWith('.asar') || !SHA256.test(app.packagedAppSha256)
    || typeof app.retainedPackagedAppPath !== 'string' || !path.isAbsolute(app.retainedPackagedAppPath)
    || path.resolve(app.retainedPackagedAppPath) !== app.retainedPackagedAppPath
    || !app.retainedPackagedAppPath.endsWith('.asar')
    || !isWithin(app.retainedPackagedAppPath, expected.retainedEvidencePath ?? expected.evidencePath)
    || !SHA256.test(app.retainedPackagedAppSha256)
    || app.retainedPackagedAppSha256 !== app.packagedAppSha256) {
    failures.push('C28 packaged executable path, digest, or size differs from the expected artifact.')
    return
  }
  try {
    // A mounted AppImage ASAR can disappear after the process closes. The
    // retained evidence copy is the stable bytes used for revalidation.
    const retainedPackaged = readFileSync(app.retainedPackagedAppPath)
    if (sha256(retainedPackaged) !== app.retainedPackagedAppSha256
        || sha256(retainedPackaged) !== app.packagedAppSha256) {
      failures.push('C28 retained packaged app bytes differ from the retained digest.')
    }
  } catch {
    failures.push('C28 retained packaged app copy is unavailable for independent hashing.')
  }
}

/** Requires the fixed invocation and exact disposable profile binding. */
function validateInvocation(invocation, profilePath, failures) {
  if (!hasExactKeys(invocation, ['app', 'evidence', 'expectedHead', 'networkBlocked', 'userDataPath'])
    || invocation.app !== '--app' || invocation.evidence !== '--evidence'
    || invocation.expectedHead !== '--expected-head' || invocation.networkBlocked !== true
    || invocation.userDataPath !== profilePath) {
    failures.push('C28 invocation did not retain the fixed app/evidence/head and profile binding.')
  }
}

/** Rejects operator-profile use and phase-specific profile substitution. */
function validateProfile(profile, expected, failures) {
  if (!hasExactKeys(profile, [
    'observedUserDataPaths', 'path', 'removed', 'sameProfileAcrossPhases',
    'usedSystemUserProfile', 'userDataPath',
  ]) || profile.path !== expected.profilePath || profile.userDataPath !== expected.profilePath
    || profile.removed !== true || profile.sameProfileAcrossPhases !== true
    || profile.usedSystemUserProfile !== false
    || !Array.isArray(profile.observedUserDataPaths)
    || profile.observedUserDataPaths.length < 1
    || profile.observedUserDataPaths.some((value) => value !== expected.profilePath)) {
    failures.push('C28 profile custody is not disposable, single-profile, exact, and removed.')
  }
}

/** Checks one stable mission identity before phase evidence can be compared. */
function validateMission(mission, failures) {
  if (!hasExactKeys(mission, ['missionId', 'nameSha256', 'phaseMissionIds'])
    || typeof mission.missionId !== 'string' || mission.missionId.length < 1
    || !SHA256.test(mission.nameSha256)
    || !Array.isArray(mission.phaseMissionIds) || mission.phaseMissionIds.length < 1
    || mission.phaseMissionIds.some((value) => value !== mission.missionId)) {
    failures.push('C28 mission identity is incomplete or changed between phases.')
    return null
  }
  return mission.missionId
}

/** Validates raw facts for every named phase, allowing only concrete declared gaps. */
function validatePhases(phases, missionId, profilePath, failures, familyContract = undefined) {
  if (!hasExactKeys(phases, PHASE_NAMES)) {
    failures.push('C28 phase inventory is incomplete or has unsupported phase names.')
    return
  }
  const settings = phases.settingsBootstrap
  if (!hasExactKeys(settings, ['networkConfiguration', 'runtimeBootstrapLoaded', 'settingsLoaded', 'supported'])
    || settings.supported !== true || settings.settingsLoaded !== true
    || settings.runtimeBootstrapLoaded !== true || settings.networkConfiguration !== 'blocked') {
    failures.push('C28 settings/bootstrap did not prove the real preload bootstrap path.')
  }
  const mission = phases.missionOutingParticipants
  if (mission?.supported === false) {
    if (!hasExactKeys(mission, [
      'missingProducer', 'missionId', 'missionStatus', 'outingEnded', 'outingId',
      'participantCount', 'participantIds', 'supported',
    ]) || mission.missionId !== missionId || !nonEmpty(mission.missingProducer)
      || !nonEmpty(mission.outingId) || mission.missionStatus !== 'active'
      || mission.outingEnded !== true || !Array.isArray(mission.participantIds)
      || mission.participantIds.length !== mission.participantCount
      || !Number.isSafeInteger(mission.participantCount) || mission.participantCount !== 0) {
      failures.push('C28 mission/outing participant gap is incomplete or cross-boundary substituted.')
    }
  } else if (!hasExactKeys(mission, [
    'backfillCompleted', 'backfillCheckpointCount', 'missionId', 'missionStatus', 'outingEnded', 'outingId', 'participantCount', 'participantIds', 'supported',
    ...(familyContract === 'C03' ? [
      'excludedDeviceId', 'excludedDeviceObserved', 'excludedDevicePositionRows',
      'excludedDeviceRowsInSelectedScope', 'knownAtFixTime', 'midnightCrossings', 'outingCount', 'scopeOracle',
    ] : []),
  ]) || mission.supported !== true || mission.missionId !== missionId
    || typeof mission.outingId !== 'string' || mission.missionStatus !== 'active'
    || mission.outingEnded !== true || !Array.isArray(mission.participantIds)
    || mission.participantIds.length !== mission.participantCount
    || !Number.isSafeInteger(mission.participantCount) || mission.participantCount < 1
    || mission.backfillCompleted !== true
    || !Number.isSafeInteger(mission.backfillCheckpointCount) || mission.backfillCheckpointCount < 1) {
    failures.push('C28 mission/outing/participant facts are incomplete or cross-boundary substituted.')
  }
  const gpx = phases.gpxDatedUndated
  if (!hasExactKeys(gpx, ['dated', 'fixtureResidualEntries', 'missionId', 'supported', 'undated'])
    || gpx.supported !== true || gpx.missionId !== missionId || gpx.fixtureResidualEntries !== 0) {
    failures.push('C28 GPX phase did not close one same-mission fixture scope.')
  } else {
    validateGpxVariant(gpx.dated, 'fully_dated', 'C28 dated GPX', failures)
    validateGpxVariant(gpx.undated, 'undated', 'C28 undated GPX', failures)
  }
  const marker = phases.markerSearch
  if (!hasExactKeys(marker, [
    'assignmentId', 'markerCount', 'markerId', 'missionId', 'searchAreaCount', 'searchAreaId',
    'searchPassCount', 'searchPassId', 'supported',
    ...(familyContract === 'C11' ? ['passOutcomes', 'passPaging'] : []),
  ]) || marker.supported !== true || marker.missionId !== missionId
    || !nonEmpty(marker.markerId) || !nonEmpty(marker.searchAreaId)
    || !nonEmpty(marker.assignmentId) || !nonEmpty(marker.searchPassId)
    || marker.markerCount !== 1 || marker.searchAreaCount !== 1
    || (familyContract === 'C11' ? marker.searchPassCount !== 50_000 : marker.searchPassCount !== 1)) {
    failures.push('C28 marker/search-area/search-pass facts are incomplete or not same-mission.')
  }
  const replay = phases.coverageReplay
  if (!hasExactKeys(replay, ['coverage', 'missionId', 'replay', 'supported'])
    || replay.supported !== true || replay.missionId !== missionId
    || !hasExactKeys(replay.coverage, ['acceptedFixCount', 'backfillIncomplete', 'changeSeq', 'chunkCount', 'enumerated', 'pendingInvalidation'])
    || !Number.isSafeInteger(replay.coverage.changeSeq) || replay.coverage.changeSeq < 0
    || replay.coverage.enumerated !== true || replay.coverage.pendingInvalidation !== false
    || replay.coverage.backfillIncomplete !== false
    || !Number.isSafeInteger(replay.coverage.chunkCount) || replay.coverage.chunkCount < 1
    || !Number.isSafeInteger(replay.coverage.acceptedFixCount) || replay.coverage.acceptedFixCount < 1
    || !hasExactKeys(replay.replay, [
      'missionId', 'objectCount', 'replayGeneration', 'selectedTime', 'staticGpxPointCount', 'totalTrackCount',
    ]) || replay.replay.missionId !== missionId
    || !Number.isSafeInteger(replay.replay.replayGeneration) || replay.replay.replayGeneration < 0
    || !Number.isSafeInteger(replay.replay.totalTrackCount) || replay.replay.totalTrackCount < 1
    || !Number.isSafeInteger(replay.replay.staticGpxPointCount) || replay.replay.staticGpxPointCount < 1
    || !Number.isSafeInteger(replay.replay.objectCount) || replay.replay.objectCount < 1
    || !isIsoTimestamp(replay.replay.selectedTime)) {
    failures.push('C28 coverage/replay facts are incomplete or cross-boundary substituted.')
  }
  const restart = phases.pauseRestart
  if (!hasExactKeys(restart, [
    'firstPid', 'missionId', 'observedUserDataPath', 'pausedStatus', 'restartPid', 'restartedStatus',
    'resumedStatus', 'sameMission', 'supported',
  ]) || restart.supported !== true || restart.missionId !== missionId
    || restart.observedUserDataPath !== profilePath || restart.pausedStatus !== 'paused'
    || restart.restartedStatus !== 'paused' || restart.resumedStatus !== 'active'
    || restart.sameMission !== true || !validPid(restart.firstPid) || !validPid(restart.restartPid)
    || restart.firstPid === restart.restartPid) {
    failures.push('C28 pause/restart did not prove same-profile mission recovery.')
  }
  const archive = phases.finishFinalizeArchive
  if (!hasExactKeys(archive, [
    'archiveAvailability', 'archiveId', 'archiveStatus', 'archiveVersion', 'ciphertextSha256',
    'finalizedStatus', 'finishedStatus', 'missionId', 'supported', 'verify',
  ]) || archive.supported !== true || archive.missionId !== missionId || archive.finishedStatus !== 'finished'
    || archive.finalizedStatus !== 'finalized' || archive.archiveVersion !== 2
    || archive.archiveStatus !== 'verified' || archive.archiveAvailability !== 'present'
    || !nonEmpty(archive.archiveId) || !SHA256.test(archive.ciphertextSha256)
    || !hasExactKeys(archive.verify, ['archiveId', 'ciphertextSha256', 'verified'])
    || archive.verify.verified !== true || archive.verify.archiveId !== archive.archiveId
    || archive.verify.ciphertextSha256 !== archive.ciphertextSha256) {
    failures.push('C28 finish/finalize/archive facts did not prove a verified v2 archive.')
  }
  const review = phases.archiveReviewRestore
  if (!hasExactKeys(review, ['missingProducer', 'review', 'restore', 'restoreExecuted', 'reviewExecuted', 'supported'])) {
    failures.push('C28 archive review/restore phase facts are incomplete.')
  } else if (review.supported === true) {
    if (review.reviewExecuted !== true || review.restoreExecuted !== true || review.missingProducer !== null
      || !hasValidReviewFacts(review.review, missionId)
      || !hasValidRestoreFacts(review.restore, missionId, phases.finishFinalizeArchive?.archiveId)) {
      failures.push('C28 archive review/restore was marked supported without both raw facts.')
    }
  } else if (review.supported !== false || review.restoreExecuted !== false
    || !nonEmpty(review.missingProducer)) {
    failures.push('C28 unsupported archive review/restore phase lacks a concrete producer gap.')
  } else if (review.reviewExecuted === true && !hasValidReviewFacts(review.review, missionId)) {
    failures.push('C28 archive review facts are incomplete or cross-boundary substituted.')
  } else if (review.reviewExecuted !== false && review.reviewExecuted !== true) {
    failures.push('C28 archive review execution flag is invalid.')
  }
  const diagnostics = phases.sanitizedDiagnostics
  if (!hasExactKeys(diagnostics, [
    'adversarialMatchCount', 'containsProfilePath', 'containsSecret', 'exactSecretMatches', 'exported', 'pathWithinProfile',
    'requested', 'sanitized', 'supported',
    ...(familyContract === 'C17' ? [
      'canaryCount', 'canaryManifestSha256', 'leakedCanaryIds', 'outputByteLength', 'outputSha256',
      'outputWithinLimit', 'retainedCanaryManifestPath', 'retainedOutputPath',
    ] : []),
  ]) || diagnostics.supported !== true || diagnostics.requested !== true || diagnostics.exported !== true
    || diagnostics.sanitized !== true || diagnostics.containsSecret !== false
    || diagnostics.containsProfilePath !== false || diagnostics.exactSecretMatches !== 0
    || diagnostics.adversarialMatchCount !== 0
    || diagnostics.pathWithinProfile !== true
    || (familyContract === 'C17'
      && (!Array.isArray(diagnostics.leakedCanaryIds) || diagnostics.leakedCanaryIds.length !== 0))) {
    failures.push('C28 diagnostics were not exported through the sanitized runtime boundary.')
  }
}

/** Checks exact GPX timing class, digest, and retained point count. */
function validateGpxVariant(value, timingClass, label, failures) {
  if (!hasExactKeys(value, ['importId', 'pointCount', 'sourceSha256', 'timingClass'])
    || !nonEmpty(value.importId) || value.timingClass !== timingClass
    || !Number.isSafeInteger(value.pointCount) || value.pointCount < 1
    || !SHA256.test(value.sourceSha256)) {
    failures.push(`${label} facts are incomplete or substituted.`)
  }
}

/** Validates the immutable archive-review session facts independently of phase status. */
function hasValidReviewFacts(value, missionId) {
  return hasExactKeys(value, [
    'closed', 'immutable', 'missionCount', 'missionIdMatched', 'mutationDenied',
    'opened', 'replayMissionId', 'replayTrackCount', 'verified',
  ]) && value.opened === true && value.immutable === true && value.verified === true
    && value.closed === true && value.missionIdMatched === true && value.mutationDenied === true
    && value.missionCount === 1 && value.replayMissionId === missionId
    && Number.isSafeInteger(value.replayTrackCount) && value.replayTrackCount >= 1
}

/** Validates the exact committed correction result returned by the production IPC boundary. */
function hasValidRestoreFacts(value, missionId, archiveId) {
  return hasExactKeys(value, [
    'archiveId', 'cleanupComplete', 'committed', 'missionId', 'returnedMissionId',
    'returnedStatus', 'status', 'storageState',
  ]) && value.archiveId === archiveId && value.missionId === missionId
    && value.returnedMissionId === missionId && value.returnedStatus === 'finished'
    && value.status === 'finished' && value.storageState === 'live'
    && value.committed === true && value.cleanupComplete === true
}

/** Requires one explicit concrete missing producer for each unsupported phase. */
function validateGaps(phases, gaps, failures) {
  if (!Array.isArray(gaps)) {
    failures.push('C28 gap inventory is missing.')
    return
  }
  const gapNames = new Set()
  for (const gap of gaps) {
    if (!hasExactKeys(gap, ['phase', 'reason']) || !PHASE_NAMES.includes(gap.phase)
      || !nonEmpty(gap.reason) || gapNames.has(gap.phase)) {
      failures.push('C28 gap inventory contains an unsupported, duplicated, or unexplained gap.')
      continue
    }
    gapNames.add(gap.phase)
    if (phases?.[gap.phase]?.supported !== false) {
      failures.push(`C28 gap ${gap.phase} does not correspond to an unsupported phase.`)
    }
    if (phases?.[gap.phase]?.missingProducer !== gap.reason) {
      failures.push(`C28 gap ${gap.phase} does not retain the producer reason.`)
    }
  }
  for (const phase of PHASE_NAMES) {
    if (phases?.[phase]?.supported === false && !gapNames.has(phase)) {
      failures.push(`C28 unsupported phase ${phase} has no concrete gap entry.`)
    }
    if (phases?.[phase]?.supported !== false && gapNames.has(phase)) {
      failures.push(`C28 supported phase ${phase} was incorrectly left as a gap.`)
    }
  }
}

/** Requires sanitized diagnostic facts without accepting a generic green flag. */
function validateDiagnostics(value, profilePath, failures, familyContract = undefined) {
  if (!hasExactKeys(value, [
    'adversarialMatchCount', 'containsProfilePath', 'containsSecret', 'exactSecretMatches', 'exported', 'requested', 'sanitized',
    ...(familyContract === 'C17' ? [
      'canaryCount', 'canaryManifestSha256', 'leakedCanaryIds', 'outputByteLength', 'outputSha256',
      'outputWithinLimit',
    ] : []),
  ]) || value.requested !== true || value.exported !== true || value.sanitized !== true
    || value.containsSecret !== false || value.containsProfilePath !== false
    || value.exactSecretMatches !== 0 || value.adversarialMatchCount !== 0
    || (familyContract === 'C17'
      && (!Array.isArray(value.leakedCanaryIds) || value.leakedCanaryIds.length !== 0))) {
    failures.push('C28 diagnostics evidence is absent or contains unsanitized values.')
  }
  if (typeof profilePath !== 'string' || !path.isAbsolute(profilePath)) {
    failures.push('C28 diagnostics profile binding is invalid.')
  }
}

/** Retains raw launch identities and bounded process diagnostics without using a pass flag. */
function validateRun(run, stderr, failures) {
  if (!hasExactKeys(run, ['finishedAt', 'firstPid', 'restartPid', 'startedAt'])
    || !isIsoTimestamp(run.startedAt) || !isIsoTimestamp(run.finishedAt)
    || !validPid(run.firstPid) || !validPid(run.restartPid) || run.firstPid === run.restartPid) {
    failures.push('C28 run identity facts are incomplete or process identities were substituted.')
  }
  if (!hasExactKeys(stderr, ['byteLength', 'lines', 'sha256']) || !SHA256.test(stderr.sha256)
    || !Number.isSafeInteger(stderr.byteLength) || stderr.byteLength < 0
    || !Array.isArray(stderr.lines) || stderr.lines.some((line) => typeof line !== 'string')) {
    failures.push('C28 raw process diagnostics are incomplete.')
  }
}

/** Requires blocked network and no completed HTTP(S) egress in the owned profile. */
function validateNetwork(network, failures) {
  if (!hasExactKeys(network, ['blocked', 'httpRequests', 'httpsRequests'])
    || network.blocked !== true || network.httpRequests !== 0 || network.httpsRequests !== 0) {
    failures.push('C28 network boundary was not blocked or recorded zero completed HTTP(S) egress.')
  }
}

/** Return whether an object owns the requested exact key set. */
function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

/** Return whether a bounded non-empty string exists. */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** Return whether a process ID is a positive safe integer. */
function validPid(value) {
  return Number.isSafeInteger(value) && value > 0
}

/** Return whether a timestamp is a canonical ISO instant. */
function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false
  return new Date(Date.parse(value)).toISOString() === value
}

/** Compare a report manifest with the exact expected inventory and identities. */
function sameManifest(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && JSON.stringify(actual) === JSON.stringify(expected)
}

/** Hash one source or artifact byte sequence. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Clone report facts before returning them from the validator. */
function clone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

/** Validate one absolute canonical filesystem path. */
function validateAbsolutePath(value, label, failures) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    failures.push(`${label} is invalid.`)
  }
}

/** Test whether a canonical child path is retained beneath its evidence root. */
function isWithin(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false
  const parentRoot = path.resolve(parent)
  const childRoot = path.resolve(child)
  return childRoot === parentRoot || childRoot.startsWith(`${parentRoot}${path.sep}`)
}
