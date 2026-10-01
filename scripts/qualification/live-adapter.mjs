import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { validateLiveExactReceipt } from './live-receipts.mjs'

const LIVE_ACCESS = 'GET_ONLY'
const CANDIDATE_ROLE = 'ci-appimage'
const RUNTIME_INPUT_SCHEMA = 'sartracker-bound-runtime-inputs-v1'
const VERSION_PATTERN = /^0\.1\.0-beta\.\d+(?:\.\d+)?$/u
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
// Historical command identity, kept so retained receipts still validate [DON-302].
const EXACT_COMMAND = Object.freeze(['node', 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'])
const PROCESS_SCHEMA = 'sartracker-live-process-v1'

/**
 * The packaged C05 live exact smoke (breadcrumb-live-exact-smoke.mjs) drove
 * Devices controls removed by DON-295 and was retired on 1 Oct 2026 (DON-302).
 * Team-smoke live-traccar supersedes it. New runs are refused visibly;
 * retained receipts still validate below.
 */
export async function executeLiveVariant() {
  throw new Error(
    'The packaged live exact smoke was retired on 1 Oct 2026 (DON-302). '
      + 'Run team-smoke live-traccar for the Live Traccar check instead.',
  )
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
  const processBytes = await readFile(processPath)
  const processEvidence = parseJsonBytes(processBytes, 'retained live process evidence')
  let validation
  try {
    validation = validateLiveExactReceipt(report, {
      artifactSha256: expected.artifact.sha256,
      version: expected.version,
    })
  } catch (error) {
    return invalidReceipt(receipt, reportPath, processPath, safeFailureReason(error, 'LIVE_REPORT_INVALID'))
  }
  const runtime = validateRetainedRuntimeSummary(receipt.observed?.runtime, expected.artifact.sha256)
  if (runtime === null) return invalidReceipt(receipt, reportPath, processPath, 'LIVE_RUNTIME_EXPECTATION_MISSING')
  const processFailure = validateProcessEvidence(processEvidence, runtime)
  if (processFailure !== null) return invalidReceipt(receipt, reportPath, processPath, processFailure)
  if (receipt.observed?.processSha256 !== sha256(processBytes)
      || receipt.observed?.processBytes !== processBytes.byteLength) {
    return invalidReceipt(receipt, reportPath, processPath, 'LIVE_PROCESS_HASH_MISMATCH')
  }
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

/** Validate only the allowlisted process cleanup facts retained by the adapter. */
function validateProcessEvidence(value, expectedRuntime) {
  const allowed = ['exitCode', 'ownedPidsAfterExit', 'outputOverflowed', 'processError', 'runtimeIdentityObserved', 'runtimeObservations', 'schema', 'signal', 'stderrBytes', 'stdoutBytes', 'timedOut', 'zeroDescendantsAfterRun']
  if (!value || typeof value !== 'object' || value.schema !== PROCESS_SCHEMA
      || Object.keys(value).sort().join(',') !== allowed.sort().join(',')
      || value.exitCode !== 0 || value.signal !== null || value.timedOut !== false || value.processError !== null
      || value.zeroDescendantsAfterRun !== true || value.outputOverflowed !== false
      || !Array.isArray(value.ownedPidsAfterExit) || value.ownedPidsAfterExit.length !== 0
      || !Number.isSafeInteger(value.stdoutBytes) || value.stdoutBytes < 0
      || !Number.isSafeInteger(value.stderrBytes) || value.stderrBytes < 0
      || value.runtimeIdentityObserved !== true || !Array.isArray(value.runtimeObservations)
      || value.runtimeObservations.length === 0 || !validRuntimeObservations(value.runtimeObservations, expectedRuntime)) return 'LIVE_RUNTIME_IDENTITY_MISSING'
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

/** Read one retained JSON file. */
async function readJson(filePath, label) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) }
  catch { throw new Error(`${label} is not valid retained JSON.`) }
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

/** Validate retained runtime observations without trusting a generic launched flag. */
function validRuntimeObservations(values, expected) {
  const seen = new Set()
  return values.every((value) => {
    if (!value || Object.keys(value).sort().join(',') !== 'appImagePath,artifactSha256,asarSha256,descendantOfRunner,executablePath,executableSha256,launchPath,mainProcess,pid,startTicks'
        || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.startTicks !== 'string'
        || !/^\d+$/u.test(value.startTicks) || value.artifactSha256 !== expected.artifactSha256
        || value.launchPath !== expected.launchPath || value.appImagePath !== expected.launchPath
        || !path.isAbsolute(value.executablePath) || !SHA256.test(value.executableSha256 ?? '')
        || value.executableSha256 !== expected.executableSha256 || value.asarSha256 !== expected.asarSha256
        || value.mainProcess !== true || value.descendantOfRunner !== true) return false
    const key = `${value.pid}:${value.startTicks}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Validate the sealed C05 runtime expectation before using it as an observation oracle. */
function validateRetainedRuntimeSummary(value, artifactSha256) {
  if (!value || value.proofMode !== 'ci-appimage' || value.artifactSha256 !== artifactSha256
      || value.installedExecutablePath !== null || typeof value.launchPath !== 'string'
      || !path.isAbsolute(value.launchPath) || path.basename(value.launchPath) !== 'candidate.AppImage'
      || !SHA256.test(value.executableSha256 ?? '') || !SHA256.test(value.asarSha256 ?? '')) return null
  return value
}

/** Parse exact retained bytes so the digest and the validated object share one read. */
function parseJsonBytes(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) }
  catch { throw new Error(`${label} is not valid retained JSON.`) }
}
