import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CANONICAL_INSTALLED_EXECUTABLE_PATH, hashCandidateFile } from './candidate-artifacts.mjs'
import {
  compilePackageCommand,
  LEGACY_DEFAULT_VARIANTS,
  LEGACY_SCHEMA_VARIANT,
  LEGACY_STARTUP_VARIANT,
  REPLAY_OUTING_VARIANT,
  REPLAY_SCALE_PROFILES,
  normalizePackagedVariant,
} from './package-command.mjs'
import { C02_LIFECYCLE_VARIANTS, validateC02LifecycleReceipt } from './c02-lifecycle-receipts.mjs'
import { BACKUP_FAULT_VARIANTS, buildStorageBackupFaultVerdict } from '../../build/electron-storage-diagnostics-kill-probe-lib.js'
import { validateArchiveFieldReceipt } from './archive-field-receipts.mjs'
import { runOwnedProcess } from './owned-process.mjs'
import { assertOwnedProcessCleanup } from './owned-process-custody.mjs'
import {
  observePackageProcesses,
  preparePackageRuntime,
  validateRuntimeObservation,
} from './package-runtime.mjs'
import { PACKAGE_SMOKE_DESCRIPTORS, validatePackageSmokeReceipt } from './package-smoke-receipts.mjs'
import { validateIpcContainmentReceipt } from './ipc-receipts.mjs'
import { validateSettingsProbeReceipt } from './settings-receipts.mjs'
import { validateDuplicateLaunchReceipt } from './duplicate-launch-receipts.mjs'
import { validateCompositeReceipt, validateCompositeVariantReceipt } from './composite-receipts.mjs'
import { validateCompositeFamilyReceipt } from './composite-family-receipts.mjs'
import { retainCompositeReferences, rebindCompositeReferences } from './composite-custody.mjs'
import { createCompositeSourceManifest } from './composite-manifest.mjs'
import {
  C01_STARTUP_PROFILE_KINDS,
  C01_STARTUP_PROOF_MODE,
  validateStartupProbeReceipt,
} from './startup-receipts.mjs'
import { validateLegacyStartupReceipt } from './legacy-startup-receipts.mjs'
import { validateReplayReceipt } from './replay-receipts.mjs'
import { validateMarkerAttachmentReceipt } from './marker-attachment-receipts.mjs'
import { validateCoordinateSurface } from './coordinate-surface-receipts.mjs'
import { validateMapSurface } from './map-surface-receipts.mjs'
import { validateAttentionSurface } from './attention-receipts.mjs'
import { validateCanonicalIngestSurface } from './canonical-ingest-receipts.mjs'
import { validatePagingFiles, PAGING_PROFILES } from './paging-file-oracle.mjs'
import { CASE_IDS as ARCHIVE_SECURITY_CASE_IDS } from './archive-security-probe.cjs'
import { validateArchiveSecurityReceipt } from './archive-security-receipts.mjs'
import { validateReplayScaleFiles } from './replay-scale-receipts.mjs'
import { validateReplayOutingReceipt } from './replay-outing-receipts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { validateLegacyDefaultReceipt } from './legacy-default-receipts.mjs'
import { validateLegacySchemaReceipt } from './legacy-schema-receipts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const SUPPORTED_PROOF_MODES = new Set(['ci-appimage', 'installed-deb'])
const PACKAGE_ADAPTER_CONTRACTS = Object.freeze(['C01', 'C02', 'C03', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22', 'C23', 'C26', 'C28'])
const MAX_LOG_BYTES = 4 * 1024 * 1024
const MAX_CAPTURE_BYTES = 25 * 1024 * 1024
const PROCESS_POLL_MS = 250
const SYNTHETIC_SETTINGS_BASE_URL_SHA256 =
  '2b71703ed6c466565ec53b0d56f3ec318696e62c2ecf5a1e7228ca514bc8bb1b'
const ARCHIVE_REFERENCE_FIELDS = Object.freeze([
  Object.freeze({ container: 'archive', field: 'sourcePath', kind: 'source' }),
  Object.freeze({ container: 'archive', field: 'restoredPath', kind: 'restored' }),
  Object.freeze({ container: 'archive', field: 'sourceOraclePath', kind: 'source' }),
  Object.freeze({ container: 'archive', field: 'restoredOraclePath', kind: 'restored' }),
  Object.freeze({ container: 'oracle', field: 'sourcePath', kind: 'source' }),
  Object.freeze({ container: 'oracle', field: 'restoredPath', kind: 'restored' }),
])
const FIELD_ARCHIVE_REFERENCE_FIELDS = Object.freeze([
  Object.freeze({ container: 'sourceFixture', field: 'path', kind: 'field-source' }),
  Object.freeze({ container: 'sourceFixture', field: 'privateCopyPath', kind: 'field-private-copy' }),
  Object.freeze({ container: 'sourceFixture', field: 'manifestPath', kind: 'field-manifest' }),
  Object.freeze({ container: 'archive', field: 'archivePath', kind: 'field-ciphertext' }),
  Object.freeze({ container: 'preArchive', field: 'databasePath', kind: 'field-prearchive' }),
  Object.freeze({ container: 'reviewRestore', field: 'restoredDatabasePath', kind: 'field-restored' }),
])

/** Enumerate the package contracts with reviewed executable producers. */
export { PACKAGE_ADAPTER_CONTRACTS }

/** Execute one exact packaged producer under an independently observed runtime wrapper. */
export async function executePackageVariant({ normalized, binding, attemptDirectory, workDirectory }) {
  const context = await validateExecutionContext(normalized, binding, attemptDirectory, workDirectory)
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Packaged qualification execution requires a Linux x64 host; source prerequisites remain testable on macOS.')
  }

  const runtimeDirectory = path.join(context.workDirectory, 'package-runtime')
  const artifact = context.artifact
  const prepared = await preparePackageRuntime({
    proofMode: binding.proofMode,
    artifact,
    version: context.version,
    workDirectory: runtimeDirectory,
    installedExecutablePath: context.installedExecutablePath,
  })
  const fixture = binding.contractId === 'C18'
    ? await copyStorageMissionFixture(context, runtimeDirectory)
      : ['C07', 'C08'].includes(binding.contractId)
      ? await copyPagingFixture(context, runtimeDirectory, context.bindingVariantId)
      : binding.contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, context.bindingVariantId)
        ? await copyReplayScaleFixture(context, runtimeDirectory, context.bindingVariantId)
      : null
  const evidenceDirectory = path.join(runtimeDirectory, 'evidence')
  context.evidenceDirectory = evidenceDirectory
  await mkdir(evidenceDirectory, { recursive: false, mode: 0o700 })
  const commandContext = {
    app: prepared.launchPath,
    evidence: evidenceDirectory,
    sourceSha: context.sourceSha,
    variantId: context.bindingVariantId,
    proofMode: binding.proofMode,
    appSha256: binding.proofMode === 'ci-appimage' ? artifact.sha256 : prepared.executableSha256,
    ...(fixture === null ? {} : { fixture: fixture.destination }),
    ...((binding.contractId === 'C01'
      || (binding.contractId === 'C19' && binding.variantId === LEGACY_STARTUP_VARIANT)
      || (binding.contractId === 'C18' && binding.variantId === 'disk-full'))
      && context.enospcMount !== undefined
      ? { enospcMount: context.enospcMount }
      : {}),
  }
  const command = compilePackageCommand(binding.contractId, commandContext)
  const runtimeExpected = runtimeExpectation(prepared, binding.proofMode)
  runtimeExpected.evidenceDirectory = evidenceDirectory
  const processResult = await runFixedPackageCommand({
    command,
    runtimeExpected,
    cwd: projectRoot,
    environment: {
      ...prepared.environment,
      EXPECTED_SOURCE_SHA: context.sourceSha,
      EXPECTED_SOURCE_TREE: context.sourceTree,
      OBSERVED_EXECUTABLE_SHA256: runtimeExpected.executableSha256,
      OBSERVED_ASAR_SHA256: runtimeExpected.asarSha256,
    },
  })
  const reportPath = path.join(evidenceDirectory, command.report)
  const reportLocation = await resolveProducerReportLocation(binding.contractId, evidenceDirectory, reportPath)
  const retained = await retainRawArtifacts({
    contractId: binding.contractId,
    variantId: context.bindingVariantId,
    reportPath: reportLocation.reportPath,
    evidenceDirectory,
    captureDirectories: reportLocation.captureDirectories,
    attemptDirectory: context.attemptDirectory,
    processResult,
  })
  const report = retained.report
  const validation = report === null
    ? invalidValidation(binding.contractId, 'Producer report was not retained.')
    : await validateProducerReport(binding.contractId, report, context, prepared, processResult.runtimeObservations)
  const runtimeValid = validateRuntimeObservations(processResult.runtimeObservations, runtimeExpected)
  const passed = processResult.exitCode === 0
    && processResult.processError === null
    && processResult.timedOut === false
    && runtimeValid.passed
    && validation.passed
    && retained.report !== null
    && (binding.contractId !== 'C21' || retained.c21WrapperReceiptError === null)
    && retained.captureFailures.length === 0
    && processResult.zeroDescendantsAfterRun
  const observedProductFailure = validation.status === 'FAIL' && validation.observedProductFailure === true
    && validation.evidenceComplete === true && runtimeValid.passed
    && [0, 1].includes(processResult.exitCode) && processResult.processError === null
    && processResult.zeroDescendantsAfterRun && retained.captureFailures.length === 0
  const status = passed ? 'PASS' : processResult.timedOut || observedProductFailure ? 'FAIL' : 'INVALID_EVIDENCE'
  return Object.freeze({
    schema: 'sartracker-package-adapter-receipt-v1',
    status,
    contractId: binding.contractId,
    variantId: binding.variantId ?? null,
    proofMode: binding.proofMode,
    sourceSha: context.sourceSha,
    sourceTree: context.sourceTree,
    definitionDigest: normalized.definitionDigest ?? null,
    artifact: {
      role: artifact.role,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      basename: path.basename(artifact.path),
    },
    runtime: safeRuntimeSummary(prepared),
    rawReportPath: retained.rawReportPath,
    runtimeObservationsPath: retained.runtimeObservationsPath,
    stdoutPath: retained.stdoutPath,
    stderrPath: retained.stderrPath,
    rawReportSha256: retained.rawReportSha256,
    c21WrapperReceiptPath: retained.c21WrapperReceiptPath,
    c21WrapperReceiptSha256: retained.c21WrapperReceiptSha256,
    c21WrapperReceiptError: retained.c21WrapperReceiptError,
    runtimeObservationsSha256: retained.runtimeObservationsSha256,
    archiveReferences: retained.archiveReferences,
    pagingRowsPath: retained.pagingRowsPath,
    pagingRowsSha256: retained.pagingRowsSha256,
    pagingRowsBytes: retained.pagingRowsBytes,
    replayRowsPath: retained.replayRowsPath,
    replayRowsSha256: retained.replayRowsSha256,
    replayRowsBytes: retained.replayRowsBytes,
    c02EvidenceLossMarkerPath: retained.c02EvidenceLossMarkerPath,
    c02EvidenceLossMarkerSha256: retained.c02EvidenceLossMarkerSha256,
    legacyReferences: retained.legacyReferences,
    compositeReferences: retained.compositeReferences,
    replayOutingFixture: retained.replayOutingFixture,
    captures: retained.captures,
    captureFailures: retained.captureFailures,
    captureFailuresPath: retained.captureFailuresPath,
    process: {
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      processError: processResult.processError,
      zeroDescendantsAfterRun: processResult.zeroDescendantsAfterRun,
    },
    validation,
    runtimeValidation: runtimeValid,
    scopeGaps: scopeGaps(binding.contractId, binding.proofMode),
    evidence: [retained.rawReportPath, retained.runtimeObservationsPath, retained.stdoutPath, retained.stderrPath,
      ...(retained.pagingRowsPath === null ? [] : [retained.pagingRowsPath]),
      ...(retained.replayRowsPath === null ? [] : [retained.replayRowsPath]),
      ...(retained.c02EvidenceLossMarkerPath === null ? [] : [retained.c02EvidenceLossMarkerPath]),
      ...(retained.replayOutingFixture === null ? [] : [retained.replayOutingFixture.path]),
      ...retained.legacyReferences.map((entry) => entry.path),
      ...retained.compositeReferences.map((entry) => entry.path),
      ...(retained.captureFailuresPath === null ? [] : [retained.captureFailuresPath]),
      ...(retained.c21WrapperReceiptPath === null ? [] : [retained.c21WrapperReceiptPath]),
      ...retained.archiveReferences.map((entry) => entry.path)],
  })
}

/** Re-read retained producer bytes and runtime observations, then recompute all package predicates. */
export async function validateRetainedPackage(receipt, binding, { definition, attemptDirectory }) {
  if (!isRecord(receipt)) throw new Error('Retained package receipt is required.')
  const context = await validateExecutionContext(definition, binding, attemptDirectory, null, { retained: true })
  if (receipt.schema !== 'sartracker-package-adapter-receipt-v1'
      || receipt.contractId !== binding.contractId
      || receipt.proofMode !== binding.proofMode
      || (binding.variantId !== undefined && receipt.variantId !== binding.variantId)
      || receipt.definitionDigest !== definition.definitionDigest
      || receipt.sourceSha !== context.sourceSha
      || receipt.sourceTree !== context.sourceTree) {
    throw new Error('Retained package receipt is not bound to the immutable definition and binding.')
  }
  const reportPath = await requireAttemptFile(attemptDirectory, receipt.rawReportPath, 'raw package report')
  const observationsPath = await requireAttemptFile(attemptDirectory, receipt.runtimeObservationsPath, 'runtime observations')
  const stdoutPath = await requireAttemptFile(attemptDirectory, receipt.stdoutPath, 'package stdout')
  const stderrPath = await requireAttemptFile(attemptDirectory, receipt.stderrPath, 'package stderr')
  const captureFailurePath = receipt.captureFailuresPath === null || receipt.captureFailuresPath === undefined
    ? null
    : await requireAttemptFile(attemptDirectory, receipt.captureFailuresPath, 'capture failure report')
  const replayRowsPath = receipt.replayRowsPath === null || receipt.replayRowsPath === undefined
    ? null
    : await requireAttemptFile(attemptDirectory, receipt.replayRowsPath, 'retained replay rows')
  const c02EvidenceLossMarkerPath = receipt.c02EvidenceLossMarkerPath === null
    || receipt.c02EvidenceLossMarkerPath === undefined
    ? null
    : await requireAttemptFile(attemptDirectory, receipt.c02EvidenceLossMarkerPath, 'retained C02 evidence-loss marker')
  const c21WrapperReceiptPath = receipt.c21WrapperReceiptPath === null || receipt.c21WrapperReceiptPath === undefined
    ? null
    : await requireAttemptFile(attemptDirectory, receipt.c21WrapperReceiptPath, 'C21 wrapper receipt')
  const reportBytes = await readFile(reportPath)
  const observationBytes = await readFile(observationsPath)
  const rawReportSha256 = sha256(reportBytes)
  const runtimeObservationsSha256 = sha256(observationBytes)
  const failures = []
  if (rawReportSha256 !== receipt.rawReportSha256) failures.push('Retained producer report digest differs from the execution receipt.')
  if (runtimeObservationsSha256 !== receipt.runtimeObservationsSha256) failures.push('Retained runtime observation digest differs from the execution receipt.')
  if (binding.contractId === 'C21') {
    if (receipt.c21WrapperReceiptError !== null && receipt.c21WrapperReceiptError !== undefined) {
      failures.push('C21 wrapper receipt retention reported an error.')
    }
    if (c21WrapperReceiptPath === null || typeof receipt.c21WrapperReceiptSha256 !== 'string') {
      failures.push('Retained C21 wrapper receipt is missing.')
    } else {
      try {
        const wrapperBytes = await readFile(c21WrapperReceiptPath)
        if (sha256(wrapperBytes) !== receipt.c21WrapperReceiptSha256) failures.push('Retained C21 wrapper receipt digest differs from the execution receipt.')
        const wrapper = parseJson(wrapperBytes, 'retained C21 wrapper receipt')
        if (wrapper.schema !== 'c21-packaged-archive-security-v1'
            || wrapper.contractId !== 'C21'
            || wrapper.proofMode !== 'packaged-module'
            || wrapper.sourceSha !== context.sourceSha
            || wrapper.reportPath !== 'archive-security-report.json'
            || wrapper.screenshotPath !== 'archive-security-runtime.png'
            || wrapper.rawReportSha256 !== receipt.rawReportSha256
            || wrapper.releaseEligible !== false) {
          failures.push('Retained C21 wrapper receipt is not bound to the raw report and immutable source.')
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  let captureFailures = Array.isArray(receipt.captureFailures) ? receipt.captureFailures : []
  if (receipt.captureFailures !== undefined && !Array.isArray(receipt.captureFailures)) {
    failures.push('Retained capture failure inventory is not an array.')
  }
  if (captureFailurePath !== null) {
    try {
      const retainedCaptureFailures = parseJson(await readFile(captureFailurePath), 'retained capture failure report')
      if (!Array.isArray(retainedCaptureFailures)
          || JSON.stringify(retainedCaptureFailures) !== JSON.stringify(captureFailures)) {
        failures.push('Retained capture failure report differs from the execution receipt.')
      }
      captureFailures = retainedCaptureFailures
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  } else if (captureFailures.length > 0) {
    failures.push('Capture failures were recorded without a retained failure report.')
  }
  const report = parseJson(reportBytes, 'retained package report')
  const compositeReport = ['C03', 'C11', 'C17', 'C28'].includes(binding.contractId)
    ? await rebindCompositeReferences({ report, references: receipt.compositeReferences, attemptDirectory })
    : null
  if (compositeReport !== null) context.retainedEvidenceDirectory = path.resolve(attemptDirectory)
  const observations = parseJson(observationBytes, 'retained runtime observations')
  if (c02EvidenceLossMarkerPath !== null) {
    const markerBytes = await readFile(c02EvidenceLossMarkerPath)
    if (sha256(markerBytes) !== receipt.c02EvidenceLossMarkerSha256) {
      failures.push('Retained C02 evidence-loss marker digest differs from the execution receipt.')
    }
  } else if (binding.contractId === 'C02' && context.bindingVariantId === 'pending-finalize') {
    failures.push('Retained C02 pending-finalize evidence-loss marker is missing.')
  }
  const archiveReferences = await validateRetainedArchiveReferences({
    report,
    receipt,
    attemptDirectory,
  })
  const legacyReferences = binding.contractId === 'C19'
    && (LEGACY_DEFAULT_VARIANTS.has(context.bindingVariantId) || context.bindingVariantId === LEGACY_SCHEMA_VARIANT)
    ? await validateRetainedLegacyReferences({ report, receipt, variantId: context.bindingVariantId, attemptDirectory })
    : []
  const replayOutingFixture = binding.contractId === 'C10' && context.bindingVariantId === REPLAY_OUTING_VARIANT
    ? await validateRetainedReplayOutingFixture({ report, receipt, attemptDirectory })
    : null
  const replayRowsValidation = binding.contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, context.bindingVariantId)
    ? await validateRetainedReplayRows({ receipt, replayRowsPath })
    : null
  const pagingValidation = ['C07', 'C08'].includes(binding.contractId)
    ? await validateRetainedPagingEvidence({ receipt, report, context, binding, attemptDirectory })
    : null
  const runtime = retainedRuntimeExpectation(receipt.runtime, observations, context, binding)
  if (['C02', 'C03', 'C11', 'C17', 'C19', 'C20', 'C22', 'C26', 'C28'].includes(binding.contractId)) {
    const observedEvidenceDirectory = validateOwnedProducerEvidencePath(observations.evidenceDirectory, attemptDirectory)
    context.evidenceDirectory = ['C02', 'C19', 'C20', 'C22'].includes(binding.contractId)
      ? path.resolve(attemptDirectory)
      : observedEvidenceDirectory
  }
  if (binding.contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, context.bindingVariantId)) {
    context.evidenceDirectory = path.resolve(attemptDirectory)
  }
  if (binding.contractId === 'C10' && context.bindingVariantId === REPLAY_OUTING_VARIANT) {
    context.evidenceDirectory = path.resolve(attemptDirectory)
  }
  if (!isRecord(receipt.runtime)
      || receipt.runtime.proofMode !== observations.proofMode
      || receipt.runtime.launchPath !== observations.launchPath
      || receipt.runtime.artifactSha256 !== observations.artifactSha256
      || receipt.runtime.executableSha256 !== observations.executableSha256
      || receipt.runtime.asarSha256 !== observations.asarSha256) {
    failures.push('Retained runtime summary differs from the independently retained process observations.')
  }
  const runtimeValidation = validateRuntimeObservations(observations, runtime)
  const validationReport = ['C20', 'C22'].includes(binding.contractId)
    ? rebindRetainedFieldArchiveReport(report, archiveReferences, attemptDirectory)
    : binding.contractId === 'C19'
      && (LEGACY_DEFAULT_VARIANTS.has(context.bindingVariantId) || context.bindingVariantId === LEGACY_SCHEMA_VARIANT)
      ? rebindRetainedLegacyReport(report, legacyReferences, attemptDirectory)
      : binding.contractId === 'C10' && context.bindingVariantId === REPLAY_OUTING_VARIANT
        ? rebindRetainedReplayOutingReport(report, replayOutingFixture, attemptDirectory)
      : binding.contractId === 'C02' && C02_LIFECYCLE_VARIANTS.includes(context.bindingVariantId)
        ? rebindRetainedC02Report(report, context.bindingVariantId, c02EvidenceLossMarkerPath, attemptDirectory)
      : compositeReport ?? report
  const validation = ['C07', 'C08'].includes(binding.contractId)
    ? pagingValidation
    : await validateProducerReport(binding.contractId, validationReport, context, runtime, observations)
  const observedProductFailure = validation.status === 'FAIL' && validation.observedProductFailure === true
    && validation.evidenceComplete === true && [0, 1].includes(receipt.process?.exitCode)
  if (receipt.process?.exitCode !== 0 && !observedProductFailure) failures.push('Retained package process exited nonzero or has no terminal exit.')
  if (receipt.process?.processError !== null) failures.push('Retained package process error state is missing or nonempty.')
  if (receipt.process?.timedOut !== false) failures.push('Retained package timeout state is missing or indicates a timeout.')
  if (observations.zeroDescendantsAfterRun !== true || !Array.isArray(observations.descendantsAfterExit)
      || observations.descendantsAfterExit.length !== 0) failures.push('Retained package run does not prove zero descendants after exit.')
  if (receipt.artifact?.role !== context.artifact.role
      || receipt.artifact?.basename !== path.basename(context.artifact.path)
      || receipt.artifact?.sha256 !== context.artifact.sha256
      || receipt.artifact?.bytes !== context.artifact.bytes) {
    failures.push('Retained package artifact identity differs from the immutable runtime input.')
  }
  if (captureFailures.length > 0) failures.push('Packaged capture retention contains invalid evidence.')
  const combinedFailures = [...failures, ...runtimeValidation.failureReasons, ...validation.failureReasons]
  if (pagingValidation !== null && pagingValidation.passed !== true) {
    combinedFailures.push(...(pagingValidation.failureReasons ?? ['Retained paging evidence is invalid.']))
  }
  if (replayRowsValidation !== null && replayRowsValidation.passed !== true) {
    combinedFailures.push(...(replayRowsValidation.failureReasons ?? ['Retained replay evidence is invalid.']))
  }
  const uniqueFailures = [...new Set(combinedFailures)]
  const passed = uniqueFailures.length === 0 && validation.passed && runtimeValidation.passed
  return Object.freeze({
    ...receipt,
    rawReportPath: path.basename(reportPath),
    runtimeObservationsPath: path.basename(observationsPath),
    stdoutPath: path.basename(stdoutPath),
    stderrPath: path.basename(stderrPath),
    captureFailuresPath: captureFailurePath === null ? null : path.basename(captureFailurePath),
    captureFailures: Object.freeze(captureFailures),
    c21WrapperReceiptPath: c21WrapperReceiptPath === null ? null : path.basename(c21WrapperReceiptPath),
    c02EvidenceLossMarkerPath: c02EvidenceLossMarkerPath === null ? null : path.basename(c02EvidenceLossMarkerPath),
    rawReportSha256,
    runtimeObservationsSha256,
    archiveReferences,
    legacyReferences,
    compositeReferences: receipt.compositeReferences ?? [],
    status: passed ? 'PASS' : observedProductFailure && failures.length === 0 && runtimeValidation.passed ? 'FAIL' : 'INVALID_EVIDENCE',
    valid: passed,
    passed,
    validation,
    runtimeValidation,
    pagingValidation,
    replayRowsValidation,
    runtimeObservations: observations,
    failureReasons: Object.freeze(uniqueFailures),
    releaseEligible: false,
    scopeGaps: scopeGaps(binding.contractId, binding.proofMode),
  })
}

/** Re-open the retained streamed paging rows and independently validate the bound fixture. */
async function validateRetainedPagingEvidence({ receipt, report, context, binding, attemptDirectory }) {
  if (typeof receipt.pagingRowsPath !== 'string'
      || receipt.pagingRowsPath !== 'paging-pages.ndjson'
      || typeof receipt.pagingRowsSha256 !== 'string'
      || !Number.isSafeInteger(receipt.pagingRowsBytes)
      || receipt.pagingRowsBytes < 1) {
    return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: ['Retained paging rows identity is incomplete.'] }
  }
  const rowsPath = await requireAttemptFile(attemptDirectory, receipt.pagingRowsPath, 'retained paging rows')
  const rows = await hashCandidateFile(rowsPath)
  if (rows.sha256 !== receipt.pagingRowsSha256 || rows.bytes !== receipt.pagingRowsBytes) {
    return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: ['Retained paging rows changed after execution.'] }
  }
  const fixture = context.runtimeInputs.config.fixtures?.[context.bindingVariantId]
  try {
    return await validatePagingFiles({ report, rowsPath, fixture, variantId: context.bindingVariantId, contractId: binding.contractId })
  } catch (error) {
    return {
      passed: false,
      status: 'INVALID_EVIDENCE',
      failureReasons: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/** Re-hash the retained replay rows before the independent scale oracle reads them. */
async function validateRetainedReplayRows({ receipt, replayRowsPath }) {
  if (replayRowsPath === null
      || receipt.replayRowsPath !== 'replay-pages.ndjson'
      || typeof receipt.replayRowsSha256 !== 'string'
      || !Number.isSafeInteger(receipt.replayRowsBytes)
      || receipt.replayRowsBytes < 1) {
    return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: ['Retained replay rows identity is incomplete.'] }
  }
  const rows = await hashCandidateFile(replayRowsPath)
  if (rows.sha256 !== receipt.replayRowsSha256 || rows.bytes !== receipt.replayRowsBytes) {
    return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: ['Retained replay rows changed after execution.'] }
  }
  return { passed: true, status: 'PASS', failureReasons: [] }
}

/** Validate the exact compiled definition, runtime input and packaged binding before launch. */
async function validateExecutionContext(normalized, binding, attemptDirectory, workDirectory, options = {}) {
  if (!isRecord(normalized) || !isRecord(normalized.runtimeInputs)
      || !isRecord(normalized.runtimeInputs.config)) {
    throw new Error('Package adapter requires exact bound runtime inputs in the campaign definition.')
  }
  if (!isRecord(binding) || !PACKAGE_ADAPTER_CONTRACTS.includes(binding.contractId)
      || !SUPPORTED_PROOF_MODES.has(binding.proofMode)) {
    throw new Error('Package adapter binding is not one of the reviewed packaged variants.')
  }
  if (!isRecord(normalized.identities?.source) || !SHA1.test(normalized.identities.source.sha)
      || !SHA1.test(normalized.identities.source.tree)) {
    throw new Error('Package adapter source identity is incomplete.')
  }
  const runtimeInputs = normalized.runtimeInputs
  const config = runtimeInputs.config
  const normalizedVariant = normalizePackagedVariant(binding.contractId, binding.variantId, binding.proofMode)
  if (config.ci?.provenance?.sourceSha !== normalized.identities.source.sha) {
    throw new Error('Runtime input source SHA differs from the immutable campaign source identity.')
  }
  const role = binding.proofMode === 'ci-appimage' ? 'ci-appimage' : 'ci-deb'
  const installer = config.ci?.installers?.find((entry) => entry?.role === role)
  if (!isRecord(installer) || !path.isAbsolute(installer.path) || !SHA256.test(String(installer.sha256))) {
    throw new Error(`Exact ${role} runtime installer is missing from the bound configuration.`)
  }
  const artifact = normalized.identities.candidate?.artifacts?.find((entry) => entry?.role === role)
  if (!isRecord(artifact) || artifact.path !== installer.path || artifact.sha256 !== installer.sha256
      || artifact.bytes !== installer.bytes || artifact.localBuild === true) {
    throw new Error(`Candidate ${role} artifact is not byte-bound to runtimeInputs.`)
  }
  const freshArtifact = await hashCandidateFile(installer.path)
  if (freshArtifact.sha256 !== installer.sha256 || freshArtifact.bytes !== installer.bytes) {
    throw new Error('Bound package artifact changed before adapter execution or retained revalidation.')
  }
  const installedExecutablePath = config.installedExecutablePath
  if (binding.proofMode === 'installed-deb'
      && installedExecutablePath !== CANONICAL_INSTALLED_EXECUTABLE_PATH) {
    throw new Error('Installed-deb package adapter requires the canonical installed launcher from runtimeInputs.')
  }
  if (!options.retained && (!path.isAbsolute(attemptDirectory) || !path.isAbsolute(workDirectory))) {
    throw new Error('Package adapter attempt and work directories must be absolute.')
  }
  if (!options.retained && path.resolve(attemptDirectory) === path.resolve(workDirectory)) {
    throw new Error('Package adapter attempt and disposable work directories must be distinct.')
  }
  return {
    attemptDirectory: path.resolve(attemptDirectory),
    workDirectory: workDirectory === null ? null : path.resolve(workDirectory),
    sourceSha: normalized.identities.source.sha,
    sourceTree: normalized.identities.source.tree,
    bindingProofMode: binding.proofMode,
    bindingVariantId: normalizedVariant.producerVariantId,
    outerVariantId: normalizedVariant.outerVariantId,
    version: normalized.identities.candidate?.version,
    artifact: { ...artifact, role },
    installedExecutablePath,
    enospcMount: config.enospcMount,
    runtimeInputs,
  }
}

/** Copy the exact storage-mission fixture into the disposable runtime area without mutating its source. */
export async function copyStorageMissionFixture(context, runtimeDirectory) {
  const declared = context.runtimeInputs.config.fixtures?.['storage-mission']
  if (!isRecord(declared) || !path.isAbsolute(declared.path)) {
    throw new Error('C18 requires the bound storage-mission fixture role.')
  }
  const source = await hashCandidateFile(declared.path)
  if (source.sha256 !== declared.sha256 || source.bytes !== declared.bytes) {
    throw new Error('Bound storage-mission fixture changed before copying.')
  }
  const destination = path.join(runtimeDirectory, 'storageMission.sqlite')
  const copied = await copyStandaloneSqliteFixture(source, destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error('Disposable storage-mission fixture copy differs from the bound input.')
  }
  const manifest = context.runtimeInputs.config.fixtures?.['storage-mission-manifest']
  if (manifest !== undefined) {
    const actual = await hashCandidateFile(manifest.path)
    if (actual.sha256 !== manifest.sha256 || actual.bytes !== manifest.bytes) throw new Error('Bound storage manifest changed before copying.')
    await copyFile(actual.path, `${destination}.manifest.json`)
    const retained = await hashCandidateFile(`${destination}.manifest.json`)
    if (retained.sha256 !== manifest.sha256 || retained.bytes !== manifest.bytes) throw new Error('Copied storage manifest differs from bound bytes.')
  }
  const after = await hashCandidateFile(source.path)
  if (after.sha256 !== source.sha256 || after.bytes !== source.bytes) {
    throw new Error('Bound storage-mission fixture changed during disposable copy.')
  }
  return { source: source.path, destination, sha256: source.sha256, bytes: source.bytes }
}

/** Copy one immutable reviewed paging fixture into the disposable package runtime. */
export async function copyPagingFixture(context, runtimeDirectory, variantId) {
  const profile = PAGING_PROFILES[variantId]
  if (!profile) throw new Error('Paging adapter requires a reviewed paging profile.')
  const declared = context.runtimeInputs.config.fixtures?.[variantId]
  if (!isRecord(declared) || !path.isAbsolute(declared.path)) {
    throw new Error(`Paging requires the bound ${variantId} fixture role.`)
  }
  const source = await hashCandidateFile(declared.path)
  if (source.sha256 !== declared.sha256 || source.bytes !== declared.bytes || source.bytes < profile.bytes) {
    throw new Error(`Bound ${variantId} paging fixture changed or is smaller than its reviewed byte floor.`)
  }
  const destination = path.join(runtimeDirectory, `${variantId}.sqlite`)
  const copied = await copyStandaloneSqliteFixture(source, destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error(`Disposable ${variantId} paging fixture copy differs from the bound input.`)
  }
  const after = await hashCandidateFile(source.path)
  if (after.sha256 !== source.sha256 || after.bytes !== source.bytes) {
    throw new Error(`Bound ${variantId} paging fixture changed during disposable copy.`)
  }
  return { source: source.path, destination, sha256: source.sha256, bytes: source.bytes }
}

/** Copy one immutable reviewed replay-scale fixture into the disposable package runtime. */
export async function copyReplayScaleFixture(context, runtimeDirectory, variantId) {
  const profile = REPLAY_SCALE_PROFILES[variantId]
  if (!profile) throw new Error('Replay adapter requires a reviewed replay-scale profile.')
  const declared = context.runtimeInputs.config.fixtures?.[variantId]
  if (!isRecord(declared) || !path.isAbsolute(declared.path)) {
    throw new Error(`Replay scale requires the bound ${variantId} fixture role.`)
  }
  const source = await hashCandidateFile(declared.path)
  if (source.sha256 !== declared.sha256 || source.bytes !== declared.bytes) {
    throw new Error(`Bound ${variantId} replay fixture changed before copying.`)
  }
  const destination = path.join(runtimeDirectory, `${variantId}.sqlite`)
  const copied = await copyStandaloneSqliteFixture(source, destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error(`Disposable ${variantId} replay fixture copy differs from the bound input.`)
  }
  const after = await hashCandidateFile(source.path)
  if (after.sha256 !== source.sha256 || after.bytes !== source.bytes) {
    throw new Error(`Bound ${variantId} replay fixture changed during disposable copy.`)
  }
  return { source: source.path, destination, sha256: source.sha256, bytes: source.bytes, rows: profile.rows }
}

/** Compile the fixed runtime identity expected by package-runtime's process oracle. */
function runtimeExpectation(prepared, proofMode) {
  return {
    proofMode,
    launchPath: prepared.launchPath,
    installedExecutablePath: prepared.installedExecutablePath,
    artifactSha256: prepared.artifactSha256,
    executableSha256: prepared.executableSha256,
    asarSha256: prepared.asarSha256,
  }
}

/** Reconstruct the runtime identity from retained observations without trusting mutable receipt fields. */
function retainedRuntimeExpectation(receiptRuntime, observations, context, binding) {
  const runtime = isRecord(receiptRuntime) ? receiptRuntime : {}
  const first = Array.isArray(observations?.observations) ? observations.observations[0] : null
  const launchPath = binding.proofMode === 'installed-deb'
    ? context.installedExecutablePath
    : first?.launchPath ?? runtime.launchPath
  return {
    proofMode: binding.proofMode,
    launchPath,
    installedExecutablePath: context.installedExecutablePath,
    artifactSha256: context.artifact.sha256,
    executableSha256: observations?.executableSha256 ?? runtime.executableSha256,
    asarSha256: observations?.asarSha256 ?? runtime.asarSha256,
  }
}

/** Reconstruct the historical owned output boundary after disposable work has been removed. */
export function validateOwnedProducerEvidencePath(filename, attemptDirectory) {
  if (typeof filename !== 'string' || path.resolve(filename) !== filename) throw new Error('Producer evidence path must be absolute and canonical.')
  const campaignRoot = path.dirname(path.dirname(attemptDirectory))
  const parts = path.relative(path.join(campaignRoot, 'leases'), filename).split(path.sep)
  if (parts.length !== 5 || !/^[a-z0-9][a-z0-9._-]*$/u.test(parts[0])
      || parts[1] !== 'fixtures' || !parts[2].startsWith(`${path.basename(attemptDirectory)}-`)
      || parts[3] !== 'package-runtime' || parts[4] !== 'evidence') {
    throw new Error('Producer evidence belongs outside this attempt and campaign lease.')
  }
  return filename
}

/** Invoke only the existing independent producer oracle for the selected contract. */
async function validateProducerReport(contractId, report, context, runtime, observations = null) {
  if (contractId === 'C01' || (contractId === 'C19' && context.bindingVariantId === LEGACY_STARTUP_VARIANT)) {
    const { default: missionStore } = await import('../../electron/mission-store.cjs')
    const expected = {
      proofMode: C01_STARTUP_PROOF_MODE, source: { expectedHead: context.sourceSha, tree: context.sourceTree },
      app: { suppliedPath: runtime.launchPath }, process: { tier: C01_STARTUP_PROOF_MODE },
      artifact: { packagedApplicationArchiveSha256: runtime.asarSha256,
        packagedExecutableSha256: context.bindingProofMode === 'ci-appimage' ? context.artifact.sha256 : runtime.executableSha256 },
      workload: { supportedSchemaVersion: missionStore.CURRENT_SCHEMA_VERSION,
        profileKinds: [...C01_STARTUP_PROFILE_KINDS] },
    }
    return contractId === 'C01'
      ? validateStartupProbeReceipt(contractId, report, expected)
      : validateLegacyStartupReceipt(report, expected)
  }
  if (contractId === 'C02' && C02_LIFECYCLE_VARIANTS.includes(context.bindingVariantId)) {
    try {
      return await validateC02LifecycleReceipt(report, {
        variantId: context.bindingVariantId,
        sourceSha: context.sourceSha,
        appSha256: runtime.executableSha256,
        asarSha256: runtime.asarSha256,
        evidencePath: context.evidenceDirectory,
      })
    } catch (error) {
      return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: [safeErrorMessage(error)] }
    }
  }
  if (contractId === 'C18' && BACKUP_FAULT_VARIANTS.includes(context.bindingVariantId)) {
    return validateStorageBackupFaultReport(report, context, runtime)
  }
  if (contractId === 'C19' && LEGACY_DEFAULT_VARIANTS.has(context.bindingVariantId)) {
    try {
      return await validateLegacyDefaultReceipt(report, {
        variantId: context.bindingVariantId,
        appSha256: runtime.executableSha256,
        asarSha256: runtime.asarSha256,
        evidencePath: context.evidenceDirectory,
      })
    } catch (error) {
      return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: [error instanceof Error ? error.message : String(error)] }
    }
  }
  if (contractId === 'C19' && context.bindingVariantId === LEGACY_SCHEMA_VARIANT) {
    try {
      return await validateLegacySchemaReceipt(report, {
        appSha256: runtime.executableSha256,
        asarSha256: runtime.asarSha256,
        evidencePath: context.evidenceDirectory,
      })
    } catch (error) {
      return { passed: false, status: 'INVALID_EVIDENCE', failureReasons: [error instanceof Error ? error.message : String(error)] }
    }
  }
  if (['C03', 'C11', 'C17'].includes(contractId)) {
    if (report?.app?.packagedAppSha256 !== runtime.asarSha256) {
      return invalidValidation(contractId, 'Composite app archive differs from the independently observed package runtime.')
    }
    return validateCompositeFamilyReceipt(report, {
      ...(await compositeFamilyExpected(runtime, context)),
      contractId,
    })
  }
  if (['C26', 'C28'].includes(contractId)) {
    const expected = { appPath: runtime.launchPath,
      appSha256: context.bindingProofMode === 'ci-appimage' ? context.artifact.sha256 : runtime.executableSha256,
      evidencePath: context.evidenceDirectory, sourceHead: context.sourceSha,
      profilePath: contractId === 'C28' ? path.join(context.evidenceDirectory, '.profile-composite') : report.profile?.path }
    if (contractId === 'C26') return validateDuplicateLaunchReceipt(report, expected)
    if (report?.app?.packagedAppSha256 !== runtime.asarSha256) {
      return invalidValidation(contractId, 'Composite app archive differs from the independently observed package runtime.')
    }
    const compositeExpected = { ...expected, sourceRoot: projectRoot,
      retainedEvidencePath: context.retainedEvidenceDirectory ?? context.evidenceDirectory,
      sourceManifest: await createCompositeSourceManifest(projectRoot) }
    const validation = context.bindingVariantId === undefined || context.bindingVariantId === 'routine'
      ? validateCompositeReceipt(report, compositeExpected)
      : validateCompositeVariantReceipt(report, {
        ...compositeExpected,
        variantId: context.bindingVariantId,
        ...compositeFieldScaleFixture(report, context.bindingVariantId),
      })
    if (!validation.complete) return { ...validation, passed: false, status: 'INVALID_EVIDENCE',
      failureReasons: [...validation.failureReasons, 'Composite journey has incomplete mandatory phases.'] }
    return validation
  }
  if (contractId === 'C21') {
    return validateArchiveSecurityReceipt(report, buildArchiveSecurityValidatorBinding(report, context, runtime, observations))
  }
  const expected = validatorBinding(contractId, context, runtime)
  if (contractId === 'C16') return validateSettingsProbeReceipt(contractId, report, expected)
  if (contractId === 'C23') return validateIpcContainmentReceipt(report, expected)
  if (contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, context.bindingVariantId)) {
    const fixture = context.runtimeInputs.config.fixtures?.[context.bindingVariantId]
    try {
      return await validateReplayScaleFiles({
        report,
        fixture,
        rowsPath: path.join(context.evidenceDirectory, 'replay-pages.ndjson'),
        variantId: context.bindingVariantId,
      })
    } catch (error) {
      return {
        passed: false,
        status: 'INVALID_EVIDENCE',
        failureReasons: [error instanceof Error ? error.message : String(error)],
      }
    }
  }
  if (contractId === 'C10' && context.bindingVariantId === REPLAY_OUTING_VARIANT) {
    try {
      return await validateReplayOutingReceipt(report, {
        appSha256: runtime.executableSha256,
        asarSha256: runtime.asarSha256,
        evidencePath: context.evidenceDirectory,
      })
    } catch (error) {
      return {
        passed: false,
        status: 'INVALID_EVIDENCE',
        failureReasons: [error instanceof Error ? error.message : String(error)],
      }
    }
  }
  if (contractId === 'C10') return validateReplayReceipt(report)
  if (contractId === 'C12') return validateMarkerAttachmentReceipt(report, expected)
  if (contractId === 'C13') return validateCoordinateSurfaceReport(report, runtime)
  if (contractId === 'C14') return validateMapSurfaceReport(report, runtime)
  if (contractId === 'C05') return validateCanonicalIngestReport(report, runtime)
  if (contractId === 'C06') return validateAttentionSurfaceReport(report, runtime)
  if (['C07', 'C08'].includes(contractId)) {
    return validatePagingFiles({
      report,
      rowsPath: path.join(context.evidenceDirectory, 'pages.ndjson'),
      fixture: context.runtimeInputs.config.fixtures?.[context.bindingVariantId],
      variantId: context.bindingVariantId,
      contractId,
    })
  }
  if (['C20', 'C22'].includes(contractId)) return validateArchiveFieldReport(contractId, report, context, runtime)
  return validatePackageSmokeReceipt(contractId, report, expected)
}

/** Validate one C18 backup-fault report using the independent bounded oracle. */
function validateStorageBackupFaultReport(report, context, runtime) {
  const failures = []
  const fixture = context.runtimeInputs.config.fixtures?.['storage-mission']
  const expectedAppSha256 = context.bindingProofMode === 'ci-appimage'
    ? context.artifact.sha256
    : runtime.executableSha256
  if (!isRecord(report)
      || report.schemaVersion !== 1
      || report.schema !== 'sartracker-storage-backup-fault-matrix-v1'
      || report.contractId !== 'C18'
      || report.variant !== context.bindingVariantId
      || report.oracleInput?.variant !== context.bindingVariantId
      || report.releaseEligible !== false) {
    failures.push('C18 backup-fault report identity, oracle variant or schema is invalid.')
  }
  if (!isRecord(fixture)
      || report?.source?.sha256 !== fixture.sha256
      || report?.app?.sha256 !== expectedAppSha256) {
    failures.push('C18 backup-fault source or package identity is not bound to the selected runtime inputs.')
  }
  if (!isRecord(report?.runtime)
      || report.runtime.proofMode !== 'packaged-module'
      || report.runtime.executableSha256 !== runtime.executableSha256
      || report.runtime.asarSha256 !== runtime.asarSha256) {
    failures.push('C18 backup-fault runtime identity is not independently bound to the observed package.')
  }
  if (!isRecord(report?.cleanup)
      || report.cleanup.applicationClosed !== true
      || report.cleanup.appProfileRemoved !== true) {
    failures.push('C18 backup-fault disposable application cleanup is incomplete.')
  }
  const identityFailures = failures.length
  let oracle = null
  try {
    oracle = buildStorageBackupFaultVerdict(report?.oracleInput)
  } catch (error) {
    failures.push(`C18 backup-fault oracle could not be evaluated: ${safeErrorMessage(error)}`)
  }
  if (oracle !== null && !oracle.passed) failures.push(...oracle.failures)
  return {
    status: failures.length === 0 ? 'PASS' : oracle?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'INVALID_EVIDENCE',
    passed: failures.length === 0,
    failureReasons: [...new Set(failures)],
    predicates: { identity: identityFailures === 0, oracle: oracle?.passed === true },
    releaseEligible: false,
  }
}

/** Adapt the asynchronous field archive oracle to the package adapter receipt shape. */
async function validateArchiveFieldReport(contractId, report, context, runtime) {
  const expected = buildArchiveFieldValidatorBinding(contractId, context, runtime)
  try {
    const facts = await validateArchiveFieldReceipt(report, expected)
    return {
      ...facts,
      contractId,
      status: 'PASS',
      valid: true,
      passed: true,
      complete: true,
      releaseEligible: false,
      failureReasons: [],
    }
  } catch (error) {
    return {
      contractId,
      status: 'INVALID_EVIDENCE',
      valid: false,
      passed: false,
      complete: false,
      releaseEligible: false,
      failureReasons: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/** Bind the fixed C28 field-scale fixture paths reported by the selected variant. */
function compositeFieldScaleFixture(report, variantId) {
  if (!['field-scale-960k', 'field-scale-2m'].includes(variantId)) return {}
  const facts = report?.variant?.facts
  return {
    fieldScaleFixture: {
      path: facts?.fixturePath,
      manifestPath: facts?.fixtureManifestPath,
      copyPath: facts?.fixtureCopyPath,
      preset: facts?.preset,
      rows: variantId === 'field-scale-960k' ? 960_000 : 2_000_000,
    },
  }
}

/** Bind a C03/C11/C17 phase receipt to the raw C28 routine producer identity. */
async function compositeFamilyExpected(runtime, context) {
  return {
    appPath: runtime.launchPath,
    appSha256: context.bindingProofMode === 'ci-appimage' ? context.artifact.sha256 : runtime.executableSha256,
    evidencePath: context.evidenceDirectory,
    retainedEvidencePath: context.retainedEvidenceDirectory ?? context.evidenceDirectory,
    profilePath: path.join(context.evidenceDirectory, '.profile-composite'),
    sourceHead: context.sourceSha,
    sourceManifest: await createCompositeSourceManifest(projectRoot),
    sourceRoot: projectRoot,
  }
}

/** Build the exact packaged runtime and fixed corpus identity expected by C21. */
export function buildArchiveSecurityValidatorBinding(report, context, runtime, observations = null) {
  const reportRuntime = report?.runtime
  if (!isRecord(reportRuntime)) throw new Error('C21 archive-security report runtime identity is missing.')
  const processObservation = Array.isArray(observations?.observations)
    ? observations.observations.find((entry) => isRecord(entry) && typeof entry.executablePath === 'string')
    : null
  const executablePath = processObservation?.executablePath ?? reportRuntime.executablePath
  const appAsarPath = processObservation === null
    ? reportRuntime.appAsarPath
    : path.join(path.dirname(executablePath), 'resources', 'app.asar')
  return {
    proofMode: 'packaged-module',
    sourceSha: context.sourceSha,
    corpusId: 'sararch2-frame-mutation-v1',
    caseIds: ARCHIVE_SECURITY_CASE_IDS,
    runtime: {
      tier: 'packaged-module',
      sourceRoot: null,
      appAsarPath,
      appAsarSha256: runtime.asarSha256,
      executablePath,
      executableSha256: runtime.executableSha256,
    },
  }
}

/** Build the exact field archive identity expected by the independent C20/C22 validator. */
export function buildArchiveFieldValidatorBinding(contractId, context, runtime) {
  if (!['C20', 'C22'].includes(contractId)) throw new Error('Archive validator binding requires C20 or C22.')
  return {
    contractId,
    sourceSha: context.sourceSha,
    appSha256: runtime.executableSha256,
    asarSha256: runtime.asarSha256,
    evidencePath: context.evidenceDirectory,
  }
}

/** Build producer-validator identity without conflating AppImage bytes and unpacked ELF bytes. */
function validatorBinding(contractId, context, runtime) {
  const source = ['C02', 'C09', 'C19'].includes(contractId)
    ? { expectedHead: context.sourceSha, tree: context.sourceTree }
    : contractId === 'C23'
      ? { expectedHead: context.sourceSha }
    : undefined
  const producerExecutableSha256 = context.bindingProofMode === 'ci-appimage'
    ? context.artifact.sha256
    : runtime.executableSha256
  const artifact = contractId === 'C09'
    ? { archiveSha256: runtime.asarSha256 }
    : contractId === 'C16'
      ? {
          packagedApplicationArchiveSha256: runtime.asarSha256,
          packagedExecutableSha256: producerExecutableSha256,
        }
      : contractId === 'C19'
        ? { executableSha256: producerExecutableSha256, archiveSha256: runtime.asarSha256 }
        : { executableSha256: producerExecutableSha256, archiveSha256: runtime.asarSha256 }
  const workload = contractId === 'C18'
    ? { fixtureSha256: context.runtimeInputs.config.fixtures['storage-mission'].sha256 }
    : contractId === 'C19'
      ? { baselineMarkerRows: 50_000 }
      : contractId === 'C09'
        ? { largePointCount: 75_000, totalPointCount: 75_004 }
        : undefined
  if (contractId === 'C15') {
    return {
      source: null,
      artifact: { archiveSha256: runtime.asarSha256 },
      processTier: 'packaged-asar-synthetic-offline-map',
    }
  }
  if (contractId === 'C16') {
    return {
      proofMode: 'packaged-electron-disposable-settings',
      source: { expectedHead: context.sourceSha, tree: context.sourceTree },
      artifact,
      workload: {
        profileId: 'synthetic-disposable-settings',
        providerType: 'traccar_http',
        baseUrlSha256: SYNTHETIC_SETTINGS_BASE_URL_SHA256,
      },
      process: { tier: 'packaged-electron-disposable-settings' },
    }
  }
  if (contractId === 'C23') {
    return {
      proofMode: 'packaged-electron-ipc-containment',
      source: { expectedHead: context.sourceSha },
      app: { suppliedPath: runtime.launchPath, executableSha256: producerExecutableSha256 },
    }
  }
  if (contractId === 'C12') {
    return {
      proofMode: 'packaged-electron-marker-attachment',
      source: { expectedHead: context.sourceSha, tree: context.sourceTree },
      artifact: {
        packagedExecutableSha256: producerExecutableSha256,
        packagedApplicationArchiveSha256: runtime.asarSha256,
      },
      workload: {
        markerKinds: ['ipp_lkp', 'clue', 'hazard', 'casualty'],
        attachmentFileName: 'same-name.txt',
      },
    }
  }
  const descriptor = PACKAGE_SMOKE_DESCRIPTORS[contractId]
  return {
    source,
    artifact,
    workload,
    processTier: descriptor?.actualProofMode,
  }
}

/** Validate the fixed C13 facts and bind its cleanup/runtime identities to the outer observation. */
function validateCoordinateSurfaceReport(report, runtime) {
  const failures = []
  let validation
  try {
    if (!isRecord(report)
        || report.schema !== 'sartracker-coordinate-surface-v1'
        || report.contractId !== 'C13'
        || !isRecord(report.cleanup)
        || report.cleanup.applicationClosed !== true
        || report.cleanup.profileRemoved !== true
        || !isRecord(report.runtime)
        || !isRecord(report.runtime.executableIdentity)
        || !isRecord(report.runtime.asarIdentity)) {
      throw new Error('C13 report schema, cleanup, or runtime identity is incomplete.')
    }
    validation = validateCoordinateSurface(report.facts)
    if (report.runtime.executableIdentity.sha256 !== runtime.executableSha256
        || report.runtime.asarIdentity.sha256 !== runtime.asarSha256) {
      throw new Error('C13 report runtime hashes differ from the independently prepared package runtime.')
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  return validation === undefined
    ? { status: 'INVALID_EVIDENCE', passed: false, failureReasons: failures, releaseEligible: false }
    : { ...validation, passed: failures.length === 0, status: failures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE', failureReasons: failures, releaseEligible: false }
}

/** Validate C14 facts independently, then bind only the exact outer runtime hashes. */
function validateMapSurfaceReport(report, runtime) {
  const failures = []
  let validation
  try {
    if (!isRecord(report)
        || report.schema !== 'sartracker-map-surface-v1'
        || report.contractId !== 'C14'
        || report.developmentTestHarness === true
        || !isRecord(report.runtime)) {
      throw new Error('C14 report schema, runtime identity, or proof tier is invalid.')
    }
    validation = validateMapSurface(report)
    if (report.runtime.executableSha256 !== runtime.executableSha256
        || report.runtime.asarSha256 !== runtime.asarSha256) {
      throw new Error('C14 report runtime hashes differ from the independently prepared package runtime.')
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  return validation === undefined
    ? { status: 'INVALID_EVIDENCE', passed: false, failureReasons: failures, releaseEligible: false }
    : { ...validation, passed: failures.length === 0, status: failures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE', failureReasons: failures, releaseEligible: false }
}

/** Validate C05 canonical-ingest facts against the observed runtime envelope. */
function validateCanonicalIngestReport(report, runtime) {
  const failures = []
  let validation
  try {
    if (!isRecord(report)
        || report.schema !== 'sartracker-attention-surface-v1'
        || report.contractId !== 'C06'
        || report.developmentTestHarness === true
        || report.qualificationExecuted !== false
        || !isRecord(report.cleanup)
        || report.cleanup.applicationClosed !== true
        || report.cleanup.serverClosed !== true
        || report.cleanup.profileRemoved !== true
        || !isRecord(report.runtime)) {
      throw new Error('C05 report schema, cleanup, runtime identity, or proof tier is invalid.')
    }
    validation = validateCanonicalIngestSurface(report.facts)
    if (report.runtime.executableSha256 !== runtime.executableSha256
        || report.runtime.asarSha256 !== runtime.asarSha256) {
      throw new Error('C05 report runtime hashes differ from the independently prepared package runtime.')
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  return validation === undefined
    ? { status: 'INVALID_EVIDENCE', passed: false, failureReasons: failures, releaseEligible: false }
    : { ...validation, passed: failures.length === 0, status: failures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE', failureReasons: failures, releaseEligible: false }
}

/** Validate C06 provider, persistence and rendered-state facts against the observed runtime. */
function validateAttentionSurfaceReport(report, runtime) {
  const failures = []
  let validation
  try {
    if (!isRecord(report)
        || report.schema !== 'sartracker-attention-surface-v1'
        || report.contractId !== 'C06'
        || report.developmentTestHarness === true
        || report.qualificationExecuted !== false
        || !isRecord(report.cleanup)
        || report.cleanup.applicationClosed !== true
        || report.cleanup.serverClosed !== true
        || report.cleanup.profileRemoved !== true
        || !isRecord(report.runtime)) {
      throw new Error('C06 report schema, cleanup, runtime identity, or proof tier is invalid.')
    }
    validation = validateAttentionSurface(report.facts)
    if (report.runtime.executableSha256 !== runtime.executableSha256
        || report.runtime.asarSha256 !== runtime.asarSha256) {
      throw new Error('C06 report runtime hashes differ from the independently prepared package runtime.')
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  return validation === undefined
    ? { status: 'INVALID_EVIDENCE', passed: false, failureReasons: failures, releaseEligible: false }
    : { ...validation, passed: failures.length === 0, status: failures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE', failureReasons: failures, releaseEligible: false }
}

/** Run the fixed Node producer through the shared bounded owned-process primitive. */
async function runFixedPackageCommand({ command, runtimeExpected, cwd, environment }) {
  const execution = await runOwnedProcess({
    file: process.execPath,
    args: [path.resolve(cwd, command.script), ...command.args],
    cwd,
    env: { ...process.env, ...environment },
    timeoutMs: command.timeoutMs,
    maxOutputBytes: MAX_LOG_BYTES,
    observeIntervalMs: PROCESS_POLL_MS,
    cleanupTimeoutMs: 10_000,
    terminationGraceMs: 5_000,
    observe: ({ pid }) => observePackageProcesses(pid, runtimeExpected),
  })
  assertOwnedProcessCleanup(execution, 'package.reviewed')
  const observations = []
  for (const sample of execution.observationResults) {
    if (!Array.isArray(sample)) continue
    for (const observation of sample) {
      const key = `${observation.pid}:${observation.startTicks}`
      if (!observations.some((existing) => `${existing.pid}:${existing.startTicks}` === key)) observations.push(observation)
    }
  }
  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    processError: execution.processError,
    supervisorPid: execution.supervisorPid,
    zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun,
    runtimeObservations: {
      schema: 'sartracker-package-runtime-observations-v1',
      proofMode: runtimeExpected.proofMode,
      launchPath: runtimeExpected.launchPath,
      artifactSha256: runtimeExpected.artifactSha256,
      executableSha256: runtimeExpected.executableSha256,
      asarSha256: runtimeExpected.asarSha256,
      evidenceDirectory: runtimeExpected.evidenceDirectory,
      observations,
      observationErrors: execution.observationErrors,
      restartCount: Math.max(0, observations.length - 1),
      descendantsAfterExit: execution.descendantsAfterExit,
      zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun,
    },
  }
}

/** Resolve C15's one fresh producer run directory without guessing at an older report. */
export async function resolveProducerReportLocation(contractId, evidenceDirectory, reportPath) {
  if (contractId !== 'C15') return { reportPath, captureDirectories: [] }
  const entries = await readdir(evidenceDirectory, { withFileTypes: true })
  const runDirectories = entries.filter((entry) => entry.isDirectory() && /^run-[a-z0-9]+$/iu.test(entry.name))
  if (runDirectories.length !== 1) {
    throw new Error('C15 packaged map probe must produce exactly one fresh run directory.')
  }
  const runDirectory = path.join(evidenceDirectory, runDirectories[0].name)
  const report = path.join(runDirectory, 'summary.json')
  return { reportPath: report, captureDirectories: [runDirectory] }
}

/** Retain bounded raw report/log bytes and process observations before work cleanup. */
async function retainRawArtifacts({ contractId, variantId, reportPath, evidenceDirectory, captureDirectories = [], attemptDirectory, processResult }) {
  const rawReportPath = 'package-raw-report.json'
  const runtimeObservationsPath = 'package-runtime-observations.json'
  const stdoutPath = 'package-stdout.log'
  const stderrPath = 'package-stderr.log'
  await writeFile(path.join(attemptDirectory, runtimeObservationsPath), `${JSON.stringify(processResult.runtimeObservations, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await writeFile(path.join(attemptDirectory, stdoutPath), processResult.stdout, { encoding: 'utf8', flag: 'wx' })
  await writeFile(path.join(attemptDirectory, stderrPath), processResult.stderr, { encoding: 'utf8', flag: 'wx' })
  let report = null
  let rawReportSha256 = null
  let archiveReferences = []
  let legacyReferences = []
  let compositeReferences = []
  let replayOutingFixture = null
  let c02EvidenceLossMarkerPath = null
  let c02EvidenceLossMarkerSha256 = null
  if (isInside(reportPath, evidenceDirectory)) {
    try {
      const reportBytes = await readFile(reportPath)
      rawReportSha256 = sha256(reportBytes)
      await writeFile(path.join(attemptDirectory, rawReportPath), reportBytes, { flag: 'wx' })
      report = parseJson(reportBytes, 'producer report')
    } catch {
      // Missing or malformed reports are retained as an invalid adapter result.
    }
  }
  if (report !== null && ['C20', 'C22'].includes(contractId)) {
    archiveReferences = await retainArchiveReferencedFiles({ report, evidenceDirectory, attemptDirectory })
  }
  if (report !== null && ['C03', 'C11', 'C17', 'C28'].includes(contractId)) {
    compositeReferences = await retainCompositeReferences({ report, evidenceDirectory, attemptDirectory })
  }
  if (report !== null && contractId === 'C19'
      && (LEGACY_DEFAULT_VARIANTS.has(variantId) || variantId === LEGACY_SCHEMA_VARIANT)) {
    legacyReferences = await retainLegacyReferencedFiles({ report, variantId, evidenceDirectory, attemptDirectory })
  }
  if (report !== null && contractId === 'C10' && variantId === REPLAY_OUTING_VARIANT) {
    replayOutingFixture = await retainReplayOutingReferencedFile({ report, evidenceDirectory, attemptDirectory })
  }
  if (report !== null && contractId === 'C02' && variantId === 'pending-finalize') {
    const sourcePath = await resolveArchiveReferencePath(
      report.pendingFinalize?.evidenceLossMarker?.path,
      await realpath(evidenceDirectory),
    )
    const markerBytes = await readFile(sourcePath)
    c02EvidenceLossMarkerPath = 'c02-renderer-loss-marker.json'
    c02EvidenceLossMarkerSha256 = sha256(markerBytes)
    await writeFile(path.join(attemptDirectory, c02EvidenceLossMarkerPath), markerBytes, { flag: 'wx' })
  }
  const pagingRows = ['C07', 'C08'].includes(contractId)
    ? await retainPagingRows({ evidenceDirectory, attemptDirectory })
    : null
  const replayRows = contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, variantId)
    ? await retainReplayRows({ evidenceDirectory, attemptDirectory })
    : null
  let c21WrapperReceiptPath = null
  let c21WrapperReceiptSha256 = null
  let c21WrapperReceiptError = null
  if (contractId === 'C21') {
    try {
      const wrapper = await retainC21WrapperReceipt({ evidenceDirectory, attemptDirectory })
      c21WrapperReceiptPath = wrapper.path
      c21WrapperReceiptSha256 = wrapper.sha256
    } catch (error) {
      c21WrapperReceiptError = safeErrorMessage(error)
    }
  }
  const observationBytes = Buffer.from(`${JSON.stringify(processResult.runtimeObservations, null, 2)}\n`, 'utf8')
  const retainedCaptures = await retainCaptures([evidenceDirectory, ...captureDirectories], attemptDirectory)
  const captureFailuresPath = retainedCaptures.captureFailures.length === 0 ? null : 'package-capture-failures.json'
  if (captureFailuresPath !== null) {
    await writeFile(path.join(attemptDirectory, captureFailuresPath), `${JSON.stringify(retainedCaptures.captureFailures, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  return {
    report,
    rawReportPath,
    runtimeObservationsPath,
    stdoutPath,
    stderrPath,
    rawReportSha256,
    runtimeObservationsSha256: sha256(observationBytes),
    archiveReferences,
    legacyReferences,
    compositeReferences,
    replayOutingFixture,
    pagingRowsPath: pagingRows?.path ?? null,
    pagingRowsSha256: pagingRows?.sha256 ?? null,
    pagingRowsBytes: pagingRows?.bytes ?? null,
    replayRowsPath: replayRows?.path ?? null,
    replayRowsSha256: replayRows?.sha256 ?? null,
    replayRowsBytes: replayRows?.bytes ?? null,
    c02EvidenceLossMarkerPath,
    c02EvidenceLossMarkerSha256,
    captures: retainedCaptures.captures,
    captureFailures: retainedCaptures.captureFailures,
    captureFailuresPath,
    c21WrapperReceiptPath,
    c21WrapperReceiptSha256,
    c21WrapperReceiptError,
  }
}

/** Retain the C21 wrapper's independently measured receipt before the disposable runtime is removed. */
async function retainC21WrapperReceipt({ evidenceDirectory, attemptDirectory }) {
  const source = path.join(evidenceDirectory, 'archive-security-receipt.json')
  const sourceInfo = await lstat(source)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error('C21 wrapper receipt must be one regular non-symlink file.')
  if (sourceInfo.size > MAX_LOG_BYTES) throw new Error('C21 wrapper receipt exceeds the bounded JSON retention limit.')
  const bytes = await readFile(source)
  const destination = path.join(attemptDirectory, 'package-c21-wrapper-receipt.json')
  await writeFile(destination, bytes, { flag: 'wx' })
  return { path: 'package-c21-wrapper-receipt.json', sha256: sha256(bytes) }
}

/** Stream-copy the explicit paging rows file into the flat attempt without buffering large output. */
async function retainPagingRows({ evidenceDirectory, attemptDirectory }) {
  const sourcePath = path.join(evidenceDirectory, 'pages.ndjson')
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error('Paging rows must be one regular non-symlink file.')
  const source = await hashCandidateFile(sourcePath)
  if (source.bytes > 4 * 1024 ** 3) throw new Error('Paging rows exceed the reviewed four-gigabyte retention bound.')
  const destination = path.join(attemptDirectory, 'paging-pages.ndjson')
  await copyFile(source.path, destination, constants.COPYFILE_EXCL)
  const copied = await hashCandidateFile(destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error('Retained paging rows differ from the producer output.')
  }
  return { path: 'paging-pages.ndjson', sha256: copied.sha256, bytes: copied.bytes }
}

/** Stream-copy the explicit replay rows file into the flat attempt without buffering large output. */
async function retainReplayRows({ evidenceDirectory, attemptDirectory }) {
  const sourcePath = path.join(evidenceDirectory, 'replay-pages.ndjson')
  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error('Replay rows must be one regular non-symlink file.')
  const source = await hashCandidateFile(sourcePath)
  if (source.bytes > 16 * 1024 ** 3) throw new Error('Replay rows exceed the reviewed sixteen-gigabyte retention bound.')
  const destination = path.join(attemptDirectory, 'replay-pages.ndjson')
  await copyFile(source.path, destination, constants.COPYFILE_EXCL)
  const copied = await hashCandidateFile(destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error('Retained replay rows differ from the producer output.')
  }
  return { path: 'replay-pages.ndjson', sha256: copied.sha256, bytes: copied.bytes }
}

/** Retain the exact closed SQLite fixture emitted by the fixed 201-outing replay producer. */
export async function retainReplayOutingReferencedFile({ report, evidenceDirectory, attemptDirectory }) {
  const evidenceRoot = await realpath(evidenceDirectory)
  const sourcePath = await resolveArchiveReferencePath(report?.fixture?.path, evidenceRoot)
  const source = await hashCandidateFile(sourcePath)
  const destination = path.join(attemptDirectory, 'replay-outing-source.sqlite')
  const copied = await copyStandaloneSqliteFixture(source, destination)
  if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
    throw new Error('Retained replay outing fixture differs from the producer reference.')
  }
  return { path: 'replay-outing-source.sqlite', sha256: copied.sha256, bytes: copied.bytes }
}

/** Re-hash the retained fixed replay outing fixture after the disposable package run is gone. */
async function validateRetainedReplayOutingFixture({ report, receipt, attemptDirectory }) {
  const retained = receipt.replayOutingFixture
  if (!isRecord(retained) || retained.path !== 'replay-outing-source.sqlite'
      || !SHA256.test(String(retained.sha256)) || !Number.isSafeInteger(retained.bytes)) {
    throw new Error('Retained replay outing fixture identity is incomplete.')
  }
  const filename = await requireAttemptFile(attemptDirectory, retained.path, 'replay outing fixture')
  const identity = await hashCandidateFile(filename)
  if (identity.sha256 !== retained.sha256 || identity.bytes !== retained.bytes) {
    throw new Error('Retained replay outing fixture differs from its execution receipt.')
  }
  if (report?.fixture?.sha256 !== retained.sha256 || report.fixture.bytes !== retained.bytes) {
    throw new Error('Retained replay outing report is not bound to the fixture identity.')
  }
  return { path: retained.path, sha256: identity.sha256, bytes: identity.bytes }
}

/** Rebind the raw replay outing fixture path to its flat retained attempt copy. */
function rebindRetainedReplayOutingReport(report, retained, attemptDirectory) {
  if (!isRecord(retained)) throw new Error('Retained replay outing fixture is missing.')
  const rebound = structuredClone(report)
  if (!isRecord(rebound.fixture)) throw new Error('Replay outing report fixture is missing.')
  rebound.fixture.path = path.join(attemptDirectory, retained.path)
  return rebound
}

/** Rebind retained C02 profile and evidence-loss paths into this attempt. */
function rebindRetainedC02Report(report, variantId, markerPath, attemptDirectory) {
  const rebound = structuredClone(report)
  const profilePath = path.join(attemptDirectory, `.profile-c02-${variantId}`)
  if (isRecord(rebound.profile)) rebound.profile.path = profilePath
  if (Array.isArray(rebound.runtime?.launches)) {
    for (const launch of rebound.runtime.launches) {
      if (isRecord(launch)) launch.userDataPath = profilePath
    }
  }
  if (markerPath !== null && isRecord(rebound.pendingFinalize?.evidenceLossMarker)) {
    rebound.pendingFinalize.evidenceLossMarker.path = markerPath
  }
  return rebound
}

/** Retain every source and migrated C19 database named by the raw report. */
export async function retainLegacyReferencedFiles({ report, variantId, evidenceDirectory, attemptDirectory }) {
  const specs = legacyReferenceSpecs(report, variantId)
  if (specs.length === 0) throw new Error('C19 producer report does not name its source and migrated database files.')
  const evidenceRoot = await realpath(evidenceDirectory)
  const retained = []
  for (const spec of specs) {
    const sourcePath = await resolveArchiveReferencePath(spec.value, evidenceRoot)
    const destination = path.join(attemptDirectory, spec.path)
    const source = await hashCandidateFile(sourcePath)
    const copied = await copyStandaloneSqliteFixture(source, destination)
    if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
      throw new Error(`Retained C19 ${spec.key} database differs from the producer reference.`)
    }
    retained.push({ key: spec.key, path: spec.path, sha256: copied.sha256, bytes: copied.bytes })
  }
  return retained
}

/** Resolve the fixed C19 source/migrated database paths without guessing at files. */
function legacyReferenceSpecs(report, variantId) {
  if (LEGACY_DEFAULT_VARIANTS.has(variantId)) {
    return [
      { key: 'fixture', path: 'legacy-source.sqlite', value: report.fixture?.path },
      { key: 'migrated', path: 'legacy-migrated.sqlite', value: report.migrated?.path },
      { key: 'restartedFile', path: 'legacy-restarted.sqlite', value: report.restartedFile?.path },
    ]
  }
  if (variantId === LEGACY_SCHEMA_VARIANT) {
    return (report.cases ?? []).flatMap((entry) => [
      { key: `schema-${entry.version}-source`, path: `legacy-schema-${entry.version}-source.sqlite`, value: entry.source?.path },
      { key: `schema-${entry.version}-migrated`, path: `legacy-schema-${entry.version}-migrated.sqlite`, value: entry.migrated?.path },
    ])
  }
  return []
}

/** Re-hash every retained C19 source/migrated database and reject missing custody. */
async function validateRetainedLegacyReferences({ report, receipt, variantId, attemptDirectory }) {
  const specs = legacyReferenceSpecs(report, variantId)
  const retained = receipt.legacyReferences
  if (!Array.isArray(retained) || retained.length !== specs.length) {
    throw new Error('Retained C19 source and migrated database inventory is incomplete.')
  }
  const checked = []
  for (const spec of specs) {
    const entry = retained.find((candidate) => candidate?.key === spec.key && candidate?.path === spec.path)
    if (!isRecord(entry)) throw new Error(`Retained C19 ${spec.key} database identity is incomplete.`)
    const filename = await requireAttemptFile(attemptDirectory, entry.path, `C19 ${spec.key} database`)
    const identity = await hashCandidateFile(filename)
    if (identity.sha256 !== entry.sha256 || identity.bytes !== entry.bytes) {
      throw new Error(`Retained C19 ${spec.key} database differs from its receipt.`)
    }
    checked.push({ key: spec.key, path: spec.path, sha256: identity.sha256, bytes: identity.bytes })
  }
  return checked
}

/** Rebind C19 report paths to the flat retained attempt files. */
function rebindRetainedLegacyReport(report, retained, attemptDirectory) {
  const rebound = structuredClone(report)
  const byKey = new Map(retained.map((entry) => [entry.key, entry.path]))
  if (isRecord(rebound.fixture) && byKey.has('fixture')) rebound.fixture.path = path.join(attemptDirectory, byKey.get('fixture'))
  if (isRecord(rebound.migrated) && byKey.has('migrated')) rebound.migrated.path = path.join(attemptDirectory, byKey.get('migrated'))
  if (isRecord(rebound.restartedFile) && byKey.has('restartedFile')) rebound.restartedFile.path = path.join(attemptDirectory, byKey.get('restartedFile'))
  for (const entry of rebound.cases ?? []) {
    if (!isRecord(entry)) continue
    const source = byKey.get(`schema-${entry.version}-source`)
    const migrated = byKey.get(`schema-${entry.version}-migrated`)
    if (source !== undefined && isRecord(entry.source)) entry.source.path = path.join(attemptDirectory, source)
    if (migrated !== undefined && isRecord(entry.migrated)) entry.migrated.path = path.join(attemptDirectory, migrated)
  }
  return rebound
}

/** Retain only explicit archive source/restored oracle files named by the raw report. */
export async function retainArchiveReferencedFiles({ report, evidenceDirectory, attemptDirectory }) {
  const specs = archiveReferenceSpecs(report)
  if (specs.length === 0) return []
  const evidenceRoot = await realpath(evidenceDirectory)
  const retained = []
  const names = new Set()
  for (const spec of specs) {
    const sourcePath = await resolveArchiveReferencePath(spec.value, evidenceRoot)
    const extension = safeArchiveReferenceExtension(sourcePath)
    const name = `archive-${spec.kind}-oracle${extension}`
    if (names.has(name)) throw new Error(`Archive ${spec.kind} oracle reference is duplicated.`)
    names.add(name)
    const destination = path.join(attemptDirectory, name)
    await copyFile(sourcePath, destination, constants.COPYFILE_EXCL)
    const copied = await hashCandidateFile(destination)
    const source = await hashCandidateFile(sourcePath)
    if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) {
      throw new Error(`Retained archive ${spec.kind} oracle differs from the producer reference.`)
    }
    retained.push({ kind: spec.kind, path: name, sha256: copied.sha256, bytes: copied.bytes })
  }
  return retained
}

/** Revalidate explicit archive oracle copies after the disposable runtime is gone. */
async function validateRetainedArchiveReferences({ report, receipt, attemptDirectory }) {
  const specs = archiveReferenceSpecs(report)
  const retained = receipt.archiveReferences
  if (specs.length === 0) {
    if (retained !== undefined && (!Array.isArray(retained) || retained.length !== 0)) {
      throw new Error('Retained package receipt contains unbound archive oracle files.')
    }
    return []
  }
  if (!Array.isArray(retained) || retained.length !== specs.length) {
    throw new Error('Retained package receipt is missing explicit archive oracle files.')
  }
  const checked = []
  const used = new Set()
  for (const spec of specs) {
    const name = `archive-${spec.kind}-oracle${safeArchiveReferenceExtension(spec.value)}`
    const entry = retained.find((candidate) => candidate?.kind === spec.kind && candidate?.path === name)
    if (!isRecord(entry) || used.has(entry.path)) throw new Error(`Retained archive ${spec.kind} oracle identity is incomplete.`)
    used.add(entry.path)
    const filename = await requireAttemptFile(attemptDirectory, entry.path, `archive ${spec.kind} oracle`)
    const identity = await hashCandidateFile(filename)
    if (identity.sha256 !== entry.sha256 || identity.bytes !== entry.bytes) {
      throw new Error(`Retained archive ${spec.kind} oracle bytes differ from its receipt.`)
    }
    checked.push({ kind: spec.kind, path: name, sha256: identity.sha256, bytes: identity.bytes })
  }
  return checked
}

/** Read only the explicitly supported archive source/restored path fields. */
function archiveReferenceSpecs(report) {
  const specs = []
  const definitions = report?.proofKind === 'packaged-large-archive-v1'
    ? FIELD_ARCHIVE_REFERENCE_FIELDS
    : ARCHIVE_REFERENCE_FIELDS
  for (const definition of definitions) {
    const container = definition.container === null ? report : report?.[definition.container]
    const value = container?.[definition.field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Archive ${definition.kind} oracle path is invalid.`)
    }
    specs.push({ kind: definition.kind, value })
  }
  return specs
}

/** Rebind field archive report paths to the flat retained attempt files. */
function rebindRetainedFieldArchiveReport(report, retained, attemptDirectory) {
  const rebound = structuredClone(report)
  const byKind = new Map(retained.map((entry) => [entry.kind, entry.path]))
  for (const definition of FIELD_ARCHIVE_REFERENCE_FIELDS) {
    const relative = byKind.get(definition.kind)
    if (relative === undefined) continue
    const container = rebound[definition.container]
    if (isRecord(container)) container[definition.field] = path.join(attemptDirectory, relative)
  }
  return rebound
}

/** Resolve one producer-reported archive path below the owned evidence directory. */
async function resolveArchiveReferencePath(value, evidenceRoot) {
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(evidenceRoot, value)
  const direct = await lstat(candidate)
  if (direct.isSymbolicLink() || !direct.isFile()) throw new Error('Archive oracle reference must be one regular non-symlink file.')
  const resolved = await realpath(candidate)
  if (!isInside(resolved, evidenceRoot)) throw new Error('Archive oracle reference escaped the producer evidence directory.')
  return resolved
}

/** Preserve a bounded harmless file extension without retaining the producer path. */
function safeArchiveReferenceExtension(filename) {
  const extension = path.extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : ''
}

/** Copy bounded UI screenshots into the flat attempt and return oracle-blind capture metadata. */
export async function retainCaptures(evidenceDirectories, attemptDirectory) {
  const captures = []
  const captureFailures = []
  const seen = new Set()
  for (const evidenceDirectory of evidenceDirectories) {
    let entries = []
    try { entries = await readdir(evidenceDirectory, { withFileTypes: true }) }
    catch { continue }
    for (const entry of entries) {
      if (!/\.(?:png|jpe?g|webp)$/iu.test(entry.name)) continue
      const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/gu, '_')
      const name = `package-ui-${safeName}`
      if (seen.has(name)) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'duplicate-capture-name' })
        continue
      }
      seen.add(name)
      const source = path.join(evidenceDirectory, entry.name)
      const destination = path.join(attemptDirectory, name)
      let sourceInfo
      try {
        sourceInfo = await lstat(source)
      } catch (error) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'capture-stat-failed', detail: safeErrorMessage(error) })
        continue
      }
      if (sourceInfo.isSymbolicLink()) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'capture-is-symlink' })
        continue
      }
      if (!sourceInfo.isFile()) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'capture-is-not-file' })
        continue
      }
      if (sourceInfo.size > MAX_CAPTURE_BYTES) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'capture-too-large', bytes: sourceInfo.size })
        continue
      }
      let bytes
      try {
        bytes = await readFile(source)
      } catch (error) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'capture-read-failed', detail: safeErrorMessage(error) })
        continue
      }
      if (!hasImageHeader(entry.name, bytes)) {
        captureFailures.push({ name, kind: 'ui-screenshot', status: 'INVALID_EVIDENCE', reason: 'invalid-image-header', bytes: bytes.byteLength })
        continue
      }
      await writeFile(destination, bytes, { flag: 'wx' })
      captures.push({ name, kind: 'ui-screenshot', path: destination, sha256: sha256(bytes), bytes: bytes.byteLength })
    }
  }
  return { captures, captureFailures }
}

/** Confirm a bounded image signature without decoding untrusted capture bytes. */
function hasImageHeader(filename, bytes) {
  if (bytes.byteLength < 4) return false
  if (/\.png$/iu.test(filename)) return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(bytes.subarray(0, 8))
  if (/\.jpe?g$/iu.test(filename)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.byteLength >= 12
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

/** Recompute the producer and process validators without accepting any embedded passed flag. */
function validateRuntimeObservations(observations, expected) {
  const failures = []
  if (!isRecord(observations) || observations.schema !== 'sartracker-package-runtime-observations-v1') {
    return { passed: false, failureReasons: ['Runtime observation schema is missing.'] }
  }
  if (!Array.isArray(observations.observations) || observations.observations.length === 0) {
    failures.push('No independently observed packaged main process was retained.')
  }
  if (observations.observationErrors !== undefined
      && (!Array.isArray(observations.observationErrors) || observations.observationErrors.length > 0)) {
    failures.push('Owned process observation errors were retained; runtime evidence is invalid.')
  }
  for (const observation of observations.observations ?? []) {
    try { validateRuntimeObservation(observation, expected) }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)) }
  }
  if (observations.proofMode !== expected.proofMode
      || observations.launchPath !== expected.launchPath
      || observations.artifactSha256 !== expected.artifactSha256
      || observations.executableSha256 !== expected.executableSha256
      || observations.asarSha256 !== expected.asarSha256) {
    failures.push('Retained runtime summary differs from the exact package identity.')
  }
  if (observations.zeroDescendantsAfterRun !== true
      || !Array.isArray(observations.descendantsAfterExit)
      || observations.descendantsAfterExit.length !== 0) {
    failures.push('Owned package process group did not prove zero descendants after run.')
  }
  return { passed: failures.length === 0, failureReasons: [...new Set(failures)] }
}

/** Summarize a prepared runtime without retaining working-directory implementation details. */
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

/** Return explicit bounded adapter gaps instead of upgrading a smoke to a contract claim. */
function scopeGaps(contractId, proofMode) {
  const gaps = [
    'producer validator provenance remains separate from the wrapper actual-process proof',
    'this adapter does not create field, release-publication, or operator-acceptance evidence',
    'raw producer and runtime oracle files are retained for revalidation; oracle-blind judge packets must carry captures only',
  ]
  if (contractId === 'C16') gaps.push('C16 producer is synthetic disposable settings only; no real provider or field machine path')
  if (['C03', 'C11', 'C17'].includes(contractId)) gaps.push(`${contractId} validates one fixed packaged C28 routine phase only; source/browser exhaustive corpus remains mandatory and composite family coverage is derived separately`)
  if (contractId === 'C05') gaps.push('C05 uses the deterministic loopback provider and synthetic two-device canonical-ingest path; exhaustive source/browser corpus and real-provider GET proof remain separate')
  if (contractId === 'C06') gaps.push('C06 uses a deterministic loopback provider and synthetic two-device attention path; field GPS distributions and operator acceptance remain separate')
  if (contractId === 'C18') gaps.push('C18 uses a copied storage-mission fixture and does not mutate the bound source fixture')
  if (contractId === 'C19') gaps.push('C19 covers fixed default-profile schema-v11 recovery, forced-kill, restart, large local/field envelopes, the twelve-schema migration matrix and shared C01 startup-boundary predicates; field operator acceptance remains separate, while DON-249/250/251 product capabilities remain explicit blockers')
  if (contractId === 'C15') gaps.push('C15 covers the existing synthetic offline map package and one fresh run directory; it does not qualify licensed/private map coverage or a field package')
  if (['C20', 'C22'].includes(contractId)) gaps.push(`C${contractId.slice(1)} covers the fixed field-archive-37gb lane with its 3.7GB source and 3.5GB ciphertext floors; smaller routine and paging-scale archive profiles remain separate package variants`)
  if (contractId === 'C23') gaps.push('C23 proves packaged IPC containment only; it does not establish field, release-publication, or operator acceptance')
  if (contractId === 'C13') gaps.push('C13 covers the fixed packaged coordinate golden vectors and one bearing persistence/render path; exhaustive coordinate corpus and field acceptance remain separate')
  if (contractId === 'C14') gaps.push('C14 covers one synthetic marker/drawing source-to-render identity, reversible visibility, basemap/focus transitions and injected overlay recovery; DON-264 remains open until persistent failure is operator-visible in the observed runtime')
  if (contractId === 'C21') gaps.push('C21 covers the bounded packaged archive-security mutation corpus; it does not claim full archive-family or field-custody coverage')
  if (contractId === 'C10') gaps.push('C10 covers the bounded synthetic large-geometry replay/archive parity lane and the fixed 201-outing eligible-GPX replay lane; it does not claim field geometry or whole-family coverage')
  if (contractId === 'C09') gaps.push('C09 retains exact 8 MiB boundary, durable copy/commit, duplicate, replacement, concurrent-write, and pending/retained forced-kill recovery observations through public IPC against the packaged Electron app PID; a separate mission-store sidecar remains source/integration evidence')
  if (contractId === 'C12') gaps.push('C12 covers the fixed synthetic marker kinds and attachment custody lane; it does not claim field corpus breadth, operator acceptance, or whole-family coverage')
  if (['C07', 'C08'].includes(contractId)) gaps.push(`${contractId} uses the reviewed packaged paging fixture profiles; rendered UI and field acceptance remain separate obligations`)
  if (proofMode === 'ci-appimage') gaps.push('AppImage producer hash is the launcher bytes; runtime executable hash is the underlying ELF')
  return Object.freeze(gaps)
}

/** Build a closed invalid producer-validation result when no raw report was retained. */
function invalidValidation(contractId, reason) {
  return Object.freeze({
    contractId,
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    failureReasons: Object.freeze([reason]),
    releaseEligible: false,
  })
}

/** Require a regular file below the immutable attempt directory. */
async function requireAttemptFile(attemptDirectory, relativePath, label) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error(`${label} path must be relative.`)
  const root = await realpath(attemptDirectory)
  const resolved = path.resolve(root, relativePath)
  if (!isInside(resolved, root)) throw new Error(`${label} path must remain inside the attempt directory.`)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`${label} must be a regular file.`)
  return resolved
}

/** Parse retained JSON bytes with a closed error boundary. */
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
}

/** Test a path containment boundary without following arbitrary user paths. */
function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Hash exact retained bytes. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Identify record-like values without accepting arrays as definition or receipt boundaries. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep capture-retention diagnostics bounded and free of absolute source paths. */
function safeErrorMessage(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : null
  return code !== null && /^[A-Z0-9_]+$/u.test(code) ? code : 'capture-operation-failed'
}
