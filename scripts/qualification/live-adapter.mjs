import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { validateLiveExactReceipt } from './live-receipts.mjs'
import { runOwnedProcess } from './owned-process.mjs'
import { hashLiveConfigDirectory } from './live-config-identity.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { observePackageProcesses, preparePackageRuntime } from './package-runtime.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIVE_SCRIPT = path.join(PROJECT_ROOT, 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs')
const LIVE_ACCESS = 'GET_ONLY'
const CANDIDATE_ROLE = 'ci-appimage'
const RUNTIME_INPUT_SCHEMA = 'sartracker-bound-runtime-inputs-v1'
const VERSION_PATTERN = /^0\.1\.0-beta\.\d+(?:\.\d+)?$/u
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const EXACT_COMMAND = Object.freeze(['node', 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'])
const PROCESS_SCHEMA = 'sartracker-live-process-v1'
const RECEIPT_SCHEMA = 'sartracker-live-receipt-v1'
const REPORT_SCHEMA = 'sartracker-live-report-v1'
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000
const CLEANUP_TIMEOUT_MS = 10_000
const TERMINATION_GRACE_MS = 5_000

/** Execute the reviewed packaged C05 live exact proof with a fixed GET-only boundary. */
export async function executeLiveVariant({ normalized, binding, attemptDirectory, workDirectory }) {
  const expected = compileLiveExpectation(normalized, binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  const workRoot = await requireDirectory(workDirectory, 'work directory')
  const reportPath = path.join(attemptRoot, 'live-report.json')
  const processPath = path.join(attemptRoot, 'live-process.json')
  const evidenceDirectory = path.join(workRoot, 'live-evidence')
  const privateVisualDirectory = path.join(workRoot, 'private-visual')
  await assertAbsent(reportPath)
  await assertAbsent(processPath)

  let processResult
  let report
  let reportValidation
  let reportBytes
  let failureCode = null
  let runtime
  try {
    const runtimeDirectory = path.join(workRoot, 'package-runtime')
    await verifyLiveFixtures(expected)
    runtime = await preparePackageRuntime({
      proofMode: 'ci-appimage',
      artifact: expected.artifact,
      version: expected.version,
      workDirectory: runtimeDirectory,
    })
    processResult = await runOwnedProcess({
      file: process.execPath,
      args: [LIVE_SCRIPT],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...runtime.environment,
        SMOKE_APP: runtime.launchPath,
        SMOKE_EVIDENCE: evidenceDirectory,
        SMOKE_PRIVATE_VISUAL_DIR: privateVisualDirectory,
        SMOKE_CONFIG_SOURCE: expected.liveConfig.path,
        SMOKE_TARGET_SELECTOR_FILE: expected.liveSelector.path,
        SMOKE_EXPECTED_VERSION: expected.version,
        SMOKE_EXPECTED_APP_SHA256: expected.artifact.sha256,
      },
      timeoutMs: PROCESS_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
      terminationGraceMs: TERMINATION_GRACE_MS,
      observe: ({ pid }) => observePackageProcesses(pid, {
        proofMode: runtime.proofMode,
        launchPath: runtime.launchPath,
        artifactSha256: runtime.artifactSha256,
        executableSha256: runtime.executableSha256,
        asarSha256: runtime.asarSha256,
      }),
    })
    try { await verifyLiveFixtures(expected) } catch { failureCode = 'LIVE_FIXTURE_CHANGED' }
    const summaryPath = path.join(evidenceDirectory, 'summary.json')
    const summary = await readJsonIfPresent(summaryPath)
    if (summary !== null) {
      try {
        reportValidation = validateLiveExactReceipt(summary, {
          artifactSha256: expected.artifact.sha256,
          version: expected.version,
        })
        report = summary
        reportBytes = jsonBytes(report)
      } catch {
        failureCode = 'LIVE_REPORT_INVALID'
      }
    } else {
      failureCode = 'LIVE_REPORT_MISSING'
    }
  } catch {
    failureCode = failureCode ?? 'LIVE_ADAPTER_FAILED'
  } finally {
    try { await removePrivateEvidence(privateVisualDirectory) } catch { failureCode = failureCode ?? 'PRIVATE_EVIDENCE_CLEANUP_FAILED' }
    try { await removePrivateEvidence(evidenceDirectory) } catch { failureCode = failureCode ?? 'LIVE_EVIDENCE_CLEANUP_FAILED' }
  }

  const safeProcess = retainProcessEvidence(processResult, failureCode)
  const passed = failureCode === null && report !== undefined && reportValidation?.status === 'PASS'
    && safeProcess.exitCode === 0 && safeProcess.signal === null && safeProcess.timedOut === false
    && safeProcess.processError === null && safeProcess.zeroDescendantsAfterRun === true
    && safeProcess.outputOverflowed === false && safeProcess.ownedPidsAfterExit.length === 0
    && safeProcess.runtimeIdentityObserved === true
  if (!passed) failureCode = failureCode ?? 'LIVE_PROCESS_FAILED'

  if (reportBytes === undefined) {
    report = { schema: REPORT_SCHEMA, status: 'ERROR', scope: 'packaged-live-get-only', errorCode: failureCode }
    reportBytes = jsonBytes(report)
  }
  const reportSha256 = sha256(reportBytes)
  const processBytes = jsonBytes(safeProcess)
  await writeJsonExclusive(reportPath, report)
  await writeJsonExclusive(processPath, safeProcess)
  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    status: passed ? 'PASS' : 'INVALID_EVIDENCE',
    observed: {
      reportPath,
      processPath,
      reportSha256,
      process: safeProcess,
      validation: passed ? reportValidation : { status: 'INVALID_EVIDENCE', failureReasons: [failureCode] },
      scope: 'packaged-live-get-only',
      sourceSha: expected.sourceSha,
      artifactSha256: expected.artifact.sha256,
      version: expected.version,
    },
    evidence: ['live-report.json', 'live-process.json'],
    reportPath,
    processPath,
    releaseEligible: false,
    reportBytes: reportBytes.byteLength,
    processBytes: processBytes.byteLength,
  })
}

/** Revalidate retained C05 live evidence, including process cleanup and report identity. */
export async function validateRetainedLive(receipt, binding, { definition, attemptDirectory }) {
  const expected = compileLiveExpectation(definition, binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Retained live receipt is required.')
  rejectPrivateReceiptFields(receipt)
  const reportPath = await requirePathInside(receipt.reportPath ?? receipt.observed?.reportPath, attemptRoot, 'retained live report', 'live-report.json')
  const processPath = await requirePathInside(receipt.processPath ?? receipt.observed?.processPath, attemptRoot, 'retained live process evidence', 'live-process.json')
  const report = await readJson(reportPath, 'retained live report')
  const processEvidence = await readJson(processPath, 'retained live process evidence')
  let validation
  try {
    validation = validateLiveExactReceipt(report, {
      artifactSha256: expected.artifact.sha256,
      version: expected.version,
    })
  } catch (error) {
    return invalidReceipt(receipt, reportPath, processPath, safeFailureReason(error, 'LIVE_REPORT_INVALID'))
  }
  const processFailure = validateProcessEvidence(processEvidence, expected.artifact.sha256)
  if (processFailure !== null) return invalidReceipt(receipt, reportPath, processPath, processFailure)
  const actualReportSha256 = sha256(jsonBytes(report))
  if (receipt.observed?.reportSha256 !== undefined && receipt.observed.reportSha256 !== actualReportSha256) {
    return invalidReceipt(receipt, reportPath, processPath, 'LIVE_REPORT_HASH_MISMATCH')
  }
  if (receipt.status !== undefined && receipt.status !== 'PASS') {
    return invalidReceipt(receipt, reportPath, processPath, 'LIVE_RECEIPT_STATUS_MISMATCH')
  }
  if (receipt.observed?.validation?.status !== undefined && receipt.observed.validation.status !== validation.status) {
    return invalidReceipt(receipt, reportPath, processPath, 'LIVE_VALIDATION_STATUS_MISMATCH')
  }
  if (receipt.observed?.scope !== undefined && receipt.observed.scope !== 'packaged-live-get-only') {
    return invalidReceipt(receipt, reportPath, processPath, 'LIVE_SCOPE_MISMATCH')
  }
  return Object.freeze({
    ...receipt,
    reportPath,
    processPath,
    status: 'PASS',
    valid: true,
    passed: true,
    validation: { ...validation, valid: true, passed: true },
    process: processEvidence,
    reportSha256: actualReportSha256,
    releaseEligible: false,
  })
}

/** Compile the immutable C05 candidate, fixture and permission identities. */
function compileLiveExpectation(normalized, binding) {
  validateBinding(binding)
  const sourceSha = normalized?.identities?.source?.sha
  const version = normalized?.identities?.candidate?.version
  const runtimeInputs = normalized?.runtimeInputs
  const config = runtimeInputs?.config
  if (runtimeInputs?.schema !== RUNTIME_INPUT_SCHEMA || !SHA1.test(sourceSha ?? '') || !VERSION_PATTERN.test(version ?? '')) {
    throw new Error('C05 live proof requires immutable source, candidate version and bound runtime inputs.')
  }
  const artifacts = normalized?.identities?.candidate?.artifacts
  const candidateArtifacts = Array.isArray(artifacts) ? artifacts.filter((entry) => entry?.role === CANDIDATE_ROLE) : []
  if (candidateArtifacts.length !== 1 || !fileIdentity(candidateArtifacts[0])) {
    throw new Error('C05 live proof requires one exact CI AppImage identity.')
  }
  const fixtures = config?.fixtures
  const liveConfig = fixtures?.['live-config']
  const liveSelector = fixtures?.['live-selector']
  if (!fileIdentity(liveConfig) || !fileIdentity(liveSelector)) {
    throw new Error('C05 live proof requires immutable live-config and live-selector fixture roles.')
  }
  const compiledFixtures = runtimeInputs.fixtures
  for (const [role, fixture] of [['live-config', liveConfig], ['live-selector', liveSelector]]) {
    const compiled = compiledFixtures?.[role]
    if (compiled !== undefined && !sameFileIdentity(compiled, fixture)) throw new Error(`C05 ${role} identity differs from bound runtime inputs.`)
  }
  return Object.freeze({
    sourceSha,
    version,
    artifact: candidateArtifacts[0],
    liveConfig,
    liveSelector,
  })
}

/** Validate the fixed C05 GET-only permission and direct smoke command. */
function validateBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || binding.contractId !== 'C05' || binding.proofMode !== 'ci-appimage'
      || binding.liveAccess !== LIVE_ACCESS
      || (binding.phase !== undefined && binding.phase !== 'prepublication')) {
    throw new Error('C05 live binding requires immutable prepublication GET_ONLY permission.')
  }
  if (binding.command !== undefined && (!Array.isArray(binding.command)
      || binding.command.length !== EXACT_COMMAND.length
      || binding.command.some((value, index) => value !== EXACT_COMMAND[index]))) {
    throw new Error('C05 live binding command is not the reviewed exact live smoke command.')
  }
}

/** Keep process outcome facts while excluding arbitrary stdout, stderr and environment values. */
function retainProcessEvidence(processResult, failureCode) {
  const runtimeObservations = sanitizeRuntimeObservations(processResult?.observationResults)
  return {
    schema: PROCESS_SCHEMA,
    exitCode: processResult?.exitCode ?? null,
    signal: processResult?.signal ?? null,
    timedOut: processResult?.timedOut === true,
    processError: processResult?.processError === null && failureCode === null ? null : (processResult ? 'OWNED_PROCESS_FAILED' : 'PROCESS_NOT_STARTED'),
    zeroDescendantsAfterRun: processResult?.zeroDescendantsAfterRun === true,
    ownedPidsAfterExit: Array.isArray(processResult?.ownedPidsAfterExit) ? processResult.ownedPidsAfterExit.filter((value) => Number.isSafeInteger(value) && value > 0) : [],
    outputOverflowed: processResult?.outputOverflowed === true,
    stdoutBytes: Buffer.byteLength(processResult?.stdout ?? '', 'utf8'),
    stderrBytes: Buffer.byteLength(processResult?.stderr ?? '', 'utf8'),
    runtimeIdentityObserved: runtimeObservations.length > 0,
    runtimeObservations,
  }
}

/** Validate only the allowlisted process cleanup facts retained by the adapter. */
function validateProcessEvidence(value, expectedArtifactSha256) {
  const allowed = ['exitCode', 'ownedPidsAfterExit', 'outputOverflowed', 'processError', 'runtimeIdentityObserved', 'runtimeObservations', 'schema', 'signal', 'stderrBytes', 'stdoutBytes', 'timedOut', 'zeroDescendantsAfterRun']
  if (!value || typeof value !== 'object' || value.schema !== PROCESS_SCHEMA
      || Object.keys(value).sort().join(',') !== allowed.sort().join(',')
      || value.exitCode !== 0 || value.signal !== null || value.timedOut !== false || value.processError !== null
      || value.zeroDescendantsAfterRun !== true || value.outputOverflowed !== false
      || !Array.isArray(value.ownedPidsAfterExit) || value.ownedPidsAfterExit.length !== 0
      || !Number.isSafeInteger(value.stdoutBytes) || value.stdoutBytes < 0
      || !Number.isSafeInteger(value.stderrBytes) || value.stderrBytes < 0
      || value.runtimeIdentityObserved !== true || !Array.isArray(value.runtimeObservations)
      || value.runtimeObservations.length === 0 || !validRuntimeObservations(value.runtimeObservations, expectedArtifactSha256)) return 'LIVE_RUNTIME_IDENTITY_MISSING'
  return null
}

/** Return a bounded invalid receipt without copying untrusted report fields. */
function invalidReceipt(receipt, reportPath, processPath, reason) {
  return Object.freeze({
    ...receipt,
    reportPath,
    processPath,
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    validation: { status: 'INVALID_EVIDENCE', valid: false, passed: false, failureReasons: [reason] },
    releaseEligible: false,
  })
}

/** Reject receipt fields that could retain credentials, private screenshots or raw process output. */
function rejectPrivateReceiptFields(value) {
  const forbidden = /(?:credential|password|secret|token|private.*(?:path|screenshot)|screenshot.*path|raw(?:Stdout|Stderr)|^(?:stdout|stderr)$)/iu
  const walk = (current) => {
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.test(key)) throw new Error('Retained live receipt contains private or unbounded evidence.')
      if (child && typeof child === 'object') walk(child)
    }
  }
  walk(value)
}

/** Ensure a retained path is a real regular file below the owned attempt directory. */
async function requirePathInside(value, attemptRoot, label, expectedBasename) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`)
  const resolved = path.resolve(value)
  const relative = path.relative(attemptRoot, resolved)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || path.dirname(resolved) !== attemptRoot || (expectedBasename !== undefined && path.basename(resolved) !== expectedBasename)) {
    throw new Error(`${label} must be a flat file directly inside the owned attempt directory.`)
  }
  const info = await lstat(resolved)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`)
  return resolved
}

/** Require a real owned directory. */
async function requireDirectory(directory, label) {
  if (typeof directory !== 'string' || path.resolve(directory) !== directory) throw new Error(`${label} must be an absolute path.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory.`)
  return directory
}

/** Ensure a retained path has not already been created by another owner. */
async function assertAbsent(filePath) {
  try {
    await lstat(filePath)
    throw new Error(`Retained file already exists: ${path.basename(filePath)}.`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/** Read JSON only when a producer report exists. */
async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

/** Read one retained JSON file. */
async function readJson(filePath, label) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) }
  catch { throw new Error(`${label} is not valid retained JSON.`) }
}

/** Remove private screenshot and live-provider work products after the report is read. */
async function removePrivateEvidence(directory) {
  await rm(directory, { recursive: true, force: true })
}

/** Write one flat retained JSON artifact without overwriting another producer. */
async function writeJsonExclusive(filePath, value) {
  await writeFile(filePath, jsonBytes(value), { flag: 'wx', mode: 0o600 })
}

/** Serialize bounded JSON bytes deterministically. */
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8') }

/** Hash retained bytes without exposing their contents. */
function sha256(value) { return createHash('sha256').update(value).digest('hex') }

/** Compare immutable fixture or artifact identity without retaining source paths. */
function sameFileIdentity(left, right) { return left?.sha256 === right?.sha256 && left?.bytes === right?.bytes }

/** Validate a fixed path/hash/byte identity. */
function fileIdentity(value) {
  return value && typeof value === 'object' && typeof value.path === 'string' && path.isAbsolute(value.path)
    && SHA256.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) && value.bytes > 0
}

/** Convert an internal validation failure to a bounded non-secret reason. */
function safeFailureReason(error, fallback) {
  const message = error instanceof Error ? error.message : ''
  if (/live|stage|identity|evidence|candidate|report/iu.test(message)) return message.slice(0, 160)
  return fallback
}

/** Rehash the private live fixture inputs before and after the producer run. */
async function verifyLiveFixtures(expected) {
  for (const [role, fixture] of [['live-config', expected.liveConfig], ['live-selector', expected.liveSelector]]) {
    const actual = role === 'live-config' ? await hashLiveConfigDirectory(fixture.path) : await hashCandidateFile(fixture.path)
    if (actual.sha256 !== fixture.sha256 || actual.bytes !== fixture.bytes) throw new Error('Live fixture identity changed.')
  }
}

/** Retain only process IDs, ticks and independently hashed package identities. */
function sanitizeRuntimeObservations(values) {
  const unique = new Map()
  for (const group of Array.isArray(values) ? values : []) {
    for (const value of Array.isArray(group) ? group : []) {
      if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.startTicks !== 'string'
          || !/^\d+$/u.test(value.startTicks) || !SHA256.test(value.artifactSha256 ?? '')
          || !SHA256.test(value.executableSha256 ?? '') || !SHA256.test(value.asarSha256 ?? '')
          || value.mainProcess !== true || value.descendantOfRunner !== true) continue
      const item = { pid: value.pid, startTicks: value.startTicks, artifactSha256: value.artifactSha256,
        executableSha256: value.executableSha256, asarSha256: value.asarSha256,
        mainProcess: true, descendantOfRunner: true }
      unique.set(`${item.pid}:${item.startTicks}`, item)
    }
  }
  return [...unique.values()].sort((left, right) => left.pid - right.pid || left.startTicks.localeCompare(right.startTicks))
}

/** Validate retained runtime observations without trusting a generic launched flag. */
function validRuntimeObservations(values, expectedArtifactSha256) {
  const seen = new Set()
  return values.every((value) => {
    if (!value || Object.keys(value).sort().join(',') !== 'artifactSha256,asarSha256,descendantOfRunner,executableSha256,mainProcess,pid,startTicks'
        || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.startTicks !== 'string'
        || !/^\d+$/u.test(value.startTicks) || value.artifactSha256 !== expectedArtifactSha256
        || !SHA256.test(value.executableSha256 ?? '') || !SHA256.test(value.asarSha256 ?? '')
        || value.mainProcess !== true || value.descendantOfRunner !== true) return false
    const key = `${value.pid}:${value.startTicks}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
