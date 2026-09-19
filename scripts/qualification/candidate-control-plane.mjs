import { randomUUID } from 'node:crypto'
import { execFile as execFileCallback, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createConnection } from 'node:net'
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildJudgePacket,
  canonicalJson,
  compileCoverageRegistry,
  fileIdentity,
  sha256,
  verifySealedResult,
} from './control-plane.mjs'

const execFile = promisify(execFileCallback)
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SHA1_PATTERN = /^[a-f0-9]{40}$/u
const CONTRACT_ID_PATTERN = /^C(?:0[0-9]|1[0-9]|2[0-9])$/u
const CONTRACT_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'INVALID_EVIDENCE',
  'ENVIRONMENT_BLOCKED',
  'NEEDS_HUMAN_DECISION',
  'ABORTED_SAFE',
  'CLEANUP_BLOCKED',
])
const JUDGE_VERDICTS = Object.freeze(['pass', 'concern', 'unreadable'])
const PROOF_MODES = Object.freeze(['synthetic', 'browser', 'ci-appimage', 'installed-deb'])
const REQUIRED_CANDIDATE_CONTRACTS = Object.freeze(
  Array.from({ length: 30 }, (_, index) => `C${String(index).padStart(2, '0')}`),
)
const ADAPTERS = new Map()
const RECEIPT_VALIDATORS = new Map()

registerCalibrationAdapters()

/**
 * Compile a reviewed campaign plan into an immutable, exact-input definition.
 *
 * The compiled definition is deliberately not a release approval. It is the
 * controller's immutable input record; later preflight and attempt receipts
 * must bind to its digest and to every recorded file identity.
 *
 * @param {object} options compilation options
 * @returns {Promise<object>} immutable campaign definition
 */
export async function compileCampaignDefinition({ plan, planPath, sourceIdentity, outputPath }) {
  const resolvedPlan = await resolvePlan(plan, planPath)
  validatePlan(resolvedPlan)
  const registryPath = resolvePlanPath(resolvedPlan.registryPath, planPath)
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  const compiledRegistry = compileCoverageRegistry(registry)
  const registryIdentity = await strictFileIdentity(registryPath, 'contract registry')
  const fixtures = await identityList(resolvedPlan.fixturePaths ?? [], planPath, 'fixture')
  const validators = await identityList(
    uniquePaths([registryPath, ...(resolvedPlan.validatorPaths ?? [])]),
    planPath,
    'validator',
  )
  const artifacts = await identityArtifacts(resolvedPlan.artifacts ?? [], planPath)
  validateSourceIdentity(sourceIdentity)

  const planIdentity = Object.freeze({
    sha256: sha256(Buffer.from(canonicalJson(resolvedPlan), 'utf8')),
    path: planPath ? path.resolve(planPath) : undefined,
  })
  const definitionBody = {
    schema: 'sartracker-qualification-campaign-definition-v1',
    immutable: true,
    campaignId: resolvedPlan.campaignId,
    mode: resolvedPlan.mode,
    releaseEligible: false,
    authorization: resolvedPlan.authorization,
    requiredContracts: resolvedPlan.requiredContracts,
    identities: {
      source: sourceIdentity,
      candidate: {
        candidateId: resolvedPlan.candidateId ?? null,
        version: resolvedPlan.version ?? null,
        artifacts,
      },
      contractRegistry: registryIdentity,
      fixtures,
      validators,
    },
    registryPath,
    bindings: resolvedPlan.bindings,
    preflight: {
      expectedPlatform: resolvedPlan.expectedPlatform ?? null,
      expectedArch: resolvedPlan.expectedArch ?? null,
      minimumFreeBytes: resolvedPlan.minimumFreeBytes ?? 1024 * 1024,
      disposableRootNames: ['profiles', 'fixtures', 'archives'],
      requiredCapabilities: uniqueStrings(
        unique(resolvedPlan.bindings.map((binding) => binding.capability).filter(Boolean)),
        'requiredCapabilities',
      ),
      baselinePorts: resolvedPlan.baselinePorts ?? [],
    },
    planIdentity,
    registryCoverage: {
      contracts: compiledRegistry.contracts,
      contractIds: compiledRegistry.contracts.map((contract) => contract.id),
      hazards: compiledRegistry.releaseCriticalHazards,
      programmeChanges: compiledRegistry.programmeChanges,
      releaseGates: compiledRegistry.releaseGates,
    },
  }
  const definitionDigest = sha256(Buffer.from(canonicalJson(definitionBody), 'utf8'))
  const definition = Object.freeze({ ...definitionBody, definitionDigest })
  if (outputPath !== undefined) {
    const resolvedOutputPath = path.resolve(outputPath)
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true, mode: 0o700 })
    await writeIdempotentJson(resolvedOutputPath, definition, 'campaign definition')
  }
  return definition
}

/**
 * Create the controller-owned lease and disposable roots for a campaign.
 *
 * Only paths created under the lease are disposable. Unknown databases and
 * operational paths are intentionally outside this cleanup boundary.
 *
 * @param {object} options lease options
 * @returns {Promise<object>} acquired lease
 */
export async function createCampaignLease({ campaignRoot, definition }) {
  validateDefinition(definition)
  const root = await requireRealRoot(campaignRoot, 'campaign root')
  const campaignLockPath = path.join(root, 'campaign.lock')
  const leaseId = `lease-${Date.now()}-${randomUUID().slice(0, 8)}`
  const leaseRoot = path.join(root, 'leases', leaseId)
  await mkdir(path.join(root, 'leases'), { recursive: true, mode: 0o700 })
  try {
    await writeExclusiveJson(campaignLockPath, {
      campaignId: definition.campaignId,
      definitionDigest: definition.definitionDigest,
      leaseId,
      pid: process.pid,
      host: os.hostname(),
    })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existingLock = JSON.parse(await readFile(campaignLockPath, 'utf8'))
    if (existingLock.campaignId !== definition.campaignId || existingLock.definitionDigest !== definition.definitionDigest) {
      throw new Error('A different immutable campaign already owns the campaign lease.')
    }
    if (existingLock.host !== os.hostname() || existingLock.pid !== process.pid) {
      if (existingLock.host === os.hostname() && processIsAlive(existingLock.pid)) {
        throw new Error(`Campaign lease is held by live process ${existingLock.pid} on ${existingLock.host}.`)
      }
      throw new Error('Campaign lease is held by another host or has a stale owner; explicit cleanup is required.')
    }
    const existingLeasePath = path.join(root, 'leases', existingLock.leaseId, 'lease.json')
    if (!await pathExists(existingLeasePath)) throw new Error('Campaign lease lock exists without a recoverable lease.')
    const existingLease = JSON.parse(await readFile(existingLeasePath, 'utf8'))
    if (existingLease.status !== 'ACQUIRED' || existingLease.pid !== process.pid || existingLease.host !== os.hostname()) {
      throw new Error('Campaign lease owner identity is not recoverable.')
    }
    return leaseFromState(existingLeasePath, existingLease)
  }
  await mkdir(leaseRoot, { recursive: false, mode: 0o700 })
  const disposableRoots = []
  for (const name of definition.preflight.disposableRootNames) {
    const disposableRoot = path.join(leaseRoot, name)
    await mkdir(disposableRoot, { recursive: false, mode: 0o700 })
    disposableRoots.push(disposableRoot)
  }
  const lease = {
    schema: 'sartracker-qualification-lease-v1',
    status: 'ACQUIRED',
    leaseId,
    campaignId: definition.campaignId,
    definitionDigest: definition.definitionDigest,
    pid: process.pid,
    host: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    acquiredAt: new Date().toISOString(),
    campaignRoot: root,
    campaignLockPath,
    disposableRoots,
    baseline: await captureBaseline(definition.preflight.baselinePorts),
  }
  const leasePath = path.join(leaseRoot, 'lease.json')
  await writeExclusiveJson(leasePath, lease)
  return leaseFromState(leasePath, lease)
}

/** Convert an on-disk lease into the narrow controller handle used by callers. */
function leaseFromState(leasePath, lease) {
  return Object.freeze({
    status: lease.status,
    leaseId: lease.leaseId,
    leasePath,
    leaseRoot: path.dirname(leasePath),
    disposableRoots: Object.freeze(lease.disposableRoots),
    baseline: lease.baseline,
  })
}

/** Acquire a write-once resource lock for timing/package contention gates. */
async function acquireResourceLock(campaignRoot, resourceKey, definitionDigest) {
  requireSafeId(resourceKey, 'resource key')
  const locksRoot = path.join(path.resolve(campaignRoot), 'locks')
  await mkdir(locksRoot, { recursive: true, mode: 0o700 })
  const lockPath = path.join(locksRoot, `${resourceKey}.lock`)
  const lock = { schema: 'sartracker-qualification-resource-lock-v1', resourceKey, definitionDigest, pid: process.pid, acquiredAt: new Date().toISOString() }
  await writeExclusiveJson(lockPath, lock)
  return Object.freeze({ lockPath, resourceKey, definitionDigest })
}

/** Release only the controller's own resource lock. */
async function releaseResourceLock(lock) {
  const current = JSON.parse(await readFile(lock.lockPath, 'utf8'))
  if (current.resourceKey !== lock.resourceKey || current.definitionDigest !== lock.definitionDigest || current.pid !== process.pid) {
    throw new Error('Resource lock identity changed during execution.')
  }
  await rm(lock.lockPath, { force: false })
}

/** Check a same-host process without treating permission errors as safe to reclaim. */
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/**
 * Run controller-owned preflight for an immutable campaign definition.
 *
 * Preflight re-hashes every bound file, checks the host and capabilities,
 * checks that every mandatory binding has a registered adapter/validator, and
 * acquires a lease only when those checks pass.
 *
 * @param {object} options preflight options
 * @returns {Promise<object>} deterministic preflight result
 */
export async function preflightCampaign({ definition, campaignRoot, currentSourceIdentity }) {
  const blockers = []
  let normalized
  try {
    normalized = validateDefinition(definition)
  } catch (error) {
    return preflightBlocked(definition, [`definition: ${error.message}`])
  }

  if (currentSourceIdentity !== undefined && !sameSourceIdentity(currentSourceIdentity, normalized.identities.source)) {
    blockers.push('source identity differs from the immutable campaign definition')
  }
  if (normalized.preflight.expectedPlatform !== null
      && normalized.preflight.expectedPlatform !== process.platform) {
    blockers.push(`platform ${process.platform} does not match ${normalized.preflight.expectedPlatform}`)
  }
  if (normalized.preflight.expectedArch !== null && normalized.preflight.expectedArch !== process.arch) {
    blockers.push(`architecture ${process.arch} does not match ${normalized.preflight.expectedArch}`)
  }

  blockers.push(...await verifyBoundIdentities(normalized))
  blockers.push(...validateBindingCoverage(normalized))
  blockers.push(...validateCapabilities(normalized))
  blockers.push(...await checkFreeSpace(normalized.preflight.minimumFreeBytes, campaignRoot))

  if (blockers.length > 0) return preflightBlocked(normalized, uniqueStrings(blockers, 'blockers'))

  try {
    const lease = await createCampaignLease({ campaignRoot, definition: normalized })
    return Object.freeze({
      status: 'READY',
      releaseEligible: false,
      blockers: Object.freeze([]),
      definitionDigest: normalized.definitionDigest,
      lease,
      baseline: lease.baseline,
    })
  } catch (error) {
    return preflightBlocked(normalized, [`lease: ${error.message}`])
  }
}

/**
 * Execute one named contract variant, retaining every attempt as an immutable
 * directory and allowing only an exact-input interrupted attempt to resume.
 *
 * @param {object} options attempt options
 * @returns {Promise<object>} attempt receipt summary
 */
export async function runContractAttempt({
  definition,
  preflight,
  campaignRoot,
  contractId,
  variantId,
  resumeAttemptId,
}) {
  const normalized = validateDefinition(definition)
  if (preflight?.definitionDigest !== normalized.definitionDigest) {
    throw new Error('Preflight definition identity does not match the campaign definition.')
  }
  if (preflight?.status !== 'READY' || preflight.lease === undefined) {
    throw new Error('Candidate execution requires a READY controller preflight lease.')
  }
  const binding = findBinding(normalized, contractId, variantId)
  const inputDigest = inputDigestFor(normalized, binding)
  const attemptsRoot = path.join(path.resolve(campaignRoot), 'attempts')
  await mkdir(attemptsRoot, { recursive: true, mode: 0o700 })
  let attemptId = resumeAttemptId
  let attemptDirectory
  let resumed = false
  if (attemptId !== undefined) {
    requireSafeId(attemptId, 'resume attempt id')
    attemptDirectory = path.join(attemptsRoot, attemptId)
    await requireRealDirectory(attemptDirectory, attemptsRoot, 'resume attempt directory')
    if (await pathExists(path.join(attemptDirectory, 'manifest.json'))
        || await pathExists(path.join(attemptDirectory, 'seal.json'))) {
      throw new Error('Cannot resume an attempt after it has been sealed.')
    }
    const metadata = JSON.parse(await readFile(path.join(attemptDirectory, 'attempt.json'), 'utf8'))
    if (metadata.definitionDigest !== normalized.definitionDigest || metadata.inputDigest !== inputDigest) {
      throw new Error('Resume attempt identity does not match the immutable definition or input identity.')
    }
    resumed = true
  } else {
    attemptId = `attempt-${Date.now()}-${randomUUID().slice(0, 8)}`
    attemptDirectory = path.join(attemptsRoot, attemptId)
    await mkdir(attemptDirectory, { recursive: false, mode: 0o700 })
    await writeExclusiveJson(path.join(attemptDirectory, 'attempt.json'), {
      schema: 'sartracker-qualification-attempt-v1',
      campaignId: normalized.campaignId,
      attemptId,
      definitionDigest: normalized.definitionDigest,
      inputDigest,
      contractId,
      variantId,
      adapterId: binding.adapterId,
      proofMode: binding.proofMode,
      retryOf: binding.retryOf ?? null,
      startedAt: new Date().toISOString(),
    })
  }
  await appendState(attemptDirectory, {
    phase: resumed ? 'resumed' : 'started',
    attemptId,
    inputDigest,
  })

  const adapter = ADAPTERS.get(binding.adapterId)
  const validator = RECEIPT_VALIDATORS.get(binding.receiptValidatorId)
  if (adapter === undefined || validator === undefined) {
    return writeBlockedAttempt({
      normalized,
      attemptId,
      attemptDirectory,
      inputDigest,
      status: 'ENVIRONMENT_BLOCKED',
      reason: adapter === undefined ? `missing adapter ${binding.adapterId}` : `missing receipt validator ${binding.receiptValidatorId}`,
      binding,
      resumed,
    })
  }

  let resourceLock
  try {
    resourceLock = await acquireResourceLock(campaignRoot, binding.resourceKey ?? 'default', normalized.definitionDigest)
    const execution = await adapter({
      attemptId,
      campaignId: normalized.campaignId,
      definitionDigest: normalized.definitionDigest,
      inputDigest,
      resumed,
      binding,
    })
    let captures
    try {
      captures = await materializeCaptures(execution.captures ?? [], attemptDirectory, attemptsRoot)
    } catch (error) {
      return writeBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest, status: 'INVALID_EVIDENCE', reason: error.message, binding, resumed })
    }
    return await writeExecutionReceipt({ normalized, binding, validator, execution, captures, attemptId, attemptDirectory, inputDigest, resumed })
  } finally {
    if (resourceLock !== undefined) await releaseResourceLock(resourceLock)
  }
}

/** Write the deterministic receipt and oracle-blind packet after resource ownership is proven. */
async function writeExecutionReceipt({ normalized, binding, validator, execution, captures, attemptId, attemptDirectory, inputDigest, resumed }) {
  const receipt = {
    schema: 'sartracker-qualification-contract-receipt-v1',
    campaignId: normalized.campaignId,
    attemptId,
    definitionDigest: normalized.definitionDigest,
    inputDigest,
    contractId: binding.contractId,
    variantId: binding.variantId,
    adapterId: binding.adapterId,
    proofMode: binding.proofMode,
    status: execution.status,
    deterministic: true,
    evidence: execution.evidence ?? [],
    observed: execution.observed ?? {},
  }
  validator(receipt, binding)
  const receiptFileName = resumed ? await nextAppendOnlyFileName(attemptDirectory, 'receipt') : 'receipt.json'
  const resultFileName = resumed ? await nextAppendOnlyFileName(attemptDirectory, 'result') : 'result.json'
  await writeExclusiveJson(path.join(attemptDirectory, receiptFileName), receipt)
  await writeExclusiveJson(path.join(attemptDirectory, resultFileName), {
    schema: 'sartracker-qualification-attempt-result-v1',
    campaignId: normalized.campaignId,
    attemptId,
    definitionDigest: normalized.definitionDigest,
    inputDigest,
    contractId: binding.contractId,
    variantId: binding.variantId,
    status: execution.status,
    deterministicFailure: execution.status === 'FAIL',
    reason: execution.reason ?? null,
  })
  await appendState(attemptDirectory, { phase: execution.status === 'ABORTED_SAFE' ? 'aborted' : 'receipt-written', status: execution.status })

  const judgePacket = buildJudgePacket({
    attemptId,
    result: { mode: normalized.mode },
    captures,
  })
  const judgePacketFileName = resumed ? await nextAppendOnlyFileName(attemptDirectory, 'judge-packet') : 'judge-packet.json'
  const judgePacketPath = path.join(attemptDirectory, judgePacketFileName)
  await writeExclusiveJson(judgePacketPath, {
    ...judgePacket,
    campaignId: normalized.campaignId,
    definitionDigest: normalized.definitionDigest,
  })
  const judgePacketSha256 = sha256(await readFile(judgePacketPath))

  if (execution.status === 'ABORTED_SAFE') {
    return Object.freeze({
      status: 'ABORTED_SAFE',
      attemptId,
      attemptDirectory,
      judgePacketSha256,
      anchorPath: undefined,
      releaseEligible: false,
    })
  }
  return Object.freeze({
    status: execution.status,
    attemptId,
    attemptDirectory,
    judgePacketSha256,
    anchorPath: undefined,
    releaseEligible: false,
  })
}

/**
 * Ingest and validate an oracle-blind advisory judge result, then seal the
 * complete attempt evidence set with an external anchor.
 *
 * @param {object} options judge ingestion options
 * @returns {Promise<object>} sealed attempt summary
 */
export async function ingestAdvisoryJudgeResult({ attemptDirectory, result }) {
  const directory = path.resolve(attemptDirectory)
  const metadata = JSON.parse(await readFile(path.join(directory, 'attempt.json'), 'utf8'))
  const packetPath = await latestAttemptFile(directory, /^judge-packet(?:-resume-\d+)?\.json$/u, 'judge packet')
  const packet = JSON.parse(await readFile(packetPath, 'utf8'))
  validateJudgeResult(result, metadata, sha256(await readFile(packetPath)))
  await writeExclusiveJson(path.join(directory, 'judge-result.json'), result)
  await appendState(directory, { phase: 'judge-ingested', verdict: result.verdict })
  const campaignRoot = path.dirname(path.dirname(directory))
  const sealed = await sealAttempt({
    attemptDirectory: directory,
    campaignRoot,
    campaignId: metadata.campaignId,
    definitionDigest: metadata.definitionDigest,
    attemptId: metadata.attemptId,
  })
  return Object.freeze({ ...sealed, judgeVerdict: result.verdict, packetSchema: packet.schema })
}

/**
 * Verify one sealed attempt independently, including campaign and definition
 * correlation after the generic closed-set verifier has checked file custody.
 *
 * @param {object} options verification options
 * @returns {Promise<object>} verified attempt identity
 */
export async function verifyCampaignAttempt({ attemptDirectory, anchorPath }) {
  await verifySealedResult(attemptDirectory, anchorPath)
  const directory = path.resolve(attemptDirectory)
  const metadata = JSON.parse(await readFile(path.join(directory, 'attempt.json'), 'utf8'))
  const result = await readLatestAttemptResult(directory)
  const anchor = JSON.parse(await readFile(anchorPath, 'utf8'))
  if (metadata.attemptId !== result.attemptId || metadata.attemptId !== anchor.attemptId) {
    throw new Error('Sealed attempt has cross-attempt identity.')
  }
  if (metadata.campaignId !== anchor.campaignId || metadata.definitionDigest !== anchor.definitionDigest) {
    throw new Error('Sealed attempt has cross-campaign or definition identity.')
  }
  return Object.freeze({
    attemptId: metadata.attemptId,
    campaignId: metadata.campaignId,
    definitionDigest: metadata.definitionDigest,
    status: result.status,
  })
}

/**
 * Compute a campaign verdict from every retained attempt, preserving failures
 * and exposing every required contract row.
 *
 * @param {object} options verdict options
 * @returns {Promise<object>} campaign verdict
 */
export async function computeCampaignVerdict({ definition, campaignRoot }) {
  const normalized = validateDefinition(definition)
  const root = path.resolve(campaignRoot)
  const attemptsRoot = path.join(root, 'attempts')
  const entries = await safeReadDirectories(attemptsRoot)
  const rows = new Map()
  const evidenceErrors = []
  const judgeHolds = []
  const deterministicFailures = []
  const environmentBlockers = []
  const aborted = []
  for (const entry of entries) {
    const attemptDirectory = path.join(attemptsRoot, entry)
    try {
      const result = await readLatestAttemptResult(attemptDirectory)
      const rowKey = `${result.contractId}:${result.variantId}`
      const existing = rows.get(rowKey)
      if (existing === undefined || result.attemptId > existing.attemptId) rows.set(rowKey, result)
      if (result.status === 'FAIL') deterministicFailures.push(result.contractId)
      if (result.status === 'ENVIRONMENT_BLOCKED') environmentBlockers.push(result.reason ?? result.contractId)
      if (result.status === 'ABORTED_SAFE') aborted.push(result.contractId)
      const anchorPath = path.join(root, 'anchors', `${result.attemptId}.anchor.json`)
      const sealPath = path.join(attemptDirectory, 'seal.json')
      const judgeResultPath = path.join(attemptDirectory, 'judge-result.json')
      if (!(await pathExists(sealPath))) {
        if (result.status === 'ENVIRONMENT_BLOCKED') environmentBlockers.push(result.reason ?? result.contractId)
        else evidenceErrors.push(`${entry}: attempt is not sealed`)
      } else {
        await verifyCampaignAttempt({ attemptDirectory, anchorPath })
        if (!(await pathExists(judgeResultPath))) throw new Error('sealed attempt is missing the advisory judge result.')
        const judge = JSON.parse(await readFile(judgeResultPath, 'utf8'))
        if (judge.verdict !== 'pass') judgeHolds.push(result.contractId)
      }
    } catch (error) {
      evidenceErrors.push(`${entry}: ${error.message}`)
    }
  }

  const requiredContracts = normalized.mode === 'candidate' ? REQUIRED_CANDIDATE_CONTRACTS : normalized.requiredContracts
  const requiredRows = requiredContracts.map((contractId) => {
    const candidates = [...rows.values()].filter((result) => result.contractId === contractId)
    const latest = candidates.sort((left, right) => left.attemptId.localeCompare(right.attemptId)).at(-1)
    return latest ?? { contractId, variantId: null, status: 'not-run' }
  })
  const missingRequired = requiredRows.filter((row) => row.status === 'not-run').map((row) => row.contractId)
  const status = evidenceErrors.length > 0
    ? 'INVALID_EVIDENCE'
    : deterministicFailures.length > 0
      ? 'FAIL'
      : aborted.length > 0
        ? 'ABORTED_SAFE'
        : environmentBlockers.length > 0 || missingRequired.length > 0
          ? 'ENVIRONMENT_BLOCKED'
          : judgeHolds.length > 0
            ? 'NEEDS_HUMAN_DECISION'
            : requiredRows.every((row) => row.status === 'PASS') ? 'PASS' : 'INVALID_EVIDENCE'
  return Object.freeze({
    schema: 'sartracker-qualification-campaign-verdict-v1',
    campaignId: normalized.campaignId,
    definitionDigest: normalized.definitionDigest,
    verdict: status,
    releaseEligible: false,
    deterministicFailures: Object.freeze(unique(deterministicFailures)),
    judgeHolds: Object.freeze(unique(judgeHolds)),
    blockers: Object.freeze(unique([...environmentBlockers, ...missingRequired.map((id) => `missing required contract ${id}`)])),
    evidenceErrors: Object.freeze(evidenceErrors),
    contractRows: Object.freeze(await allContractRows(normalized, requiredRows)),
    attempts: Object.freeze(entries),
  })
}

/** Read the newest append-only result file for an attempt. */
async function readLatestAttemptResult(attemptDirectory) {
  const resultPath = await latestAttemptFile(attemptDirectory, /^result(?:-resume-\d+)?\.json$/u, 'attempt result')
  return JSON.parse(await readFile(resultPath, 'utf8'))
}

/** Locate the newest append-only file in an attempt. */
async function latestAttemptFile(attemptDirectory, pattern, label) {
  const entries = await readdir(attemptDirectory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => appendOnlySequence(left) - appendOnlySequence(right) || left.localeCompare(right))
  if (names.length === 0) throw new Error(`${label} is missing.`)
  return path.join(attemptDirectory, names.at(-1))
}

/** Allocate a monotonic append-only evidence filename for one attempt. */
async function nextAppendOnlyFileName(attemptDirectory, prefix) {
  const entries = await readdir(attemptDirectory, { withFileTypes: true })
  const pattern = new RegExp(`^${prefix}-resume-(\\d+)\\.json$`, 'u')
  const next = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => Number(entry.name.match(pattern)?.[1] ?? -1))
    .reduce((maximum, value) => Math.max(maximum, value), -1) + 1
  return `${prefix}-resume-${String(next).padStart(6, '0')}.json`
}

/** Return the numeric append-only sequence, keeping the initial file first. */
function appendOnlySequence(name) {
  return Number(name.match(/-resume-(\d+)\.json$/u)?.[1] ?? -1)
}

/**
 * Remove only controller-owned disposable roots, or quarantine the lease when
 * any cleanup postcondition is not proven.
 *
 * @param {object} options cleanup options
 * @returns {Promise<object>} cleanup disposition
 */
export async function cleanupCampaignLease({ leasePath, simulateFailure = false }) {
  const lease = JSON.parse(await readFile(leasePath, 'utf8'))
  const leaseRoot = path.dirname(path.resolve(leasePath))
  const quarantineRoot = path.join(path.dirname(leaseRoot), '..', 'quarantine')
  if (simulateFailure) {
    await mkdir(quarantineRoot, { recursive: true, mode: 0o700 })
    const quarantinePath = path.join(quarantineRoot, path.basename(leaseRoot))
    await rename(leaseRoot, quarantinePath)
    await writeExclusiveJson(path.join(quarantinePath, 'cleanup-receipt.json'), {
      schema: 'sartracker-qualification-cleanup-receipt-v1',
      status: 'CLEANUP_BLOCKED',
      leaseId: lease.leaseId,
      reason: 'simulated cleanup failure',
      quarantinePath,
    })
    return Object.freeze({ status: 'CLEANUP_BLOCKED', quarantinePath })
  }
  for (const disposableRoot of lease.disposableRoots) {
    const resolved = path.resolve(disposableRoot)
    if (!resolved.startsWith(`${leaseRoot}${path.sep}`)) throw new Error('Cleanup path escaped the lease root.')
    await rm(resolved, { recursive: true, force: false })
  }
  await rm(leasePath, { force: false })
  if (typeof lease.campaignLockPath === 'string') await rm(lease.campaignLockPath, { force: false })
  await rmdir(leaseRoot)
  return Object.freeze({ status: 'CLEANED', leaseId: lease.leaseId })
}

/**
 * Return registered adapter and receipt-validator ids for diagnostics/tests.
 *
 * @returns {object} immutable registry inventory
 */
export function getCandidateAdapterInventory() {
  return Object.freeze({
    adapters: Object.freeze([...ADAPTERS.keys()]),
    receiptValidators: Object.freeze([...RECEIPT_VALIDATORS.keys()]),
  })
}

/** Register the bounded synthetic/calibration adapters. */
function registerCalibrationAdapters() {
  ADAPTERS.set('calibration.pass', async () => ({ status: 'PASS', observed: { calibration: 'pass' } }))
  ADAPTERS.set('calibration.fail', async () => ({ status: 'FAIL', reason: 'synthetic deterministic failure', observed: { calibration: 'fail' } }))
  ADAPTERS.set('calibration.interrupt', async ({ resumed }) => resumed
    ? { status: 'PASS', observed: { calibration: 'resumed' } }
    : { status: 'ABORTED_SAFE', reason: 'synthetic interruption before completion', observed: { calibration: 'interrupted' } })
  ADAPTERS.set('calibration.capture', async ({ binding }) => ({
    status: 'PASS',
    captures: [{ name: binding.captureName, path: binding.capturePath, kind: 'image' }],
    observed: { calibration: 'capture' },
  }))
  RECEIPT_VALIDATORS.set('calibration.v1', (receipt, binding) => {
    if (receipt.contractId !== binding.contractId || receipt.variantId !== binding.variantId) {
      throw new Error('Calibration receipt contract identity does not match the binding.')
    }
    if (!CONTRACT_STATUSES.includes(receipt.status)) throw new Error('Calibration receipt status is invalid.')
    if (!SHA256_PATTERN.test(receipt.inputDigest) || !SHA256_PATTERN.test(receipt.definitionDigest)) {
      throw new Error('Calibration receipt identity is invalid.')
    }
  })
}

/** Read a plan from an object or an explicit file. */
async function resolvePlan(plan, planPath) {
  if (plan !== undefined) return structuredClone(plan)
  if (planPath === undefined) throw new Error('Campaign plan or plan path is required.')
  return JSON.parse(await readFile(planPath, 'utf8'))
}

/** Validate the reviewed plan before any identities are captured. */
function validatePlan(plan) {
  if (plan?.schema !== 'sartracker-qualification-campaign-plan-v1') throw new Error('Campaign plan schema is invalid.')
  requireSafeId(plan.campaignId, 'campaign id')
  if (!['candidate', 'calibration'].includes(plan.mode)) throw new Error('Campaign plan mode is invalid.')
  if (plan.releaseEligible !== false) throw new Error('Campaign plans must set releaseEligible false.')
  if (plan.authorization?.explicitlyEnabled !== true) throw new Error('Campaign mode requires explicit authorization.')
  if (!Array.isArray(plan.requiredContracts) || plan.requiredContracts.length === 0) throw new Error('Campaign required contracts are required.')
  if (!Array.isArray(plan.bindings) || plan.bindings.length === 0) throw new Error('Campaign adapter bindings are required.')
  for (const contractId of plan.requiredContracts) {
    if (!CONTRACT_ID_PATTERN.test(contractId)) throw new Error(`Invalid required contract id: ${contractId}.`)
  }
  const bindingKeys = new Set()
  for (const binding of plan.bindings) {
    validateBinding(binding)
    const key = `${binding.contractId}:${binding.variantId}`
    if (bindingKeys.has(key)) throw new Error(`Duplicate campaign binding: ${key}.`)
    bindingKeys.add(key)
  }
}

/** Validate an immutable campaign definition and return a frozen view. */
function validateDefinition(definition) {
  if (definition?.schema !== 'sartracker-qualification-campaign-definition-v1' || definition.immutable !== true) {
    throw new Error('Campaign definition must be an immutable compiled definition.')
  }
  validatePlan({
    schema: 'sartracker-qualification-campaign-plan-v1',
    campaignId: definition.campaignId,
    mode: definition.mode,
    releaseEligible: definition.releaseEligible,
    authorization: definition.authorization,
    requiredContracts: definition.requiredContracts,
    bindings: definition.bindings,
  })
  validateSourceIdentity(definition.identities?.source)
  if (!isIdentity(definition.identities?.contractRegistry)) throw new Error('Contract registry identity is required.')
  if (!Array.isArray(definition.identities.fixtures) || !Array.isArray(definition.identities.validators)
      || !Array.isArray(definition.identities.candidate?.artifacts)) throw new Error('Campaign identities are incomplete.')
  for (const identity of [...definition.identities.fixtures, ...definition.identities.validators, ...definition.identities.candidate.artifacts]) {
    if (!isIdentity(identity)) throw new Error('Campaign file identity is invalid.')
  }
  if (!Array.isArray(definition.preflight?.disposableRootNames) || definition.preflight.disposableRootNames.length === 0) {
    throw new Error('Campaign disposable roots are required.')
  }
  if (typeof definition.definitionDigest !== 'string' || !SHA256_PATTERN.test(definition.definitionDigest)) {
    throw new Error('Campaign definition digest is invalid.')
  }
  const expectedDigest = sha256(Buffer.from(canonicalJson(stripDigest(definition)), 'utf8'))
  if (expectedDigest !== definition.definitionDigest) throw new Error('Campaign definition digest does not match its immutable bytes.')
  return Object.freeze(definition)
}

/** Validate a contract adapter binding. */
function validateBinding(binding) {
  if (binding === null || typeof binding !== 'object' || !CONTRACT_ID_PATTERN.test(binding.contractId ?? '')) {
    throw new Error('Campaign binding contract id is invalid.')
  }
  requireSafeId(binding.variantId, 'binding variant id')
  requireSafeId(binding.adapterId, 'binding adapter id')
  requireSafeId(binding.receiptValidatorId, 'binding receipt validator id')
  if (!PROOF_MODES.includes(binding.proofMode)) throw new Error(`Binding ${binding.contractId} proof mode is invalid.`)
  if (binding.mandatory !== true) throw new Error(`Binding ${binding.contractId}:${binding.variantId} must be explicitly mandatory.`)
  if (!Array.isArray(binding.command) || binding.command.length === 0 || binding.command.some((part) => typeof part !== 'string' || part === '')) {
    throw new Error(`Binding ${binding.contractId}:${binding.variantId} needs an explicit command.`)
  }
  if (typeof binding.oracle !== 'string' && binding.proofMode !== 'synthetic') {
    throw new Error(`Binding ${binding.contractId}:${binding.variantId} needs an explicit oracle description.`)
  }
}

/**
 * Materialize judge captures into the current attempt while rejecting symlink
 * and cross-attempt media custody.
 */
async function materializeCaptures(captures, attemptDirectory, attemptsRoot) {
  if (!Array.isArray(captures)) throw new Error('Capture list must be an array.')
  const canonicalAttempt = await realpath(attemptDirectory)
  const canonicalAttemptsRoot = await realpath(attemptsRoot)
  const materialized = []
  for (const capture of captures) {
    if (capture === null || typeof capture !== 'object') throw new Error('Capture identity is invalid.')
    requireSafeId(capture.name, 'capture name')
    if (capture.path === undefined) {
      materialized.push(capture)
      continue
    }
    if (typeof capture.path !== 'string' || capture.path === '') throw new Error('Capture path is invalid.')
    const source = path.resolve(capture.path)
    const sourceMetadata = await lstat(source)
    if (sourceMetadata.isSymbolicLink()) throw new Error('Capture path must not be a symbolic link.')
    const canonicalSource = await realpath(source)
    if (canonicalSource.startsWith(`${canonicalAttemptsRoot}${path.sep}`)
        && !canonicalSource.startsWith(`${canonicalAttempt}${path.sep}`)) {
      throw new Error('Capture media belongs to a different attempt.')
    }
    const identity = await strictFileIdentity(source, 'capture')
    if (capture.sha256 !== undefined && capture.sha256 !== identity.sha256) throw new Error('Capture bytes do not match the declared digest.')
    if (!canonicalSource.startsWith(`${canonicalAttempt}${path.sep}`)) {
      const name = `media-${capture.name}`
      await writeExclusiveBytes(path.join(attemptDirectory, name), await readFile(source))
    }
    materialized.push({ name: capture.name, kind: capture.kind, sha256: identity.sha256 })
  }
  return materialized
}

/** Validate a source SHA/tree/cleanliness record. */
function validateSourceIdentity(identity) {
  if (identity === null || typeof identity !== 'object' || !SHA1_PATTERN.test(identity.sha ?? '')
      || !SHA1_PATTERN.test(identity.tree ?? '') || identity.dirty !== false) {
    throw new Error('Exact clean source SHA and tree identity are required; untracked or modified files make the source dirty.')
  }
}

/** Check all exact bound file identities against their current bytes. */
async function verifyBoundIdentities(definition) {
  const mismatches = []
  const identities = [
    ['contract registry', definition.identities.contractRegistry],
    ...definition.identities.fixtures.map((identity) => ['fixture', identity]),
    ...definition.identities.validators.map((identity) => ['validator', identity]),
    ...definition.identities.candidate.artifacts.map((identity) => ['artifact', identity]),
  ]
  for (const [label, identity] of identities) {
    try {
      const current = await strictFileIdentity(identity.path, label)
      if (!sameIdentity(current, identity)) mismatches.push(`${label} identity changed: ${identity.path}`)
    } catch (error) {
      mismatches.push(`${label} identity unavailable: ${error.message}`)
    }
  }
  return mismatches
}

/** Ensure candidate coverage and make unresolved rows explicit blockers. */
function validateBindingCoverage(definition) {
  const blockers = []
  const expected = definition.mode === 'candidate' ? REQUIRED_CANDIDATE_CONTRACTS : definition.requiredContracts
  if (definition.mode === 'candidate' && (definition.identities.candidate.candidateId === null || definition.identities.candidate.version === null)) {
    blockers.push('exact candidate id and version are missing')
  }
  for (const contractId of expected) {
    const bindings = definition.bindings.filter((binding) => binding.contractId === contractId && binding.mandatory)
    if (bindings.length === 0) blockers.push(`missing mandatory adapter binding for ${contractId}`)
    for (const binding of bindings) {
      if (!ADAPTERS.has(binding.adapterId)) blockers.push(`missing adapter ${binding.adapterId} for ${contractId}`)
      if (!RECEIPT_VALIDATORS.has(binding.receiptValidatorId)) blockers.push(`missing receipt validator ${binding.receiptValidatorId} for ${contractId}`)
      if (binding.proofMode === 'ci-appimage' && !hasArtifact(definition, 'ci-appimage')) blockers.push(`missing exact CI AppImage artifact identity for ${contractId}`)
      if (binding.proofMode === 'installed-deb' && !hasArtifact(definition, 'installed-deb')) blockers.push(`missing exact installed deb artifact identity for ${contractId}`)
    }
  }
  return blockers
}

/** Check the required capability inventory without treating a missing tool as pass. */
function validateCapabilities(definition) {
  const available = new Set(['node', 'fs'])
  if (hasCommand('git')) available.add('git')
  if (process.versions.electron !== undefined) available.add('electron')
  return definition.preflight.requiredCapabilities
    .filter((capability) => !available.has(capability))
    .map((capability) => `missing host capability ${capability}`)
}

/** Check free space on the campaign filesystem. */
async function checkFreeSpace(minimumBytes, campaignRoot) {
  try {
    const resolvedRoot = path.resolve(campaignRoot)
    const target = await pathExists(resolvedRoot) ? resolvedRoot : path.dirname(resolvedRoot)
    const usage = await statfs(target)
    const freeBytes = Number(usage.bavail) * Number(usage.bsize)
    return freeBytes >= minimumBytes ? [] : [`free space ${freeBytes} is below required ${minimumBytes}`]
  } catch (error) {
    return [`free-space capability unavailable: ${error.message}`]
  }
}

/** Write a deterministic environment-blocked attempt result. */
async function writeBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest, status, reason, binding, resumed = false }) {
  const receiptPath = path.join(attemptDirectory, resumed ? await nextAppendOnlyFileName(attemptDirectory, 'receipt') : 'receipt.json')
  const resultPath = path.join(attemptDirectory, resumed ? await nextAppendOnlyFileName(attemptDirectory, 'result') : 'result.json')
  await writeExclusiveJson(receiptPath, {
    schema: 'sartracker-qualification-contract-receipt-v1',
    campaignId: normalized.campaignId,
    attemptId,
    definitionDigest: normalized.definitionDigest,
    inputDigest,
    contractId: binding.contractId,
    variantId: binding.variantId,
    adapterId: binding.adapterId,
    proofMode: binding.proofMode,
    status,
    deterministic: true,
    evidence: [],
    observed: { reason },
  })
  await writeExclusiveJson(resultPath, {
    schema: 'sartracker-qualification-attempt-result-v1',
    campaignId: normalized.campaignId,
    attemptId,
    definitionDigest: normalized.definitionDigest,
    inputDigest,
    contractId: binding.contractId,
    variantId: binding.variantId,
    status,
    deterministicFailure: false,
    reason,
  })
  await appendState(attemptDirectory, { phase: 'blocked', status, reason })
  return Object.freeze({ status, attemptId, attemptDirectory, anchorPath: undefined, releaseEligible: false })
}

/** Write an immutable definition once, allowing only an exact same-byte rerun. */
async function writeIdempotentJson(filePath, value, label) {
  try {
    await writeExclusiveJson(filePath, value)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = JSON.parse(await readFile(filePath, 'utf8'))
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new Error(`Existing ${label} differs; choose a new output path for a new immutable input.`)
    }
  }
}

/** Seal every regular file in an attempt and place the anchor outside it. */
async function sealAttempt({ attemptDirectory, campaignRoot, campaignId, definitionDigest, attemptId }) {
  const directory = await requireRealDirectory(attemptDirectory, path.dirname(attemptDirectory), 'attempt directory')
  if (await pathExists(path.join(directory, 'manifest.json'))) throw new Error('Attempt is already sealed and cannot be mutated.')
  await appendState(directory, { phase: 'sealed', anchorPath: 'external-anchor-pending' })
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Attempt evidence is not a regular file: ${entry.name}.`)
    if (entry.name !== 'manifest.json' && entry.name !== 'seal.json') files.push(entry.name)
  }
  files.sort()
  const manifest = {
    schema: 'sartracker-qualification-evidence-manifest-v2',
    campaignId,
    attemptId,
    definitionDigest,
    files: await Promise.all(files.map(async (name) => {
      const identity = await strictFileIdentity(path.join(directory, name), 'attempt evidence')
      return { name, bytes: identity.bytes, sha256: identity.sha256, attemptId, campaignId }
    })),
  }
  await writeExclusiveJson(path.join(directory, 'manifest.json'), manifest)
  const seal = {
    schema: 'sartracker-qualification-seal-v2',
    campaignId,
    attemptId,
    definitionDigest,
    manifestSha256: sha256(await readFile(path.join(directory, 'manifest.json'))),
  }
  await writeExclusiveJson(path.join(directory, 'seal.json'), seal)
  const anchorsRoot = path.join(path.resolve(campaignRoot), 'anchors')
  await mkdir(anchorsRoot, { recursive: true, mode: 0o700 })
  const anchorPath = path.join(anchorsRoot, `${attemptId}.anchor.json`)
  await writeExclusiveJson(anchorPath, {
    schema: 'sartracker-qualification-external-anchor-v2',
    campaignId,
    attemptId,
    definitionDigest,
    sealSha256: sha256(await readFile(path.join(directory, 'seal.json'))),
  })
  return Object.freeze({ attemptDirectory: directory, anchorPath, sealPath: path.join(directory, 'seal.json') })
}

/** Validate the constrained judge-result schema and packet correlation. */
function validateJudgeResult(result, metadata, packetSha256) {
  if (result?.schema !== 'sartracker-oracle-blind-judge-result-v1') throw new Error('Judge result schema is invalid.')
  if (result.campaignId !== metadata.campaignId || result.attemptId !== metadata.attemptId) throw new Error('Judge result identity does not match the attempt.')
  if (result.packetSha256 !== packetSha256) throw new Error('Judge result packet identity does not match.')
  if (!JUDGE_VERDICTS.includes(result.verdict)) throw new Error('Judge result verdict is invalid.')
  if (!Array.isArray(result.observations)) throw new Error('Judge result observations are required.')
  const forbiddenKey = /oracle|expected|gate|secret|password|database|coordinate|raw/iu
  if (containsForbiddenKey(result, forbiddenKey)) throw new Error('Judge result contains oracle, private or deterministic evidence fields.')
  for (const observation of result.observations) {
    if (observation === null || typeof observation !== 'object' || typeof observation.captureName !== 'string') throw new Error('Judge observation identity is invalid.')
    requireSafeId(observation.captureName, 'judge capture name')
  }
}

/** Reject forbidden field names while allowing the fixed oracle-blind schema name. */
function containsForbiddenKey(value, forbiddenKey) {
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenKey(entry, forbiddenKey))
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, entry]) => forbiddenKey.test(key) || containsForbiddenKey(entry, forbiddenKey))
}

/** Create every contract row, including unexecuted rows, for visible coverage. */
async function allContractRows(definition, requiredRows) {
  const registry = JSON.parse(await readFile(definition.registryPath, 'utf8'))
  const byId = new Map(requiredRows.map((row) => [row.contractId, row]))
  return registry.contracts.map((contract) => ({
    contractId: contract.id,
    required: (definition.mode === 'candidate' ? REQUIRED_CANDIDATE_CONTRACTS : definition.requiredContracts).includes(contract.id),
    status: byId.get(contract.id)?.status ?? 'not-run',
    variantId: byId.get(contract.id)?.variantId ?? null,
  }))
}

/** Capture process/port baseline without claiming runtime qualification. */
async function captureBaseline(ports) {
  const portStates = []
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid baseline port: ${port}.`)
    portStates.push({ port, occupied: await probeTcpPort(port), probe: 'tcp-connect-127.0.0.1' })
  }
  let processSummary = `pid=${process.pid}`
  try {
    const result = await execFile('ps', ['-o', 'pid=,comm=', '-p', String(process.pid)])
    processSummary = result.stdout.trim()
  } catch {
    processSummary = `pid=${process.pid};ps-unavailable`
  }
  return Object.freeze({
    capturedAt: new Date().toISOString(),
    process: processSummary,
    ports: Object.freeze(portStates),
    cwd: process.cwd(),
  })
}

/** Probe a declared TCP port and fail closed when its state cannot be determined. */
function probeTcpPort(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (callback) => {
      socket.removeAllListeners()
      socket.destroy()
      callback()
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(() => resolve(true)))
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') finish(() => resolve(false))
      else finish(() => reject(new Error(`TCP port ${port} probe failed: ${error.message}`)))
    })
    socket.once('timeout', () => finish(() => reject(new Error(`TCP port ${port} probe timed out.`))))
  })
}

/** Append a state event without rewriting the previous event history. */
async function appendState(attemptDirectory, event) {
  await appendFile(path.join(attemptDirectory, 'state.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 })
}

/** Return a blocked preflight with no lease and no release authority. */
function preflightBlocked(definition, blockers) {
  return Object.freeze({
    status: 'ENVIRONMENT_BLOCKED',
    releaseEligible: false,
    definitionDigest: definition?.definitionDigest ?? null,
    blockers: Object.freeze(unique(blockers)),
  })
}

/** Resolve a plan path relative to its plan file when one exists. */
function resolvePlanPath(candidatePath, planPath) {
  return path.resolve(planPath ? path.dirname(planPath) : process.cwd(), candidatePath)
}

/** Resolve and hash a list of strict non-symlink files. */
async function identityList(paths, planPath, label) {
  return Object.freeze(await Promise.all(paths.map((filePath) => strictFileIdentity(resolvePlanPath(filePath, planPath), label))))
}

/** Resolve and hash declared artifacts without accepting local substitutes for CI modes. */
async function identityArtifacts(artifacts, planPath) {
  if (!Array.isArray(artifacts)) throw new Error('Campaign artifacts must be an array.')
  return Object.freeze(await Promise.all(artifacts.map(async (artifact) => {
    if (artifact === null || typeof artifact !== 'object' || typeof artifact.role !== 'string' || typeof artifact.path !== 'string') {
      throw new Error('Artifact identity needs a role and path.')
    }
    const identity = await strictFileIdentity(resolvePlanPath(artifact.path, planPath), 'artifact')
    return Object.freeze({ ...identity, role: artifact.role, ciRunId: artifact.ciRunId ?? null, localBuild: artifact.localBuild === true })
  })))
}

/** Reject symlinks before following a file identity. */
async function strictFileIdentity(filePath, label) {
  const resolved = path.resolve(filePath)
  const metadata = await lstat(resolved)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${filePath}.`)
  const identity = await fileIdentity(resolved)
  return Object.freeze({ ...identity, path: resolved })
}

/** Create a real campaign root without following a root symlink. */
async function requireRealRoot(rootPath, label) {
  const resolved = path.resolve(rootPath)
  try {
    const existing = await lstat(resolved)
    if (existing.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 })
  return requireRealDirectory(resolved, path.dirname(resolved), label)
}

/** Require a real directory whose canonical parent is the declared parent. */
async function requireRealDirectory(directoryPath, parentPath, label) {
  const metadata = await lstat(directoryPath)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be a real directory.`)
  const canonicalDirectory = await realpath(directoryPath)
  const canonicalParent = await realpath(parentPath)
  if (path.dirname(canonicalDirectory) !== canonicalParent) throw new Error(`${label} escaped its parent.`)
  return canonicalDirectory
}

/** Read only real child directories. */
async function safeReadDirectories(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/** Find a unique binding for a named contract variant. */
function findBinding(definition, contractId, variantId) {
  if (!CONTRACT_ID_PATTERN.test(contractId ?? '') || !SAFE_ID_PATTERN.test(variantId ?? '')) throw new Error('Contract and variant identity is invalid.')
  const binding = definition.bindings.find((candidate) => candidate.contractId === contractId && candidate.variantId === variantId)
  if (binding === undefined) throw new Error(`No immutable binding exists for ${contractId}:${variantId}.`)
  return binding
}

/** Compute the exact input identity used for execution and resume. */
function inputDigestFor(definition, binding) {
  return sha256(Buffer.from(canonicalJson({
    definitionDigest: definition.definitionDigest,
    contractId: binding.contractId,
    variantId: binding.variantId,
    adapterId: binding.adapterId,
    proofMode: binding.proofMode,
    identities: definition.identities,
  }), 'utf8'))
}

/** Test whether a declared artifact role is present and exact. */
function hasArtifact(definition, role) {
  return definition.identities.candidate.artifacts.some((artifact) => artifact.role === role && artifact.localBuild !== true)
}

/** Check command availability without making it a release claim. */
function hasCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Return a strict path list with duplicates removed. */
function uniquePaths(paths) {
  return [...new Set(paths)]
}

/** Require a safe identifier. */
function requireSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`)
}

/** Require unique non-empty strings. */
function uniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.trim() === '')) throw new Error(`${label} must contain non-empty strings.`)
  const normalized = values.map((value) => value.trim())
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicates.`)
  return normalized
}

/** Test whether an object is a valid file identity. */
function isIdentity(identity) {
  return identity !== null && typeof identity === 'object' && typeof identity.path === 'string'
    && Number.isSafeInteger(identity.bytes) && identity.bytes >= 0 && SHA256_PATTERN.test(identity.sha256)
}

/** Compare byte identities while ignoring path aliases. */
function sameIdentity(left, right) {
  return left?.bytes === right?.bytes && left?.sha256 === right?.sha256
}

/** Compare the exact clean source SHA, tree and dirty-state identity. */
function sameSourceIdentity(left, right) {
  return left?.sha === right?.sha && left?.tree === right?.tree && left?.dirty === right?.dirty
}

/** Return whether a file or directory exists. */
async function pathExists(filePath) {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** Remove the mutable digest field before recomputing an immutable definition digest. */
function stripDigest(definition) {
  const clone = structuredClone(definition)
  delete clone.definitionDigest
  return clone
}

/** Return unique values in insertion order. */
function unique(values) {
  return [...new Set(values)]
}

/** Write a JSON file once, refusing mutation or replacement. */
async function writeExclusiveJson(filePath, value) {
  const handle = await open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Write arbitrary evidence bytes once, refusing mutation or replacement. */
async function writeExclusiveBytes(filePath, bytes) {
  const handle = await open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
