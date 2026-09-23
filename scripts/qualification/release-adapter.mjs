import { execFile as execFileCallback } from 'node:child_process'
import { streamCommandToFile } from './release-transfer.mjs'
import { releaseCiExpectation, validateReleaseCiEvidence } from './release-ci.mjs'
import { assessRepositoryControls, collectRepositoryControls } from './repository-controls.mjs'
import { validateRepositoryRiskDecision } from './repository-risk.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { lstat, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertQualifiedAssets,
  assertReleaseAssetMetadata,
  assertReleaseUnchanged,
  parseSha256Manifest,
  peelGitHubTagToCommit,
  validateQualificationBody,
  validateRegressionRecord,
  validateReleaseProvenance,
} from '../../build/electron-release-lib.js'
import {
  validateExpectedIdentity,
  validateReleaseDownloadEvidence,
} from './release-receipts.mjs'
import { candidateProductCapabilityResiduals } from './product-capabilities.mjs'

const execFile = promisify(execFileCallback)
const REPOSITORY = 'donal0c/sartracker-web'
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`
const DOWNLOAD_ROOT = `https://github.com/${REPOSITORY}/releases/download`
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_JSON_BYTES = 16 * 1024 * 1024
const COMMAND_TIMEOUT = 120_000
const SHA256 = /^[a-f0-9]{64}$/u
const SHA1 = /^[a-f0-9]{40}$/u
const RELEASE_ASSET = /^[A-Za-z0-9._-]+\.(?:AppImage|deb)$/u

/**
 * Compile the fixed, read-only GitHub operations for one release variant.
 *
 * The returned plan is an inspection plan rather than an executable command
 * supplied by a campaign file. C27 includes the candidate draft and the
 * previously qualified public rollback; C00 includes only fresh public bytes.
 *
 * @param {object} options release binding options
 * @returns {object} immutable read-only operation plan
 */
export function buildReleaseRequestPlan({ normalized, binding }) {
  const compiled = compileExpectedReleaseInputs(normalized)
  const variant = validateBinding(binding)
  const operations = []
  const addVariant = (expected, phase, auth, prefix) => {
    addMetadataOperations(operations, expected, auth, prefix)
    addTagOperations(operations, expected, auth, prefix)
    for (const asset of [...expected.assets, { name: 'SHA256SUMS' }]) {
      const url = `${DOWNLOAD_ROOT}/${expected.tag}/${encodeURIComponent(asset.name)}`
      operations.push(Object.freeze({
        kind: 'download',
        auth,
        repository: REPOSITORY,
        releaseId: expected.releaseId,
        tag: expected.tag,
        phase,
        prefix,
        assetName: asset.name,
        url,
        command: auth === 'authenticated-draft-api'
          ? Object.freeze(['gh', 'api', `repos/${REPOSITORY}/releases/assets/{assetId}`, '--header', 'Accept: application/octet-stream'])
          : undefined,
      }))
    }
  }
  if (variant === 'c27') {
    addVariant(compiled.expected, 'prepublication', 'authenticated-draft-api', 'candidate')
    addVariant(compiled.rollbackExpected, 'postpublication', 'unauthenticated-public', 'rollback')
  } else {
    addVariant(compiled.expected, 'postpublication', 'unauthenticated-public', 'candidate')
  }
  return deepFreeze({ schema: 'sartracker-release-request-plan-v1', phase: variant === 'c27' ? 'prepublication' : 'postpublication', expected: compiled.expected,
    rollbackExpected: variant === 'c27' ? compiled.rollbackExpected : undefined, operations })
}

/**
 * Execute one fixed C27 or C00 release inspection, retaining raw metadata and
 * exact transfer facts under the owned attempt directory.
 *
 * No publication, tag, deletion, installation, or arbitrary command is
 * accepted. Draft reads use the authenticated gh API; public reads use native
 * unauthenticated HTTPS requests so local gh credentials cannot satisfy C00.
 *
 * @param {object} options adapter execution options
 * @returns {Promise<object>} deterministic execution receipt
 */
export async function executeReleaseVariant({ normalized, binding, attemptDirectory, workDirectory }) {
  const compiled = compileExpectedReleaseInputs(normalized)
  const variant = validateBinding(binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  const workRoot = await requireDirectory(workDirectory, 'work directory')
  const reportPath = path.join(attemptRoot, 'release-report.json')
  await assertAbsent(reportPath)
  try {
    const repositoryControls = variant === 'c27' ? await collectRepositoryControls(compiled.expected.sourceSha, readGhJson) : undefined
    if (repositoryControls) await writeJsonExclusive(path.join(attemptRoot, 'repository-controls-before.json'), repositoryControls)
    const releaseCi = variant === 'c27' ? await readReleaseCi(normalized, attemptRoot, 'release-ci.json') : undefined
    const candidate = await inspectRelease({
      expected: compiled.expected,
      phase: variant === 'c27' ? 'prepublication' : 'postpublication',
      auth: variant === 'c27' ? 'authenticated-draft-api' : 'unauthenticated-public',
      prefix: 'candidate',
      attemptRoot,
      workRoot,
    })
    const rollback = variant === 'c27'
      ? await inspectRelease({ expected: compiled.rollbackExpected, phase: 'postpublication', auth: 'unauthenticated-public', prefix: 'rollback', attemptRoot, workRoot })
      : undefined
    const releaseCiAfter = variant === 'c27' ? await readReleaseCi(normalized, attemptRoot, 'release-ci-after.json') : undefined
    const repositoryControlsAfter = variant === 'c27' ? await collectRepositoryControls(compiled.expected.sourceSha, readGhJson) : undefined
    if (repositoryControlsAfter) await writeJsonExclusive(path.join(attemptRoot, 'repository-controls-after.json'), repositoryControlsAfter)
    const riskInputs = variant === 'c27' ? await readRiskInputs(normalized) : {}
    const report = { schema: 'sartracker-release-download-report-v1', ...candidate.report, rollback: rollback?.report, releaseCi, releaseCiAfter,
      claimScope: normalized.claimScope,
      notClaimedCapabilities: candidateProductCapabilityResiduals(normalized.mode, normalized.claimScope),
      repositoryControls, repositoryControlsAfter, ...riskInputs }
    await writeJsonExclusive(reportPath, report)
    const repositoryDecision = variant === 'c27' ? assessReleaseControls(report, compiled.expected, riskInputs.riskAuthority) : undefined
    const validation = validateReleaseDownloadEvidence(candidate.report, compiled.expected)
    const rollbackValidation = rollback === undefined ? undefined
      : validateReleaseDownloadEvidence(rollback.report, compiled.rollbackExpected)
    return Object.freeze({
      schema: 'sartracker-release-receipt-v1',
      status: repositoryDecision?.status ?? 'PASS',
      observed: { reportPath, validation, rollbackValidation, expected: compiled.expected, rollbackExpected: rollback?.expected },
      evidence: [path.basename(reportPath), ...candidate.evidence, ...(rollback?.evidence ?? [])],
      reportPath,
      releaseEligible: false,
    })
  } catch (error) {
    const failure = { schema: 'sartracker-release-download-report-v1', status: 'ERROR', phase: variant === 'c27' ? 'prepublication' : 'postpublication', error: errorMessage(error) }
    await writeJsonExclusive(reportPath, failure).catch(() => undefined)
    return Object.freeze({
      schema: 'sartracker-release-receipt-v1',
      status: 'INVALID_EVIDENCE',
      reason: failure.error,
      observed: { reportPath, error: failure.error, expected: compiled.expected, rollbackExpected: variant === 'c27' ? compiled.rollbackExpected : undefined },
      evidence: [path.basename(reportPath)],
      reportPath,
      releaseEligible: false,
    })
  }
}

/**
 * Recompute retained release evidence from the raw report and immutable
 * definition. Process success or a stored PASS field is never sufficient.
 *
 * @param {object} receipt retained controller receipt or adapter observation
 * @param {object} binding contract binding
 * @param {object} context immutable definition and attempt directory
 * @returns {Promise<object>} independently revalidated receipt
 */
export async function validateRetainedRelease(receipt, binding, { definition, attemptDirectory }) {
  const compiled = compileExpectedReleaseInputs(definition)
  const variant = validateBinding(binding)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Retained release receipt is required.')
  const reportPath = receipt.reportPath ?? receipt.observed?.reportPath
  if (reportPath !== path.join(attemptRoot, 'release-report.json')) throw new Error('Retained release report must be the exact flat attempt file.')
  const retainedPath = await requirePathInside(reportPath, attemptRoot, 'retained release report')
  const report = await readJson(retainedPath, 'retained release report')
  if (report.status === 'ERROR') {
    if (receipt.status !== 'INVALID_EVIDENCE') throw new Error('Retained release error report cannot support a passing receipt.')
    return Object.freeze({ ...receipt, reportPath: retainedPath, status: 'INVALID_EVIDENCE', releaseEligible: false,
      validation: Object.freeze({ status: 'INVALID_EVIDENCE', valid: false, passed: false, failureReasons: Object.freeze([report.error ?? 'Release report failed.']) }) })
  }
  if (JSON.stringify(report.claimScope) !== JSON.stringify(definition.claimScope)
      || JSON.stringify(report.notClaimedCapabilities)
        !== JSON.stringify(candidateProductCapabilityResiduals(definition.mode, definition.claimScope))) {
    throw new Error('Retained C27/C00 report does not preserve the exact candidate claim scope.')
  }
  const expectedPhase = variant === 'c27' ? 'prepublication' : 'postpublication'
  if (report.phase !== expectedPhase) throw new Error('Retained release report phase differs from its binding.')
  assertReleaseMetadata(report.before, compiled.expected, expectedPhase, report.tagBefore)
  assertReleaseMetadata(report.after, compiled.expected, expectedPhase, report.tagAfter)
  const validation = validateReleaseDownloadEvidence(report, compiled.expected)
  let rollbackValidation
  let repositoryDecision
  if (variant === 'c27') {
    const riskInputs = await readRiskInputs(definition)
    if (JSON.stringify(report.riskAuthority) !== JSON.stringify(riskInputs.riskAuthority)
        || JSON.stringify(report.riskAcceptance) !== JSON.stringify(riskInputs.riskAcceptance)) throw new Error('Retained repository risk inputs differ from the immutable handoff.')
    repositoryDecision = assessReleaseControls(report, compiled.expected, riskInputs.riskAuthority)
    validateReleaseCiEvidence(report.releaseCi, releaseCiExpectation(definition))
    validateReleaseCiEvidence(report.releaseCiAfter, releaseCiExpectation(definition))
    if (!report.rollback || typeof report.rollback !== 'object') throw new Error('C27 retained release report is missing rollback evidence.')
    assertReleaseMetadata(report.rollback.before, compiled.rollbackExpected, 'postpublication', report.rollback.tagBefore)
    assertReleaseMetadata(report.rollback.after, compiled.rollbackExpected, 'postpublication', report.rollback.tagAfter)
    rollbackValidation = validateReleaseDownloadEvidence(report.rollback, compiled.rollbackExpected)
  }
  const status = validation.status === 'PASS' && (rollbackValidation === undefined || rollbackValidation.status === 'PASS')
    ? repositoryDecision?.status ?? 'PASS' : 'INVALID_EVIDENCE'
  if (receipt.status !== undefined && receipt.status !== status) throw new Error('Retained release status differs from independently validated evidence.')
  if (receipt.observed?.reportPath !== undefined && receipt.observed.reportPath !== retainedPath) throw new Error('Retained release report path differs from the owned report.')
  if (receipt.validation?.status !== undefined && receipt.validation.status !== validation.status) throw new Error('Retained release validation differs from independently validated evidence.')
  if (receipt.rollbackValidation?.status !== undefined && receipt.rollbackValidation.status !== rollbackValidation?.status) throw new Error('Retained rollback validation differs from independently validated evidence.')
  if (receipt.observed?.validation?.status !== undefined && receipt.observed.validation.status !== validation.status) throw new Error('Retained release observation differs from independently validated evidence.')
  if (receipt.observed?.rollbackValidation?.status !== undefined && receipt.observed.rollbackValidation.status !== rollbackValidation?.status) throw new Error('Retained rollback observation differs from independently validated evidence.')
  return Object.freeze({ ...receipt, reportPath: retainedPath, status, releaseEligible: false, validation,
    rollbackValidation, repositoryDecision, expected: compiled.expected, rollbackExpected: variant === 'c27' ? compiled.rollbackExpected : undefined })
}

/** Read optional independently pinned public authority and signed decision, never incoming self-nominated keys. */
async function readRiskInputs(definition) {
  const fixtures = definition.runtimeInputs?.fixtures ?? {}
  const output = {}
  for (const [role, key] of [['release-risk-authority', 'riskAuthority'], ['release-risk-acceptance', 'riskAcceptance']]) {
    const declared = fixtures[role]
    if (!declared) continue
    if (declared.bytes > 32 * 1024) throw new Error('Repository risk input exceeds its bounded size.')
    const actual = await hashCandidateFile(declared.path)
    if (actual.sha256 !== declared.sha256 || actual.bytes !== declared.bytes) throw new Error('Repository risk input changed after campaign compilation.')
    output[key] = await readJson(actual.path, 'repository risk input')
    if (key === 'riskAuthority') {
      const trusted = definition.releaseInputs?.riskAuthorityPublicKeySha256
      if (!SHA256.test(trusted ?? '') || output[key]?.publicKeySha256 !== trusted) {
        throw new Error('Repository risk authority is not bound to the reviewed public-key digest.')
      }
    }
    const after = await hashCandidateFile(actual.path)
    if (after.sha256 !== actual.sha256 || after.bytes !== actual.bytes) throw new Error('Repository risk input changed during read.')
  }
  return output
}

/** Recompute both fresh observations; any newly observed gap needs its own explicit acceptance. */
function assessReleaseControls(report, expected, authority) {
  const decisions = [report.repositoryControls, report.repositoryControlsAfter].map(facts => {
    const assessment = assessRepositoryControls(facts, expected.sourceSha)
    return validateRepositoryRiskDecision({ gaps: assessment.gaps, expected, observedAt: facts.observedAt,
      authority, acceptance: report.riskAcceptance })
  })
  return { status: decisions.every(decision => decision.status === 'PASS') ? 'PASS' : 'NEEDS_HUMAN_DECISION',
    observations: decisions, releaseEligible: false }
}

/** Retain fresh tag CI metadata before checking it, so failed admission remains inspectable. */
async function readReleaseCi(definition, attemptRoot, filename) {
  const expected = releaseCiExpectation(definition)
  const evidence = {
    run: await readGhJson(`repos/${REPOSITORY}/actions/runs/${expected.runId}`),
    artifact: await readGhJson(`repos/${REPOSITORY}/actions/artifacts/${expected.artifactId}`),
  }
  await writeJsonExclusive(path.join(attemptRoot, filename), evidence)
  validateReleaseCiEvidence(evidence, expected)
  return evidence
}

/** Compile candidate and rollback identities from the immutable definition. */
function compileExpectedReleaseInputs(normalized) {
  const releaseInputs = normalized?.releaseInputs
  const sourceSha = normalized?.identities?.source?.sha
  if (!SHA1.test(sourceSha ?? '')) throw new Error('Release adapter requires the immutable source SHA.')
  if (!releaseInputs || typeof releaseInputs !== 'object' || Array.isArray(releaseInputs)) throw new Error('Release inputs are required.')
  const artifacts = normalized?.identities?.candidate?.artifacts
  if (!Array.isArray(artifacts)) throw new Error('Candidate artifact identities are required for release proof.')
  const assets = ['ci-appimage', 'ci-deb'].map((role) => {
    const matches = artifacts.filter((artifact) => (artifact?.role ?? artifact?.kind) === role)
    if (matches.length !== 1) throw new Error(`Exactly one ${role} candidate artifact is required.`)
    const artifact = matches[0]
    const name = path.basename(artifact.path ?? '')
    if (!RELEASE_ASSET.test(name) || !SHA256.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new Error(`Candidate ${role} artifact identity is incomplete.`)
    }
    return { name, sha256: artifact.sha256, bytes: artifact.bytes }
  })
  const expected = {
    releaseId: releaseInputs.releaseId,
    tag: releaseInputs.tag,
    sourceSha,
    assets,
    ...(releaseInputs.riskAuthorityPublicKeySha256 === undefined
      ? {}
      : { riskAuthorityPublicKeySha256: releaseInputs.riskAuthorityPublicKeySha256 }),
  }
  validateExpectedIdentity(expected)
  const rollback = structuredClone(releaseInputs.rollback)
  validateExpectedIdentity(rollback)
  return Object.freeze({ expected: deepFreeze(expected), rollbackExpected: deepFreeze(rollback) })
}

/** Validate exactly the two reviewed release bindings. */
function validateBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error('Release binding is required.')
  const phase = binding.phase ?? 'prepublication'
  if (binding.contractId === 'C27' && phase === 'prepublication' && binding.proofMode === 'ci-appimage') return 'c27'
  if (binding.contractId === 'C00' && phase === 'postpublication' && binding.proofMode === 'public-release') return 'c00'
  throw new Error('Release binding is not a reviewed C27 draft or C00 public-release variant.')
}

/** Add fixed metadata reads to a release operation plan. */
function addMetadataOperations(operations, expected, auth, prefix) {
  for (const phase of ['before', 'after']) operations.push(Object.freeze({ kind: 'api', auth, repository: REPOSITORY, releaseId: expected.releaseId, tag: expected.tag, prefix, phase, endpoint: `repos/${REPOSITORY}/releases/${expected.releaseId}`, command: auth === 'authenticated-draft-api' ? Object.freeze(['gh', 'api', `repos/${REPOSITORY}/releases/${expected.releaseId}`]) : undefined, url: auth === 'unauthenticated-public' ? `${API_ROOT}/releases/${expected.releaseId}` : undefined }))
}

/** Add fixed tag reads to a release operation plan. */
function addTagOperations(operations, expected, auth, prefix) {
  operations.push(Object.freeze({ kind: 'api', auth, repository: REPOSITORY, tag: expected.tag, prefix, phase: 'tag-before', endpoint: `repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(expected.tag)}`, command: auth === 'authenticated-draft-api' ? Object.freeze(['gh', 'api', `repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(expected.tag)}`]) : undefined, url: auth === 'unauthenticated-public' ? `${API_ROOT}/git/ref/tags/${encodeURIComponent(expected.tag)}` : undefined }))
  operations.push(Object.freeze({ kind: 'api', auth, repository: REPOSITORY, tag: expected.tag, prefix, phase: 'tag-after', endpoint: `repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(expected.tag)}`, command: auth === 'authenticated-draft-api' ? Object.freeze(['gh', 'api', `repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(expected.tag)}`]) : undefined, url: auth === 'unauthenticated-public' ? `${API_ROOT}/git/ref/tags/${encodeURIComponent(expected.tag)}` : undefined }))
}

/** Inspect one release and retain its exact report facts and raw files. */
async function inspectRelease({ expected, phase, auth, prefix, attemptRoot, workRoot }) {
  const before = await readRelease(expected, auth)
  await writeJsonExclusive(path.join(attemptRoot, `${prefix}-release-before.json`), before)
  const tagBefore = await readTag(expected.tag, auth)
  await writeJsonExclusive(path.join(attemptRoot, `${prefix}-tag-before.json`), { tag: expected.tag, commit: tagBefore })
  assertReleaseMetadata(before, expected, phase, tagBefore)
  const variantWork = path.join(workRoot, prefix)
  await mkdir(variantWork, { recursive: false, mode: 0o700 })
  const manifestAsset = releaseAsset(before, 'SHA256SUMS')
  const transferAssets = [...expected.assets, { name: 'SHA256SUMS', bytes: manifestAsset.size, sha256: undefined }]
  const downloads = []
  for (const asset of transferAssets) {
    const metadata = releaseAsset(before, asset.name)
    const url = `${DOWNLOAD_ROOT}/${expected.tag}/${encodeURIComponent(asset.name)}`
    const destination = path.join(variantWork, asset.name)
    const observed = auth === 'authenticated-draft-api'
      ? await downloadGhAsset(metadata.id, destination, asset.bytes)
      : await downloadPublicAsset(url, destination, asset.bytes)
    downloads.push({ name: asset.name, sha256: observed.sha256, bytes: observed.bytes, transport: auth, url })
    await writeJsonExclusive(path.join(attemptRoot, `${prefix}-transfer-${downloads.length}.json`), downloads.at(-1))
    if (asset.name === 'SHA256SUMS') {
      const manifest = await readFile(destination, 'utf8')
      const manifestSha256 = createHash('sha256').update(manifest).digest('hex')
      if (observed.sha256 !== manifestSha256) throw new Error('Retained SHA256SUMS digest changed while reading.')
      assertQualifiedAssets(before.assets.map((entry) => entry.name), qualificationFromExpected(expected), parseSha256Manifest(manifest))
      assertReleaseAssetMetadata(before.assets, qualificationFromExpected(expected), manifestSha256)
      for (const configured of expected.assets) {
        const transfer = downloads.find((entry) => entry.name === configured.name)
        if (transfer?.sha256 !== configured.sha256 || transfer.bytes !== configured.bytes) throw new Error(`Fresh ${configured.name} bytes differ from expected candidate identity.`)
      }
      await writeTextExclusive(path.join(attemptRoot, `${prefix}-SHA256SUMS`), manifest)
    }
  }
  const after = await readRelease(expected, auth)
  await writeJsonExclusive(path.join(attemptRoot, `${prefix}-release-after.json`), after)
  const tagAfter = await readTag(expected.tag, auth)
  await writeJsonExclusive(path.join(attemptRoot, `${prefix}-tag-after.json`), { tag: expected.tag, commit: tagAfter })
  assertReleaseMetadata(after, expected, phase, tagAfter)
  assertReleaseUnchanged(before, after)
  if (tagBefore !== expected.sourceSha || tagAfter !== expected.sourceSha) throw new Error('Remote release tag differs from the immutable source identity.')
  await writeJsonExclusive(path.join(attemptRoot, `${prefix}-release-downloads.json`), downloads)
  const manifest = await readFile(path.join(variantWork, 'SHA256SUMS'), 'utf8')
  return { expected, evidence: [`${prefix}-release-before.json`, `${prefix}-release-after.json`, `${prefix}-tag-before.json`, `${prefix}-tag-after.json`, `${prefix}-SHA256SUMS`, `${prefix}-release-downloads.json`], report: { phase, before, after, tagBefore, tagAfter, manifest, downloads } }
}

/** Validate release state, body qualification, regression provenance and asset names before downloads. */
function assertReleaseMetadata(release, expected, phase, tagCommit) {
  if (tagCommit !== expected.sourceSha) throw new Error('Release tag differs from the immutable source before download.')
  if (!release || release.id !== expected.releaseId || release.tag_name !== expected.tag || release.prerelease !== true
      || release.draft !== (phase === 'prepublication') || !Array.isArray(release.assets) || release.assets.length !== 3
      || new Set(release.assets.map((asset) => asset.id)).size !== 3 || new Set(release.assets.map((asset) => asset.name)).size !== 3) throw new Error('Release metadata does not match the exact immutable release identity.')
  validateReleaseProvenance(release.body, tagCommit)
  validateRegressionRecord(release.body)
  const qualification = validateQualificationBody(release.body)
  if (qualification.appImage.name !== expected.assets.find((asset) => asset.name.endsWith('.AppImage')).name
      || qualification.appImage.sha256 !== expected.assets.find((asset) => asset.name.endsWith('.AppImage')).sha256
      || qualification.deb.name !== expected.assets.find((asset) => asset.name.endsWith('.deb')).name
      || qualification.deb.sha256 !== expected.assets.find((asset) => asset.name.endsWith('.deb')).sha256) throw new Error('Release qualification body differs from the configured candidate or rollback bytes.')
  const requiredNames = new Set([...expected.assets.map((asset) => asset.name), 'SHA256SUMS'])
  if (release.assets.some((asset) => !requiredNames.has(asset.name))) throw new Error('Release contains an unconfigured asset.')
}

/** Read one release through either authenticated gh API or unauthenticated HTTPS. */
async function readRelease(expected, auth) {
  return auth === 'authenticated-draft-api'
    ? readGhJson(`repos/${REPOSITORY}/releases/${expected.releaseId}`)
    : readPublicJson(`${API_ROOT}/releases/${expected.releaseId}`)
}

/** Resolve and peel one fixed repository tag through the selected read transport. */
async function readTag(tag, auth) {
  const endpoint = `repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(tag)}`
  const read = auth === 'authenticated-draft-api' ? (pathName) => readGhJson(pathName) : (pathName) => readPublicJson(`https://api.github.com/${pathName}`)
  const reference = await read(endpoint)
  return peelGitHubTagToCommit(reference.object, async (tagSha) => (await read(`repos/${REPOSITORY}/git/tags/${tagSha}`)).object)
}

/** Download an exact release asset through authenticated gh API stdout. */
async function downloadGhAsset(assetId, destination, expectedBytes) {
  return streamCommandToFile({ command: 'gh', args: ['api', `repos/${REPOSITORY}/releases/assets/${assetId}`, '--header', 'Accept: application/octet-stream'],
    destination, expectedBytes, cwd: REPOSITORY_ROOT })
}

/** Download an exact canonical public release URL without auth headers or cookies. */
async function downloadPublicAsset(url, destination, expectedBytes) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(COMMAND_TIMEOUT), headers: { accept: 'application/octet-stream', 'user-agent': 'sartracker-release-qualification' } })
  if (!response.ok || response.body === null) throw new Error(`Public release download failed with HTTP ${response.status}.`)
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== 'https:' || !(finalUrl.hostname === 'github.com' || finalUrl.hostname.endsWith('.githubusercontent.com'))) throw new Error('Public release download left the GitHub HTTPS asset boundary.')
  return streamResponseToFile(response, destination, expectedBytes)
}

/** Read bounded JSON from the authenticated gh API. */
async function readGhJson(endpoint) {
  const { stdout } = await execFile('gh', ['api', endpoint], { cwd: REPOSITORY_ROOT, encoding: 'utf8', timeout: COMMAND_TIMEOUT, maxBuffer: MAX_JSON_BYTES })
  return parseJson(stdout, 'GitHub API response')
}

/** Read bounded JSON from GitHub without using gh credentials or cookies. */
async function readPublicJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(COMMAND_TIMEOUT), headers: { accept: 'application/vnd.github+json', 'user-agent': 'sartracker-release-qualification' } })
  if (!response.ok || response.body === null) throw new Error(`Public GitHub API failed with HTTP ${response.status}.`)
  return parseJson(await readResponseText(response), 'Public GitHub API response')
}

/** Stream one response into a new bounded regular file while hashing bytes. */
async function streamResponseToFile(response, destination, expectedBytes) {
  const stream = Readable.fromWeb(response.body)
  return streamStreamToFile(stream, destination, expectedBytes)
}

/** Stream one web/child stream into an exclusive file with exact byte bounds. */
async function streamStreamToFile(stream, destination, expectedBytes) {
  const handle = await open(destination, 'wx', 0o600)
  const digest = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > expectedBytes) throw new Error('Release asset exceeded its configured byte bound.')
      digest.update(chunk)
      await handle.writeFile(chunk)
    }
    await handle.sync()
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
  if (bytes !== expectedBytes) { await rm(destination, { force: true }); throw new Error(`Downloaded release asset has ${bytes} bytes; expected ${expectedBytes}.`) }
  return { bytes, sha256: digest.digest('hex') }
}

/** Read a bounded response text body without buffering an unbounded API response. */
async function readResponseText(response) {
  let bytes = 0
  const chunks = []
  for await (const chunk of Readable.fromWeb(response.body)) {
    bytes += chunk.length
    if (bytes > MAX_JSON_BYTES) throw new Error('GitHub API response exceeded its size bound.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Locate one exact release asset. */
function releaseAsset(release, name) {
  const matches = release.assets.filter((asset) => asset.name === name)
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0 || !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0) throw new Error(`Release asset ${JSON.stringify(name)} is missing or malformed.`)
  return matches[0]
}

/** Return the release qualification shape expected by the Electron release library. */
function qualificationFromExpected(expected) {
  return { appImage: expected.assets.find((asset) => asset.name.endsWith('.AppImage')), deb: expected.assets.find((asset) => asset.name.endsWith('.deb')) }
}

/** Parse one bounded JSON string. */
function parseJson(value, label) {
  try { return JSON.parse(value) } catch { throw new Error(`${label} is not valid JSON.`) }
}

/** Require a real absolute owned directory. */
async function requireDirectory(directory, label) {
  if (typeof directory !== 'string' || path.resolve(directory) !== directory) throw new Error(`${label} must be an absolute path.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory.`)
  return directory
}

/** Require that an evidence output path does not already exist. */
async function assertAbsent(filename) {
  try { await lstat(filename); throw new Error(`Release evidence output already exists: ${filename}`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

/** Require a retained path within the owned attempt directory. */
async function requirePathInside(filename, root, label) {
  if (typeof filename !== 'string' || path.resolve(filename) !== filename) throw new Error(`${label} path is invalid.`)
  const resolved = path.resolve(filename)
  const rootResolved = path.resolve(root)
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) throw new Error(`${label} is outside the attempt directory.`)
  const info = await lstat(resolved)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) throw new Error(`${label} must be a bounded regular file.`)
  return resolved
}

/** Read a retained JSON evidence file. */
async function readJson(filename, label) {
  try { return parseJson(await readFile(filename, 'utf8'), label) } catch (error) { if (error?.message === `${label} is not valid JSON.`) throw error; throw new Error(`${label} is unavailable: ${error.message}`) }
}

/** Write retained JSON without replacing append-only evidence. */
async function writeJsonExclusive(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

/** Write retained text without replacing append-only evidence. */
async function writeTextExclusive(filename, value) {
  await writeFile(filename, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

/** Convert unknown thrown values to a stable retained error. */
function errorMessage(error) { return error instanceof Error ? error.message : String(error) }

/** Recursively freeze a JSON-compatible plan. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
