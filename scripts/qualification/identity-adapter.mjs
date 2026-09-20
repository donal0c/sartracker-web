import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  validateCiArtifactProvenance,
  validateInstalledPayload,
} from './candidate-artifacts.mjs'
import { verifyRuntimeInputs } from './runtime-inputs.mjs'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const VERSION = /^0\.1\.0-beta\.\d+(?:\.\d+)?$/u
const ROLES = Object.freeze(['ci-appimage', 'ci-deb'])
const REPOSITORY = 'donal0c/sartracker-web'

/**
 * Execute the C00 CI and installation identity inspection.
 *
 * This invokes the existing read-only runtime verifier in an owned work
 * directory. The result is deliberately scoped to CI/archive/installation
 * identity; it does not launch the application or claim runtime behaviour.
 *
 * @param {object} options adapter execution options
 * @returns {Promise<object>} deterministic execution receipt
 */
export async function executeIdentityVariant({ normalized, binding, attemptDirectory, workDirectory }) {
  const expected = compileIdentityExpectation(normalized)
  validateBinding(binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  const workRoot = await requireDirectory(workDirectory, 'work directory')
  const reportPath = path.join(attemptRoot, 'identity-report.json')
  await assertAbsent(reportPath)
  let runtime
  try {
    runtime = await verifyRuntimeInputs(normalized.runtimeInputs, normalized.identities.source, expected.version, workRoot)
    await writeRawMetadata(attemptRoot, runtime)
    const validation = independentlyValidateIdentity(runtime, expected)
    const report = {
      ...runtime,
      schema: 'sartracker-identity-report-v1',
      status: 'PASS',
      scope: 'ci-installation-identity-only',
      launchVerified: false,
      sourceSha: expected.sourceSha,
      version: expected.version,
      ciMetadata: runtime.ci.ciMetadata,
      validation,
    }
    await writeJsonExclusive(reportPath, report)
    return Object.freeze({ schema: 'sartracker-identity-receipt-v1', status: 'PASS',
      observed: { reportPath, validation }, evidence: ['identity-report.json', 'identity-ci-run.json', 'identity-ci-artifact.json'],
      reportPath, releaseEligible: false })
  } catch (error) {
    const message = errorMessage(error)
    const failure = {
      ...(runtime ?? {}),
      schema: 'sartracker-identity-report-v1',
      status: 'ERROR',
      scope: 'ci-installation-identity-only',
      launchVerified: false,
      sourceSha: expected.sourceSha,
      version: expected.version,
      error: message,
      ciMetadata: runtime?.ci?.ciMetadata,
    }
    await writeJsonExclusive(reportPath, failure).catch(() => undefined)
    return Object.freeze({ schema: 'sartracker-identity-receipt-v1', status: 'INVALID_EVIDENCE', reason: message,
      observed: { reportPath, error: message }, evidence: ['identity-report.json'], reportPath, releaseEligible: false })
  }
}

/**
 * Revalidate a retained identity report without rerunning CI, package tools,
 * or an application process.
 *
 * @param {object} receipt retained controller or adapter receipt
 * @param {object} binding contract binding
 * @param {object} context immutable definition and attempt directory
 * @returns {Promise<object>} independently revalidated receipt
 */
export async function validateRetainedIdentity(receipt, binding, { definition, attemptDirectory }) {
  const expected = compileIdentityExpectation(definition)
  validateBinding(binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Retained identity receipt is required.')
  const reportPath = receipt.reportPath ?? receipt.observed?.reportPath
  const retainedPath = await requirePathInside(reportPath, attemptRoot, 'retained identity report')
  const report = await readJson(retainedPath, 'retained identity report')
  if (report.status === 'ERROR') {
    if (receipt.status !== 'INVALID_EVIDENCE') throw new Error('Retained identity error report cannot support a passing receipt.')
    return Object.freeze({ ...receipt, reportPath: retainedPath, status: 'INVALID_EVIDENCE', releaseEligible: false,
      valid: false, passed: false,
      validation: Object.freeze({ status: 'INVALID_EVIDENCE', valid: false, passed: false, scope: 'ci-installation-identity-only', launchVerified: false, failureReasons: Object.freeze([report.error ?? 'Identity report failed.']) }) })
  }
  const validation = independentlyValidateReport(report, expected)
  if (receipt.status !== undefined && receipt.status !== validation.status) throw new Error('Retained identity status differs from independently validated evidence.')
  if (receipt.observed?.reportPath !== undefined && receipt.observed.reportPath !== retainedPath) throw new Error('Retained identity report path differs from the owned report.')
  if (receipt.validation?.status !== undefined && receipt.validation.status !== validation.status) throw new Error('Retained identity validation differs from independently validated evidence.')
  if (receipt.observed?.validation?.status !== undefined && receipt.observed.validation.status !== validation.status) throw new Error('Retained identity observation differs from independently validated evidence.')
  return Object.freeze({ ...receipt, reportPath: retainedPath, status: validation.status, valid: validation.valid, passed: validation.passed,
    validation, releaseEligible: false })
}

/** Compile exact CI, installer, and installed package identities from definition. */
function compileIdentityExpectation(normalized) {
  const sourceSha = normalized?.identities?.source?.sha
  const version = normalized?.identities?.candidate?.version
  const runtimeInputs = normalized?.runtimeInputs
  const config = runtimeInputs?.config
  const ci = config?.ci
  if (!SHA1.test(sourceSha ?? '') || !VERSION.test(version ?? '') || runtimeInputs?.schema !== 'sartracker-bound-runtime-inputs-v1') {
    throw new Error('C00 identity proof requires immutable source, candidate version, and bound runtime inputs.')
  }
  if (!ci || ci.version !== version || !ci.provenance || !Number.isSafeInteger(ci.provenance.runId)
      || !Number.isSafeInteger(ci.provenance.runAttempt) || !Number.isSafeInteger(ci.provenance.artifactId)
      || ci.provenance.sourceSha !== sourceSha || !fileIdentity(ci.archive)
      || !Array.isArray(ci.installers) || ci.installers.length !== 2
      || ci.installers.some((entry) => !ROLES.includes(entry.role) || !fileIdentity(entry))
      || new Set(ci.installers.map((entry) => entry.role)).size !== 2
      || typeof config.installedExecutablePath !== 'string' || !path.isAbsolute(config.installedExecutablePath)) {
    throw new Error('C00 identity proof requires exact CI archive, installer, and installed path identities.')
  }
  const artifacts = normalized.identities.candidate.artifacts
  if (!Array.isArray(artifacts) || ROLES.some((role) => artifacts.filter((entry) => entry.role === role).length !== 1)) {
    throw new Error('C00 identity proof requires one immutable candidate artifact per installer role.')
  }
  return Object.freeze({ sourceSha, version, runId: ci.provenance.runId, runAttempt: ci.provenance.runAttempt,
    artifactId: ci.provenance.artifactId, archive: ci.archive, installers: ci.installers,
    artifacts, installedExecutablePath: config.installedExecutablePath })
}

/** Validate the reviewed C00 identity binding and keep launch proof separate. */
function validateBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || binding.contractId !== 'C00' || binding.proofMode !== 'ci-appimage'
      || (binding.phase !== undefined && binding.phase !== 'prepublication')) {
    throw new Error('Identity binding must be the prepublication C00 ci-appimage variant.')
  }
}

/** Independently validate a fresh runtime verifier result against definition identities. */
function independentlyValidateIdentity(runtime, expected) {
  const validation = independentlyValidateReport({ ...runtime, status: 'PASS', sourceSha: expected.sourceSha, version: expected.version, scope: 'ci-installation-identity-only', launchVerified: false }, expected)
  return validation
}

/** Recompute all retained C00 identity predicates from raw metadata. */
function independentlyValidateReport(report, expected) {
  if (!report || report.schema !== 'sartracker-identity-report-v1' && report.schema !== 'sartracker-runtime-preflight-v1') throw new Error('Retained identity report schema is invalid.')
  if (report.status !== 'PASS' || report.scope !== 'ci-installation-identity-only'
      || report.sourceSha !== expected.sourceSha || report.version !== expected.version) throw new Error('Identity report scope or immutable candidate identity differs.')
  if (report.launchVerified !== false) throw new Error('C00 identity report must not claim application launch verification.')
  const run = report.ci?.ciMetadata?.run ?? report.ciMetadata?.run
  const artifact = report.ci?.ciMetadata?.artifact ?? report.ciMetadata?.artifact
  if (!run || !artifact) throw new Error('Retained report is missing raw CI run or artifact metadata.')
  const provenance = validateCiArtifactProvenance(run, artifact, expected)
  const ci = report.ci
  if (!ci || ci.schema !== 'sartracker-candidate-ci-artifacts-v1' || ci.version !== expected.version
      || !ci.provenance || ci.provenance.sourceSha !== expected.sourceSha || ci.provenance.runId !== expected.runId
      || ci.provenance.runAttempt !== expected.runAttempt || ci.provenance.artifactId !== expected.artifactId
      || ci.provenance.archiveSha256 !== provenance.archiveSha256 || ci.provenance.archiveBytes !== provenance.archiveBytes) {
    throw new Error('Retained CI provenance differs from the exact source/run/archive identity.')
  }
  if (!sameFileIdentity(ci.archive, expected.archive)
      || ci.archive.sha256 !== provenance.archiveSha256 || ci.archive.bytes !== provenance.archiveBytes) throw new Error('Retained CI ZIP identity differs from the immutable archive.')
  const expectedInstallers = expectedInstallersByRole(expected)
  if (!Array.isArray(ci.installers) || ci.installers.length !== 2 || new Set(ci.installers.map((entry) => entry.role)).size !== 2) throw new Error('Retained CI installer inventory is incomplete.')
  for (const role of ROLES) {
    const actual = ci.installers.find((entry) => entry.role === role)
    const configured = expectedInstallers[role]
    const candidate = expected.artifacts.find((entry) => entry.role === role)
    if (!actual || !sameFileIdentity(actual, configured) || !sameFileIdentity(actual, candidate)
        || path.basename(actual.path) !== path.basename(candidate.path)) throw new Error(`Retained ${role} installer identity differs from the definition.`)
  }
  const installation = report.installation
  const deb = expectedInstallers['ci-deb']
  if (!installation || installation.schema !== 'sartracker-candidate-installed-deb-v1'
      || !sameFileIdentity(installation.deb, deb) || installation.packageName !== 'sartracker-web'
      || installation.version !== expected.version || installation.architecture !== 'amd64') throw new Error('Retained installed Debian identity differs from the exact candidate.')
  const payloadExpected = installation.payloadExpected ?? report.payloadExpected
  if (!payloadExpected || !Array.isArray(payloadExpected.files)) throw new Error('Retained installation payload expectation is missing.')
  validateInstalledPayload(installation, payloadExpected)
  const installedPath = report.installedExecutablePath
  if (installedPath !== expected.installedExecutablePath) throw new Error('Retained installed executable path differs from the definition.')
  const relativeExecutable = installedPath.replace(/^\//u, '')
  if (!payloadExpected.files.some((entry) => entry.path === relativeExecutable && entry.sha256)
      || !installation.files.some((entry) => entry.path === relativeExecutable && entry.sha256)) throw new Error('Retained installed executable is not present in the verified payload.')
  return Object.freeze({ status: 'PASS', valid: true, passed: true, scope: 'ci-installation-identity-only', launchVerified: false,
    sourceSha: expected.sourceSha, version: expected.version, runId: expected.runId, runAttempt: expected.runAttempt,
    artifactId: expected.artifactId, archiveSha256: provenance.archiveSha256, archiveBytes: provenance.archiveBytes,
    installerSha256: Object.freeze(Object.fromEntries(ROLES.map((role) => [role, expectedInstallers[role].sha256]))),
    installedPayloadFiles: payloadExpected.files.length })
}

/** Return configured installer identities by role. */
function expectedInstallersByRole(expected) { return Object.fromEntries(expected.installers.map((entry) => [entry.role, entry])) }

/** Compare only immutable file identity fields, ignoring retained paths. */
function sameFileIdentity(left, right) { return left?.sha256 === right?.sha256 && left?.bytes === right?.bytes }

/** Validate a file identity shape. */
function fileIdentity(value) { return value && typeof value === 'object' && typeof value.path === 'string' && path.isAbsolute(value.path) && SHA256.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) && value.bytes > 0 }

/** Retain raw run and artifact metadata as separate flat attempt files. */
async function writeRawMetadata(attemptRoot, runtime) {
  const metadata = runtime.ci?.ciMetadata
  if (!metadata?.run || !metadata?.artifact) throw new Error('Runtime verifier did not retain raw CI metadata.')
  await writeJsonExclusive(path.join(attemptRoot, 'identity-ci-run.json'), metadata.run)
  await writeJsonExclusive(path.join(attemptRoot, 'identity-ci-artifact.json'), metadata.artifact)
}

/** Require a real absolute owned directory. */
async function requireDirectory(directory, label) {
  if (typeof directory !== 'string' || path.resolve(directory) !== directory) throw new Error(`${label} must be an absolute path.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory.`)
  return directory
}

/** Refuse replacement of retained evidence. */
async function assertAbsent(filename) {
  try { await lstat(filename); throw new Error(`Identity report already exists: ${filename}`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

/** Require a retained report path inside the owned attempt directory. */
async function requirePathInside(filename, root, label) {
  if (typeof filename !== 'string' || path.resolve(filename) !== filename) throw new Error(`${label} path is invalid.`)
  const resolved = path.resolve(filename)
  const rootResolved = path.resolve(root)
  if (resolved !== path.join(rootResolved, 'identity-report.json')) throw new Error(`${label} is outside the flat attempt report path.`)
  const info = await lstat(resolved)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file.`)
  return resolved
}

/** Parse a retained JSON file. */
async function readJson(filename, label) {
  try { return JSON.parse(await readFile(filename, 'utf8')) } catch (error) { throw new Error(`${label} is unavailable or invalid: ${error.message}`) }
}

/** Write append-only retained JSON. */
async function writeJsonExclusive(filename, value) { await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }) }

/** Convert unknown thrown values to a stable retained error. */
function errorMessage(error) { return error instanceof Error ? error.message : String(error) }
