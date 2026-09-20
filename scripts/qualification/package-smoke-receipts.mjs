import { createHash } from 'node:crypto'
import { validateProducerPackageTier } from './package-proof-tier.mjs'

import { validateSmokeReceipt } from '../../build/electron-repair-train-d-smoke-lib.js'
import {
  expectedOfficialMapSource,
  isCanonicalOfficialRasterTemplate,
  isOfficialRasterSourceReady,
  isSyntheticTargetCamera,
  SYNTHETIC_MAP_ID,
  SYNTHETIC_TARGET_TILE,
} from '../../build/electron-official-map-qualification-smoke-lib.js'
import { buildStorageKillProbeVerdict } from '../../build/electron-storage-diagnostics-kill-probe-lib.js'
import { validateLegacyRecoveryReport } from '../../build/legacy-recovery-report-validation.js'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const MAX_GPX_SOURCE_BYTES = 8 * 1024 * 1024
const BAD_SECRET_WARNING =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
const C09_IMPORTS = Object.freeze([
  { file_name: 'fidelity.gpx', display_name: 'fidelity', timing_class: 'fully_dated' },
  { file_name: 'outing-race.gpx', display_name: 'outing-race', timing_class: 'fully_dated' },
  { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated' },
])
const C09_UNDATED = Object.freeze([
  {
    file_name: 'undated-late-name.gpx',
    display_name: 'undated-late-name',
    timing_class: 'undated',
    point_index: 0,
    track_name: 'Ridge party',
    source_time: null,
  },
  {
    file_name: 'undated-late-name.gpx',
    display_name: 'undated-late-name',
    timing_class: 'undated',
    point_index: 1,
    track_name: 'Ridge party',
    source_time: null,
  },
])
const C09_POINTS = Object.freeze([
  { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
  { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
])
const C09_RECEIPTS = Object.freeze([
  { file_name: 'fidelity.gpx', status: 'settled' },
  { file_name: 'malformed-geometry.gpx', status: 'failed' },
  { file_name: 'outing-race.gpx', status: 'settled' },
  { file_name: 'undated-late-name.gpx', status: 'settled' },
])
const C15_VALID_TILE_COUNT = 81
const C15_MISSING_TILE_COUNT = 80

/** Describes the exact existing package-smoke producer and the proof it can actually provide. */
export const PACKAGE_SMOKE_DESCRIPTORS = Object.freeze({
  C01: descriptor(
    'scripts/electron-bad-secret-smoke.mjs',
    ['--app', '<packaged-executable>', '--evidence-dir', '<evidence-dir>', '--app-arg', '<arg>'],
    '<evidence-dir>/summary.json',
    'packaged-electron-startup-subset',
    [
      'summary.json omits source HEAD/tree and executable/ASAR hashes',
      'summary.json omits a machine-readable Settings recovery assertion; screenshots are retained evidence only',
      'no installed-deb, release-artifact, or full C01 store-admission proof',
    ],
  ),
  C02: descriptor(
    'scripts/electron-repair-train-d-smoke.mjs',
    ['--app', '<packaged-executable>', '--evidence', '<evidence-dir>'],
    '<evidence-dir>/receipt.json',
    'packaged-electron-unpacked',
    [
      'producer proves bounded Train D packaged scenarios, not installed-deb execution',
      'no full C02 field or release qualification; receipt remains a bounded smoke',
    ],
  ),
  C09: descriptor(
    'scripts/electron-gpx-fidelity-smoke.mjs',
    ['<packaged-executable>', '<output-dir>'],
    '<output-dir>/receipt.json',
    'packaged-electron-synthetic-profile',
    [
      'synthetic GPX profile does not prove field corpus breadth or operator qualification',
      'receipt has ASAR/input hashes but no executable or installed-deb identity',
      'forced-kill recovery is bound to the packaged Electron app PID through public import IPC; a separate mission-store sidecar is retained as source/integration evidence',
      'source-reader boundary evidence is checkout-bound; it does not replace an independent field source-file oracle',
    ],
  ),
  C15: descriptor(
    'scripts/electron-official-map-qualification-smoke.mjs',
    ['--app', '<packaged-executable>', '--evidence-dir', '<evidence-dir>', '--app-arg', '<arg>'],
    '<evidence-dir>/run-*/summary.json',
    'packaged-asar-synthetic-offline-map',
    [
      'synthetic MBTiles only; no licensed national package or platform matrix',
      'summary has ASAR/source-input identity but no executable or installed-deb identity',
      'no field-ready operator acceptance or release-artifact parity',
    ],
  ),
  C16: descriptor(
    'scripts/electron-bad-secret-smoke.mjs',
    ['--app', '<packaged-executable>', '--evidence-dir', '<evidence-dir>', '--app-arg', '<arg>'],
    '<evidence-dir>/summary.json',
    'packaged-electron-startup-subset',
    [
      'same summary as C01: no source/artifact custody fields',
      'Settings save/reload, credential boundary and persistence are not machine-readable in summary.json',
      'no installed-deb or full C16 bootstrap qualification',
    ],
  ),
  C18: descriptor(
    'scripts/electron-storage-diagnostics-kill-probe.mjs',
    [
      '--app', '<packaged-executable>', '--fixture', '<mission-store.sqlite>', '--evidence', '<evidence-dir>',
      '--timeout-ms', '<ms>', '--post-restart-observation-ms', '<ms>', '--', '<app-arg>',
    ],
    '<evidence-dir>/storage-diagnostics-kill-probe-report.json',
    'packaged-kill-restart-summary',
    [
      'schema-v2 report emits only bounded marker/enum/numeric oracle inputs; full runtime log and support-bundle text stay local',
      'privacy absence checks remain producer-side because private forbidden values are intentionally not emitted',
      'app/fixture hashes are present, but no source identity or installed-deb identity is emitted',
    ],
  ),
  C19: descriptor(
    'scripts/electron-legacy-object-recovery-smoke.mjs',
    ['<packaged-executable>', '<output-dir>'],
    '<output-dir>/report.json',
    'diagnostic-only-injected-store',
    [
      'producer uses an injected second disposable mission store, not default app wiring',
      'diagnostic report does not prove operator load, field, or production migration acceptance',
      'existing validator binds checkout and packaged source hashes but cannot create the missing app-level proof',
    ],
  ),
})

const SUPPORTED_CONTRACTS = new Set(Object.keys(PACKAGE_SMOKE_DESCRIPTORS))

/** Validate an existing package-smoke output against independent observed predicates. */
export function validatePackageSmokeReceipt(contractId, report, expected) {
  const descriptorEntry = PACKAGE_SMOKE_DESCRIPTORS[contractId]
  if (!SUPPORTED_CONTRACTS.has(contractId)) {
    return makeResult(contractId, null, {}, ['Package-smoke adapter has no producer for this contract.'])
  }

  const failures = []
  const predicates = {
    identity: false,
    workload: false,
    producerOracle: false,
    custody: false,
    startup: false,
    recoverySurface: false,
    provenance: false,
    render: false,
    recovery: false,
  }
  const binding = readExpectedBinding(expected, failures)
  if (!isRecord(report)) {
    failures.push('Package-smoke report is missing or is not a JSON object.')
    return makeResult(contractId, descriptorEntry, predicates, failures, binding)
  }
  if (report.developmentTestHarness === true) {
    failures.push('Development test harness receipt cannot satisfy candidate qualification.')
    return makeResult(contractId, descriptorEntry, predicates, failures, binding)
  }
  if (binding?.processTier !== undefined && binding.processTier !== descriptorEntry.actualProofMode
      && !(contractId === 'C02' && ['ci-appimage', 'installed-deb'].includes(binding.processTier))) {
    failures.push(
      `${contractId} producer establishes ${descriptorEntry.actualProofMode}; expected process tier ${String(binding.processTier)} is not produced by this adapter.`,
    )
  }

  switch (contractId) {
    case 'C01':
    case 'C16':
      validateBadSecret(report, binding, predicates, failures)
      break
    case 'C02':
      validateRepairTrainD(report, binding, predicates, failures)
      break
    case 'C09':
      validateGpx(report, binding, predicates, failures)
      break
    case 'C15':
      validateOfficialMap(report, binding, predicates, failures)
      break
    case 'C18':
      validateStorageKill(report, binding, predicates, failures)
      break
    case 'C19':
      validateLegacyRecovery(report, binding, predicates, failures)
      break
    default:
      failures.push('Package-smoke adapter contract dispatch is incomplete.')
  }
  return makeResult(contractId, descriptorEntry, predicates, failures, binding)
}

/** Build one immutable producer descriptor with copied arrays. */
function descriptor(script, cli, reportPath, actualProofMode, uncoveredAxes) {
  return Object.freeze({
    script,
    cli: Object.freeze([...cli]),
    reportPath,
    actualProofMode,
    uncoveredAxes: Object.freeze([...uncoveredAxes]),
  })
}

/** Read optional controller-owned identity bindings without accepting producer verdicts. */
function readExpectedBinding(expected, failures) {
  if (!isRecord(expected)) {
    failures.push('Expected package-smoke binding is missing.')
    return null
  }
  const sourceInput = isRecord(expected.source) ? expected.source : null
  const source = sourceInput !== null
    ? { ...sourceInput, expectedHead: sourceInput.expectedHead ?? sourceInput.head }
    : expected.sourceSha !== undefined || expected.sourceTree !== undefined
      ? { expectedHead: expected.sourceSha, tree: expected.sourceTree }
      : null
  const artifactInput = isRecord(expected.artifact)
    ? expected.artifact
    : isRecord(expected.package)
      ? expected.package
      : null
  const artifact = artifactInput !== null
    ? {
      ...artifactInput,
      archiveSha256: artifactInput.archiveSha256 ?? artifactInput.packageSha256 ?? artifactInput.sha256,
      executableSha256: artifactInput.executableSha256
        ?? (isRecord(expected.process) ? expected.process.executableSha256 : undefined),
    }
    : expected.artifactSha256 !== undefined || expected.packageSha256 !== undefined
        || expected.executableSha256 !== undefined
      ? {
        archiveSha256: expected.artifactSha256 ?? expected.packageSha256,
        executableSha256: expected.executableSha256
          ?? (isRecord(expected.process) ? expected.process.executableSha256 : undefined),
      }
      : null
  const workload = isRecord(expected.workload) ? expected.workload : null
  const processTier = typeof expected.processTier === 'string'
    ? expected.processTier
    : isRecord(expected.process) && typeof expected.process.tier === 'string'
      ? expected.process.tier
      : null
  if (source !== null) {
    for (const [field, value] of [['expectedHead', source.expectedHead], ['tree', source.tree]]) {
      if (value !== undefined && !SHA1.test(String(value))) failures.push(`Expected source ${field} is not a SHA-1.`)
    }
  }
  if (artifact !== null) {
    for (const [field, value] of Object.entries(artifact)) {
      if (value === undefined || field === 'packageTier' || field === 'basename') continue
      if (field === 'packagedInputHashes') {
        if (!isRecord(value) || Object.values(value).some((hash) => !SHA256.test(String(hash)))) {
          failures.push('Expected artifact packagedInputHashes are not SHA-256 digests.')
        }
        continue
      }
      if (!SHA256.test(String(value))) failures.push(`Expected artifact ${field} is not a SHA-256.`)
    }
  }
  if (processTier === null) failures.push('Expected process tier is missing.')
  return { source, artifact, workload, processTier, runtime: expected.runtime }
}

/** Validate the summary-only bad-secret producer and retain its actual coverage boundary. */
function validateBadSecret(report, binding, predicates, failures) {
  predicates.identity = hasStrings(report, ['appPath', 'evidenceDir', 'userDataDir'])
  if (!predicates.identity) failures.push('Bad-secret summary is missing app/evidence/user-data paths.')
  predicates.workload = report.result === 'pass' && report.warning === BAD_SECRET_WARNING
  if (!predicates.workload) failures.push('Bad-secret startup warning/result predicate failed.')
  predicates.startup = predicates.workload
  predicates.producerOracle = false
  failures.push('Bad-secret summary omits a machine-readable Settings recovery observation; retained screenshots cannot be recomputed by this adapter.')
  predicates.recoverySurface = false
  validateUnavailableBindings(report, binding, ['source', 'artifact'], failures)
  predicates.custody = false
}

/** Validate the bounded Train D receipt with its existing independent validator. */
function validateRepairTrainD(report, binding, predicates, failures) {
  try {
    const candidateTier = ['ci-appimage', 'installed-deb'].includes(binding?.processTier)
    if (candidateTier) {
      const runtime = validateProducerPackageTier(binding.processTier, binding.runtime)
      const launcherSha256 = binding.processTier === 'ci-appimage' ? runtime.artifactSha256 : runtime.executableSha256
      if (report.runtime?.platform !== 'linux' || binding.artifact?.executableSha256 !== launcherSha256
          || binding.artifact?.archiveSha256 !== runtime.asarSha256) throw new Error('Train D exact package runtime or hashes differ.')
    }
    validateSmokeReceipt(report, {
      strictSource: binding?.source !== null,
      expectedSourceSha: binding?.source?.expectedHead,
      expectedSourceTree: binding?.source?.tree,
      requireLinuxUnpacked: !candidateTier,
    })
    predicates.producerOracle = true
  } catch (error) {
    failures.push(`Train D independent validator: ${error instanceof Error ? error.message : String(error)}`)
  }
  predicates.identity = compareC02Identity(report, binding, failures)
  predicates.workload = compareExpected(report.profile, binding?.workload?.profile, 'Train D profile', failures)
  predicates.custody = report.profileRetention?.status === 'removed'
  if (!predicates.custody) failures.push('Train D disposable profile was not independently shown as removed.')
}

/** Compare the Train D source and packaged artifact fields to expected custody facts. */
function compareC02Identity(report, binding, failures) {
  let valid = true
  if (binding?.source !== null) {
    if (report.source?.head !== binding.source.expectedHead) { failures.push('Train D source head does not match expected identity.'); valid = false }
    if (report.source?.tree !== binding.source.tree) { failures.push('Train D source tree does not match expected identity.'); valid = false }
  }
  if (binding?.artifact !== null) {
    valid = compareField(report.package?.executableSha256, binding.artifact.executableSha256, 'Train D executable hash', failures) && valid
    valid = compareField(report.package?.archiveSha256, binding.artifact.archiveSha256, 'Train D ASAR hash', failures) && valid
  }
  return valid
}

/** Validate exact GPX persisted observations, source custody and restart equality. */
function validateGpx(report, binding, predicates, failures) {
  predicates.identity = validateGpxIdentity(report, binding, failures)
  predicates.workload = validateGpxWorkload(report, binding, failures)
  predicates.producerOracle = validateGpxObservations(report, failures)
  predicates.provenance = predicates.producerOracle
  predicates.custody = predicates.identity && report.sourceDirty === false
  if (!predicates.producerOracle) failures.push('GPX receipt does not contain the complete independently inspectable fidelity/provenance observation set.')
  if (!predicates.custody) failures.push('GPX source/package custody is incomplete or the source tree is dirty.')
}

/** Bind GPX source and archive/input hashes without inventing an executable hash. */
function validateGpxIdentity(report, binding, failures) {
  let valid = true
  if (!SHA1.test(String(report.sourceHead)) || !SHA1.test(String(report.sourceTree))) {
    failures.push('GPX source HEAD/tree identity is missing or malformed.')
    valid = false
  }
  if (binding?.source !== null) {
    valid = compareField(report.sourceHead, binding.source.expectedHead, 'GPX source head', failures) && valid
    valid = compareField(report.sourceTree, binding.source.tree, 'GPX source tree', failures) && valid
  }
  if (!SHA256.test(String(report.archiveSha256))) {
    failures.push('GPX ASAR hash is missing or malformed.')
    valid = false
  }
  if (binding?.artifact?.archiveSha256 !== undefined) {
    valid = compareField(report.archiveSha256, binding.artifact.archiveSha256, 'GPX ASAR hash', failures) && valid
  }
  const inputHashes = report.packagedInputHashes
  if (!isRecord(inputHashes) || Object.keys(inputHashes).length === 0 || Object.values(inputHashes).some((value) => !SHA256.test(String(value)))) {
    failures.push('GPX packaged input hashes are missing or malformed.')
    valid = false
  }
  if (binding?.artifact?.packagedInputHashes !== undefined) {
    valid = compareHashMap(inputHashes, binding.artifact.packagedInputHashes, 'GPX packaged input', failures) && valid
  }
  return valid
}

/** Validate GPX workload identity including the synthetic large-track size. */
function validateGpxWorkload(report, binding, failures) {
  let valid = report.largePointCount === 75_000 && SHA256.test(String(report.sourceSha256))
    && SHA256.test(String(report.largeSourceSha256))
    && SHA256.test(String(report.malformedSourceSha256))
    && SHA256.test(String(report.undatedSourceSha256))
  if (!valid) failures.push('GPX source workload hashes or 75,000-point workload are missing.')
  const workload = binding?.workload
  if (workload?.largePointCount !== undefined) valid = compareField(report.largePointCount, workload.largePointCount, 'GPX large point count', failures) && valid
  if (workload?.totalPointCount !== undefined) valid = compareField(report.beforeRestart?.count, workload.totalPointCount, 'GPX total point count', failures) && valid
  return valid
}

/** Recompute the persisted GPX rows, rejection, receipt and restart predicates. */
function validateGpxObservations(report, failures) {
  const before = report.beforeRestart
  const after = report.afterRestart
  let valid = isRecord(before) && isRecord(after)
  if (!valid) failures.push('GPX beforeRestart/afterRestart observations are missing.')
  if (valid && JSON.stringify(before) !== JSON.stringify(after)) {
    failures.push('GPX persisted observations changed across restart.')
    valid = false
  }
  if (before?.integrity !== 'ok' || before?.count !== 75_008 || before?.endedOutings !== 1) {
    failures.push('GPX SQLite integrity, 75,008-point count or ended-outing predicate failed.')
    valid = false
  }
  if (!deepEqual(before?.points, C09_POINTS) || !deepEqual(before?.undated, C09_UNDATED)) {
    failures.push('GPX canonical point or undated-track observations failed.')
    valid = false
  }
  if (!deepEqual(before?.imports, C09_IMPORTS) || !deepEqual(before?.receipts, C09_RECEIPTS)) {
    failures.push('GPX import or source-receipt observations failed.')
    valid = false
  }
  const failure = before?.failures?.[0]
  if (!Array.isArray(before?.failures) || before.failures.length !== 1
      || failure?.file_name !== 'malformed-geometry.gpx'
      || failure.reason !== 'GPX namespace_mismatch: trkseg.'
      || failure.rejection_count !== 0
      || failure.rejections_json !== '[]'
      || !SHA256.test(String(failure.content_sha256))
      || typeof failure.source_bytes_base64 !== 'string') {
    failures.push('GPX malformed-geometry rejection/custody observation failed.')
    valid = false
  }
  const revisionCounts = new Map()
  for (const revision of before?.revisions ?? []) {
    revisionCounts.set(revision?.content_sha256, (revisionCounts.get(revision?.content_sha256) ?? 0) + 1)
  }
  if (!Array.isArray(before?.revisions) || before.revisions.length !== 5
      || before.revisions.some((revision) => !SHA256.test(String(revision?.content_sha256))
        || typeof revision?.source_bytes_base64 !== 'string'
        || digestBase64(revision.source_bytes_base64) !== revision.content_sha256
        || !Number.isSafeInteger(revision?.revision_sequence) || revision.revision_sequence < 1
        || revision?.import_state !== 'complete'
        || typeof revision?.audit_event_id !== 'string' || revision.audit_event_id.length === 0)
      || revisionCounts.get(report.sourceSha256) !== 2
      || revisionCounts.get(report.largeSourceSha256) !== 1
      || revisionCounts.get(report.undatedSourceSha256) !== 1) {
    failures.push('GPX revision byte custody observations failed.')
    valid = false
  }
  if (report.passed !== true) {
    failures.push('GPX producer did not report a terminal pass.')
    valid = false
  }
  if (!validateGpxExpandedObservations(report, failures)) valid = false
  return valid
}

/** Validate the bounded source-reader, durable lifecycle, identity-race, and kill checkpoints. */
function validateGpxExpandedObservations(report, failures) {
  let valid = true
  const boundary = report.boundaryProbe
  if (!isRecord(boundary)
      || boundary.maxBytes !== MAX_GPX_SOURCE_BYTES
      || !isRecord(boundary.exact)
      || boundary.exact.bytes !== MAX_GPX_SOURCE_BYTES
      || boundary.exact.accepted !== true
      || !SHA256.test(String(boundary.exact.sha256))
      || !isRecord(boundary.over)
      || boundary.over.bytes !== MAX_GPX_SOURCE_BYTES + 1
      || boundary.over.rejected !== true
      || !SHA256.test(String(boundary.over.sha256))
      || !/8 MiB|8 MiB evidence import safety limit/iu.test(String(boundary.over.error))) {
    failures.push('GPX exact 8 MiB acceptance and first-byte-over-limit rejection evidence is missing.')
    valid = false
  }

  const lifecycle = report.lifecycle
  const batches = lifecycle?.batches
  const receipts = lifecycle?.receipts
  const commits = lifecycle?.commits
  if (!isRecord(lifecycle)
      || !Array.isArray(batches) || batches.length === 0
      || batches.some((batch) => !isRecord(batch)
        || !['completed', 'completed_with_failures'].includes(batch.status)
        || !Number.isSafeInteger(batch.total_files) || batch.total_files < 1
        || !Number.isSafeInteger(batch.completed_files) || batch.completed_files < 0
        || !Number.isSafeInteger(batch.failed_files) || batch.failed_files < 0
        || batch.completed_files + batch.failed_files !== batch.total_files
        || typeof batch.finished_at !== 'string' || batch.finished_at.length === 0)
      || !Array.isArray(receipts) || receipts.length === 0
      || receipts.some((receipt) => !isRecord(receipt)
        || typeof receipt.file_name !== 'string' || receipt.file_name.length === 0
        || !['settled', 'failed'].includes(receipt.status)
        || !SHA256.test(String(receipt.content_sha256))
        || receipt.copy_checkpoint !== true)
      || !Array.isArray(commits) || commits.length === 0
      || commits.some((commit) => !isRecord(commit)
        || typeof commit.file_name !== 'string' || commit.file_name.length === 0
        || commit.import_state !== 'complete'
        || !Number.isSafeInteger(commit.revision_sequence) || commit.revision_sequence < 1
        || typeof commit.audit_event_id !== 'string' || commit.audit_event_id.length === 0
        || commit.commit_checkpoint !== true)
      || lifecycle.unsettled_count !== 0) {
    failures.push('GPX durable batch, source-copy, and publication-commit checkpoints are incomplete.')
    valid = false
  }

  const duplicate = report.duplicateIdentity
  if (!isRecord(duplicate)
      || duplicate.attempted !== true
      || duplicate.same_content_skipped !== true
      || duplicate.no_new_revision !== true
      || duplicate.before_revision_count !== duplicate.after_revision_count) {
    failures.push('GPX duplicate import identity was not independently shown to be idempotent.')
    valid = false
  }
  const replacement = report.replacementIdentity
  if (!isRecord(replacement)
      || replacement.attempted !== true
      || !SHA256.test(String(replacement.original_sha256))
      || !SHA256.test(String(replacement.replacement_sha256))
      || replacement.original_sha256 === replacement.replacement_sha256
      || replacement.final_sha256 !== replacement.original_sha256
      || replacement.source_path_stable !== true
      || replacement.revisions_added !== 2) {
    failures.push('GPX same-path replacement and restoration did not retain distinct immutable revisions.')
    valid = false
  }
  const concurrent = report.concurrentIdentity
  if (!isRecord(concurrent)
      || concurrent.attempted !== true
      || concurrent.request_count !== 2
      || concurrent.settled_count !== 2
      || concurrent.no_duplicate_revision !== true) {
    failures.push('GPX concurrent same-source writes were not independently reconciled.')
    valid = false
  }
  const kill = report.killRecovery
  const killCases = kill?.cases
  const expectedKillPhases = ['pending', 'retained']
  const killCasesValid = Array.isArray(killCases) && killCases.length === expectedKillPhases.length
    && expectedKillPhases.every((phase, index) => {
      const entry = killCases[index]
      return isRecord(entry)
        && entry.phase === phase
        && entry.sourceBytes >= 1024 * 1024
        && entry.source_sha256 === boundary.exact.sha256
        && Number.isSafeInteger(entry.app_pid) && entry.app_pid > 0
        && entry.barrier_observed === true
        && entry.signal === 'SIGKILL'
        && entry.recovered_status === 'failed'
        && entry.receipt_checkpoint === true
        && entry.copy_checkpoint === (phase === 'retained')
        && entry.no_committed_revision === true
        && entry.batch_checkpoint === true
        && entry.profile_removed === true
        && entry.worker_hook_matched === 1
        && entry.worker_hook_restored === true
        && (phase === 'pending' ? entry.failure_hash === null : entry.failure_hash === entry.source_sha256)
        && (phase === 'pending'
          ? /before source bytes were retained/u.test(String(entry.failure_reason))
          : /after source bytes were retained/u.test(String(entry.failure_reason)))
        && isRecord(entry.retained_database)
        && Number.isSafeInteger(entry.retained_database.bytes)
        && entry.retained_database.bytes > 0
        && SHA256.test(String(entry.retained_database.sha256))
    })
  if (!isRecord(kill) || kill.attempted !== true
      || kill.proofMode !== 'packaged-electron-public-ipc'
      || !Array.isArray(kill.phases) || JSON.stringify(kill.phases) !== JSON.stringify(['pending', 'retained'])
      || kill.fixtureBytes < 1024 * 1024
      || kill.source_sha256 !== boundary.exact.sha256
      || kill.receipt_checkpoint !== true || kill.copy_checkpoint !== true || kill.commit_checkpoint !== true
      || !killCasesValid) {
    failures.push('GPX forced-kill receipt recovery remains unproved for pending and retained boundaries.')
    valid = false
  }
  return valid
}

/** Validate the official-map package, provider isolation, render and removal predicates. */
function validateOfficialMap(report, binding, predicates, failures) {
  predicates.identity = validateOfficialMapIdentity(report, binding, failures)
  predicates.workload = validateOfficialMapWorkload(report, failures)
  predicates.producerOracle = validateOfficialMapObservations(report, failures)
  predicates.render = predicates.producerOracle
  predicates.custody = report.processExit?.cleanExit === true
  if (!predicates.custody) failures.push('Official-map packaged process did not prove clean exit.')
}

/** Bind official-map ASAR identity and require the producer's packaged runtime boundary. */
function validateOfficialMapIdentity(report, binding, failures) {
  let valid = report.runtime?.isPackaged === true && String(report.runtime?.appPath).endsWith('.asar')
  if (!valid) failures.push('Official-map report does not prove a packaged ASAR runtime.')
  if (!SHA256.test(String(report.buildIdentity?.asarSha256))) { failures.push('Official-map ASAR hash is missing or malformed.'); valid = false }
  if (report.buildIdentity?.packagedRuntimeInputs?.matched !== true) { failures.push('Official-map packaged runtime input comparison did not pass.'); valid = false }
  if (binding?.artifact?.archiveSha256 !== undefined) valid = compareField(report.buildIdentity?.asarSha256, binding.artifact.archiveSha256, 'Official-map ASAR hash', failures) && valid
  if (binding?.source !== null) {
    failures.push('Official-map producer emits source input hashes, not source HEAD/tree identity; caller must bind source custody separately.')
    valid = false
  }
  return valid
}

/** Validate official-map workload constants and all rendered/removal observations. */
function validateOfficialMapWorkload(report, failures) {
  const packageEvidence = report.package
  const expectedSource = expectedOfficialMapSource()
  let valid = packageEvidence?.mapId === SYNTHETIC_MAP_ID
    && deepEqual(packageEvidence?.targetTile, SYNTHETIC_TARGET_TILE)
    && packageEvidence?.validTileCount === C15_VALID_TILE_COUNT
    && packageEvidence?.missingTileCount === C15_MISSING_TILE_COUNT
    && packageEvidence?.invalidTileCount === C15_VALID_TILE_COUNT
    && packageEvidence?.replacementTileCount === C15_VALID_TILE_COUNT
    && packageEvidence?.initialStatus === 'ready'
    && packageEvidence?.missingStatus === 'ready'
    && packageEvidence?.invalidStatus === 'invalid'
    && packageEvidence?.withdrawnStatus === 'invalid'
    && packageEvidence?.removedStatus === 'missing'
    && report.blockedNetwork === true
    && report.providerIsolation?.rendererNetworkProbeBlocked === true
    && report.providerIsolation?.mainMapGenieFallbackEligible === false
  if (!valid) failures.push('Official-map package counts/statuses/provider isolation are incomplete.')
  const style = report.styleSettlement
  if (!isRecord(style) || style.styleLoadCount < 1 || style.sourceId !== expectedSource.id
      || !isCanonicalOfficialRasterTemplate(style.template, expectedSource.id)
      || !isSyntheticTargetCamera(style.camera)) {
    failures.push('Official-map style settlement/source/camera observation failed.')
    valid = false
  }
  if (report.styleSettlementDiagnostics?.cleaned !== true || report.styleSettlementDiagnostics?.listenerActive !== false) {
    failures.push('Official-map style settlement cleanup was not independently observed.')
    valid = false
  }
  return valid
}

/** Validate each official-map GPU frame, operator check, replacement and removal observation. */
function validateOfficialMapObservations(report, failures) {
  let valid = true
  const sourceReady = (evidence) => isGpuEvidence(evidence) && isOfficialRasterSourceReady(evidence, SYNTHETIC_MAP_ID)
  const initial = sourceReady(report.mapEvidence) && hasPalette(report.mapEvidence, 'a')
  const missing = sourceReady(report.missingMapEvidence)
    && report.missingMapEvidence.hatchPixels.length > 0
    && report.missingMapEvidence.backgroundPixels.length > 0
  const replacement = sourceReady(report.replacementMapEvidence) && hasPalette(report.replacementMapEvidence, 'b')
  const removed = sourceReady(report.removedMapEvidence)
    && !hasPalette(report.removedMapEvidence, 'a') && !hasPalette(report.removedMapEvidence, 'b')
  const checks = report.checks
  const operators = checks?.completeOperatorCheck?.text?.includes('Current view tiles verified')
    && checks?.replacementOperatorCheck?.text?.includes('Current view tiles verified')
    && checks?.invalidOperatorCheck?.text?.includes('Official offline coverage incomplete')
    && checks?.removedOperatorCheck?.text?.includes('Official offline coverage incomplete')
  const automatic = report.automaticRemoval
  const automaticValid = automatic?.settings?.officialMaps?.packages?.[0]?.status === 'invalid'
    && automatic.settings.officialMaps.packages[0].attestation === undefined
    && automatic.fieldReady === false
    && /missing|unreadable|unavailable/u.test(String(automatic.warning))
    && sourceReady(automatic.mapEvidence)
  if (!initial || !missing || !replacement || !removed || operators !== true || automaticValid !== true) {
    failures.push('Official-map rendered GPU, operator Check View, automatic removal or stale-replacement predicates failed.')
    valid = false
  }
  if (checks?.complete?.status !== 'complete' || checks.complete.totalTiles !== 1 || checks.complete.usableTiles !== 1
      || checks?.missing?.status !== 'missing' || checks.missing.usableTiles !== 0
      || checks?.staleReplacementServedOldContent !== false) {
    failures.push('Official-map current-view completeness or stale-replacement predicate failed.')
    valid = false
  }
  return valid
}

/** Validate the emitted C18 identity and invoke the existing oracle on bounded raw facts. */
function validateStorageKill(report, binding, predicates, failures) {
  const appHash = binding?.artifact?.executableSha256 ?? binding?.artifact?.appSha256
  predicates.identity = SHA256.test(String(report.app?.sha256)) && SHA256.test(String(report.fixture?.sha256))
  if (!predicates.identity) failures.push('Storage kill report app/fixture hashes are missing or malformed.')
  if (appHash !== undefined && !compareField(report.app?.sha256, appHash, 'Storage kill app hash', failures)) predicates.identity = false
  if (binding?.workload?.fixtureSha256 !== undefined && !compareField(report.fixture?.sha256, binding.workload.fixtureSha256, 'Storage kill fixture hash', failures)) predicates.identity = false
  predicates.workload = report.killedAt?.type === 'backup' && report.killedAt?.stage === 'started'
    && report.recoveredAs?.type === 'backup' && report.recoveredAs?.stage === 'started'
  if (!predicates.workload) failures.push('Storage kill checkpoint summary does not show backup-start interruption/recovery.')
  const raw = report.oracleInput
  if (!validateStorageOracleInput(report, raw, failures)) {
    failures.push('Storage kill report omits bounded runtime-log/support-bundle oracle inputs required by buildStorageKillProbeVerdict; verdict.passed is not trusted.')
    predicates.producerOracle = false
    predicates.recovery = false
    predicates.custody = false
    return
  }
  const verdict = buildStorageKillProbeVerdict(raw)
  predicates.producerOracle = verdict.passed === true
  predicates.recovery = predicates.producerOracle
  predicates.custody = Array.isArray(report.privacyChecks) && report.privacyChecks.length > 0
    && report.privacyChecks.every((check) => check?.absent === true)
    && raw.privacy.every((check) => check.matchCount === 0)
  if (!predicates.producerOracle) failures.push(...verdict.failures.map((failure) => `Storage kill oracle: ${failure}`))
  if (!predicates.custody) failures.push('Storage kill privacy checks did not all pass.')
}

/** Validate the schema, redaction boundary and bounded metrics of the C18 oracle input. */
function validateStorageOracleInput(report, raw, failures) {
  if (report.schemaVersion !== 2 || report.schema !== 'sartracker-storage-diagnostics-kill-probe-v2') {
    failures.push('Storage kill report must use schema v2 for bounded oracle inputs.')
    return false
  }
  if (!isRecord(raw)
      || raw.schemaVersion !== 1
      || raw.redaction !== 'bounded-marker-and-metric-extract-v1'
      || !isRecord(raw.beforeKill)
      || !isRecord(raw.afterRestart)
      || !isRecord(raw.runtimeLog)
      || !isRecord(raw.supportBundle)) return false
  const runtime = raw.runtimeLog
  const support = raw.supportBundle
  const requiredMarkers = [
    'storage_backup_started',
    'storage_previous_run_interrupted',
    'storage_main_event_loop_summary',
  ]
  if (!Array.isArray(runtime.markers)
      || JSON.stringify(runtime.markers) !== JSON.stringify(requiredMarkers)
      || typeof runtime.evidence !== 'string'
      || !Number.isSafeInteger(runtime.bytes) || runtime.bytes < 1
      || !SHA256.test(String(runtime.sha256))) {
    failures.push('Storage kill runtime marker evidence or bounded metrics are malformed.')
    return false
  }
  if (!Array.isArray(support.requiredLines)
      || !support.requiredLines.includes('[storage-diagnostics]')
      || !support.requiredLines.includes('previous interrupted operation: backup started')
      || !support.requiredLines.some((line) => /^event loop latest maximum delay ms: [1-9][0-9]*$/u.test(line))
      || typeof support.evidence !== 'string'
      || !Number.isSafeInteger(support.bytes) || support.bytes < 1
      || !SHA256.test(String(support.sha256))
      || !Number.isSafeInteger(support.eventLoopLatestMaximumDelayMs)
      || support.eventLoopLatestMaximumDelayMs < 1) {
    failures.push('Storage kill support-bundle metric evidence is malformed.')
    return false
  }
  if (!Array.isArray(raw.privacy) || raw.privacy.some((check) =>
    !isRecord(check)
      || !/^forbidden-value-[1-9][0-9]*$/u.test(String(check.label))
      || !SHA256.test(String(check.valueSha256))
      || !Number.isSafeInteger(check.matchCount)
      || check.matchCount < 0)) {
    failures.push('Storage kill structured privacy observations are malformed.')
    return false
  }
  if (raw.beforeKill.activeOperation?.type !== 'backup'
      || raw.beforeKill.activeOperation?.stage !== 'started'
      || raw.afterRestart.activeOperation !== null
      || raw.afterRestart.previousInterruptedOperation?.type !== 'backup'
      || raw.afterRestart.previousInterruptedOperation?.stage !== 'started') {
    failures.push('Storage kill bounded checkpoint operations are malformed.')
    return false
  }
  return true
}

/** Run the existing C19 validator and then bind its report to controller-owned workload/artifact facts. */
function validateLegacyRecovery(report, binding, predicates, failures) {
  if (binding?.source === null || binding?.source?.expectedHead === undefined) {
    failures.push('C19 requires an expected source HEAD for its existing independent validator.')
  }
  const existingFailures = validateLegacyRecoveryReport(report, {
    projectRoot: process.cwd(),
    expectedSourceSha: binding?.source?.expectedHead,
  })
  if (existingFailures.length > 0) failures.push(...existingFailures.map((failure) => `Legacy recovery oracle: ${failure}`))
  predicates.producerOracle = existingFailures.length === 0
  predicates.identity = predicates.producerOracle
  predicates.workload = report.expectedBaselineRows === 50_000
    && (binding?.workload?.baselineMarkerRows === undefined || report.expectedBaselineRows === binding.workload.baselineMarkerRows)
  if (!predicates.workload) failures.push('C19 baseline workload is not exactly the expected 50,000 rows.')
  predicates.custody = isRecord(report.packaged)
    && SHA256.test(String(report.packaged.executableSha256))
    && SHA256.test(String(report.packaged.asarSha256))
  if (!predicates.custody) failures.push('C19 packaged executable/ASAR custody is missing.')
  if (binding?.artifact?.executableSha256 !== undefined) compareField(report.packaged?.executableSha256, binding.artifact.executableSha256, 'C19 executable hash', failures)
  if (binding?.artifact?.archiveSha256 !== undefined) compareField(report.packaged?.asarSha256, binding.artifact.archiveSha256, 'C19 ASAR hash', failures)
  if (binding?.processTier !== 'diagnostic-only-injected-store') failures.push('C19 producer is diagnostic-only injected-store proof, not installed-deb proof.')
}

/** Keep expected identity omissions explicit rather than inventing fields absent from a producer report. */
function validateUnavailableBindings(report, binding, fields, failures) {
  for (const field of fields) {
    if (binding?.[field] !== null && binding?.[field] !== undefined) {
      failures.push(`Producer report does not emit expected ${field} identity; caller must supply runtime custody separately.`)
    }
  }
  void report
}

/** Return a stable result which never marks any package-smoke output release eligible. */
function makeResult(contractId, descriptorEntry, predicates, failures, binding = null) {
  const uniqueFailures = [...new Set(failures)]
  return Object.freeze({
    contractId,
    status: uniqueFailures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE',
    valid: uniqueFailures.length === 0,
    passed: uniqueFailures.length === 0,
    contractComplete: false,
    coverageComplete: false,
    producerOracleComplete: uniqueFailures.length === 0 && (contractId === 'C02' || contractId === 'C19'),
    qualificationEligible: false,
    releaseEligible: false,
    proofMode: binding?.processTier ?? descriptorEntry?.actualProofMode ?? null,
    predicates: Object.freeze({ ...predicates }),
    uncoveredAxes: Object.freeze([...(descriptorEntry?.uncoveredAxes ?? ['No package-smoke producer is registered.'])]),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Compare one optional expected binding without accepting undefined report values. */
function compareField(actual, expected, label, failures) {
  if (expected === undefined) return true
  if (actual !== expected) {
    failures.push(`${label} does not match expected identity.`)
    return false
  }
  return true
}

/** Compare a map of exact hashes with no missing or extra keys. */
function compareHashMap(actual, expected, label, failures) {
  if (!isRecord(actual) || !isRecord(expected)) {
    failures.push(`${label} hash map is missing.`)
    return false
  }
  let valid = true
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const key of keys) {
    if (actual[key] !== expected[key]) {
      failures.push(`${label} hash ${key} does not match expected identity.`)
      valid = false
    }
  }
  return valid
}

/** Check that an expected workload field equals an actual scalar when supplied. */
function compareExpected(actual, expected, label, failures) {
  if (expected === undefined) return true
  if (actual !== expected) {
    failures.push(`${label} does not match expected workload.`)
    return false
  }
  return true
}

/** Check a report object contains non-empty string fields. */
function hasStrings(report, fields) {
  return fields.every((field) => typeof report[field] === 'string' && report[field].length > 0)
}

/** Return true for a plain record and false for arrays/null. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Compare JSON-compatible observations without allowing object identity differences. */
function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Hash exact bytes represented by a base64 revision field. */
function digestBase64(value) {
  try {
    return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex')
  } catch {
    return null
  }
}

/** Require the renderer frame fields used by the official-map GPU oracle. */
function isGpuEvidence(evidence) {
  return isRecord(evidence)
    && evidence.capturedAtRender === true
    && Number.isFinite(evidence.canvasWidth) && evidence.canvasWidth > 0
    && Number.isFinite(evidence.canvasHeight) && evidence.canvasHeight > 0
    && typeof evidence.renderer === 'string' && evidence.renderer.length > 0
    && isRecord(evidence.viewport)
    && Array.isArray(evidence.sampledPixels) && evidence.sampledPixels.length > 0
}

/** Recompute the synthetic raster palette predicate from captured pixel values. */
function hasPalette(evidence, variant) {
  const palettes = {
    a: [[0x2c, 0x3e, 0x67], [0x72, 0xd2, 0xb6]],
    b: [[0x24, 0x4f, 0x45], [0xf0, 0xc9, 0x4d]],
  }
  return palettes[variant].some((palette) => evidence.sampledPixels.some((pixel) => Array.isArray(pixel)
    && pixel.length >= 3
    && Math.max(
      Math.abs(pixel[0] - palette[0]),
      Math.abs(pixel[1] - palette[1]),
      Math.abs(pixel[2] - palette[2]),
    ) <= 48))
}
