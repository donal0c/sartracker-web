import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildTrackingSoakExpectedPositionTruthEvidence,
} from '../../build/electron-tracking-soak-mock-server.js'
import {
  createTrackingSoakProfile,
} from '../../build/electron-tracking-soak-lib.js'
import {
  createTrackingSoakFixtureClock,
} from '../../build/electron-tracking-soak-exact-proof-lib.js'
import { expectedSoakPrioritySource, validateSoakContractEvidence } from './soak-receipts.mjs'
import { runOwnedProcess } from './owned-process.mjs'
import {
  observePackageProcesses,
  preparePackageRuntime,
  validateRuntimeObservation,
} from './package-runtime.mjs'
import { CANONICAL_INSTALLED_EXECUTABLE_PATH, hashCandidateFile } from './candidate-artifacts.mjs'
import {
  MAX_SOAK_CAPTURE_BYTES,
  MAX_SOAK_REPORT_BYTES,
  readBoundedSoakFile,
} from './soak-evidence-file.mjs'
import {
  runSoakExecutionWorker,
} from './soak-execution-boundary.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/u
const MAX_LOG_BYTES = 4 * 1024 * 1024
const OBSERVE_INTERVAL_MS = 250
const STRICT_TIMING_THRESHOLD_MS = 200
const SOAK_PROCESS_TIER = 'owned-packaged-electron-soak'
const SOAK_REPORT_PATH = 'electron-tracking-soak-report.json'
const NORMAL_PREFIX_BATCH = 480
const SOAK_ADAPTER_CONTRACTS = Object.freeze(['C04', 'C24', 'C25'])
const STORAGE_FIXTURE_GENERATORS = Object.freeze({
  local: Object.freeze({ command: 'scripts/seed-mission-store.mjs', preset: 'local' }),
  field: Object.freeze({ command: 'scripts/seed-mission-store.mjs', preset: 'field' }),
})

/** Enumerate the contracts with this executable packaged-soak adapter. */
export { SOAK_ADAPTER_CONTRACTS }
/** Keep the focused bounded evidence reader available to its adapter tests. */
export { readBoundedSoakFile }

/** Fixed variant definitions; callers cannot substitute a smaller workload. */
export const SOAK_VARIANTS = Object.freeze({
  ci: Object.freeze({
    id: 'ci',
    profileName: 'ci',
    contractIds: Object.freeze(['C04', 'C24']),
    workloadClass: 'ci',
    minimumEquivalentProductionPolls: 1_080,
    minimumDeviceCount: 32,
    minimumArchiveCycles: 2,
    timeoutMs: 15 * 60 * 1_000,
  }),
  'priority-100': Object.freeze({
    id: 'priority-100',
    profileName: 'priority-100',
    contractIds: Object.freeze(['C04']),
    workloadClass: 'ci',
    minimumEquivalentProductionPolls: 1_080,
    minimumDeviceCount: 100,
    timeoutMs: 20 * 60 * 1_000,
  }),
  normal: Object.freeze({
    id: 'normal',
    profileName: 'normal',
    contractIds: Object.freeze(['C25']),
    workloadClass: 'long-duration',
    minimumEquivalentProductionPolls: 86_400,
    minimumDeviceCount: 32,
    minimumArchiveCycles: 2,
    timeoutMs: 35 * 60 * 1_000,
  }),
  extended: Object.freeze({
    id: 'extended',
    profileName: 'extended',
    contractIds: Object.freeze(['C25']),
    workloadClass: 'long-duration',
    minimumEquivalentProductionPolls: 241_920,
    minimumDeviceCount: 32,
    minimumArchiveCycles: 2,
    timeoutMs: 35 * 60 * 1_000,
  }),
  'field-960k': Object.freeze({
    id: 'field-960k',
    profileName: 'field-960k',
    contractIds: Object.freeze(['C24', 'C25']),
    workloadClass: 'field-scale',
    minimumEquivalentProductionPolls: 9_600,
    minimumDeviceCount: 100,
    minimumPositionRows: 960_000,
    expectedOutingCount: 12,
    maximumResidentBytes: 2_147_483_648,
    minimumFixtureBytes: 3_700_000_000,
    fixturePreset: 'field',
    timeoutMs: 60 * 60 * 1_000,
  }),
  'field-2m': Object.freeze({
    id: 'field-2m',
    profileName: 'field-2m',
    contractIds: Object.freeze(['C24', 'C25']),
    workloadClass: 'field-scale',
    minimumEquivalentProductionPolls: 20_000,
    minimumDeviceCount: 100,
    minimumPositionRows: 2_000_000,
    expectedOutingCount: 12,
    maximumResidentBytes: 2_147_483_648,
    minimumFixtureBytes: 3_700_000_000,
    fixturePreset: 'field',
    timeoutMs: 90 * 60 * 1_000,
  }),
  'field-local-1gib': Object.freeze({
    id: 'field-local-1gib',
    profileName: 'field-960k',
    contractIds: Object.freeze(['C24', 'C25']),
    workloadClass: 'field-scale',
    minimumEquivalentProductionPolls: 9_600,
    minimumDeviceCount: 100,
    minimumPositionRows: 960_000,
    expectedOutingCount: 12,
    maximumResidentBytes: 2_147_483_648,
    minimumFixtureBytes: 1_073_741_824,
    fixturePreset: 'local',
    timeoutMs: 60 * 60 * 1_000,
  }),
  'field-device-modes': Object.freeze({
    id: 'field-device-modes',
    profileName: 'field-device-modes',
    contractIds: Object.freeze(['C25']),
    workloadClass: 'field-scale',
    minimumEquivalentProductionPolls: 9_600,
    minimumDeviceCount: 100,
    minimumPositionRows: 768_020,
    expectedOutingCount: 12,
    maximumResidentBytes: 2_147_483_648,
    minimumFixtureBytes: 3_700_000_000,
    fixturePreset: 'field',
    deviceModes: Object.freeze({ moving: 80, stationary: 10, stale: 10 }),
    timeoutMs: 60 * 60 * 1_000,
  }),
})

/** Describe the executable soak adapter and its explicit field-scale limits. */
export const SOAK_ADAPTER_DESCRIPTOR = Object.freeze({
  contractIds: SOAK_ADAPTER_CONTRACTS,
  producer: 'scripts/electron-tracking-soak.mjs',
  reportPath: SOAK_REPORT_PATH,
  processTier: SOAK_PROCESS_TIER,
  strictTimingThresholdMs: STRICT_TIMING_THRESHOLD_MS,
  fixtureGenerators: STORAGE_FIXTURE_GENERATORS,
  variants: Object.freeze([
    'ci', 'ci-installed', 'priority-100', 'priority-100-installed', 'normal', 'extended', 'field-960k', 'field-2m', 'field-local-1gib', 'field-device-modes',
    'normal-installed', 'extended-installed', 'field-960k-installed', 'field-2m-installed',
    'field-local-1gib-installed', 'field-device-modes-installed',
  ]),
  fieldVariants: Object.freeze([
    Object.freeze({ id: 'field-960k', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 960_000 }),
    Object.freeze({ id: 'field-2m', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 20_000, positionRows: 2_000_000 }),
    Object.freeze({ id: 'field-local-1gib', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 960_000, fixturePreset: 'local', minimumFixtureBytes: 1_073_741_824 }),
    Object.freeze({ id: 'field-device-modes', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 768_020, fixturePreset: 'field', moving: 80, stationary: 10, stale: 10 }),
  ]),
  coverage: Object.freeze([
    'C04 current-position packaged soak using the fixed ci profile, with held-history, offline/reconnect, current identity and hide/show observations through the packaged bridges',
    'C24 packaged responsiveness soak using the fixed ci profile and strict 200ms thresholds, with exact timed/untimed GPX imports, archive create/verify/restore/review/cleanup, backup and support export, competing cancellation, diagnostics and map-fault recovery stages, provider-fault stages, archive failure/recovery and retained CPU/storage distributions',
    'C25 normal and extended 32-device long-duration packaged profiles with restarts and exact proof where extended requires it',
    'C25 normal and extended profiles retain two verified archive cycles performed while the tracking mission remains active',
    'C25 field-960k and field-2m packaged profiles with 100-device, 12-outing synthetic workload and retained raw storage/resource metrics',
    'C25 local-1GiB fixture profile using the existing seed-mission-store local preset and the 100-device/12-outing workload',
    'C25 stationary/stale device profile with explicit moving, stationary and stale counts in the mock provider and retained report',
    'C25 archive-failure rejection and post-restart recovery with an active tracking mission',
    'owned Node producer process group with exact AppImage or installed-deb main-process observations',
    'independently recomputed source position digests from the existing deterministic source helper',
  ]),
  uncoveredAxes: Object.freeze([
    'C04 Train-D multi-participant backfill completion/fence is a separate packaged C02 producer; this soak retains direct current/history priority observations and does not relabel that evidence',
    'C04 bounded live-provider and original-machine variants remain separate from the fixed 100-device synthetic priority lane',
    'C04 browser, exact AppImage and installed-deb variants require separate adapters',
    'C24 product integrity/retention and background scheduling capability faults are not implemented by the product and remain explicit owner work; no runtime success is claimed',
    'C24 integrity and retention operation phases remain source-controlled product holds; implemented operation probes run at fixed CI and field workloads on both package tiers',
    '960k/2m position rows and an explicit local-1GiB fixture profile are produced; the bound fixture remains synthetic and the external original field 3.7GB host run is not claimed',
    'the 12 outings are deterministic closed synthetic windows; a twelve-day wall-clock/provider history is not claimed by this adapter',
    'field workloads use deterministic synthetic provider data; live provider and original-machine field behavior remain external',
    'C25 extended remains 32-device long-duration evidence and cannot receive field-scale credit',
    'exact AppImage/installed-deb runtime proof still requires the parent package binding and Linux x64 host',
    'live provider, browser-only and release-publication evidence remain separate contract variants',
  ]),
  nextExtensionProposal: Object.freeze({
    workloadClass: 'field-scale',
    maximumResidentBytes: 2_147_483_648,
    databaseBytes: 3_700_000_000,
    requiredProducerChanges: Object.freeze([
      'retain original-machine and live-provider custody for the twelve-day field execution boundary',
      'retain installed-deb/AppImage parity and same-profile Mint host observations for the field fixture variants',
    ]),
  }),
})

/** Compile one fixed soak command with no arbitrary producer flags. */
export function compileSoakCommand({ contractId, variantId, app, evidence, fieldFixture }) {
  const variant = variantFor(contractId, variantId)
  requireAbsolute(app, 'Soak app')
  requireAbsolute(evidence, 'Soak evidence')
  const profile = createTrackingSoakProfile(variant.profileName)
  const args = [
    path.join(projectRoot, 'scripts', 'electron-tracking-soak.mjs'),
    '--app', app,
    '--profile', profile.name,
    '--evidence', evidence,
    '--poll-interval-ms', String(profile.recommendedPollIntervalMs),
    '--timeout-ms', String(variant.timeoutMs),
    '--freeze-threshold-ms', String(STRICT_TIMING_THRESHOLD_MS),
    '--main-stall-threshold-ms', String(STRICT_TIMING_THRESHOLD_MS),
    ...(contractId === 'C04' || contractId === 'C24' ? ['--priority-faults'] : []),
    ...(contractId === 'C24' ? ['--operation-phases'] : []),
    '--',
    '--no-sandbox',
    '--ignore-gpu-blocklist',
  ]
  if (variant.profileName === 'ci') {
    args.push(
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    )
  }
  if (variant.workloadClass === 'field-scale') {
    requireAbsolute(fieldFixture, 'Soak field fixture')
    args.splice(args.indexOf('--', 1), 0, '--field-fixture', fieldFixture)
    args.splice(args.indexOf('--', 1), 0, '--field-fixture-preset', variant.fixturePreset ?? 'field')
  }
  return Object.freeze({
    script: args[0],
    args: Object.freeze(args.slice(1)),
    report: SOAK_REPORT_PATH,
    timeoutMs: variant.timeoutMs + 30_000,
    variantId: variant.id,
    profileName: profile.name,
    scope: 'bounded packaged soak; field-scale and release variants remain separate',
  })
}

/** Compute immutable expected position digests through the reviewed source helper. */
export function buildIndependentSoakSourceFacts(profileName, recordedNowMs, prioritySource = null) {
  const profile = createTrackingSoakProfile(profileName)
  if (!Number.isSafeInteger(recordedNowMs) || recordedNowMs < 1) {
    throw new Error('Soak source recordedNowMs must be a positive safe integer.')
  }
  const clock = createTrackingSoakFixtureClock(profile, recordedNowMs)
  const truth = buildTrackingSoakExpectedPositionTruthEvidence({
    deviceCount: profile.deviceCount,
    movingDeviceCount: profile.movingDeviceCount,
    productionPollsPerBatch: profile.productionPollsPerBatch,
    maximumBatches: profile.actualBatches,
    baseTimeMs: clock.baseTimeMs,
    intervalMs: clock.intervalMs,
    statePath: path.join(os.tmpdir(), 'sartracker-soak-source-oracle-not-written.json'),
  }, NORMAL_PREFIX_BATCH, prioritySource)
  return Object.freeze({
    recordedNowMs,
    baseTimeMs: clock.baseTimeMs,
    intervalMs: clock.intervalMs,
    normalPrefixBatch: NORMAL_PREFIX_BATCH,
    fullSha256: truth.full.sha256,
    normalPrefixSha256: truth.normalPrefix.sha256,
    prioritySource,
    expectedPositionRows: truth.full.rowCount,
  })
}

/** Execute one fixed soak variant under one owned, bounded worker lifecycle. */
export async function executeSoakVariant({ normalized, binding, attemptDirectory, workDirectory }) {
  const variant = validateSoakWorkerInvocation({ normalized, binding, attemptDirectory, workDirectory })
  const { execution, worker } = await runSoakExecutionWorker({
    config: { normalized, binding, attemptDirectory, workDirectory },
    projectRoot,
    variant,
  })
  const cleanupVerified = execution.zeroDescendantsAfterRun === true
  const resourceCleanupBlocked = execution.supervisorPid !== null && !cleanupVerified
  const failureCode = workerFailureCode(execution, worker)
  if (failureCode === null && worker.receipt !== null) {
    const receipt = {
      ...worker.receipt,
      workerExecution: {
        schema: 'sartracker-soak-execution-v1',
        status: 'COMPLETED',
        failureCode: null,
        timedOut: false,
        cleanupVerified: true,
        zeroDescendantsAfterRun: true,
        resourceCleanupBlocked: false,
      },
    }
    try {
      await writeJson(path.join(attemptDirectory, 'soak-adapter-receipt.json'), receipt)
    } catch {
      throw createReceiptWriteError(resourceCleanupBlocked)
    }
    return Object.freeze(receipt)
  }
  const receipt = workerFailureReceipt({
    normalized,
    binding,
    execution,
    failureCode: failureCode ?? 'WORKER_OUTPUT_INVALID',
    cleanupVerified,
    resourceCleanupBlocked,
  })
  try {
    await writeJson(path.join(attemptDirectory, 'soak-adapter-receipt.json'), receipt)
  } catch {
    throw createReceiptWriteError(resourceCleanupBlocked)
  }
  return Object.freeze(receipt)
}

/** Execute the complete soak lifecycle inside the already-owned worker. */
export async function executeSoakVariantInProcess({ normalized, binding, attemptDirectory, workDirectory }) {
  const context = await validateExecutionContext(normalized, binding, attemptDirectory, workDirectory)
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Packaged soak execution requires a Linux x64 host; source and validator checks remain testable on macOS.')
  }
  const variant = variantFor(binding.contractId, binding.variantId)
  const runtimeDirectory = path.join(context.workDirectory, 'soak-runtime')
  await mkdir(context.workDirectory, { recursive: true, mode: 0o700 })
  const prepared = await preparePackageRuntime({
    proofMode: binding.proofMode,
    artifact: context.artifact,
    version: context.version,
    workDirectory: runtimeDirectory,
    installedExecutablePath: context.installedExecutablePath,
  })
  const fieldFixture = await copyFieldFixture(context.fieldFixture, runtimeDirectory)
  const evidenceDirectory = path.join(runtimeDirectory, 'evidence')
  await mkdir(evidenceDirectory, { recursive: false, mode: 0o700 })
  const command = compileSoakCommand({
    contractId: binding.contractId,
    variantId: binding.variantId,
    app: prepared.launchPath,
    evidence: evidenceDirectory,
    fieldFixture: fieldFixture?.destination,
  })
  const runtimeExpected = runtimeExpectation(prepared, binding.proofMode, variant)
  const processResult = await runFixedSoakCommand({
    command,
    runtimeExpected,
    environment: prepared.environment,
  })
  const retained = await retainSoakArtifacts({
    reportPath: path.join(evidenceDirectory, command.report),
    evidenceDirectory,
    attemptDirectory: context.attemptDirectory,
    processResult,
  })
  const report = retained.report
  const validation = report === null
    ? invalidValidation(binding.contractId, 'Soak producer report was not retained.')
    : validateObservedSoakReport(report, binding, prepared, variant, context.fieldFixture)
  const runtimeValidation = validateSoakRuntimeObservations(
    processResult.runtimeObservations,
    runtimeExpected,
  )
  const passed = processResult.exitCode === 0 &&
    processResult.processError === null &&
    processResult.timedOut === false &&
    processResult.zeroDescendantsAfterRun === true &&
    retained.captureErrors.length === 0 &&
    runtimeValidation.passed &&
    validation.passed
  const receipt = {
    schema: 'sartracker-soak-adapter-receipt-v1',
    status: passed ? 'PASS' : processResult.timedOut ? 'FAIL' : 'INVALID_EVIDENCE',
    contractId: binding.contractId,
    variantId: binding.variantId,
    proofMode: binding.proofMode,
    sourceSha: context.sourceSha,
    sourceTree: context.sourceTree,
    definitionDigest: normalized.definitionDigest ?? null,
    artifact: {
      role: context.artifact.role,
      sha256: context.artifact.sha256,
      bytes: context.artifact.bytes,
      basename: path.basename(context.artifact.path),
    },
    runtime: safeRuntimeSummary(prepared),
    rawReportPath: retained.rawReportPath,
    runtimeObservationsPath: retained.runtimeObservationsPath,
    stdoutPath: retained.stdoutPath,
    stderrPath: retained.stderrPath,
    rawReportSha256: retained.rawReportSha256,
    competingOperationReportPath: retained.competingOperationReportPath,
    competingOperationReportSha256: retained.competingOperationReportSha256,
    runtimeObservationsSha256: retained.runtimeObservationsSha256,
    captures: retained.captures,
    captureErrors: retained.captureErrors,
    process: {
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      processError: processResult.processError,
      zeroDescendantsAfterRun: processResult.zeroDescendantsAfterRun,
    },
    validation,
    runtimeValidation,
    scopeGaps: scopeGapsForValidation(validation),
    evidence: [
      retained.rawReportPath,
      retained.runtimeObservationsPath,
      retained.stdoutPath,
      retained.stderrPath,
      ...(retained.competingOperationReportPath === null ? [] : [retained.competingOperationReportPath]),
    ],
  }
  return Object.freeze(receipt)
}

/** Validate only the fixed parent-to-worker invocation boundary. */
function validateSoakWorkerInvocation({ normalized, binding, attemptDirectory, workDirectory }) {
  if (!isRecord(normalized) || !isRecord(binding)) throw new Error('Soak worker invocation requires bound objects.')
  if (!['C04', 'C24', 'C25'].includes(binding.contractId)
      || !['ci-appimage', 'installed-deb'].includes(binding.proofMode)) {
    throw new Error('Soak worker invocation is not a reviewed package variant.')
  }
  const variant = variantFor(binding.contractId, binding.variantId)
  requireAbsolute(attemptDirectory, 'Soak attempt directory')
  requireAbsolute(workDirectory, 'Soak work directory')
  if (path.resolve(attemptDirectory) === path.resolve(workDirectory)) {
    throw new Error('Soak attempt and disposable work directories must be distinct.')
  }
  return variant
}

/** Map worker and supervisor outcomes to a fixed bounded receipt code. */
function workerFailureCode(execution, worker) {
  if (execution.supervisorPid === null && execution.processError !== null) return 'WORKER_UNAVAILABLE'
  if (execution.timedOut === true) return execution.zeroDescendantsAfterRun === true
    ? 'WORKER_TIMEOUT_CLEAN'
    : 'WORKER_TIMEOUT_CLEANUP_UNPROVEN'
  if (execution.zeroDescendantsAfterRun !== true) return 'WORKER_CLEANUP_UNPROVEN'
  if (execution.processError !== null || execution.exitCode !== 0) return 'WORKER_PROCESS_FAILED'
  if (worker.status === 'failed' || worker.status === 'invalid') return worker.failureCode ?? 'WORKER_OUTPUT_INVALID'
  if (worker.status !== 'completed' || worker.receipt === null) return 'WORKER_OUTPUT_INVALID'
  return null
}

/** Build a code-only invalid receipt when the outer worker cannot retain one. */
function workerFailureReceipt({ normalized, binding, execution, failureCode, cleanupVerified, resourceCleanupBlocked }) {
  const validation = invalidValidation(binding.contractId, 'Owned soak worker did not retain a valid receipt.')
  return {
    schema: 'sartracker-soak-adapter-receipt-v1',
    status: 'INVALID_EVIDENCE',
    contractId: binding.contractId,
    variantId: binding.variantId,
    proofMode: binding.proofMode,
    sourceSha: normalized.identities?.source?.sha ?? null,
    sourceTree: normalized.identities?.source?.tree ?? null,
    definitionDigest: normalized.definitionDigest ?? null,
    artifact: null,
    runtime: null,
    rawReportPath: null,
    runtimeObservationsPath: null,
    stdoutPath: null,
    stderrPath: null,
    rawReportSha256: null,
    competingOperationReportPath: null,
    competingOperationReportSha256: null,
    runtimeObservationsSha256: null,
    captures: [],
    captureErrors: [],
    process: {
      exitCode: execution.exitCode,
      signal: execution.signal,
      timedOut: execution.timedOut === true,
      processError: null,
      zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun === true,
    },
    workerExecution: {
      schema: 'sartracker-soak-execution-v1',
      status: 'INVALID_EVIDENCE',
      failureCode,
      timedOut: execution.timedOut === true,
      cleanupVerified,
      zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun === true,
      resourceCleanupBlocked,
    },
    validation,
    runtimeValidation: { passed: false, failureReasons: ['Owned soak worker did not retain runtime observations.'] },
    scopeGaps: scopeGapsForValidation(validation),
    evidence: [],
  }
}

/** Return a code-only write failure while preserving the outer cleanup flag. */
function createReceiptWriteError(resourceCleanupBlocked) {
  const error = new Error('Soak receipt write failed.')
  error.resourceCleanupBlocked = resourceCleanupBlocked === true
  error.code = error.resourceCleanupBlocked ? 'SOAK_RESOURCE_CLEANUP_BLOCKED' : 'SOAK_RECEIPT_WRITE_FAILED'
  return error
}

/** Re-read retained raw soak and process observations and recompute all predicates. */
export async function validateRetainedSoak(receipt, binding, { definition, attemptDirectory }) {
  if (!isRecord(receipt)) throw new Error('Retained soak adapter receipt is required.')
  const context = await validateExecutionContext(definition, binding, attemptDirectory, null, { retained: true })
  const variant = variantFor(binding.contractId, binding.variantId)
  const failures = []
  if (!isRecord(receipt.workerExecution)
      || receipt.workerExecution.schema !== 'sartracker-soak-execution-v1'
      || receipt.workerExecution.status !== 'COMPLETED'
      || receipt.workerExecution.failureCode !== null
      || receipt.workerExecution.timedOut !== false
      || receipt.workerExecution.cleanupVerified !== true
      || receipt.workerExecution.zeroDescendantsAfterRun !== true
      || receipt.workerExecution.resourceCleanupBlocked !== false) {
    failures.push('Retained soak worker did not prove bounded completion and cleanup.')
  }
  if (!Array.isArray(receipt.captureErrors) || receipt.captureErrors.length !== 0) {
    failures.push('Retained soak capture errors make the evidence incomplete.')
  }
  if (receipt.schema !== 'sartracker-soak-adapter-receipt-v1' ||
      receipt.contractId !== binding.contractId ||
      receipt.variantId !== binding.variantId ||
      receipt.proofMode !== binding.proofMode ||
      receipt.definitionDigest !== (definition.definitionDigest ?? null) ||
      receipt.sourceSha !== context.sourceSha ||
      receipt.sourceTree !== context.sourceTree) {
    failures.push('Retained soak receipt is not bound to the immutable definition or source.')
  }
  const reportPath = await requireAttemptFile(attemptDirectory, receipt.rawReportPath, 'raw soak report')
  const observationsPath = await requireAttemptFile(attemptDirectory, receipt.runtimeObservationsPath, 'soak runtime observations')
  const reportBytes = await readBoundedSoakFile(reportPath, MAX_SOAK_REPORT_BYTES, 'retained soak report')
  const observationBytes = await readBoundedSoakFile(observationsPath, MAX_SOAK_REPORT_BYTES, 'retained soak runtime observations')
  if (sha256(reportBytes) !== receipt.rawReportSha256) failures.push('Retained soak report digest differs from receipt.')
  if (sha256(observationBytes) !== receipt.runtimeObservationsSha256) failures.push('Retained soak runtime observation digest differs from receipt.')
  if (binding.contractId === 'C24') {
    if (typeof receipt.competingOperationReportPath !== 'string'
        || typeof receipt.competingOperationReportSha256 !== 'string') {
      failures.push('Retained C24 competing-operation report identity is incomplete.')
    } else {
      const helperReportPath = await requireAttemptFile(
        attemptDirectory,
        receipt.competingOperationReportPath,
        'C24 competing-operation report',
      )
      const helperReportBytes = await readBoundedSoakFile(helperReportPath, MAX_SOAK_REPORT_BYTES, 'retained C24 competing-operation report')
      if (sha256(helperReportBytes) !== receipt.competingOperationReportSha256) {
        failures.push('Retained C24 competing-operation report digest differs from receipt.')
      }
    }
  }
  const report = parseJson(reportBytes, 'retained soak report')
  const observations = parseJson(observationBytes, 'retained soak runtime observations')
  const runtime = runtimeFromReceipt(
    receipt.runtime,
    binding.proofMode,
    variant,
    context.installedExecutablePath,
  )
  const runtimeValidation = validateSoakRuntimeObservations(observations, runtime)
  const prepared = {
    proofMode: binding.proofMode,
    launchPath: runtime.launchPath,
    artifactSha256: runtime.artifactSha256,
    executableSha256: runtime.executableSha256,
    asarSha256: runtime.asarSha256,
  }
  const validation = validateObservedSoakReport(report, binding, prepared, variant, context.fieldFixture)
  if (receipt.artifact?.role !== context.artifact.role ||
      receipt.artifact?.sha256 !== context.artifact.sha256 ||
      receipt.artifact?.bytes !== context.artifact.bytes ||
      receipt.artifact?.basename !== path.basename(context.artifact.path)) {
    failures.push('Retained soak artifact identity differs from the immutable runtime input.')
  }
  if (receipt.process?.exitCode !== 0) failures.push('Retained soak producer exited nonzero.')
  if (receipt.process?.timedOut === true) failures.push('Retained soak producer timed out.')
  if (observations.zeroDescendantsAfterRun !== true || observations.descendantsAfterExit?.length !== 0) {
    failures.push('Retained soak does not prove zero descendants after the owned process exited.')
  }
  const combinedFailures = [
    ...failures,
    ...runtimeValidation.failureReasons,
    ...validation.failureReasons,
  ]
  const uniqueFailures = [...new Set(combinedFailures)]
  const passed = uniqueFailures.length === 0 && runtimeValidation.passed && validation.passed
  return Object.freeze({
    ...receipt,
    status: passed ? 'PASS' : 'INVALID_EVIDENCE',
    valid: passed,
    passed,
    validation,
    runtimeValidation,
    runtimeObservations: observations,
    failureReasons: Object.freeze(uniqueFailures),
    releaseEligible: false,
    scopeGaps: scopeGapsForValidation(validation),
  })
}

/** Independently build the report fields supplied by the runtime adapter. */
export function projectSoakReport(report, binding, runtime, variantId) {
  const variant = variantFor(binding.contractId, variantId)
  const projected = {
    ...report,
    variantId,
    package: { tier: binding.proofMode },
    process: {
      tier: SOAK_PROCESS_TIER,
      executableSha256: runtime.executableSha256,
    },
    thresholds: {
      freezeThresholdMs: STRICT_TIMING_THRESHOLD_MS,
      mainStallThresholdMs: STRICT_TIMING_THRESHOLD_MS,
    },
  }
  if (variant.profileName !== report?.profile?.name) {
    throw new Error('Soak report profile does not match the fixed adapter variant.')
  }
  return projected
}

/** Build the exact independent validator binding for one retained raw report. */
export function buildSoakExpectedBinding(report, binding, runtime, variantId, fieldFixture = null) {
  const variant = variantFor(binding.contractId, variantId)
  const profile = createTrackingSoakProfile(variant.profileName)
  const sourceInput = isRecord(binding.source) ? binding.source : {}
  const recordedNowMs = Number.isSafeInteger(sourceInput.recordedNowMs)
    ? sourceInput.recordedNowMs
    : report?.fixtureClock?.recordedNowMs
  if (!Number.isSafeInteger(recordedNowMs)) {
    throw new Error('Soak binding requires an independently bound recordedNowMs source input.')
  }
  const prioritySource = expectedSoakPrioritySource(
    binding.contractId,
    profile,
    variant.workloadClass,
  )
  const source = buildIndependentSoakSourceFacts(profile.name, recordedNowMs, prioritySource)
  if (Number.isSafeInteger(sourceInput.baseTimeMs) && sourceInput.baseTimeMs !== source.baseTimeMs) {
    throw new Error('Soak source baseTimeMs differs from the independent fixture clock.')
  }
  if (Number.isSafeInteger(sourceInput.intervalMs) && sourceInput.intervalMs !== source.intervalMs) {
    throw new Error('Soak source intervalMs differs from the independent fixture clock.')
  }
  const appSha256 = binding.proofMode === 'ci-appimage'
    ? runtime.artifactSha256
    : runtime.executableSha256
  const platform = binding.platform ?? {
    os: `${os.type()} ${os.release()}`,
    architecture: os.arch(),
  }
  const missionModel = binding.missionModel
  if (!isRecord(missionModel) || typeof missionModel.enabled !== 'boolean' ||
      !Number.isSafeInteger(missionModel.expectedParticipantRows) ||
      !Number.isSafeInteger(missionModel.expectedParticipantAddedEvents)) {
    throw new Error('Soak binding requires independent mission-model facts.')
  }
  return {
    variantId: variant.id,
    profileName: profile.name,
    source,
    artifact: {
      basename: path.basename(runtime.launchPath),
      sha256: appSha256,
      packageTier: binding.proofMode,
    },
    process: {
      tier: SOAK_PROCESS_TIER,
      executableSha256: runtime.executableSha256,
    },
    platform,
    workload: {
      class: variant.workloadClass,
      minimumEquivalentProductionPolls: variant.minimumEquivalentProductionPolls,
      minimumDeviceCount: variant.minimumDeviceCount,
      ...(variant.deviceModes === undefined ? {} : { deviceModes: variant.deviceModes }),
      ...((variant.workloadClass === 'long-duration' || binding.contractId === 'C24')
        ? { minimumArchiveCycles: variant.minimumArchiveCycles ?? 2 }
        : {}),
      ...(variant.workloadClass === 'field-scale'
        ? {
            minimumPositionRows: variant.minimumPositionRows,
            expectedOutingCount: variant.expectedOutingCount,
            maximumResidentBytes: variant.maximumResidentBytes,
            minimumFixtureBytes: variant.minimumFixtureBytes ?? 3_700_000_000,
            fixturePreset: variant.fixturePreset ?? 'field',
            fieldFixture: fieldFixture === null
              ? undefined
              : {
                  basename: fieldFixture.basename,
                  bytes: fieldFixture.bytes,
                  sha256: fieldFixture.sha256,
                  preset: fieldFixture.preset ?? variant.fixturePreset ?? 'field',
                },
          }
        : {}),
    },
    missionModel,
    thresholds: {
      freezeThresholdMs: STRICT_TIMING_THRESHOLD_MS,
      mainStallThresholdMs: STRICT_TIMING_THRESHOLD_MS,
    },
  }
}

/** Validate raw soak output with independent source and runtime facts. */
function validateObservedSoakReport(report, binding, prepared, variant, fieldFixture = null) {
  const runtime = runtimeSummaryFromPrepared(prepared)
  const projected = projectSoakReport(report, binding, runtime, variant.id)
  const expected = buildSoakExpectedBinding(report, binding, runtime, variant.id, fieldFixture)
  const result = validateSoakContractEvidence(binding.contractId, projected, expected)
  return {
    ...result,
    independentSource: expected.source,
    strictTimingThresholdMs: STRICT_TIMING_THRESHOLD_MS,
  }
}

/** Run the producer with a fixed Node command and exact package process observer. */
async function runFixedSoakCommand({ command, runtimeExpected, environment }) {
  const execution = await runOwnedProcess({
    file: process.execPath,
    args: [command.script, ...command.args],
    cwd: projectRoot,
    env: {
      ...process.env,
      ...environment,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
    },
    timeoutMs: command.timeoutMs,
    maxOutputBytes: MAX_LOG_BYTES,
    observeIntervalMs: OBSERVE_INTERVAL_MS,
    cleanupTimeoutMs: 10_000,
    terminationGraceMs: 5_000,
    observe: ({ pid }) => observePackageProcesses(pid, runtimeExpected),
  })
  const observations = []
  for (const sample of execution.observationResults) {
    if (!Array.isArray(sample)) continue
    for (const observation of sample) {
      const key = `${observation.pid}:${observation.startTicks}`
      if (!observations.some((item) => `${item.pid}:${item.startTicks}` === key)) observations.push(observation)
    }
  }
  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    processError: execution.processError,
    observationErrors: execution.observationErrors,
    runtimeObservations: {
      schema: 'sartracker-soak-runtime-observations-v1',
      proofMode: runtimeExpected.proofMode,
      launchPath: runtimeExpected.launchPath,
      artifactSha256: runtimeExpected.artifactSha256,
      executableSha256: runtimeExpected.executableSha256,
      asarSha256: runtimeExpected.asarSha256,
      expectedLaunches: runtimeExpected.expectedLaunches,
      observations,
      observationErrors: execution.observationErrors,
      descendantsAfterExit: execution.descendantsAfterExit,
      zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun,
    },
    zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun,
  }
}

/** Retain raw report, runtime observations, logs and flat UI captures before work cleanup. */
async function retainSoakArtifacts({ reportPath, evidenceDirectory, attemptDirectory, processResult }) {
  const rawReportPath = 'soak-raw-report.json'
  const runtimeObservationsPath = 'soak-runtime-observations.json'
  const stdoutPath = 'soak-stdout.log'
  const stderrPath = 'soak-stderr.log'
  await writeFile(path.join(attemptDirectory, runtimeObservationsPath), `${JSON.stringify(processResult.runtimeObservations, null, 2)}\n`, { flag: 'wx' })
  await writeFile(path.join(attemptDirectory, stdoutPath), processResult.stdout, { flag: 'wx' })
  await writeFile(path.join(attemptDirectory, stderrPath), processResult.stderr, { flag: 'wx' })
  let report = null
  let rawReportSha256 = null
  try {
    const bytes = await readBoundedSoakFile(reportPath, MAX_SOAK_REPORT_BYTES, 'retained soak report')
    rawReportSha256 = sha256(bytes)
    await writeFile(path.join(attemptDirectory, rawReportPath), bytes, { flag: 'wx' })
    report = parseJson(bytes, 'soak producer report')
  } catch {
    // Missing/malformed reports remain an invalid adapter result.
  }
  const captures = await retainCaptures(evidenceDirectory, attemptDirectory)
  const competingOperation = await retainCompetingOperationReport(evidenceDirectory, attemptDirectory)
  return {
    report,
    rawReportPath,
    runtimeObservationsPath,
    stdoutPath,
    stderrPath,
    rawReportSha256,
    competingOperationReportPath: competingOperation.path,
    competingOperationReportSha256: competingOperation.sha256,
    runtimeObservationsSha256: sha256(Buffer.from(`${JSON.stringify(processResult.runtimeObservations, null, 2)}\n`, 'utf8')),
    captures: captures.captures,
    captureErrors: captures.errors,
  }
}

/** Retain the bounded C24 helper report beside the outer soak receipt. */
async function retainCompetingOperationReport(evidenceDirectory, attemptDirectory) {
  const sourcePath = path.join(evidenceDirectory, 'competing-operation-report.json')
  const retainedPath = 'c24-competing-operation-report.json'
  try {
    const bytes = await readBoundedSoakFile(sourcePath, MAX_SOAK_REPORT_BYTES, 'C24 competing-operation report')
    await writeFile(path.join(attemptDirectory, retainedPath), bytes, { flag: 'wx' })
    return { path: retainedPath, sha256: sha256(bytes) }
  } catch {
    return { path: null, sha256: null }
  }
}

/** Copy only bounded image captures into the flat attempt directory. */
async function retainCaptures(evidenceDirectory, attemptDirectory) {
  const captures = []
  const errors = []
  let entries = []
  try {
    entries = await readdir(evidenceDirectory, { withFileTypes: true })
  } catch {
    return { captures, errors: ['capture-directory-unreadable'] }
  }
  for (const entry of entries) {
    if (!/\.(?:png|jpe?g|webp)$/iu.test(entry.name)) continue
    if (!entry.isFile()) {
      errors.push(`${entry.name}:not-a-regular-file`)
      continue
    }
    const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/gu, '_')
    const destination = path.join(attemptDirectory, `soak-ui-${safeName}`)
    let bytes
    try {
      bytes = await readBoundedSoakFile(
        path.join(evidenceDirectory, entry.name),
        MAX_SOAK_CAPTURE_BYTES,
        `soak capture ${entry.name}`,
      )
    } catch {
      errors.push(`${entry.name}:bounded-read-failed`)
      continue
    }
    await writeFile(destination, bytes, { flag: 'wx' })
    captures.push({ name: path.basename(destination), kind: 'ui-screenshot', path: destination, sha256: sha256(bytes) })
  }
  return { captures, errors }
}

/** Build exact runtime expectations from package-runtime observations. */
function runtimeExpectation(prepared, proofMode, variant) {
  return {
    proofMode,
    launchPath: prepared.launchPath,
    installedExecutablePath: prepared.installedExecutablePath ?? null,
    artifactSha256: prepared.artifactSha256,
    executableSha256: prepared.executableSha256,
    asarSha256: prepared.asarSha256,
    expectedLaunches: expectedLaunchCount(variant),
  }
}

/** Validate every exact main-process observation retained by the owned runner. */
function validateSoakRuntimeObservations(observations, expected) {
  const failures = []
  if (!isRecord(observations) || observations.schema !== 'sartracker-soak-runtime-observations-v1') {
    failures.push('Soak runtime observation schema is missing.')
  }
  if (!Array.isArray(observations?.observations) || observations.observations.length < expected.expectedLaunches) {
    failures.push(`Fewer than ${expected.expectedLaunches} independent packaged launch observations were retained.`)
  }
  if (!Array.isArray(observations?.observationErrors) || observations.observationErrors.length > 0) {
    failures.push('Soak package observation errors were retained.')
  }
  for (const observation of observations?.observations ?? []) {
    try { validateRuntimeObservation(observation, expected) }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)) }
  }
  if (observations?.proofMode !== expected.proofMode ||
      observations?.launchPath !== expected.launchPath ||
      observations?.artifactSha256 !== expected.artifactSha256 ||
      observations?.executableSha256 !== expected.executableSha256 ||
      observations?.asarSha256 !== expected.asarSha256) {
    failures.push('Soak runtime summary differs from the exact package identity.')
  }
  if (observations?.zeroDescendantsAfterRun !== true || observations?.descendantsAfterExit?.length !== 0) {
    failures.push('Soak owned process group did not prove zero descendants after exit.')
  }
  return { passed: failures.length === 0, failureReasons: [...new Set(failures)] }
}

/** Reconstruct runtime identity from a retained adapter receipt. */
function runtimeFromReceipt(runtime, proofMode, variant, installedExecutablePath) {
  if (!isRecord(runtime)) throw new Error('Retained soak runtime summary is missing.')
  return {
    proofMode,
    launchPath: runtime.launchPath,
    installedExecutablePath: installedExecutablePath ?? null,
    artifactSha256: runtime.artifactSha256,
    executableSha256: runtime.executableSha256,
    asarSha256: runtime.asarSha256,
    expectedLaunches: expectedLaunchCount(variant),
  }
}

/** Derive the required launch count from the immutable profile checkpoints. */
function expectedLaunchCount(variant) {
  return createTrackingSoakProfile(variant.profileName).restartCheckpoints.length + 1
}

/** Summarize prepared runtime identity without worktree internals. */
function safeRuntimeSummary(prepared) {
  return {
    proofMode: prepared.proofMode,
    launchPath: prepared.launchPath,
    installedExecutablePath: prepared.installedExecutablePath ?? null,
    artifactSha256: prepared.artifactSha256,
    executableSha256: prepared.executableSha256,
    asarSha256: prepared.asarSha256,
  }
}

/** Summarize prepared runtime identity for report projection. */
function runtimeSummaryFromPrepared(prepared) {
  return {
    proofMode: prepared.proofMode,
    launchPath: prepared.launchPath,
    artifactSha256: prepared.proofMode === 'ci-appimage'
      ? prepared.artifactSha256
      : prepared.executableSha256,
    executableSha256: prepared.executableSha256,
    asarSha256: prepared.asarSha256,
  }
}

/** Validate exact bound candidate/artifact context before launch or revalidation. */
async function validateExecutionContext(normalized, binding, attemptDirectory, workDirectory, options = {}) {
  if (!isRecord(normalized) || !isRecord(normalized.runtimeInputs?.config)) {
    throw new Error('Soak adapter requires exact bound runtime inputs.')
  }
  if (!isRecord(binding) || !['C04', 'C24', 'C25'].includes(binding.contractId) ||
      !['ci-appimage', 'installed-deb'].includes(binding.proofMode)) {
    throw new Error('Soak adapter binding is not a reviewed C04/C24/C25 package variant.')
  }
  variantFor(binding.contractId, binding.variantId)
  if (!isAbsolutePath(attemptDirectory)) throw new Error('Soak attempt directory must be absolute.')
  if (!options.retained && !isAbsolutePath(workDirectory)) throw new Error('Soak work directory must be absolute.')
  if (!options.retained && path.resolve(attemptDirectory) === path.resolve(workDirectory)) {
    throw new Error('Soak attempt and disposable work directories must be distinct.')
  }
  if (!isRecord(normalized.identities?.source) || !SHA1.test(normalized.identities.source.sha) || !SHA1.test(normalized.identities.source.tree)) {
    throw new Error('Soak source identity is incomplete.')
  }
  const config = normalized.runtimeInputs.config
  if (config.ci?.provenance?.sourceSha !== normalized.identities.source.sha) throw new Error('Soak runtime source SHA is not bound to the campaign source.')
  const role = binding.proofMode === 'ci-appimage' ? 'ci-appimage' : 'ci-deb'
  const installer = config.ci?.installers?.find((entry) => entry?.role === role)
  if (!isRecord(installer) || !isAbsolutePath(installer.path) || !SHA256.test(String(installer.sha256))) throw new Error(`Exact ${role} soak installer is missing.`)
  const artifact = normalized.identities.candidate?.artifacts?.find((entry) => entry?.role === role)
  if (!isRecord(artifact) || artifact.path !== installer.path || artifact.sha256 !== installer.sha256 || artifact.bytes !== installer.bytes || artifact.localBuild === true) throw new Error(`Candidate ${role} soak artifact is not byte-bound.`)
  const fresh = await hashCandidateFile(installer.path)
  if (fresh.sha256 !== installer.sha256 || fresh.bytes !== installer.bytes) throw new Error('Bound soak package artifact changed before execution.')
  const installedExecutablePath = config.installedExecutablePath
  if (binding.proofMode === 'installed-deb'
      && (installedExecutablePath !== CANONICAL_INSTALLED_EXECUTABLE_PATH
        || !isAbsolutePath(installedExecutablePath))) {
    throw new Error('Installed-deb soak requires the canonical package-manager executable path.')
  }
  const variant = variantFor(binding.contractId, binding.variantId)
  const fieldFixture = variant.workloadClass === 'field-scale'
    ? await resolveFieldFixture(config, variant)
    : null
  return {
    artifact,
    sourceSha: normalized.identities.source.sha,
    sourceTree: normalized.identities.source.tree,
    version: normalized.identities.candidate.version,
    installedExecutablePath,
    attemptDirectory,
    workDirectory,
    fieldFixture,
  }
}

/** Bind the immutable 3.7GB field storage fixture before a field-scale launch. */
async function resolveFieldFixture(config, variant) {
  const declared = config.fixtures?.[variant.id] ?? config.fixtures?.[variant.id.replace(/-installed$/u, '')]
    ?? config.fixtures?.[variant.profileName] ?? config.fixtures?.field ?? config.fixtures?.['field-scale']
  const minimumFixtureBytes = variant.minimumFixtureBytes ?? 3_700_000_000
  if (!isRecord(declared) || !isAbsolutePath(declared.path)
      || !Number.isSafeInteger(declared.bytes) || declared.bytes < minimumFixtureBytes
      || !SHA256.test(String(declared.sha256))) {
    throw new Error(`Field-scale soak requires the bound ${variant.fixturePreset ?? 'field'} fixture of at least ${minimumFixtureBytes} bytes.`)
  }
  const fresh = await hashCandidateFile(declared.path)
  if (fresh.bytes !== declared.bytes || fresh.sha256 !== declared.sha256) {
    throw new Error('Bound field-scale fixture changed before execution.')
  }
  return Object.freeze({
    path: fresh.path,
    basename: path.basename(fresh.path),
    bytes: fresh.bytes,
    sha256: fresh.sha256,
    preset: variant.fixturePreset ?? null,
  })
}

/** Copy the immutable field fixture into the disposable package runtime. */
async function copyFieldFixture(fieldFixture, runtimeDirectory) {
  if (fieldFixture === null) return null
  const destination = path.join(runtimeDirectory, 'field-mission.sqlite')
  await copyFile(fieldFixture.path, destination)
  const copied = await hashCandidateFile(destination)
  if (copied.bytes !== fieldFixture.bytes || copied.sha256 !== fieldFixture.sha256) {
    throw new Error('Disposable field-scale fixture copy differs from the bound input.')
  }
  return Object.freeze({ ...fieldFixture, destination })
}

/** Resolve one fixed contract/profile pair. */
function variantFor(contractId, variantId) {
  const baseVariantId = typeof variantId === 'string' && variantId.endsWith('-installed')
    ? variantId.slice(0, -'-installed'.length)
    : variantId
  const variant = SOAK_VARIANTS[baseVariantId]
  if (variant === undefined || !variant.contractIds.includes(contractId)) throw new Error(`Soak variant ${String(variantId)} is not reviewed for ${contractId}.`)
  return variantId === baseVariantId ? variant : Object.freeze({ ...variant, id: variantId })
}

/** Test whether a controller-owned path is absolute. */
function isAbsolutePath(value) {
  return typeof value === 'string' && ABSOLUTE_PATH.test(value)
}

/** Require an absolute path from controller-owned context. */
function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !ABSOLUTE_PATH.test(value)) throw new Error(`${label} must be absolute.`)
}

/** Return an invalid producer validation with explicit retained reason. */
function invalidValidation(contractId, reason) {
  return {
    contractId,
    passed: false,
    valid: false,
    coverageComplete: false,
    qualificationEligible: false,
    failureReasons: [reason],
    uncoveredAxes: SOAK_ADAPTER_DESCRIPTOR.uncoveredAxes,
  }
}

/** Keep per-variant validation separate from the mandatory family coverage gate. */
function scopeGapsForValidation(validation) {
  const missing = Array.isArray(validation?.familyMissingVariants)
    ? validation.familyMissingVariants.map((entry) => `${entry.variantId}:${entry.proofMode}`)
    : []
  return Object.freeze(missing.length === 0 ? [] : missing)
}

/** Require a retained file to be a direct regular file under the attempt directory. */
async function requireAttemptFile(attemptDirectory, relativeName, label) {
  if (typeof relativeName !== 'string' || relativeName === '' || path.basename(relativeName) !== relativeName) throw new Error(`${label} path is not a retained flat file.`)
  const filePath = path.join(attemptDirectory, relativeName)
  const fileStat = await lstat(filePath)
  if (!fileStat.isFile()) throw new Error(`${label} is not a retained regular file.`)
  return filePath
}

/** Parse retained JSON only after its bounded file path has been checked. */
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`) }
}

/** Hash retained bytes for receipt custody. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Return whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Write deterministic JSON evidence. */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}
