import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  computeArchivedTableContentDigest,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
} = require('../electron/archive-inventory.cjs')
const { inspectArchiveCustodyFile } = require('../electron/archive-custody-file.cjs')
const {
  createArchiveReviewSessionManager,
} = require('../electron/archive-review-sessions.cjs')
const { createElectronMissionStore } = require('../electron/mission-store.cjs')

const PROTOCOL_VERSION = 2
const CURRENT_SCHEMA_VERSION = 13
const REQUIRED_INVENTORY_TABLE_COUNT = 49
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 30 * 60_000
const MAX_PROTOCOL_LINE_BYTES = 64 * 1024
const MAX_PROTOCOL_OUTPUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024
const MAX_STATE_BYTES = 4 * 1024 * 1024
const SCAN_CHUNK_BYTES = 1024 * 1024
const CASE_ID = /^(?:create|verify|restore|cleanup)\.[a-z_]+$/u
const SHA256 = /^[0-9a-f]{64}$/u
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const SAFE_DETAIL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const SENSITIVE_DETAIL = /passphrase|recovery.?code|^recovery$|secret/iu
const STATE_FILE_NAME = 'kill-matrix-state.json'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const REVIEW_DIRECTORY_NAME = 'archive-review'
const CANONICAL_SCHEMA_V13_INVENTORY = Object.freeze(
  listArchiveInventoryForSchema(CURRENT_SCHEMA_VERSION).map((entry) => Object.freeze({
    tableName: entry.tableName,
    decision: entry.decision,
  })),
)
const SCHEMA_V13_RETAINED_MISSION_TABLES = new Set(['mission_events', 'missions'])
const SCHEMA_V13_MISSION_ID_DERIVED_TABLES = new Set([
  'coverage_chunks',
  'coverage_invalidations',
  'coverage_missions',
  'ingest_anomaly_devices',
  'ingest_anomaly_mission_health',
  'mission_replay_generations',
  'mission_replay_position_day_counts',
])
const SCHEMA_V13_CLEANUP_OPERATIONAL_TABLES = new Set([
  'gpx_import_source_receipts',
  'ingest_anomaly_deliveries',
  'participant_backfill_checkpoints',
  'tracking_history_checkpoints',
])
const CANONICAL_SCHEMA_V13_CLEANUP_ORDER = Object.freeze([
  'coverage_chunks',
  'coverage_invalidations',
  'coverage_missions',
  'drawings',
  'gpx_evidence_points',
  'gpx_evidence_rejections',
  'gpx_import_aliases',
  'gpx_import_failures',
  'gpx_import_source_receipts',
  'helicopters',
  'ingest_anomalies',
  'ingest_anomaly_deliveries',
  'ingest_anomaly_devices',
  'ingest_anomaly_mission_health',
  'layer_catalog_entries',
  'legacy_event_provenance_quarantine_missions',
  'markers',
  'mission_group_membership_events',
  'mission_object_versions',
  'mission_participants',
  'mission_replay_generations',
  'mission_replay_position_day_counts',
  'participant_backfill_checkpoints',
  'position_revisions',
  'search_pass_evidence_links',
  'tracking_history_checkpoints',
  'gpx_import_batches',
  'gpx_import_revisions',
  'mission_teams',
  'positions',
  'search_passes',
  'devices',
  'gpx_track_imports',
  'search_assignments',
  'outings',
  'search_areas',
])
const EXPECTED_RESTART_ACTION = Object.freeze({
  create: 'startup_custody_reconciliation',
  verify: 'verification_reconciliation',
  restore: 'startup_plaintext_sweep',
  cleanup: 'cleanup_resume',
})
const LIFECYCLE_MUTABLE_TABLES = deepFreeze({
  create: [
    'metadata',
    'mission_archives',
    'mission_events',
    'mission_finalization_fences',
    'missions',
  ],
  verify: ['metadata', 'mission_archives', 'mission_events'],
  restore: ['metadata', 'mission_archives', 'mission_events'],
  cleanup: ['metadata', 'mission_archives', 'mission_cleanup_journal', 'mission_events'],
})

export const ARCHIVE_LIFECYCLE_PHASES = deepFreeze({
  create: [
    'preflight',
    'snapshot',
    'extract',
    'sqlite',
    'proof',
    'attachments',
    'digest',
    'encrypt',
    'sync',
    'plaintext_cleanup',
    'staged',
    'publish',
    'seal',
  ],
  verify: [
    'preflight',
    'keys',
    'decrypt',
    'entries',
    'sqlite',
    'inventory',
    'gpx',
    'attachments',
    'replay',
    'plaintext_cleanup',
    'proof',
    'verified',
  ],
  restore: ['preflight', 'keys', 'ciphertext', 'decrypt', 'validate', 'ready'],
  cleanup: ['cleanup'],
})

export const ARCHIVE_KILL_MATRIX_CASES = Object.freeze(
  Object.entries(ARCHIVE_LIFECYCLE_PHASES).flatMap(([lifecycle, phases]) =>
    phases.map((phase, indexWithinLifecycle) => {
      const ordinal = Object.entries(ARCHIVE_LIFECYCLE_PHASES)
        .filter(([candidate]) => candidate < lifecycle)
        .reduce((total, [, candidatePhases]) => total + candidatePhases.length, 0)
        + indexWithinLifecycle + 1
      return Object.freeze({
        id: `${lifecycle}.${phase}`,
        lifecycle,
        phase,
        operationId: `70000000-0000-4000-8000-${ordinal.toString(16).padStart(12, '0')}`,
      })
    }),
  ),
)

/** Parses the deliberately small CLI surface used by the qualification runner. */
export function parseBreadcrumbPr6KillMatrixArgs(argv) {
  const parsed = {
    caseIds: [],
    keepWorkRoot: false,
    protocolSelfTest: false,
    reportPath: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    workRoot: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--keep-work-root') {
      parsed.keepWorkRoot = true
      continue
    }
    if (argument === '--protocol-self-test') {
      parsed.protocolSelfTest = true
      continue
    }
    const [name, inlineValue] = splitArgument(argument)
    if (!['--case', '--report', '--timeout-ms', '--work-root'].includes(name)) {
      throw new Error(`Unsupported archive kill-matrix argument: ${argument}`)
    }
    const value = inlineValue ?? argv[index + 1]
    if (inlineValue === null) index += 1
    if (typeof value !== 'string' || value.length < 1) throw new Error(`${name} requires a value.`)
    if (name === '--case') {
      parsed.caseIds.push(...value.split(',').map((entry) => entry.trim()))
    } else if (name === '--report') {
      parsed.reportPath = normalizeAbsolutePath(value, 'Archive kill-matrix report path')
    } else if (name === '--work-root') {
      parsed.workRoot = normalizeAbsolutePath(value, 'Archive kill-matrix work root')
    } else {
      const timeoutMs = Number(value)
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error('Archive kill-matrix timeout must be between 1000 and 1800000 ms.')
      }
      parsed.timeoutMs = timeoutMs
    }
  }
  resolveArchiveKillMatrixSelection(parsed.caseIds)
  return Object.freeze({ ...parsed, caseIds: Object.freeze([...parsed.caseIds]) })
}

/** Resolves an optional subset without permitting unknown, duplicate, or reordered cases. */
export function resolveArchiveKillMatrixSelection(caseIds = []) {
  if (!Array.isArray(caseIds)) throw new Error('Archive kill-matrix case selection is invalid.')
  if (caseIds.length === 0) return ARCHIVE_KILL_MATRIX_CASES
  const selected = new Set()
  for (const caseId of caseIds) {
    if (typeof caseId !== 'string' || !CASE_ID.test(caseId)
      || !ARCHIVE_KILL_MATRIX_CASES.some((entry) => entry.id === caseId)) {
      throw new Error(`Unknown archive kill case: ${String(caseId)}`)
    }
    if (selected.has(caseId)) throw new Error(`Duplicate archive kill case: ${caseId}`)
    selected.add(caseId)
  }
  return Object.freeze(ARCHIVE_KILL_MATRIX_CASES.filter((entry) => selected.has(entry.id)))
}

/** Captures the private prepared fixtures before any SIGKILL can mutate them. */
export function captureArchiveKillMatrixBaseline(input) {
  const root = normalizeAbsolutePath(input?.root, 'Archive kill-matrix fixture root')
  const selectedCases = resolveArchiveKillMatrixSelection(
    input?.selectedCases?.map((entry) => entry?.id) ?? [],
  )
  const state = readFixtureState(root)
  const recoveryCodes = new Set()
  const cases = {}
  for (const definition of selectedCases) {
    const record = normalizeFixtureRecord(state.cases?.[definition.id], definition)
    if (recoveryCodes.has(record.recoveryCode)) {
      throw new Error('Archive kill-matrix recovery codes are not unique per archive.')
    }
    recoveryCodes.add(record.recoveryCode)
    const profilePath = resolveFixtureProfile(root, record.profileRelativePath)
    const databasePath = path.join(profilePath, 'mission-store.sqlite')
    cases[definition.id] = Object.freeze({
      caseId: definition.id,
      lifecycle: definition.lifecycle,
      profilePath,
      databasePath,
      missionId: record.missionId,
      archiveId: record.archiveId,
      passphrase: state.passphrase,
      recoveryCode: record.recoveryCode,
      inventory: captureMissionInventory(databasePath),
      stableMission: captureStableMissionEvidence(databasePath, record.missionId),
    })
  }
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    caseCount: selectedCases.length,
    cases: Object.freeze(cases),
  })
}

/** Captures exact Git/workspace/harness identity without placing local paths in the report. */
export function captureBreadcrumbPr6KillMatrixRepositoryState(input) {
  const projectRoot = normalizeAbsolutePath(input?.projectRoot, 'Repository root')
  const harnessRelativePaths = normalizeHarnessPaths(input?.harnessRelativePaths)
  const headSha = runGit(projectRoot, ['rev-parse', 'HEAD^{commit}']).trim()
  const treeSha = runGit(projectRoot, ['rev-parse', 'HEAD^{tree}']).trim()
  if (!GIT_OBJECT_ID.test(headSha) || !GIT_OBJECT_ID.test(treeSha)) {
    throw new Error('Archive kill-matrix repository identity is invalid.')
  }
  const status = execFileSync('git', [
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ], { cwd: projectRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const workspacePaths = runGitBuffer(projectRoot, [
    'ls-files', '-co', '--exclude-standard', '-z',
  ]).toString('utf8').split('\0').filter(Boolean).sort()
  const workspaceHash = createHash('sha256')
  for (const relativePath of workspacePaths) {
    const absolutePath = resolveRepositoryFile(projectRoot, relativePath)
    workspaceHash.update(Buffer.from(relativePath, 'utf8'))
    workspaceHash.update(Buffer.from([0]))
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) workspaceHash.update(readlinkSync(absolutePath), 'utf8')
    else if (stat.isFile()) workspaceHash.update(readFileSync(absolutePath))
    else workspaceHash.update('<non-regular>', 'utf8')
    workspaceHash.update(Buffer.from([0]))
  }
  const harnessFiles = harnessRelativePaths.map((relativePath) => Object.freeze({
    relativePath,
    sha256: digestRepositoryFile(projectRoot, relativePath),
  }))
  return Object.freeze({
    headSha,
    treeSha,
    clean: status.length === 0,
    statusSha256: createHash('sha256').update(status).digest('hex'),
    workspaceSha256: workspaceHash.digest('hex'),
    harnessFiles: Object.freeze(harnessFiles),
  })
}

/** Runs one child to a declared phase, delivers SIGKILL, then independently inspects restart. */
export async function runArchiveKillCase(input) {
  if (process.platform === 'win32') {
    throw new Error('Archive SIGKILL qualification requires a POSIX host.')
  }
  const definition = normalizeCaseDefinition(input?.caseDefinition)
  const childPath = normalizeAbsolutePath(input?.childPath, 'Archive kill child path')
  const cwd = normalizeAbsolutePath(input?.cwd, 'Archive kill child working directory')
  const timeoutMs = normalizeTimeout(input?.timeoutMs)
  const runArgs = normalizeChildArgs(input?.runArgs)
  const reconcileArgs = normalizeChildArgs(input?.reconcileArgs)
  const protocolSelfTest = input?.protocolSelfTest === true
  const baseline = protocolSelfTest ? null : normalizeCaseBaseline(input?.baseline, definition)
  const startedAt = performance.now()
  const killed = await runUntilKilled({ definition, childPath, cwd, args: runArgs, timeoutMs })
  const childFacts = await runToReconciliation({
    definition,
    childPath,
    cwd,
    args: reconcileArgs,
    timeoutMs,
    protocolSelfTest,
  })
  const parentFacts = baseline === null
    ? null
    : await observeArchiveKillCase({ definition, baseline })
  const verdict = baseline === null
    ? Object.freeze({ proofTier: 'protocol_only' })
    : deriveArchiveKillCaseVerdict({ definition, childFacts, parentFacts })
  return Object.freeze({
    caseId: definition.id,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    kill: Object.freeze({
      requestedSignal: 'SIGKILL',
      observedSignal: killed.signal,
      exitCode: killed.code,
    }),
    phaseEvidence: killed.phaseEvidence,
    restart: Object.freeze({ childFacts, parentFacts, verdict }),
    durationMs: Math.max(0, performance.now() - startedAt),
    passed: true,
  })
}

/** Applies all safety meaning exclusively to facts observed by the qualifier process. */
export function deriveArchiveKillCaseVerdict(input) {
  const definition = normalizeCaseDefinition(input?.definition)
  const facts = input?.parentFacts
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new Error('Parent-observed archive restart facts are missing.')
  }
  if (facts.residue?.secretMatchCount !== 0) {
    throw new Error('Archive restart left an exact known secret residue.')
  }
  if (facts.residue?.entryCount !== 0 || facts.residue?.fileCount !== 0) {
    throw new Error('Archive restart left app-addressable plaintext residue.')
  }
  if (facts.mission?.idMatched !== true) {
    throw new Error('Archive restart did not preserve the mission identity stub.')
  }
  if (facts.mission?.stableCoreMatched !== true
    || facts.mission?.eventPrefixMatched !== true) {
    throw new Error('Archive restart mutated stable mission content or prior audit-event bytes.')
  }
  if ((definition.lifecycle === 'create'
      && !['finished', 'finalized'].includes(facts.mission?.status))
    || (definition.lifecycle !== 'create' && facts.mission?.status !== 'finalized')) {
    throw new Error('Archive restart left the mission in an invalid lifecycle state.')
  }
  if (facts.inventory?.declarationCount !== REQUIRED_INVENTORY_TABLE_COUNT
    || !Array.isArray(facts.inventory?.baselineTables)
    || !Array.isArray(facts.inventory?.observedTables)
    || facts.inventory.baselineTables.length !== REQUIRED_INVENTORY_TABLE_COUNT
    || facts.inventory.observedTables.length !== REQUIRED_INVENTORY_TABLE_COUNT) {
    throw new Error('Archive restart did not exhaust the authoritative 49-table inventory.')
  }
  assertCanonicalSchemaV13Tables(
    facts.inventory.baselineTables,
    'Archive baseline inventory',
  )
  assertCanonicalSchemaV13Tables(
    facts.inventory.observedTables,
    'Archive observed inventory',
  )
  const computedBaselineDigest = createHash('sha256')
    .update(JSON.stringify(facts.inventory.baselineTables), 'utf8')
    .digest('hex')
  const computedObservedDigest = createHash('sha256')
    .update(JSON.stringify(facts.inventory.observedTables), 'utf8')
    .digest('hex')
  const computedChangedTables = compareInventories(
    {
      declarationCount: facts.inventory.declarationCount,
      tables: facts.inventory.baselineTables,
    },
    {
      declarationCount: facts.inventory.declarationCount,
      tables: facts.inventory.observedTables,
    },
  )
  const allowedChanges = new Set([
    ...LIFECYCLE_MUTABLE_TABLES[definition.lifecycle],
    ...facts.inventory.observedTables
      .filter((entry) => entry.decision === 'derived_excluded')
      .map((entry) => entry.tableName),
    ...(definition.lifecycle === 'cleanup'
      ? facts.cleanup?.declaredRows?.map((entry) => entry.tableName) ?? []
      : []),
  ])
  const computedUnexpectedChangedTables = computedChangedTables
    .filter((tableName) => !allowedChanges.has(tableName))
  if (computedBaselineDigest !== facts.inventory.baselineDigestSha256
    || computedObservedDigest !== facts.inventory.observedDigestSha256
    || JSON.stringify(computedChangedTables) !== JSON.stringify(facts.inventory.changedTables)
    || JSON.stringify(computedUnexpectedChangedTables)
      !== JSON.stringify(facts.inventory.unexpectedChangedTables)) {
    throw new Error('Archive restart inventory verdict was not centrally derived from 49 tables.')
  }
  if (computedUnexpectedChangedTables.length > 0) {
    throw new Error(
      `Live mission inventory changed unexpectedly: ${computedUnexpectedChangedTables.join(',')}.`,
    )
  }
  const custody = facts.custody
  if (custody?.activeOperationPresent !== false || custody?.blockingConflictPresent !== false) {
    throw new Error('Archive custody did not reconcile after SIGKILL.')
  }
  if (definition.lifecycle !== 'create' && custody?.applicable === false) {
    throw new Error('Archive custody disappeared after SIGKILL.')
  }
  if (custody?.applicable === false && (
    custody?.registeredArchiveCount !== 0
    || custody?.diskArchiveCount !== 0
    || custody?.unregisteredArchiveCount !== 0
  )) {
    throw new Error('Archive restart left registry/disk drift or unregistered archive bytes.')
  }
  if (custody?.applicable !== false) {
    if (custody?.archiveIdMatched !== true || custody?.missionIdMatched !== true
      || custody?.availability !== 'present'
      || custody?.registryCiphertextSha256 !== custody?.diskCiphertextSha256
      || custody?.registrySizeBytes !== custody?.diskSizeBytes
      || custody?.registeredArchiveCount !== 1
      || custody?.diskArchiveCount !== 1
      || custody?.unregisteredArchiveCount !== 0
      || custody?.registryFileIdentityMatched !== true
      || (custody?.status === 'verified'
        && custody?.verificationProofFileIdentityMatched !== true)) {
      throw new Error('Archive custody registry, disk bytes, size, or file identity did not match.')
    }
    if (!['sealed', 'verified'].includes(custody?.status)) {
      throw new Error('Archive custody status is not safely sealed or verified.')
    }
  }
  const reviewRequired = custody?.status === 'verified'
  if (reviewRequired && (facts.review?.attempted !== true
    || facts.review?.openedAuditCount !== 1
    || facts.review?.readMethod !== 'listMissions'
    || facts.review?.readMissionMatched !== true
    || facts.review?.closedAuditCount !== 1)) {
    throw new Error('Post-restart archive Review did not open, read, and close cleanly.')
  }
  if (custody?.status === 'sealed') {
    if (facts.cleanupEligibility?.eligible !== false
      || !facts.cleanupEligibility?.blockers?.includes('current_archive_not_verified')) {
      throw new Error('Current post-restart cleanup eligibility lost the verification gate.')
    }
  } else if (custody?.status === 'verified' && definition.lifecycle !== 'cleanup') {
    if (facts.cleanupEligibility?.eligible !== false
      || JSON.stringify(facts.cleanupEligibility?.blockers)
        !== JSON.stringify(['fresh_non_machine_unlock_required'])
      || facts.cleanupEligibility?.storageState !== 'live') {
      throw new Error('Current post-restart cleanup eligibility is not safely credential-gated.')
    }
  }
  let cleanupResumeProven = null
  let cleanupDeclaredRowsProven = null
  if (definition.lifecycle === 'cleanup') {
    const declaredRows = facts.cleanup?.declaredRows
    if (facts.cleanup?.journalState !== 'completed'
      || facts.cleanup?.storageState !== 'archived'
      || !Number.isSafeInteger(facts.cleanup?.declaredTableCount)
      || facts.cleanup.declaredTableCount < 1
      || !Array.isArray(declaredRows)
      || declaredRows.length !== facts.cleanup.declaredTableCount
      || !Array.isArray(facts.cleanup?.remainingRows)
      || !Array.isArray(facts.cleanup?.reconstructibleDerivedRows)
      || !Array.isArray(facts.cleanup?.postReviewRemainingRows)) {
      throw new Error(
        'Cleanup did not retain exhaustive zero-row proof for every declared live-row table.',
      )
    }
    const observedByTable = new Map(
      facts.inventory.observedTables.map((entry) => [entry.tableName, entry]),
    )
    const declaredNames = new Set()
    const observedCleanupRows = declaredRows.map((entry) => {
      if (declaredNames.has(entry?.tableName)) {
        throw new Error('Cleanup declared-row inventory contains a duplicate table.')
      }
      declaredNames.add(entry?.tableName)
      const observed = observedByTable.get(entry?.tableName)
      const zeroRequired = observed?.decision !== 'derived_excluded'
      if (observed === undefined
        || entry.decision !== observed.decision
        || entry.rowCount !== observed.rowCount
        || entry.zeroRequired !== zeroRequired) {
        throw new Error('Cleanup row proof contradicts the observed 49-table inventory.')
      }
      return Object.freeze({
        tableName: observed.tableName,
        decision: observed.decision,
        rowCount: observed.rowCount,
        zeroRequired,
      })
    })
    assertCanonicalSchemaV13CleanupPlan(declaredRows)
    const expectedRemainingRows = observedCleanupRows.filter((entry) =>
      entry.zeroRequired && entry.rowCount > 0)
    const expectedReconstructibleDerivedRows = observedCleanupRows.filter((entry) =>
      !entry.zeroRequired && entry.rowCount > 0)
    const expectedPostReviewRemainingRows = observedCleanupRows
      .filter((entry) => entry.rowCount > 0)
      .map((entry) => Object.freeze({
        tableName: entry.tableName,
        rowCount: entry.rowCount,
      }))
    if (JSON.stringify(facts.cleanup.remainingRows) !== JSON.stringify(expectedRemainingRows)
      || JSON.stringify(facts.cleanup.reconstructibleDerivedRows)
        !== JSON.stringify(expectedReconstructibleDerivedRows)
      || JSON.stringify(facts.cleanup.postReviewRemainingRows)
        !== JSON.stringify(expectedPostReviewRemainingRows)
      || expectedRemainingRows.length > 0) {
      throw new Error('Cleanup row proof contradicts the observed 49-table inventory.')
    }
    if (facts.cleanupEligibility?.eligible !== false
      || !facts.cleanupEligibility?.blockers?.includes('cleanup_already_completed')
      || facts.cleanupEligibility?.storageState !== 'archived') {
      throw new Error('Current post-restart cleanup completion eligibility is invalid.')
    }
    if (!reviewRequired || facts.review?.closedAuditCount !== 1) {
      throw new Error('Post-cleanup archive Review did not close cleanly.')
    }
    cleanupResumeProven = true
    cleanupDeclaredRowsProven = true
  }
  return Object.freeze({
    proofTier: 'archive_lifecycle',
    archiveCustodyReconciled: true,
    archiveReviewProven: reviewRequired,
    cleanupVerificationGateProven: custody?.status === 'sealed'
      || custody?.status === 'verified',
    cleanupResumeProven,
    cleanupDeclaredRowsProven,
    liveMissionPreserved: definition.lifecycle === 'cleanup' ? null : true,
    missionStubPreserved: true,
    plaintextResidualCount: 0,
    exactSecretResidualMatchCount: 0,
    exhaustiveInventoryTableCount: REQUIRED_INVENTORY_TABLE_COUNT,
  })
}

/** Creates one path-free, secret-free report bound to exact repository and invocation state. */
export function buildBreadcrumbPr6KillMatrixReport(input) {
  const selectedCases = resolveArchiveKillMatrixSelection(
    input?.selectedCases?.map((entry) => entry?.id) ?? [],
  )
  if (!Array.isArray(input?.caseEvidence) || input.caseEvidence.length !== selectedCases.length) {
    throw new Error('Archive kill-matrix evidence does not match the selected matrix.')
  }
  const startedAt = normalizeTimestamp(input.startedAt, 'Archive kill-matrix start time')
  const completedAt = normalizeTimestamp(input.completedAt, 'Archive kill-matrix completion time')
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error('Archive kill-matrix completion precedes its start.')
  }
  const invocation = normalizeInvocation(input?.invocation, selectedCases)
  const repository = normalizeRepositoryBinding(input?.repositoryBefore, input?.repositoryAfter)
  const cases = Object.freeze(input.caseEvidence.map((evidence, index) =>
    normalizeCaseEvidence(evidence, selectedCases[index], invocation.protocolSelfTest)))
  const failedCaseCount = cases.filter((entry) => entry.passed !== true).length
  const complete = selectedCases.length === ARCHIVE_KILL_MATRIX_CASES.length
    && selectedCases.every((entry, index) => entry.id === ARCHIVE_KILL_MATRIX_CASES[index].id)
  const eligibilityGateProven = cases.some((entry) =>
    entry.lifecycle === 'create'
      && entry.restart.parentFacts?.custody?.status === 'sealed'
      && entry.restart.verdict.cleanupVerificationGateProven === true)
  const cleanupResumeProven = cases.some((entry) =>
    entry.restart.verdict.cleanupResumeProven === true
      && entry.restart.verdict.cleanupDeclaredRowsProven === true)
  const archiveLifecycleProof = !invocation.protocolSelfTest
    && cases.every((entry) => entry.restart.verdict.proofTier === 'archive_lifecycle')
  const qualified = complete && failedCaseCount === 0 && eligibilityGateProven
    && cleanupResumeProven && archiveLifecycleProof && repository.stable && repository.clean
  const structuralCases = cases.map((entry) => Object.freeze({
    caseId: entry.caseId,
    lifecycle: entry.lifecycle,
    phase: entry.phase,
    kill: entry.kill,
    phaseCheckpoint: Object.freeze({
      unit: entry.phaseEvidence.unit,
      detail: entry.phaseEvidence.detail,
    }),
    restart: entry.restart,
    passed: entry.passed,
  }))
  const runtime = Object.freeze({
    architecture: process.arch,
    node: process.version,
    platform: process.platform,
  })
  const structuralDigestSha256 = createHash('sha256')
    .update(JSON.stringify({ structuralCases, repository, invocation, runtime }), 'utf8')
    .digest('hex')
  let verdict = 'focused_pass'
  if (failedCaseCount > 0) verdict = 'failed'
  else if (qualified) verdict = 'qualified'
  else if (invocation.protocolSelfTest) verdict = 'protocol_self_test'
  else if (complete && (!repository.clean || !repository.stable)) verdict = 'matrix_pass_unbound'
  else if (!repository.clean || !repository.stable) verdict = 'focused_pass_unbound'
  return Object.freeze({
    schemaVersion: 2,
    proof: 'breadcrumb-pr6-archive-lifecycle-sigkill-matrix',
    startedAt,
    completedAt,
    runtime,
    invocation,
    repository,
    protocolSelfTest: invocation.protocolSelfTest,
    coverage: Object.freeze({
      complete,
      executedCaseCount: cases.length,
      requiredCaseCount: ARCHIVE_KILL_MATRIX_CASES.length,
      selectedCaseCount: selectedCases.length,
      eligibilityGateProven,
      cleanupResumeProven,
      archiveLifecycleProof,
    }),
    cases,
    summary: Object.freeze({
      failedCaseCount,
      passedCaseCount: cases.length - failedCaseCount,
    }),
    structuralDigestSha256,
    verdict,
  })
}

/** Independently opens the restarted store, exercises Review, and closes it before inspection. */
async function observeArchiveKillCase({ definition, baseline }) {
  const postCleanupProof = definition.lifecycle === 'cleanup'
    ? capturePostCleanupProof(baseline.databasePath, baseline.missionId)
    : null
  const store = createElectronMissionStore({
    userDataPath: baseline.profilePath,
    archiveCleanupBatchLimits: { positions: 1, default: 1 },
  })
  const manager = createArchiveReviewSessionManager({
    reviewRoot: path.join(baseline.profilePath, REVIEW_DIRECTORY_NAME),
    archiveDirectory: path.join(baseline.profilePath, ARCHIVE_DIRECTORY_NAME),
    registry: {
      issueReviewTicket: (archiveId) => store.issueMissionArchiveReviewTicket(archiveId),
      recordReviewOpened: (entry) => store.recordMissionArchiveReviewOpened(entry),
      recordReviewClosed: (entry) => store.recordMissionArchiveReviewClosed(entry),
      recordReviewMutationDenied: (entry) =>
        store.recordMissionArchiveReviewMutationDenied(entry),
    },
  })
  let archiveId = baseline.archiveId
  let review = Object.freeze({
    attempted: false,
    openedAuditCount: 0,
    readMethod: null,
    readMissionMatched: false,
    closedAuditCount: 0,
  })
  let cleanupEligibility = null
  try {
    await manager.sweepStartup()
    const archives = await store.listMissionArchives(baseline.missionId)
    if (archiveId === null) archiveId = archives.at(-1)?.id ?? null
    const archive = archiveId === null
      ? null
      : archives.find((entry) => entry.id === archiveId) ?? null
    if (archive?.status === 'verified') {
      const senderId = 9_001
      const publicSession = await manager.open({
        senderId,
        request: {
          archiveId,
          containerVersion: 2,
          operationId: reviewOperationId(definition.operationId),
          slotType: 'recovery',
        },
        secret: baseline.recoveryCode,
      })
      const missions = await manager.read({
        senderId,
        sessionId: publicSession.sessionId,
        method: 'listMissions',
        args: [],
      })
      const readMissionMatched = Array.isArray(missions)
        && missions.some((mission) => mission?.id === baseline.missionId)
      await manager.close({ senderId, sessionId: publicSession.sessionId })
      const audits = readReviewAudits(
        baseline.databasePath,
        baseline.missionId,
        archiveId,
        publicSession.sessionId,
      )
      review = Object.freeze({
        attempted: true,
        openedAuditCount: audits.opened,
        readMethod: 'listMissions',
        readMissionMatched,
        closedAuditCount: audits.closed,
      })
    }
    if (archiveId !== null) {
      cleanupEligibility = await store.getMissionCleanupEligibility(
        { missionId: baseline.missionId, archiveId },
        { reviewActivity: manager.hasReviewActivity() },
      )
    }
  } finally {
    await manager.prepareClose().catch(() => undefined)
    await store.prepareClose()
    store.close()
  }

  const raw = inspectRestartDatabase({
    definition,
    baseline,
    archiveId,
    cleanupEligibility,
    postCleanupProof,
    review,
  })
  return Object.freeze(raw)
}

/** Reads all durable post-close state and exact disk identity from the parent process. */
function inspectRestartDatabase({
  definition,
  baseline,
  archiveId,
  cleanupEligibility,
  postCleanupProof,
  review,
}) {
  const db = new Database(baseline.databasePath, { readonly: true, fileMustExist: true })
  let mission
  let archive
  let archiveRows
  let activeOperation
  let blockingConflict
  let cleanup
  try {
    mission = db.prepare('SELECT id, status FROM missions WHERE id = ?').get(baseline.missionId)
    archive = archiveId === null
      ? null
      : db.prepare(`SELECT id, mission_id, relative_path, ciphertext_sha256, size_bytes,
          status, availability, last_observed_file_identity, verification_proof_json
        FROM mission_archives WHERE id = ?`).get(archiveId) ?? null
    archiveRows = db.prepare(`SELECT id, relative_path FROM mission_archives
      WHERE mission_id = ? ORDER BY id`).all(baseline.missionId)
    activeOperation = readMetadataFromDb(db, 'archive_custody_active_operation')
    blockingConflict = readMetadataFromDb(db, 'archive_custody_blocking_conflict')
      ?? readMetadataFromDb(db, 'archive_custody_recovery_failure')
    cleanup = readCleanupFacts(db, baseline.missionId)
  } finally {
    db.close()
  }
  const inventory = captureMissionInventory(baseline.databasePath)
  const stableMission = captureStableMissionEvidence(
    baseline.databasePath,
    baseline.missionId,
    baseline.stableMission.eventRowCount,
  )
  const cleanupTables = cleanup?.tables ?? []
  const allowedChanges = new Set([
    ...LIFECYCLE_MUTABLE_TABLES[definition.lifecycle],
    ...inventory.tables
      .filter((entry) => entry.decision === 'derived_excluded')
      .map((entry) => entry.tableName),
    ...(definition.lifecycle === 'cleanup' ? cleanupTables : []),
  ])
  const changedTables = compareInventories(baseline.inventory, inventory)
  const unexpectedChangedTables = changedTables.filter((tableName) => !allowedChanges.has(tableName))
  const cleanupProof = postCleanupProof === null ? null : Object.freeze({
    ...postCleanupProof,
    postReviewRemainingRows: Object.freeze(cleanupTables.flatMap((tableName) => {
      const table = inventory.tables.find((entry) => entry.tableName === tableName)
      return table?.rowCount > 0
        ? [Object.freeze({ tableName, rowCount: table.rowCount })]
        : []
    })),
  })
  return {
    mission: Object.freeze({
      idMatched: mission?.id === baseline.missionId,
      status: ['finished', 'finalized'].includes(mission?.status) ? mission.status : null,
      stableCoreMatched: stableMission.coreSha256 === baseline.stableMission.coreSha256,
      eventPrefixMatched: stableMission.eventPrefixSha256
        === baseline.stableMission.eventPrefixSha256,
      baselineEventRowCount: baseline.stableMission.eventRowCount,
      observedEventRowCount: stableMission.totalEventRowCount,
    }),
    custody: inspectCustody({
      baseline,
      archive,
      archiveRows,
      activeOperation,
      blockingConflict,
    }),
    inventory: Object.freeze({
      declarationCount: inventory.declarationCount,
      baselineDigestSha256: baseline.inventory.digestSha256,
      observedDigestSha256: inventory.digestSha256,
      changedTables: Object.freeze(changedTables),
      unexpectedChangedTables: Object.freeze(unexpectedChangedTables),
      baselineTables: baseline.inventory.tables,
      observedTables: inventory.tables,
    }),
    cleanupEligibility: normalizeCleanupEligibilityFact(cleanupEligibility),
    cleanup: cleanupProof,
    review,
    residue: scanKnownResidueRoots(baseline.profilePath, [
      baseline.passphrase,
      baseline.recoveryCode,
    ]),
  }
}

/** Inspects one archive through the production pinned-file boundary and registry proof. */
function inspectCustody({
  baseline,
  archive,
  archiveRows,
  activeOperation,
  blockingConflict,
}) {
  const diskRelativePaths = listCustodyArchiveFiles(
    path.join(baseline.profilePath, ARCHIVE_DIRECTORY_NAME),
  )
  const registeredRelativePaths = new Set(archiveRows.map((row) => row.relative_path))
  const unregisteredArchiveCount = diskRelativePaths
    .filter((relativePath) => !registeredRelativePaths.has(relativePath)).length
  if (archive === null) {
    return Object.freeze({
      applicable: false,
      activeOperationPresent: activeOperation !== null,
      blockingConflictPresent: blockingConflict !== null,
      diskArchiveCount: diskRelativePaths.length,
      registeredArchiveCount: archiveRows.length,
      status: null,
      unregisteredArchiveCount,
    })
  }
  let disk = null
  let inspectionErrorCode = null
  try {
    disk = inspectArchiveCustodyFile({
      archiveDirectory: path.join(baseline.profilePath, ARCHIVE_DIRECTORY_NAME),
      archiveRelativePath: archive.relative_path,
    })
  } catch (error) {
    inspectionErrorCode = typeof error?.code === 'string'
      ? error.code
      : 'ARCHIVE_CUSTODY_INSPECTION_FAILED'
  }
  const registryFileIdentity = parseBoundedJson(archive.last_observed_file_identity)
  const verificationProof = parseBoundedJson(archive.verification_proof_json)
  return Object.freeze({
    applicable: true,
    archiveIdMatched: archive.id === (baseline.archiveId ?? archive.id),
    missionIdMatched: archive.mission_id === baseline.missionId,
    status: ['sealed', 'verified'].includes(archive.status) ? archive.status : null,
    availability: archive.availability,
    registryCiphertextSha256: archive.ciphertext_sha256,
    diskCiphertextSha256: disk?.ciphertextSha256 ?? null,
    registrySizeBytes: archive.size_bytes === null ? null : Number(archive.size_bytes),
    diskSizeBytes: disk?.sizeBytes ?? null,
    registryFileIdentityMatched: disk !== null
      && registryFileIdentity !== null
      && JSON.stringify(registryFileIdentity) === JSON.stringify(disk.fileIdentity),
    verificationProofFileIdentityMatched: archive.status !== 'verified'
      ? null
      : disk !== null
        && verificationProof?.custodyFileIdentity !== undefined
        && JSON.stringify(verificationProof.custodyFileIdentity)
          === JSON.stringify(disk.fileIdentity),
    activeOperationPresent: activeOperation !== null,
    blockingConflictPresent: blockingConflict !== null,
    inspectionErrorCode,
    diskArchiveCount: diskRelativePaths.length,
    registeredArchiveCount: archiveRows.length,
    unregisteredArchiveCount,
  })
}

/** Lists final archive-container paths without following links or entering scratch roots. */
function listCustodyArchiveFiles(archiveDirectory) {
  let root
  try { root = lstatSync(archiveDirectory) } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze([])
    throw error
  }
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('Archive custody directory is unsafe during parent inspection.')
  }
  const results = []
  const visit = (directory, relativePrefix) => {
    for (const name of readdirSync(directory).sort()) {
      if (relativePrefix === '' && ['.staging', '.verification'].includes(name)) continue
      const entryPath = path.join(directory, name)
      const relativePath = relativePrefix === '' ? name : `${relativePrefix}/${name}`
      const stat = lstatSync(entryPath)
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(entryPath, relativePath)
      else if (name.endsWith('.sararch')) results.push(relativePath)
    }
  }
  visit(archiveDirectory, '')
  return Object.freeze(results)
}

/** Captures all 49 schema-v13 table row counts and content digests from one profile. */
function captureMissionInventory(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    reconcileArchiveInventory(db, { schemaVersion: CURRENT_SCHEMA_VERSION })
    const declarations = listArchiveInventoryForSchema(CURRENT_SCHEMA_VERSION)
    if (declarations.length !== REQUIRED_INVENTORY_TABLE_COUNT) {
      throw new Error('Archive kill-matrix schema-v13 inventory is not exactly 49 tables.')
    }
    const tables = declarations.map((declaration) => {
      const digest = computeArchivedTableContentDigest(db, {
        tableName: declaration.tableName,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      })
      return Object.freeze({
        tableName: declaration.tableName,
        decision: declaration.decision,
        rowCount: digest.rowCount,
        contentSha256: digest.contentSha256,
      })
    })
    return Object.freeze({
      declarationCount: declarations.length,
      tables: Object.freeze(tables),
      digestSha256: createHash('sha256').update(JSON.stringify(tables), 'utf8').digest('hex'),
    })
  } finally {
    db.close()
  }
}

/** Digests immutable mission fields and the exact prior audit-event prefix. */
function captureStableMissionEvidence(databasePath, missionId, prefixRowCount = null) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const mission = db.prepare(`SELECT id, name, start_time, pause_time, finish_time,
        paused_seconds, notes, schema_version
      FROM missions WHERE id = ?`).get(missionId)
    if (mission === undefined) throw new Error('Stable mission evidence is missing.')
    const totalEventRowCount = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM mission_events WHERE mission_id = ?`).get(missionId).count)
    const requestedCount = prefixRowCount ?? totalEventRowCount
    if (!Number.isSafeInteger(requestedCount) || requestedCount < 0
      || requestedCount > totalEventRowCount) {
      throw new Error('Stable mission event prefix is invalid.')
    }
    const events = db.prepare(`SELECT rowid AS durable_rowid, * FROM mission_events
      WHERE mission_id = ? ORDER BY rowid LIMIT ?`).all(missionId, requestedCount)
    if (events.length !== requestedCount) {
      throw new Error('Stable mission event prefix is incomplete.')
    }
    return Object.freeze({
      coreSha256: createHash('sha256').update(JSON.stringify(mission), 'utf8').digest('hex'),
      eventPrefixSha256: createHash('sha256')
        .update(JSON.stringify(events), 'utf8')
        .digest('hex'),
      eventRowCount: requestedCount,
      totalEventRowCount,
    })
  } finally {
    db.close()
  }
}

/** Captures the terminal cleanup cursor and every declared row count before Review adds audits. */
function capturePostCleanupProof(databasePath, missionId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  let cleanup
  try {
    cleanup = readCleanupFacts(db, missionId)
  } finally {
    db.close()
  }
  if (cleanup === null) throw new Error('Post-cleanup journal proof is missing.')
  const inventory = captureMissionInventory(databasePath)
  const declaredRows = cleanup.tables.map((tableName) => {
    const table = inventory.tables.find((entry) => entry.tableName === tableName)
    return Object.freeze({
      tableName,
      decision: table?.decision ?? null,
      rowCount: table?.rowCount ?? -1,
      zeroRequired: table?.decision !== 'derived_excluded',
    })
  })
  return Object.freeze({
    journalState: cleanup.state,
    storageState: cleanup.state === 'completed' ? 'archived' : 'cleanup_in_progress',
    declaredTableCount: cleanup.tables.length,
    declaredRows: Object.freeze(declaredRows),
    remainingRows: Object.freeze(declaredRows.filter((entry) =>
      entry.zeroRequired && entry.rowCount !== 0)),
    reconstructibleDerivedRows: Object.freeze(declaredRows.filter((entry) =>
      !entry.zeroRequired && entry.rowCount !== 0)),
  })
}

/** Returns every changed table, comparing exact decision, row count and content digest. */
function compareInventories(baseline, observed) {
  if (baseline?.declarationCount !== REQUIRED_INVENTORY_TABLE_COUNT
    || observed?.declarationCount !== REQUIRED_INVENTORY_TABLE_COUNT
    || !Array.isArray(baseline.tables) || !Array.isArray(observed.tables)) {
    throw new Error('Archive kill-matrix inventory comparison is incomplete.')
  }
  const observedByTable = new Map(observed.tables.map((entry) => [entry.tableName, entry]))
  return baseline.tables.flatMap((entry) => {
    const current = observedByTable.get(entry.tableName)
    return current === undefined
      || current.decision !== entry.decision
      || current.rowCount !== entry.rowCount
      || current.contentSha256 !== entry.contentSha256
      ? [entry.tableName]
      : []
  })
}

/** Requires the exact table-name, decision and order projection of schema v13. */
function assertCanonicalSchemaV13Tables(tables, label) {
  if (!Array.isArray(tables)
    || tables.length !== REQUIRED_INVENTORY_TABLE_COUNT
    || CANONICAL_SCHEMA_V13_INVENTORY.length !== REQUIRED_INVENTORY_TABLE_COUNT) {
    throw new Error(`${label} is not the canonical schema-v13 inventory.`)
  }
  const names = new Set()
  for (let index = 0; index < CANONICAL_SCHEMA_V13_INVENTORY.length; index += 1) {
    const actual = tables[index]
    const expected = CANONICAL_SCHEMA_V13_INVENTORY[index]
    if (actual?.tableName !== expected.tableName
      || actual?.decision !== expected.decision
      || names.has(actual.tableName)) {
      throw new Error(`${label} is not the canonical schema-v13 inventory.`)
    }
    names.add(actual.tableName)
  }
}

/** Requires the exact schema-v13 cleanup selection and FK-safe journal order. */
function assertCanonicalSchemaV13CleanupPlan(declaredRows) {
  const selectedBySchemaContract = CANONICAL_SCHEMA_V13_INVENTORY
    .filter((entry) => (
      entry.decision === 'mission_rows'
        && !SCHEMA_V13_RETAINED_MISSION_TABLES.has(entry.tableName)
    ) || (
      entry.decision === 'derived_excluded'
        && SCHEMA_V13_MISSION_ID_DERIVED_TABLES.has(entry.tableName)
    ) || (
      entry.decision === 'operational_excluded'
        && SCHEMA_V13_CLEANUP_OPERATIONAL_TABLES.has(entry.tableName)
    ))
    .map((entry) => entry.tableName)
    .sort()
  const orderedContract = [...CANONICAL_SCHEMA_V13_CLEANUP_ORDER].sort()
  const declaredOrder = Array.isArray(declaredRows)
    ? declaredRows.map((entry) => entry?.tableName)
    : []
  if (JSON.stringify(selectedBySchemaContract) !== JSON.stringify(orderedContract)
    || JSON.stringify(declaredOrder) !== JSON.stringify(CANONICAL_SCHEMA_V13_CLEANUP_ORDER)) {
    throw new Error('Cleanup proof does not match the exact schema-v13 cleanup plan and order.')
  }
}

/** Scans only app-owned plaintext roots and reports counts without reflecting secret values. */
function scanKnownResidueRoots(profilePath, secrets) {
  const secretBuffers = secrets.map((secret) => Buffer.from(secret, 'utf8'))
  let entryCount = 0
  let fileCount = 0
  let secretMatchCount = 0
  let scannedByteCount = 0
  const visit = (entryPath) => {
    let stat
    try { stat = lstatSync(entryPath) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    entryCount += 1
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      if (stat.isFile()) {
        fileCount += 1
        const scan = scanFileForSecrets(entryPath, secretBuffers)
        scannedByteCount += scan.scannedByteCount
        secretMatchCount += scan.secretMatchCount
      }
      return
    }
    for (const child of readdirSync(entryPath)) visit(path.join(entryPath, child))
  }
  for (const root of [
    path.join(profilePath, ARCHIVE_DIRECTORY_NAME, '.staging'),
    path.join(profilePath, ARCHIVE_DIRECTORY_NAME, '.verification'),
    path.join(profilePath, REVIEW_DIRECTORY_NAME),
  ]) {
    let rootStat
    try { rootStat = lstatSync(root) } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      visit(root)
      continue
    }
    for (const child of readdirSync(root)) visit(path.join(root, child))
  }
  for (const secret of secretBuffers) secret.fill(0)
  return Object.freeze({ entryCount, fileCount, scannedByteCount, secretMatchCount })
}

/** Streams a regular residue file while retaining only a bounded cross-chunk suffix. */
function scanFileForSecrets(filePath, secrets) {
  const descriptor = openSync(filePath, 'r')
  const chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES)
  const longestSecret = Math.max(...secrets.map((secret) => secret.length), 1)
  let carry = Buffer.alloc(0)
  let position = 0
  let scannedByteCount = 0
  let secretMatchCount = 0
  try {
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      scannedByteCount += bytesRead
      position += bytesRead
      const searchable = Buffer.concat([carry, chunk.subarray(0, bytesRead)])
      for (const secret of secrets) {
        let offset = 0
        while ((offset = searchable.indexOf(secret, offset)) >= 0) {
          secretMatchCount += 1
          offset += Math.max(secret.length, 1)
        }
      }
      const keep = Math.min(searchable.length, longestSecret - 1)
      carry.fill(0)
      carry = Buffer.from(searchable.subarray(searchable.length - keep))
      searchable.fill(0)
    }
    return { scannedByteCount, secretMatchCount }
  } finally {
    carry.fill(0)
    chunk.fill(0)
    closeSync(descriptor)
  }
}

/** Reads exact opened/closed audit events for the parent-owned review session. */
function readReviewAudits(databasePath, missionId, archiveId, sessionId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare(`SELECT event_type, details_json FROM mission_events
      WHERE mission_id = ? AND event_type IN (
        'mission_archive_review_opened', 'mission_archive_review_closed'
      ) ORDER BY rowid`).all(missionId)
    let opened = 0
    let closed = 0
    for (const row of rows) {
      const details = parseBoundedJson(row.details_json)
      if (details?.archive_id !== archiveId || details?.session_id !== sessionId) continue
      if (row.event_type === 'mission_archive_review_opened') opened += 1
      if (row.event_type === 'mission_archive_review_closed'
        && details.plaintext_sweep_confirmed === true) closed += 1
    }
    return Object.freeze({ opened, closed })
  } finally {
    db.close()
  }
}

/** Reads and shape-closes one cleanup journal including its durable table plan. */
function readCleanupFacts(db, missionId) {
  const row = db.prepare(`SELECT state, progress_json FROM mission_cleanup_journal
    WHERE mission_id = ?`).get(missionId)
  if (row === undefined) return null
  const progress = parseBoundedJson(row.progress_json)
  if (!['eligible', 'in_progress', 'completed'].includes(row.state)
    || !Array.isArray(progress?.tables)
    || progress.tables.some((tableName) => typeof tableName !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName))) {
    throw new Error('Archive cleanup journal proof is invalid.')
  }
  return Object.freeze({ state: row.state, tables: Object.freeze([...progress.tables]) })
}

/** Projects current store-owned eligibility without accepting cached preparation state. */
function normalizeCleanupEligibilityFact(input) {
  if (input === null) return null
  if (typeof input !== 'object' || typeof input.eligible !== 'boolean'
    || !Array.isArray(input.blockers)
    || input.blockers.some((blocker) => typeof blocker !== 'string')
    || !['live', 'cleanup_in_progress', 'archived'].includes(input.storageState)) {
    throw new Error('Current archive cleanup eligibility observation is invalid.')
  }
  return Object.freeze({
    eligible: input.eligible,
    blockers: Object.freeze([...input.blockers]),
    storageState: input.storageState,
  })
}

/** Reads bounded JSON evidence without reflecting invalid bytes. */
function parseBoundedJson(input) {
  if (typeof input !== 'string' || input.length < 1
    || Buffer.byteLength(input, 'utf8') > MAX_STATE_BYTES) return null
  try {
    const value = JSON.parse(input)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Reads one metadata value on an already-open parent-owned connection. */
function readMetadataFromDb(db, key) {
  return db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value ?? null
}

/** Spawns one child and kills it immediately after its exact target phase protocol record. */
async function runUntilKilled({ definition, childPath, cwd, args, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childPath, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let phaseEvidence = null
    let protocolFailure = null
    let stderrBytes = 0
    const parser = createLineParser((message) => {
      if (phaseEvidence !== null) throw new Error('Archive kill child emitted duplicate output.')
      phaseEvidence = normalizePhaseMessage(message, definition)
      if (!child.kill('SIGKILL')) throw new Error('Archive kill child could not be sent SIGKILL.')
    })
    const timeout = setTimeout(() => {
      protocolFailure ??= new Error(
        `Archive kill child did not reach ${definition.id} within its timeout.`,
      )
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (protocolFailure !== null) return
      try { parser.push(chunk) } catch (error) {
        protocolFailure = error
        child.kill('SIGKILL')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STDERR_BYTES && protocolFailure === null) {
        protocolFailure = new Error('Archive kill child stderr exceeded its safe bound.')
        child.kill('SIGKILL')
      }
    })
    child.once('error', (error) => {
      protocolFailure ??= new Error('Archive kill child could not be started.', { cause: error })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      try { parser.finish() } catch (error) { protocolFailure ??= error }
      if (protocolFailure !== null) reject(protocolFailure)
      else if (phaseEvidence === null) {
        reject(new Error(`Archive kill child exited before phase ${definition.id}.`))
      } else if (signal !== 'SIGKILL' || code !== null) {
        reject(new Error(
          `Archive kill child did not exit by SIGKILL (code=${String(code)}, signal=${String(signal)}).`,
        ))
      } else resolve(Object.freeze({ code, signal, phaseEvidence }))
    })
  })
}

/** Runs the fresh restart process to its one non-assertive operation-completion record. */
async function runToReconciliation({
  definition,
  childPath,
  cwd,
  args,
  timeoutMs,
  protocolSelfTest,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childPath, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let restart = null
    let protocolFailure = null
    let stderrBytes = 0
    const parser = createLineParser((message) => {
      if (restart !== null) throw new Error('Archive restart child emitted duplicate output.')
      restart = normalizeRestartMessage(message, definition, protocolSelfTest)
    })
    const timeout = setTimeout(() => {
      protocolFailure ??= new Error(
        `Archive restart child did not reconcile ${definition.id} within its timeout.`,
      )
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (protocolFailure !== null) return
      try { parser.push(chunk) } catch (error) {
        protocolFailure = error
        child.kill('SIGKILL')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STDERR_BYTES && protocolFailure === null) {
        protocolFailure = new Error('Archive restart child stderr exceeded its safe bound.')
        child.kill('SIGKILL')
      }
    })
    child.once('error', (error) => {
      protocolFailure ??= new Error('Archive restart child could not be started.', { cause: error })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      try { parser.finish() } catch (error) { protocolFailure ??= error }
      if (protocolFailure !== null) reject(protocolFailure)
      else if (code !== 0 || signal !== null || restart === null) {
        reject(new Error('Archive restart child did not return one successful reconciliation.'))
      } else resolve(restart)
    })
  })
}

/** Maintains bounded newline-delimited JSON protocol state for one child. */
function createLineParser(onMessage) {
  let buffered = Buffer.alloc(0)
  let totalBytes = 0
  const parseLine = (line) => {
    if (line.length < 1) return
    if (line.length > MAX_PROTOCOL_LINE_BYTES) {
      throw new Error('Archive kill child protocol line exceeded its safe bound.')
    }
    let message
    try { message = JSON.parse(line.toString('utf8')) } catch {
      throw new Error('Archive kill child emitted invalid JSON.')
    }
    onMessage(message)
  }
  return Object.freeze({
    push(chunk) {
      totalBytes += chunk.length
      if (totalBytes > MAX_PROTOCOL_OUTPUT_BYTES) {
        throw new Error('Archive kill child protocol output exceeded its safe bound.')
      }
      buffered = Buffer.concat([buffered, chunk])
      let newline
      while ((newline = buffered.indexOf(0x0a)) >= 0) {
        parseLine(buffered.subarray(0, newline))
        buffered = buffered.subarray(newline + 1)
      }
      if (buffered.length > MAX_PROTOCOL_LINE_BYTES) {
        throw new Error('Archive kill child protocol line exceeded its safe bound.')
      }
    },
    finish() {
      if (buffered.length > 0) parseLine(buffered)
      buffered = Buffer.alloc(0)
    },
  })
}

/** Shape-closes one phase checkpoint and discards all non-allowlisted child data. */
function normalizePhaseMessage(input, definition) {
  requireExactKeys(
    input,
    ['caseId', 'lifecycle', 'phase', 'progress', 'protocolVersion', 'type'],
    'Archive phase message',
  )
  if (input.type !== 'phase-reached' || input.protocolVersion !== PROTOCOL_VERSION
    || input.caseId !== definition.id || input.lifecycle !== definition.lifecycle
    || input.phase !== definition.phase) {
    throw new Error('Archive kill child reached an unexpected phase.')
  }
  requireExactKeys(
    input.progress,
    ['completed', 'detail', 'sequence', 'total', 'unit'],
    'Archive phase progress',
  )
  const progress = input.progress
  if (!Number.isSafeInteger(progress.sequence) || progress.sequence < 1
    || !['bytes', 'directories', 'files', 'phases', 'rows'].includes(progress.unit)
    || !Number.isSafeInteger(progress.completed) || progress.completed < 0
    || (progress.total !== null && (!Number.isSafeInteger(progress.total)
      || progress.total < progress.completed))
    || typeof progress.detail !== 'string' || !SAFE_DETAIL.test(progress.detail)) {
    throw new Error('Archive kill child phase progress is invalid.')
  }
  if (SENSITIVE_DETAIL.test(progress.detail)) {
    throw new Error('Archive kill child emitted sensitive progress detail.')
  }
  return Object.freeze({
    sequence: progress.sequence,
    unit: progress.unit,
    completed: progress.completed,
    total: progress.total,
    detail: progress.detail,
  })
}

/** Accepts only a child operation outcome; all safety assertions belong to the parent. */
function normalizeRestartMessage(input, definition, protocolSelfTest) {
  requireExactKeys(
    input,
    ['caseId', 'lifecycle', 'operation', 'phase', 'protocolVersion', 'type'],
    'Archive restart message',
  )
  if (input.type !== 'reconciled' || input.protocolVersion !== PROTOCOL_VERSION
    || input.caseId !== definition.id || input.lifecycle !== definition.lifecycle
    || input.phase !== definition.phase) {
    throw new Error('Archive restart child reconciled an unexpected case.')
  }
  requireExactKeys(input.operation, ['action', 'outcome'], 'Archive restart operation')
  const expectedAction = protocolSelfTest
    ? 'protocol_restart'
    : EXPECTED_RESTART_ACTION[definition.lifecycle]
  if (input.operation.action !== expectedAction || input.operation.outcome !== 'completed') {
    throw new Error('Archive restart child operation outcome is invalid.')
  }
  return Object.freeze({ action: expectedAction, outcome: 'completed' })
}

/** Revalidates evidence supplied to the final report builder. */
function normalizeCaseEvidence(input, definition, protocolSelfTest) {
  requireExactKeys(input, [
    'caseId',
    'durationMs',
    'kill',
    'lifecycle',
    'passed',
    'phase',
    'phaseEvidence',
    'restart',
  ], 'Archive kill case evidence')
  if (input.caseId !== definition.id || input.lifecycle !== definition.lifecycle
    || input.phase !== definition.phase || input.passed !== true
    || !Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error('Archive kill case evidence identity is invalid.')
  }
  requireExactKeys(
    input.kill,
    ['exitCode', 'observedSignal', 'requestedSignal'],
    'Archive kill signal evidence',
  )
  if (input.kill.requestedSignal !== 'SIGKILL'
    || input.kill.observedSignal !== 'SIGKILL' || input.kill.exitCode !== null) {
    throw new Error('Archive kill case did not prove SIGKILL.')
  }
  const phaseEvidence = normalizePhaseMessage({
    type: 'phase-reached',
    protocolVersion: PROTOCOL_VERSION,
    caseId: definition.id,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    progress: input.phaseEvidence,
  }, definition)
  requireExactKeys(input.restart, ['childFacts', 'parentFacts', 'verdict'], 'Restart evidence')
  const childFacts = normalizeRestartMessage({
    type: 'reconciled',
    protocolVersion: PROTOCOL_VERSION,
    caseId: definition.id,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    operation: input.restart.childFacts,
  }, definition, protocolSelfTest)
  let parentFacts = null
  let verdict
  if (protocolSelfTest) {
    if (input.restart.parentFacts !== null
      || input.restart.verdict?.proofTier !== 'protocol_only'
      || Object.keys(input.restart.verdict).join(',') !== 'proofTier') {
      throw new Error('Protocol-only evidence made unsupported archive claims.')
    }
    verdict = Object.freeze({ proofTier: 'protocol_only' })
  } else {
    parentFacts = normalizeParentFactsForReport(input.restart.parentFacts)
    verdict = deriveArchiveKillCaseVerdict({
      definition,
      childFacts,
      parentFacts,
    })
    if (JSON.stringify(verdict) !== JSON.stringify(input.restart.verdict)) {
      throw new Error('Archive kill case verdict was not centrally derived from report facts.')
    }
  }
  return Object.freeze({
    caseId: definition.id,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    kill: Object.freeze({
      requestedSignal: 'SIGKILL',
      observedSignal: 'SIGKILL',
      exitCode: null,
    }),
    phaseEvidence,
    restart: Object.freeze({ childFacts, parentFacts, verdict }),
    durationMs: input.durationMs,
    passed: true,
  })
}

/** Removes private/non-report fields by serializing only the closed parent fact structure. */
function normalizeParentFactsForReport(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Archive parent evidence is invalid.')
  }
  requireExactKeys(input, [
    'cleanup',
    'cleanupEligibility',
    'custody',
    'inventory',
    'mission',
    'residue',
    'review',
  ], 'Archive parent evidence')
  requireExactKeys(input.mission, [
    'baselineEventRowCount',
    'eventPrefixMatched',
    'idMatched',
    'observedEventRowCount',
    'stableCoreMatched',
    'status',
  ], 'Archive mission observation')
  if (typeof input.mission.idMatched !== 'boolean'
    || typeof input.mission.stableCoreMatched !== 'boolean'
    || typeof input.mission.eventPrefixMatched !== 'boolean'
    || !['finished', 'finalized', null].includes(input.mission.status)
    || !Number.isSafeInteger(input.mission.baselineEventRowCount)
    || !Number.isSafeInteger(input.mission.observedEventRowCount)
    || input.mission.baselineEventRowCount < 0
    || input.mission.observedEventRowCount < input.mission.baselineEventRowCount) {
    throw new Error('Archive mission observation is invalid.')
  }
  const custodyKeys = input.custody?.applicable === false
    ? [
        'activeOperationPresent',
        'applicable',
        'blockingConflictPresent',
        'diskArchiveCount',
        'registeredArchiveCount',
        'status',
        'unregisteredArchiveCount',
      ]
    : [
        'activeOperationPresent',
        'applicable',
        'archiveIdMatched',
        'availability',
        'blockingConflictPresent',
        'diskCiphertextSha256',
        'diskArchiveCount',
        'diskSizeBytes',
        'inspectionErrorCode',
        'missionIdMatched',
        'registryCiphertextSha256',
        'registeredArchiveCount',
        'registryFileIdentityMatched',
        'registrySizeBytes',
        'status',
        'verificationProofFileIdentityMatched',
        'unregisteredArchiveCount',
      ]
  requireExactKeys(input.custody, custodyKeys, 'Archive custody observation')
  if (typeof input.custody.activeOperationPresent !== 'boolean'
    || typeof input.custody.blockingConflictPresent !== 'boolean'
    || !Number.isSafeInteger(input.custody.diskArchiveCount)
    || !Number.isSafeInteger(input.custody.registeredArchiveCount)
    || !Number.isSafeInteger(input.custody.unregisteredArchiveCount)
    || input.custody.diskArchiveCount < 0
    || input.custody.registeredArchiveCount < 0
    || input.custody.unregisteredArchiveCount < 0) {
    throw new Error('Archive custody observation is invalid.')
  }
  if (input.custody.applicable !== false && (
    input.custody.applicable !== true
    || typeof input.custody.archiveIdMatched !== 'boolean'
    || typeof input.custody.missionIdMatched !== 'boolean'
    || !['sealed', 'verified', null].includes(input.custody.status)
    || typeof input.custody.registryFileIdentityMatched !== 'boolean'
    || (input.custody.verificationProofFileIdentityMatched !== null
      && typeof input.custody.verificationProofFileIdentityMatched !== 'boolean')
    || (input.custody.registryCiphertextSha256 !== null
      && !SHA256.test(input.custody.registryCiphertextSha256))
    || (input.custody.diskCiphertextSha256 !== null
      && !SHA256.test(input.custody.diskCiphertextSha256))
  )) throw new Error('Archive custody observation is invalid.')
  requireExactKeys(input.inventory, [
    'baselineDigestSha256',
    'baselineTables',
    'changedTables',
    'declarationCount',
    'observedDigestSha256',
    'observedTables',
    'unexpectedChangedTables',
  ], 'Archive inventory observation')
  if (input.inventory.declarationCount !== REQUIRED_INVENTORY_TABLE_COUNT
    || !SHA256.test(input.inventory.baselineDigestSha256)
    || !SHA256.test(input.inventory.observedDigestSha256)) {
    throw new Error('Archive inventory observation is invalid.')
  }
  normalizeReportInventoryTables(input.inventory.baselineTables)
  normalizeReportInventoryTables(input.inventory.observedTables)
  for (const names of [input.inventory.changedTables, input.inventory.unexpectedChangedTables]) {
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) {
      throw new Error('Archive inventory changed-table evidence is invalid.')
    }
  }
  requireExactKeys(input.residue, [
    'entryCount', 'fileCount', 'scannedByteCount', 'secretMatchCount',
  ], 'Archive residue observation')
  if (Object.values(input.residue).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Archive residue observation is invalid.')
  }
  requireExactKeys(input.review, [
    'attempted',
    'closedAuditCount',
    'openedAuditCount',
    'readMethod',
    'readMissionMatched',
  ], 'Archive Review observation')
  if (typeof input.review.attempted !== 'boolean'
    || !Number.isSafeInteger(input.review.openedAuditCount)
    || !Number.isSafeInteger(input.review.closedAuditCount)
    || ![null, 'listMissions'].includes(input.review.readMethod)
    || typeof input.review.readMissionMatched !== 'boolean') {
    throw new Error('Archive Review observation is invalid.')
  }
  if (input.cleanupEligibility !== null) {
    requireExactKeys(input.cleanupEligibility, [
      'blockers', 'eligible', 'storageState',
    ], 'Archive cleanup eligibility observation')
    if (typeof input.cleanupEligibility.eligible !== 'boolean'
      || !Array.isArray(input.cleanupEligibility.blockers)
      || input.cleanupEligibility.blockers.some((blocker) => typeof blocker !== 'string')
      || !['live', 'cleanup_in_progress', 'archived']
        .includes(input.cleanupEligibility.storageState)) {
      throw new Error('Archive cleanup eligibility observation is invalid.')
    }
  }
  if (input.cleanup !== null) normalizeReportCleanup(input.cleanup)
  const serialized = JSON.stringify(input)
  if (/"(?:passphrase|recoveryCode|recovery_code|secretValue)"/iu.test(serialized)
    || serialized.includes('/tmp/')) {
    throw new Error('Archive parent evidence exposed a path or secret-bearing field.')
  }
  return deepFreeze(JSON.parse(serialized))
}

/** Shape-closes all 49 per-table report digests. */
function normalizeReportInventoryTables(input) {
  if (!Array.isArray(input) || input.length !== REQUIRED_INVENTORY_TABLE_COUNT) {
    throw new Error('Archive inventory table evidence is incomplete.')
  }
  for (const table of input) {
    requireExactKeys(
      table,
      ['contentSha256', 'decision', 'rowCount', 'tableName'],
      'Archive inventory table evidence',
    )
    if (typeof table.tableName !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table.tableName)
      || !['mission_rows', 'global_rows', 'derived_excluded', 'operational_excluded']
        .includes(table.decision)
      || !Number.isSafeInteger(table.rowCount) || table.rowCount < 0
      || !SHA256.test(table.contentSha256)) {
      throw new Error('Archive inventory table evidence is invalid.')
    }
  }
  assertCanonicalSchemaV13Tables(input, 'Archive report inventory')
}

/** Shape-closes terminal cleanup rows and reconstructible derived-state disclosure. */
function normalizeReportCleanup(input) {
  requireExactKeys(input, [
    'declaredRows',
    'declaredTableCount',
    'journalState',
    'postReviewRemainingRows',
    'reconstructibleDerivedRows',
    'remainingRows',
    'storageState',
  ], 'Archive cleanup proof')
  if (!['eligible', 'in_progress', 'completed'].includes(input.journalState)
    || !['cleanup_in_progress', 'archived'].includes(input.storageState)
    || !Number.isSafeInteger(input.declaredTableCount)
    || input.declaredTableCount < 1
    || !Array.isArray(input.declaredRows)
    || input.declaredRows.length !== input.declaredTableCount) {
    throw new Error('Archive cleanup proof is invalid.')
  }
  if (new Set(input.declaredRows.map((row) => row?.tableName)).size
    !== input.declaredRows.length) {
    throw new Error('Archive cleanup row proof contains duplicate declared tables.')
  }
  assertCanonicalSchemaV13CleanupPlan(input.declaredRows)
  for (const rows of [
    input.declaredRows,
    input.remainingRows,
    input.reconstructibleDerivedRows,
  ]) {
    if (!Array.isArray(rows)) throw new Error('Archive cleanup row proof is invalid.')
    for (const row of rows) {
      requireExactKeys(
        row,
        ['decision', 'rowCount', 'tableName', 'zeroRequired'],
        'Archive cleanup row proof',
      )
      if (typeof row.tableName !== 'string' || typeof row.decision !== 'string'
        || !Number.isSafeInteger(row.rowCount) || row.rowCount < 0
        || typeof row.zeroRequired !== 'boolean') {
        throw new Error('Archive cleanup row proof is invalid.')
      }
    }
  }
  if (!Array.isArray(input.postReviewRemainingRows)) {
    throw new Error('Archive post-Review cleanup row proof is invalid.')
  }
  for (const row of input.postReviewRemainingRows) {
    requireExactKeys(row, ['rowCount', 'tableName'], 'Archive post-Review cleanup row proof')
    if (typeof row.tableName !== 'string'
      || !Number.isSafeInteger(row.rowCount) || row.rowCount < 1) {
      throw new Error('Archive post-Review cleanup row proof is invalid.')
    }
  }
}

/** Normalizes report invocation flags so proof cannot omit how it was selected. */
function normalizeInvocation(input, selectedCases) {
  requireExactKeys(input, [
    'caseIds',
    'keepWorkRoot',
    'protocolSelfTest',
    'reportPathExplicit',
    'timeoutMs',
    'workRootExplicit',
  ], 'Archive kill-matrix invocation')
  if (!Array.isArray(input.caseIds)
    || JSON.stringify(resolveArchiveKillMatrixSelection(input.caseIds).map((entry) => entry.id))
      !== JSON.stringify(selectedCases.map((entry) => entry.id))
    || typeof input.keepWorkRoot !== 'boolean'
    || typeof input.protocolSelfTest !== 'boolean'
    || typeof input.reportPathExplicit !== 'boolean'
    || typeof input.workRootExplicit !== 'boolean') {
    throw new Error('Archive kill-matrix invocation flags are invalid.')
  }
  return Object.freeze({
    caseIds: Object.freeze([...input.caseIds]),
    keepWorkRoot: input.keepWorkRoot,
    protocolSelfTest: input.protocolSelfTest,
    reportPathExplicit: input.reportPathExplicit,
    timeoutMs: normalizeTimeout(input.timeoutMs),
    workRootExplicit: input.workRootExplicit,
  })
}

/** Requires stable before/after repository and harness identity, retaining dirty state truthfully. */
function normalizeRepositoryBinding(before, after) {
  const first = normalizeRepositoryState(before)
  const second = normalizeRepositoryState(after)
  const stable = JSON.stringify(first) === JSON.stringify(second)
  return Object.freeze({
    headSha: second.headSha,
    treeSha: second.treeSha,
    clean: second.clean,
    stable,
    statusSha256: second.statusSha256,
    workspaceSha256: second.workspaceSha256,
    harnessFiles: second.harnessFiles,
  })
}

/** Shape-closes one Git/worktree capture. */
function normalizeRepositoryState(input) {
  requireExactKeys(input, [
    'clean',
    'harnessFiles',
    'headSha',
    'statusSha256',
    'treeSha',
    'workspaceSha256',
  ], 'Archive kill-matrix repository state')
  if (!GIT_OBJECT_ID.test(input.headSha) || !GIT_OBJECT_ID.test(input.treeSha)
    || !SHA256.test(input.statusSha256) || !SHA256.test(input.workspaceSha256)
    || typeof input.clean !== 'boolean' || !Array.isArray(input.harnessFiles)
    || input.harnessFiles.length !== 4) {
    throw new Error('Archive kill-matrix repository state is invalid.')
  }
  const harnessFiles = input.harnessFiles.map((entry) => {
    requireExactKeys(entry, ['relativePath', 'sha256'], 'Archive harness file identity')
    if (typeof entry.relativePath !== 'string' || !SHA256.test(entry.sha256)) {
      throw new Error('Archive harness file identity is invalid.')
    }
    return Object.freeze({ relativePath: entry.relativePath, sha256: entry.sha256 })
  })
  return Object.freeze({
    headSha: input.headSha,
    treeSha: input.treeSha,
    clean: input.clean,
    statusSha256: input.statusSha256,
    workspaceSha256: input.workspaceSha256,
    harnessFiles: Object.freeze(harnessFiles),
  })
}

/** Reads the private mode-restricted fixture state without forwarding secrets. */
function readFixtureState(root) {
  const statePath = path.join(root, STATE_FILE_NAME)
  const stat = lstatSync(statePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_STATE_BYTES) {
    throw new Error('Archive kill-matrix fixture state is unsafe.')
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  requireExactKeys(state, ['cases', 'passphrase', 'protocolVersion'], 'Kill-matrix state')
  if (state.protocolVersion !== PROTOCOL_VERSION
    || typeof state.passphrase !== 'string'
    || Buffer.byteLength(state.passphrase, 'utf8') < 14
    || Buffer.byteLength(state.passphrase, 'utf8') > 1_024
    || state.cases === null || typeof state.cases !== 'object' || Array.isArray(state.cases)) {
    throw new Error('Archive kill-matrix fixture state is invalid.')
  }
  return state
}

/** Validates one private case routing record and its archive-unique recovery code. */
function normalizeFixtureRecord(input, definition) {
  requireExactKeys(
    input,
    ['archiveId', 'missionId', 'profileRelativePath', 'recoveryCode'],
    'Kill-matrix case state',
  )
  if (typeof input.profileRelativePath !== 'string'
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || !RECOVERY_CODE.test(input.recoveryCode)
    || (definition.lifecycle === 'create' && input.archiveId !== null)
    || (definition.lifecycle !== 'create'
      && (typeof input.archiveId !== 'string' || input.archiveId.length < 1))) {
    throw new Error('Archive kill-matrix case fixture is invalid.')
  }
  return Object.freeze({
    profileRelativePath: input.profileRelativePath,
    missionId: input.missionId,
    archiveId: input.archiveId,
    recoveryCode: input.recoveryCode,
  })
}

/** Validates one caller-owned private baseline before any observation. */
function normalizeCaseBaseline(input, definition) {
  if (input?.caseId !== definition.id || input.lifecycle !== definition.lifecycle
    || typeof input.profilePath !== 'string' || typeof input.databasePath !== 'string'
    || typeof input.missionId !== 'string'
    || (input.archiveId !== null && typeof input.archiveId !== 'string')
    || typeof input.passphrase !== 'string' || !RECOVERY_CODE.test(input.recoveryCode)
    || input.inventory?.declarationCount !== REQUIRED_INVENTORY_TABLE_COUNT
    || !SHA256.test(input.stableMission?.coreSha256)
    || !SHA256.test(input.stableMission?.eventPrefixSha256)
    || !Number.isSafeInteger(input.stableMission?.eventRowCount)
    || input.stableMission.eventRowCount < 0) {
    throw new Error('Archive kill-matrix case baseline is invalid.')
  }
  return input
}

/** Resolves one state-issued profile path without permitting root escape. */
function resolveFixtureProfile(root, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => !segment || ['.', '..'].includes(segment))) {
    throw new Error('Archive kill-matrix case profile path is invalid.')
  }
  const resolved = path.join(root, ...relativePath.split('/'))
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Archive kill-matrix case profile escaped its root.')
  }
  return resolved
}

/** Derives a distinct RFC-4122 v4 operation identity for parent-owned Review. */
function reviewOperationId(operationId) {
  return `73000000-0000-4000-8000-${operationId.slice(-12)}`
}

/** Runs one bounded read-only Git command. */
function runGit(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Runs one bounded binary Git command. */
function runGitBuffer(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Validates and sorts the exact four harness paths that determine qualification semantics. */
function normalizeHarnessPaths(input) {
  if (!Array.isArray(input) || input.length !== 4
    || new Set(input).size !== input.length
    || input.some((entry) => typeof entry !== 'string'
      || path.isAbsolute(entry) || entry.includes('\\')
      || entry.split('/').some((segment) => !segment || ['.', '..'].includes(segment)))) {
    throw new Error('Archive kill-matrix harness path list is invalid.')
  }
  return Object.freeze([...input].sort())
}

/** Resolves a repository-relative regular file without root escape. */
function resolveRepositoryFile(projectRoot, relativePath) {
  const resolved = path.join(projectRoot, ...relativePath.split('/'))
  if (!resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error('Archive kill-matrix repository file escaped its root.')
  }
  return resolved
}

/** Digests one exact regular harness file. */
function digestRepositoryFile(projectRoot, relativePath) {
  const filePath = resolveRepositoryFile(projectRoot, relativePath)
  const stat = lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Archive kill-matrix harness file is not regular.')
  }
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** Requires an exact plain-record key set. */
function requireExactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`${label} has missing or unsupported fields.`)
  }
}

/** Confirms the caller selected one of the frozen case records by identity. */
function normalizeCaseDefinition(input) {
  const definition = ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === input?.id)
  if (definition === undefined || input.lifecycle !== definition.lifecycle
    || input.phase !== definition.phase || input.operationId !== definition.operationId) {
    throw new Error('Archive kill case definition is invalid.')
  }
  return definition
}

/** Validates a child argument vector without shell interpretation. */
function normalizeChildArgs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64
    || value.some((entry) => typeof entry !== 'string'
      || entry.length < 1 || Buffer.byteLength(entry, 'utf8') > 8_192
      || entry.includes('\0'))) {
    throw new Error('Archive kill child arguments are invalid.')
  }
  return Object.freeze([...value])
}

/** Applies the shared runner timeout bound. */
function normalizeTimeout(value) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Archive kill child timeout is invalid.')
  }
  return timeoutMs
}

/** Requires a canonical absolute path without exposing it in evidence. */
function normalizeAbsolutePath(value, label) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192 || value.includes('\0')
    || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${label} must be an absolute canonical path.`)
  }
  return value
}

/** Requires a canonical ISO timestamp. */
function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

/** Splits a supported --name=value form without accepting empty inline values. */
function splitArgument(argument) {
  if (typeof argument !== 'string') return [argument, null]
  const equals = argument.indexOf('=')
  return equals < 0
    ? [argument, null]
    : [argument.slice(0, equals), argument.slice(equals + 1)]
}

/** Recursively freezes the public evidence graph. */
function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object') deepFreeze(nested)
  }
  return Object.freeze(value)
}
