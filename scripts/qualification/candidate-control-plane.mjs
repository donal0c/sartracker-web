import { randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { promisify } from 'node:util'
import { createConnection } from 'node:net'
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  link,
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
import { fileURLToPath } from 'node:url'
import { createHumanTrainingRequest, validateHumanTrainingSubmission, validateHumanPublicKey } from './human-request.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { compileRuntimeInputs, verifyRuntimeInputs } from './runtime-inputs.mjs'
import { compileSuiteBinding, executeSuiteVariant, validateRetainedSuite } from './suite-adapter.mjs'
import {
  assertC27Admission,
  assertC29Admission,
  assertPostpublicationAdmission,
  evaluateQualificationPhases,
  evaluateTechnicalHandover,
  validateQualificationPhase,
} from './campaign-phases.mjs'
import { compileReleaseInputs } from './release-receipts.mjs'
import { executeReleaseVariant, validateRetainedRelease } from './release-adapter.mjs'
import { executeIdentityVariant, validateRetainedIdentity } from './identity-adapter.mjs'
import { validateHostCapabilities } from './host-capabilities.mjs'
import { hashLiveConfigDirectory } from './live-config-identity.mjs'
import { C28_REQUIRED_VARIANTS } from './composite-coverage.mjs'
import {
  candidateClaimScopeMatchesReviewedPlan,
  candidateProductCapabilityResiduals,
  validateCandidateClaimScope,
} from './product-capabilities.mjs'
import {
  hasOwnedProcessCleanupMarker,
  isOwnedProcessCleanupError,
} from './owned-process-custody.mjs'

import {
  buildJudgePacket,
  canonicalJson,
  compileCoverageRegistry,
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
const CAPTURE_BYTE_LIMITS = Object.freeze({
  image: 25 * 1024 * 1024,
  'ui-screenshot': 25 * 1024 * 1024,
})
const PROOF_MODES = Object.freeze(['synthetic', 'source', 'browser', 'ci-appimage', 'installed-deb', 'external-human', 'public-release'])
const REQUIRED_CANDIDATE_CONTRACTS = Object.freeze(
  Array.from({ length: 30 }, (_, index) => `C${String(index).padStart(2, '0')}`),
)
const REQUIRED_C25_CANDIDATE_VARIANTS = Object.freeze([
  'normal',
  'extended',
  'field-960k',
  'field-2m',
  'field-local-1gib',
  'field-device-modes',
  'normal-installed',
  'extended-installed',
  'field-960k-installed',
  'field-2m-installed',
  'field-local-1gib-installed',
  'field-device-modes-installed',
])
const REQUIRED_C28_CANDIDATE_VARIANTS = Object.freeze(
  C28_REQUIRED_VARIANTS.flatMap((variantId) => [`${variantId}-appimage`, `${variantId}-installed`]),
)
const ADAPTERS = new Map()
const RECEIPT_VALIDATORS = new Map()
const OWNED_PROCESS_CUSTODY_ADAPTERS = Object.freeze([
  'live.get-only',
  'package.reviewed',
  'suite.source',
  'suite.browser',
])

registerCalibrationAdapters()
for (const proofMode of ['source', 'browser']) {
  ADAPTERS.set(`suite.${proofMode}`, async (context) => {
    const observed = await executeSuiteVariant({ ...context,
      expected: context.normalized.suiteExpectations[`${context.binding.contractId}:${context.binding.variantId}`] })
    return { status: observed.status, observed, captures: observed.captures ?? [] }
  })
}
RECEIPT_VALIDATORS.set('suite.receipt', async (receipt, binding, context) => {
  const checked = await validateRetainedSuite(receipt.observed, binding, { ...context,
    expected: context.definition.suiteExpectations[`${binding.contractId}:${binding.variantId}`] })
  if (checked.status !== receipt.status) throw new Error('Retained suite status differs from independently validated runner evidence.')
})
ADAPTERS.set('external.c29.training', async (context) => {
  const request = await expectedHumanRequest(context.normalized, context.attemptDirectory)
  await writeExclusiveJson(path.join(context.attemptDirectory, 'human-request.json'), request)
  return { status: 'NEEDS_HUMAN_DECISION', observed: { requestSha256: request.requestSha256 } }
})
RECEIPT_VALIDATORS.set('external.c29.receipt', validateRetainedHumanReceipt)
ADAPTERS.set('release.draft', executeReleaseVariant)
ADAPTERS.set('release.public-bytes', executeReleaseVariant)
RECEIPT_VALIDATORS.set('release.draft-receipt', validateRetainedRelease)
RECEIPT_VALIDATORS.set('release.public-receipt', validateRetainedRelease)
ADAPTERS.set('identity.ci-installed', executeIdentityVariant)
RECEIPT_VALIDATORS.set('identity.receipt', validateRetainedIdentity)
ADAPTERS.set('package.reviewed', async (context) => {
  const { executePackageVariant } = await import('./package-adapter.mjs')
  const observed = await executePackageVariant(context)
  return { status: observed.status, observed, captures: observed.captures ?? [] }
})
RECEIPT_VALIDATORS.set('package.receipt', async (receipt, binding, context) => {
  const { validateRetainedPackage } = await import('./package-adapter.mjs')
  const checked = await validateRetainedPackage(receipt.observed, binding, context)
  if (checked.status !== receipt.status) throw new Error('Package status differs from independently validated producer and runtime evidence.')
})
ADAPTERS.set('soak.reviewed', async (context) => {
  const { executeSoakVariant } = await import('./soak-adapter.mjs')
  const observed = await executeSoakVariant(context)
  return { status: observed.status, observed, captures: observed.captures ?? [] }
})
RECEIPT_VALIDATORS.set('soak.receipt', async (receipt, binding, context) => {
  const { validateRetainedSoak } = await import('./soak-adapter.mjs')
  const checked = await validateRetainedSoak(receipt.observed, binding, context)
  if (receipt.status === 'CLEANUP_BLOCKED' && receipt.observed?.workerExecution?.resourceCleanupBlocked === true) {
    if (checked.status !== 'INVALID_EVIDENCE') throw new Error('Cleanup-blocked soak evidence unexpectedly validated as a complete result.')
    return
  }
  if (checked.status !== receipt.status) throw new Error('Soak status differs from independently validated producer and runtime evidence.')
})
ADAPTERS.set('live.get-only', async (context) => {
  const { executeLiveVariant } = await import('./live-adapter.mjs')
  return executeLiveVariant(context)
})
RECEIPT_VALIDATORS.set('live.receipt', async (receipt, binding, context) => {
  const { validateRetainedLive } = await import('./live-adapter.mjs')
  const checked = await validateRetainedLive(receipt, binding, context)
  if (checked.status !== receipt.status) throw new Error('Live receipt differs from independently validated runtime and privacy-safe lane evidence.')
})

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
    uniquePaths([registryPath, ...await qualificationValidatorFiles(), ...(resolvedPlan.validatorPaths ?? [])]),
    planPath,
    'validator',
  )
  const runtimeInputs = resolvedPlan.runtimeInputPath === undefined ? null
    : await compileRuntimeInputs(resolvePlanPath(resolvedPlan.runtimeInputPath, planPath), sourceIdentity, resolvedPlan.version)
  const artifactInputs = runtimeInputs ? runtimeInputs.config.ci.installers.map((entry) => ({ ...entry,
    ciRunId: runtimeInputs.config.ci.provenance.runId, localBuild: false })) : resolvedPlan.artifacts ?? []
  const artifacts = await identityArtifacts(artifactInputs, planPath)
  const externalHuman = await compileHumanAuthority(resolvedPlan.externalHuman, planPath, resolvedPlan.mode)
  const reviewedPlanIdentity = resolvedPlan.mode === 'candidate'
    ? await strictFileIdentity(reviewedCandidatePlanPath(), 'reviewed candidate plan') : null
  validateSourceIdentity(sourceIdentity)
  const suiteExpectations = {}
  for (const binding of resolvedPlan.bindings.filter((entry) => entry.adapterId.startsWith('suite.'))) {
    if (binding.adapterId !== `suite.${binding.proofMode}` || binding.receiptValidatorId !== 'suite.receipt') {
      throw new Error('Suite adapter and validator must match the declared source/browser proof tier.')
    }
    suiteExpectations[`${binding.contractId}:${binding.variantId}`] = await compileSuiteBinding(binding, sourceIdentity.sha)
  }

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
    claimScope: resolvedPlan.claimScope ?? null,
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
        unique([...resolvedPlan.bindings.map((binding) => binding.capability).filter(Boolean),
          ...(resolvedPlan.mode === 'candidate' ? ['git', 'gh', 'owned-process-supervisor'] : [])]),
        'requiredCapabilities',
      ),
      baselinePorts: resolvedPlan.baselinePorts ?? [],
    },
    planIdentity,
    externalHuman,
    reviewedPlanIdentity,
    runtimeInputs,
    releaseInputs: resolvedPlan.release === undefined ? null : compileReleaseInputs(resolvedPlan.release, resolvedPlan.version),
    suiteExpectations,
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

/** Bind the complete reviewed qualification and build-validator module inventory, including imported helpers. */
async function qualificationValidatorFiles() {
  const qualificationRoot = path.dirname(fileURLToPath(import.meta.url))
  const buildRoot = path.resolve(qualificationRoot, '../../build')
  const files = []
  for (const directory of [qualificationRoot, buildRoot]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (/\.(?:mjs|cjs|js|py)$/u.test(entry.name)) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Qualification validator inventory contains a non-regular module.')
        files.push(path.join(directory, entry.name))
      }
    }
  }
  return files.sort()
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
  const leasesRoot = path.join(root, 'leases')
  const leaseRoot = path.join(leasesRoot, leaseId)
  const owner = await processOwnerIdentity(process.pid)
  const leasePath = path.join(leaseRoot, 'lease.json')
  let published = false
  await mkdir(leasesRoot, { recursive: true, mode: 0o700 })
  const leasesInfo = await lstat(leasesRoot)
  if (!leasesInfo.isDirectory() || leasesInfo.isSymbolicLink() || await realpath(leasesRoot) !== leasesRoot) {
    throw new Error('Campaign lease root must be a real directory.')
  }
  try {
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
      pid: owner.pid,
      host: owner.host,
      bootId: owner.bootId,
      processStart: owner.processStart,
      platform: process.platform,
      arch: process.arch,
      acquiredAt: new Date().toISOString(),
      campaignRoot: root,
      campaignLockPath,
      disposableRoots,
      baseline: await captureBaseline(definition.preflight.baselinePorts),
    }
    await writeExclusiveJson(leasePath, lease)
    try {
      await link(leasePath, campaignLockPath)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await rm(leaseRoot, { recursive: true, force: false })
      return recoverExistingCampaignLease({ root, campaignLockPath, definition, owner })
    }
    published = true
    return leaseFromState(leasePath, lease)
  } catch (error) {
    if (!published) await rm(leaseRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/** Resolve a competing final lock after this process has rolled back its unpublished lease. */
async function recoverExistingCampaignLease({ root, campaignLockPath, definition, owner }) {
  const lockInfo = await lstat(campaignLockPath)
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink() || lockInfo.size > 1024 * 1024) {
    throw new Error('Campaign lease lock is not a regular recoverable file.')
  }
  const existingLock = JSON.parse(await readFile(campaignLockPath, 'utf8'))
  if (existingLock.campaignId !== definition.campaignId || existingLock.definitionDigest !== definition.definitionDigest) {
    throw new Error('A different immutable campaign already owns the campaign lease.')
  }
  if (existingLock.status !== 'ACQUIRED' || existingLock.campaignLockPath !== campaignLockPath
      || typeof existingLock.leaseId !== 'string' || !SAFE_ID_PATTERN.test(existingLock.leaseId)) {
    throw new Error('Campaign lease lock has an invalid recoverable identity.')
  }
  const sameOwner = existingLock.host === owner.host && existingLock.bootId === owner.bootId
    && existingLock.pid === owner.pid && existingLock.processStart === owner.processStart
  if (!sameOwner) {
    if (existingLock.host === owner.host && existingLock.bootId === owner.bootId && processIsAlive(existingLock.pid)) {
      throw new Error(`Campaign lease is held by live process ${existingLock.pid} on ${existingLock.host}.`)
    }
    throw new Error('Campaign lease is held by another host or has a stale owner; explicit cleanup is required.')
  }
  const existingLeasePath = path.join(root, 'leases', existingLock.leaseId, 'lease.json')
  const existingLeaseInfo = await lstat(existingLeasePath).catch(() => null)
  if (existingLeaseInfo === null || !existingLeaseInfo.isFile() || existingLeaseInfo.isSymbolicLink()
      || existingLeaseInfo.size > 1024 * 1024 || existingLeaseInfo.dev !== lockInfo.dev || existingLeaseInfo.ino !== lockInfo.ino) {
    throw new Error('Campaign lease lock exists without a recoverable lease.')
  }
  const existingLease = JSON.parse(await readFile(existingLeasePath, 'utf8'))
  if (existingLease.status !== 'ACQUIRED' || existingLease.pid !== owner.pid
      || existingLease.host !== owner.host || existingLease.bootId !== owner.bootId
      || existingLease.processStart !== owner.processStart) {
    throw new Error('Campaign lease owner identity is not recoverable.')
  }
  return leaseFromState(existingLeasePath, existingLease)
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

/** Bind a lease to the host boot and process-start instance, not PID alone. */
async function processOwnerIdentity(pid) {
  const processStart = await processStartFingerprint(pid)
  const bootId = await bootFingerprint()
  return Object.freeze({ pid, host: os.hostname(), bootId, processStart })
}

/** Read a stable process-start marker on the supported qualification hosts. */
async function processStartFingerprint(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Lease process identity requires a positive PID.')
  if (process.platform === 'linux') {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u)
    const startTicks = fields[19]
    if (!/^\d+$/u.test(startTicks ?? '')) throw new Error('Lease process start identity is unavailable.')
    return `linux:${startTicks}`
  }
  const result = await execFile('ps', ['-o', 'lstart=', '-p', String(pid)])
  const value = result.stdout.trim()
  if (value === '' || value.length > 128) throw new Error('Lease process start identity is unavailable.')
  return `${process.platform}:${value}`
}

/** Read a stable host-boot marker so a reused PID from another boot cannot own a lease. */
async function bootFingerprint() {
  if (process.platform === 'linux') {
    const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
    if (!/^[a-f0-9-]{8,128}$/u.test(value)) throw new Error('Lease host boot identity is unavailable.')
    return `linux:${value}`
  }
  if (process.platform === 'darwin') {
    const result = await execFile('sysctl', ['-n', 'kern.boottime'])
    const value = result.stdout.trim()
    if (value === '' || value.length > 128) throw new Error('Lease host boot identity is unavailable.')
    return `darwin:${value}`
  }
  throw new Error('Lease host boot identity is unsupported on this platform.')
}

/** Compare persisted lease ownership with the current process instance. */
function sameProcessOwner(lease, owner) {
  return lease.host === owner.host && lease.bootId === owner.bootId
    && lease.pid === owner.pid && lease.processStart === owner.processStart
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
  if (normalized.mode === 'candidate' && currentSourceIdentity === undefined) {
    blockers.push('current clean source identity is required for candidate preflight')
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

  if (blockers.length > 0) return preflightBlocked(normalized, blockers)

  let lease
  try {
    lease = await createCampaignLease({ campaignRoot, definition: normalized })
    let runtime = null
    if (normalized.mode === 'candidate') {
      const workDirectory = path.join(lease.disposableRoots.find((root) => path.basename(root) === 'fixtures'), 'candidate-inputs')
      await mkdir(workDirectory, { recursive: false, mode: 0o700 })
      runtime = await verifyRuntimeInputs(normalized.runtimeInputs, normalized.identities.source, normalized.identities.candidate.version, workDirectory)
    }
    return Object.freeze({
      status: 'READY',
      releaseEligible: false,
      blockers: Object.freeze([]),
      definitionDigest: normalized.definitionDigest,
      lease,
      baseline: lease.baseline,
      runtime,
    })
  } catch (error) {
    if (lease !== undefined) {
      try { await cleanupCampaignLease({ leasePath: lease.leasePath }) }
      catch { return preflightBlocked(normalized, [`runtime preflight: ${error.message}`, 'owned preflight cleanup could not be completed']) }
    }
    return preflightBlocked(normalized, [`preflight: ${error.message}`])
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
  const changedInputs = await verifyBoundIdentities(normalized)
  if (changedInputs.length > 0) throw new Error(changedInputs.join('; '))
  await assertOwnedCampaignLease(preflight.lease, campaignRoot, normalized)
  const binding = findBinding(normalized, contractId, variantId)
  if (binding.proofMode === 'external-human' && !normalized.externalHuman) {
    throw new Error('C29 requires independently bound human authority and authorization before human acceptance can run; technical evidence does not replace it.')
  }
  if (binding.phase === 'postpublication') {
    const verdict = await computeCampaignVerdict({ definition: normalized, campaignRoot })
    assertPostpublicationAdmission(verdict, normalized.bindings, binding)
  } else if (normalized.mode === 'candidate' && binding.contractId === 'C27') {
    const verdict = await computeCampaignVerdict({ definition: normalized, campaignRoot })
    assertC27Admission(verdict, normalized.bindings, binding)
  } else if (normalized.mode === 'candidate' && binding.contractId === 'C29') {
    const verdict = await computeCampaignVerdict({ definition: normalized, campaignRoot })
    assertC29Admission(verdict, normalized.bindings)
  }
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
  let resourceCleanupBlocked = false
  let receiptPersistenceBlocked = false
  const persistBlockedAttempt = async (options) => {
    try {
      return await writeBlockedAttempt(options)
    } catch (error) {
      if (isReceiptPersistenceError(error)) receiptPersistenceBlocked = true
      throw error
    }
  }
  try {
    let workDirectory
    try {
      resourceLock = await acquireResourceLock(campaignRoot, binding.resourceKey ?? 'default', normalized.definitionDigest)
      const fixturesRoot = preflight.lease.disposableRoots.find((root) => path.basename(root) === 'fixtures')
      if (typeof fixturesRoot !== 'string') throw new Error('owned fixtures root is unavailable')
      workDirectory = path.join(fixturesRoot, `${attemptId}-${randomUUID()}`)
      await mkdir(workDirectory, { recursive: false, mode: 0o700 })
    } catch {
      return await persistBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest,
        status: 'ENVIRONMENT_BLOCKED', reason: 'Owned attempt setup could not be completed before adapter execution.', binding, resumed })
    }
    let execution
    try {
      execution = await adapter({
        normalized,
        attemptDirectory,
        attemptId,
        campaignId: normalized.campaignId,
        definitionDigest: normalized.definitionDigest,
        inputDigest,
        resumed,
        binding,
        workDirectory,
      })
      resourceCleanupBlocked = binding.adapterId === 'soak.reviewed' && (
        execution?.workerExecution?.resourceCleanupBlocked === true
        || execution?.observed?.workerExecution?.resourceCleanupBlocked === true)
      if (OWNED_PROCESS_CUSTODY_ADAPTERS.includes(binding.adapterId)
          && hasOwnedProcessCleanupMarker(execution)) {
        resourceCleanupBlocked = true
        return await persistBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest,
          status: 'CLEANUP_BLOCKED', reason: 'Owned producer cleanup was not proven; resource lock is retained for manual recovery.', binding, resumed })
      }
    } catch (error) {
      // Producers retain bounded diagnostics themselves. Do not copy arbitrary
      // exception text, which may contain private configuration, into receipts.
      // The soak wrapper may report that its receipt write failed after the
      // worker cleanup boundary was unproven. Preserve that typed custody
      // signal so the resource lock cannot be released by this catch path.
      if (isReceiptPersistenceError(error)) {
        receiptPersistenceBlocked = true
        throw error
      }
      resourceCleanupBlocked = (binding.adapterId === 'soak.reviewed'
        && error?.code === 'SOAK_RESOURCE_CLEANUP_BLOCKED'
        && error?.resourceCleanupBlocked === true)
        || (OWNED_PROCESS_CUSTODY_ADAPTERS.includes(binding.adapterId)
          && isOwnedProcessCleanupError(error, binding.adapterId))
      return await persistBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest,
        status: resourceCleanupBlocked ? 'CLEANUP_BLOCKED' : 'INVALID_EVIDENCE',
        reason: resourceCleanupBlocked
          ? (binding.adapterId === 'soak.reviewed'
            ? 'Soak receipt retention failed while cleanup was unproven; resource lock is retained for manual recovery.'
            : 'Owned producer cleanup was not proven; resource lock is retained for manual recovery.')
          : 'Adapter terminated without a valid execution receipt; inspect retained producer evidence.',
        binding, resumed })
    }
    let captures
    try {
      captures = await materializeCaptures(
        execution.captures ?? [],
        attemptDirectory,
        attemptsRoot,
        normalized.mode,
      )
    } catch (error) {
      return await persistBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest,
        status: resourceCleanupBlocked ? 'CLEANUP_BLOCKED' : 'INVALID_EVIDENCE',
        reason: resourceCleanupBlocked ? 'Owned producer cleanup was not proven; resource lock is retained for manual recovery.' : error.message,
        binding, resumed })
    }
    const persistedExecution = resourceCleanupBlocked
      ? { ...execution, status: 'CLEANUP_BLOCKED' }
      : execution
    try {
      return await writeExecutionReceipt({ normalized, binding, validator, execution: persistedExecution,
        captures, attemptId, attemptDirectory, inputDigest, resumed })
    } catch (error) {
      if (isReceiptPersistenceError(error)) receiptPersistenceBlocked = true
      throw error
    }
  } finally {
    if (resourceLock !== undefined && !resourceCleanupBlocked && !receiptPersistenceBlocked) await releaseResourceLock(resourceLock)
  }
}

/** Re-read lease ownership immediately before using any campaign resource. */
async function assertOwnedCampaignLease(handle, campaignRoot, definition) {
  const root = await realpath(campaignRoot).catch(() => { throw new Error('Preflight lease campaign root is unavailable.') })
  if (path.dirname(path.dirname(path.resolve(handle.leasePath))) !== path.join(root, 'leases')) {
    throw new Error('Preflight lease belongs to a different campaign root.')
  }
  const leaseInfo = await lstat(handle.leasePath)
  const lockPath = path.join(root, 'campaign.lock')
  const lockInfo = await lstat(lockPath)
  if (!leaseInfo.isFile() || leaseInfo.isSymbolicLink() || !lockInfo.isFile() || lockInfo.isSymbolicLink()
      || leaseInfo.dev !== lockInfo.dev || leaseInfo.ino !== lockInfo.ino) {
    throw new Error('Preflight lease custody changed before execution.')
  }
  const lease = JSON.parse(await readFile(handle.leasePath, 'utf8'))
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const currentOwner = await processOwnerIdentity(process.pid)
  if (lease.status !== 'ACQUIRED' || lease.campaignRoot !== root
      || lease.definitionDigest !== definition.definitionDigest || lock.definitionDigest !== definition.definitionDigest
      || lease.campaignId !== definition.campaignId || lock.campaignId !== definition.campaignId
      || lease.leaseId !== handle.leaseId || lock.leaseId !== lease.leaseId
      || !sameProcessOwner(lease, currentOwner) || !sameProcessOwner(lock, currentOwner)) {
    throw new Error('Preflight lease ownership changed before execution.')
  }
}

/** Bind externally supplied public authority and authorization files at compilation. */
async function compileHumanAuthority(config, planPath, mode = 'calibration') {
  if (config === undefined) return null
  if (!config || typeof config.authorityPath !== 'string' || typeof config.authorizationPath !== 'string') {
    throw new Error('External human authority and authorization paths are required.')
  }
  const authorityRead = await readBoundJsonFile(resolvePlanPath(config.authorityPath, planPath), 'human authority')
  const authorityIdentity = authorityRead.identity
  const authorizationIdentity = await strictFileIdentity(resolvePlanPath(config.authorizationPath, planPath), 'human authorization')
  if (authorityIdentity.bytes > 16384 || authorizationIdentity.bytes < 1 || authorizationIdentity.bytes > 1024 * 1024) {
    throw new Error('External authority inputs exceed their bounded size or are empty.')
  }
  const authority = authorityRead.value
  if (Object.keys(authority).sort().join(',') !== ['dataClass', 'machineId', 'profileSha256', 'publicKey', 'signerId'].sort().join(',')) {
    throw new Error('External human authority must contain only named public training authority fields.')
  }
  validateHumanPublicKey(authority.publicKey)
  const publicKeySha256 = sha256(Buffer.from(authority.publicKey, 'utf8'))
  if (mode === 'candidate'
      && (!SHA256_PATTERN.test(config.trustedPublicKeySha256 ?? '') || config.trustedPublicKeySha256 !== publicKeySha256)) {
    throw new Error('Candidate human authority requires a reviewed public-key digest; a campaign cannot nominate its own signing key.')
  }
  return {
    authorityPath: config.authorityPath,
    authorizationPath: config.authorizationPath,
    trustedPublicKeySha256: config.trustedPublicKeySha256 ?? null,
    authorityIdentity,
    authorizationIdentity,
    authority: { ...authority, authorizationSha256: authorizationIdentity.sha256 },
  }
}

/** Reconstruct the request from bound inputs and immutable attempt metadata. */
async function expectedHumanRequest(definition, attemptDirectory) {
  const metadata = JSON.parse(await readFile(path.join(attemptDirectory, 'attempt.json'), 'utf8'))
  const binding = findBinding(definition, metadata.contractId, metadata.variantId)
  const artifact = definition.identities.candidate.artifacts.find((entry) => entry.role === 'ci-deb' && entry.localBuild !== true)
  if (binding.adapterId !== 'external.c29.training' || binding.receiptValidatorId !== 'external.c29.receipt'
      || binding.proofMode !== 'external-human' || !definition.externalHuman || !artifact
      || metadata.campaignId !== definition.campaignId || metadata.definitionDigest !== definition.definitionDigest
      || metadata.inputDigest !== inputDigestFor(definition, binding)) throw new Error('Human request is outside the bound C29 campaign.')
  return createHumanTrainingRequest({ campaignId: definition.campaignId, definitionDigest: definition.definitionDigest,
    inputDigest: metadata.inputDigest, attemptId: metadata.attemptId, variantId: metadata.variantId,
    sourceSha: definition.identities.source.sha, artifactSha256: artifact.sha256, createdAt: metadata.startedAt }, definition.externalHuman.authority)
}

/** Independently revalidate retained pending or accepted human evidence; never consult a model result. */
async function validateRetainedHumanReceipt(receipt, binding, { definition, attemptDirectory }) {
  const request = await expectedHumanRequest(definition, attemptDirectory)
  const retained = JSON.parse(await readFile(path.join(attemptDirectory, 'human-request.json'), 'utf8'))
  if (canonicalJson(request) !== canonicalJson(retained) || receipt.observed?.requestSha256 !== request.requestSha256
      || receipt.attemptId !== request.attemptId || receipt.definitionDigest !== request.definitionDigest
      || receipt.inputDigest !== request.inputDigest || receipt.contractId !== 'C29'
      || receipt.variantId !== binding.variantId || receipt.proofMode !== 'external-human') {
    throw new Error('Human receipt differs from the independently bound request.')
  }
  if (receipt.status === 'NEEDS_HUMAN_DECISION') return
  if (receipt.status !== 'PASS') throw new Error('Human acceptance is absent.')
  const envelope = JSON.parse(await readFile(path.join(attemptDirectory, 'human-envelope.json'), 'utf8'))
  const evidence = await readFile(path.join(attemptDirectory, 'human-evidence.bin'))
  validateHumanTrainingSubmission(request, envelope, evidence, receipt.observed.receivedAt)
}

/** Read an external regular-file submission within a fixed size bound. */
async function readBoundedSubmission(filename, maximum) {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) throw new Error('Human submission size or file type is outside its bound.')
  const identity = await strictFileIdentity(filename, 'human submission')
  if (identity.bytes < 1 || identity.bytes > maximum) throw new Error('Human submission size is outside its bound.')
  const bytes = await readFile(identity.path)
  if (sha256(bytes) !== identity.sha256) throw new Error('Human submission changed while being copied.')
  return bytes
}

/**
 * Import externally signed C29 acceptance under an owned lease, preserving the
 * original pending request and copied bytes. Invalid submissions become retained
 * invalid attempts; neither a generated signature nor an advisory pass is used.
 */
export async function ingestHumanTrainingEvidence({ definition, preflight, campaignRoot, attemptId, envelopePath, evidencePath }) {
  const normalized = validateDefinition(definition)
  if (preflight?.status !== 'READY' || preflight.definitionDigest !== normalized.definitionDigest) throw new Error('Human ingestion requires a current READY preflight.')
  await assertOwnedCampaignLease(preflight.lease, campaignRoot, normalized)
  const changed = await verifyBoundIdentities(normalized)
  if (changed.length) throw new Error(changed.join('; '))
  requireSafeId(attemptId, 'human attempt id')
  const attemptsRoot = path.join(path.resolve(campaignRoot), 'attempts')
  const attemptDirectory = await requireRealDirectory(path.join(attemptsRoot, attemptId), attemptsRoot, 'human attempt directory')
  if (await pathExists(path.join(attemptDirectory, 'seal.json'))) throw new Error('Human attempt is already sealed.')
  const previous = await readLatestAttemptResult(attemptDirectory)
  if (previous.status !== 'NEEDS_HUMAN_DECISION') throw new Error('Only a pending human request can accept a submission.')
  const binding = findBinding(normalized, previous.contractId, previous.variantId)
  const request = await expectedHumanRequest(normalized, attemptDirectory)
  const lock = await acquireResourceLock(campaignRoot, `human-${attemptId}`, normalized.definitionDigest)
  let retainReceiptPersistenceLock = false
  try {
    if (await pathExists(path.join(attemptDirectory, 'seal.json'))
        || (await readLatestAttemptResult(attemptDirectory)).status !== 'NEEDS_HUMAN_DECISION') {
      throw new Error('Only an unsealed pending human request can accept a submission.')
    }
    const receivedAt = new Date().toISOString()
    try {
      const envelopeBytes = await readBoundedSubmission(envelopePath, 256 * 1024)
      const evidenceBytes = await readBoundedSubmission(evidencePath, 16 * 1024 * 1024)
      await writeExclusiveBytes(path.join(attemptDirectory, 'human-envelope.json'), envelopeBytes)
      await writeExclusiveBytes(path.join(attemptDirectory, 'human-evidence.bin'), evidenceBytes)
      validateHumanTrainingSubmission(request, JSON.parse(envelopeBytes.toString('utf8')), evidenceBytes, receivedAt)
    } catch {
      try {
        return await writeBlockedAttempt({ normalized, attemptId, attemptDirectory, inputDigest: request.inputDigest,
          status: 'INVALID_EVIDENCE', reason: 'External human submission could not be retained or failed signature, identity, custody or training admission validation.', binding, resumed: true })
      } catch (error) {
        if (isReceiptPersistenceError(error)) retainReceiptPersistenceLock = true
        throw error
      }
    }
    try {
      return await writeExecutionReceipt({ normalized, binding, validator: validateRetainedHumanReceipt,
        execution: { status: 'PASS', observed: { requestSha256: request.requestSha256, receivedAt },
          evidence: ['human-request.json', 'human-envelope.json', 'human-evidence.bin'] }, captures: [],
        attemptId, attemptDirectory, inputDigest: request.inputDigest, resumed: true })
    } catch (error) {
      if (isReceiptPersistenceError(error)) retainReceiptPersistenceLock = true
      throw error
    }
  } finally {
    if (!retainReceiptPersistenceLock) await releaseResourceLock(lock)
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
  await validator(receipt, binding, { definition: normalized, attemptDirectory })
  try {
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

    if (!requiresAdvisoryJudge(normalized, binding)) {
      const pendingExternalHuman = execution.status === 'NEEDS_HUMAN_DECISION'
        && binding.proofMode === 'external-human'
      const sealed = !pendingExternalHuman ? await sealAttempt({ attemptDirectory,
        campaignRoot: path.dirname(path.dirname(attemptDirectory)), campaignId: normalized.campaignId,
        definitionDigest: normalized.definitionDigest, attemptId }) : {}
      return Object.freeze({ ...sealed, status: execution.status, attemptId, attemptDirectory, releaseEligible: false })
    }

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
  } catch (error) {
    if (isReceiptPersistenceError(error)) throw error
    throw createReceiptPersistenceError()
  }
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
export async function verifyCampaignAttempt({ attemptDirectory, anchorPath, definition }) {
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
  if (definition !== undefined) {
    const normalized = validateDefinition(definition)
    const binding = findBinding(normalized, metadata.contractId, metadata.variantId)
    const receiptPath = await latestAttemptFile(directory, /^receipt(?:-resume-\d+)?\.json$/u, 'contract receipt')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    for (const record of [metadata, result, receipt]) {
      if (record.campaignId !== normalized.campaignId || record.definitionDigest !== normalized.definitionDigest
          || record.attemptId !== metadata.attemptId || record.inputDigest !== inputDigestFor(normalized, binding)
          || record.contractId !== binding.contractId || record.variantId !== binding.variantId) {
        throw new Error('Retained evidence differs from its immutable campaign binding.')
      }
    }
    if (receipt.adapterId !== binding.adapterId || receipt.proofMode !== binding.proofMode
        || receipt.status !== result.status || receipt.deterministic !== true) {
      throw new Error('Retained receipt proof tier, adapter or result differs from its binding.')
    }
    const validator = RECEIPT_VALIDATORS.get(binding.receiptValidatorId)
    if (validator === undefined) throw new Error('Retained receipt validator is unavailable.')
    await validator(receipt, binding, { definition: normalized, attemptDirectory: directory })
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
  const allAttempts = []
  const evidenceErrors = await verifyBoundIdentities(normalized)
  const judgeHolds = []
  const deterministicFailures = []
  const notClaimedCapabilities = candidateProductCapabilityResiduals(normalized.mode, normalized.claimScope)
  const environmentBlockers = validateBindingCoverage(normalized)
  const aborted = []
  const cleanupBlocked = []
  for (const entry of entries) {
    const attemptDirectory = path.join(attemptsRoot, entry)
    try {
      const result = await readLatestAttemptResult(attemptDirectory)
      const binding = findBinding(normalized, result.contractId, result.variantId)
      if (result.campaignId !== normalized.campaignId
          || result.definitionDigest !== normalized.definitionDigest
          || result.inputDigest !== inputDigestFor(normalized, binding)) {
        throw new Error('Attempt does not belong to this immutable campaign and binding.')
      }
      const rowKey = `${result.contractId}:${result.variantId}`
      allAttempts.push(result)
      const existing = rows.get(rowKey)
      if (existing === undefined || result.attemptId > existing.attemptId) rows.set(rowKey, result)
      if (result.status === 'FAIL') deterministicFailures.push(result.contractId)
      if (result.status === 'ENVIRONMENT_BLOCKED') environmentBlockers.push(result.reason ?? result.contractId)
      if (result.status === 'ABORTED_SAFE') aborted.push(result.contractId)
      if (result.status === 'INVALID_EVIDENCE') evidenceErrors.push(`${entry}: variant reported INVALID_EVIDENCE`)
      if (result.status === 'NEEDS_HUMAN_DECISION') judgeHolds.push(result.contractId)
      if (result.status === 'CLEANUP_BLOCKED') cleanupBlocked.push(result.contractId)
      const anchorPath = path.join(root, 'anchors', `${result.attemptId}.anchor.json`)
      const sealPath = path.join(attemptDirectory, 'seal.json')
      const judgeResultPath = path.join(attemptDirectory, 'judge-result.json')
      if (!(await pathExists(sealPath))) {
        if (result.status === 'ENVIRONMENT_BLOCKED') environmentBlockers.push(result.reason ?? result.contractId)
        else if (result.status === 'NEEDS_HUMAN_DECISION' && binding.proofMode === 'external-human') {
          const receipt = JSON.parse(await readFile(await latestAttemptFile(attemptDirectory, /^receipt(?:-resume-\d+)?\.json$/u, 'human receipt'), 'utf8'))
          await validateRetainedHumanReceipt(receipt, binding, { definition: normalized, attemptDirectory })
        }
        else evidenceErrors.push(`${entry}: attempt is not sealed`)
      } else {
        await verifyCampaignAttempt({ attemptDirectory, anchorPath, definition: normalized })
        if (requiresAdvisoryJudge(normalized, binding)) {
          if (!(await pathExists(judgeResultPath))) throw new Error('sealed attempt is missing the advisory judge result.')
          const judge = JSON.parse(await readFile(judgeResultPath, 'utf8'))
          if (judge.verdict !== 'pass') judgeHolds.push(result.contractId)
        }
      }
    } catch (error) {
      evidenceErrors.push(`${entry}: ${error.message}`)
    }
  }

  const requiredContracts = normalized.mode === 'candidate' ? REQUIRED_CANDIDATE_CONTRACTS : normalized.requiredContracts
  const requiredRows = requiredContracts.map((contractId) => {
    const candidates = [...rows.values()].filter((result) => result.contractId === contractId)
    const bindings = normalized.bindings.filter((binding) => binding.contractId === contractId && binding.mandatory)
    const latest = candidates.sort((left, right) => left.attemptId.localeCompare(right.attemptId)).at(-1)
    if (latest === undefined) return { contractId, variantId: null, status: 'not-run' }
    if (bindings.some((binding) => !rows.has(`${contractId}:${binding.variantId}`))) {
      return { contractId, variantId: null, status: 'not-run' }
    }
    const nonPassing = candidates.find((result) => result.status !== 'PASS')
    if (nonPassing !== undefined) return nonPassing
    const contractResiduals = notClaimedCapabilities.filter((entry) => entry.contractIds.includes(contractId))
    if (contractResiduals.length > 0) {
      return { ...latest, status: 'SCOPE_LIMITED', notClaimedCapabilities: contractResiduals }
    }
    return latest
  })
  const missingRequired = requiredRows.filter((row) => row.status === 'not-run').map((row) => row.contractId)
  const missingVariants = normalized.bindings.filter((binding) => binding.mandatory
    && !rows.has(`${binding.contractId}:${binding.variantId}`))
  environmentBlockers.push(...missingVariants.map((binding) => `missing required variant ${binding.contractId}:${binding.variantId}`))
  const status = evidenceErrors.length > 0
    ? 'INVALID_EVIDENCE'
    : cleanupBlocked.length > 0
      ? 'CLEANUP_BLOCKED'
      : deterministicFailures.length > 0
        ? 'FAIL'
        : aborted.length > 0
          ? 'ABORTED_SAFE'
          : environmentBlockers.length > 0 || missingRequired.length > 0
            ? 'ENVIRONMENT_BLOCKED'
            : judgeHolds.length > 0
              ? 'NEEDS_HUMAN_DECISION'
              : requiredRows.every((row) => row.status === 'PASS')
                ? 'PASS'
                : requiredRows.every((row) => ['PASS', 'SCOPE_LIMITED'].includes(row.status))
                  ? 'SCOPE_LIMITED' : 'INVALID_EVIDENCE'
  const verdict = {
    schema: 'sartracker-qualification-campaign-verdict-v1',
    campaignId: normalized.campaignId,
    // A passing calibration/development campaign is evidence for that mode
    // only. Retain the mode in the verdict so it cannot be mistaken for
    // candidate qualification by a downstream consumer.
    mode: normalized.mode,
    definitionDigest: normalized.definitionDigest,
    verdict: status,
    phases: evaluateQualificationPhases(normalized.bindings, allAttempts.map((attempt) => ({ ...attempt,
      status: attempt.status === 'PASS' && judgeHolds.includes(attempt.contractId) ? 'NEEDS_HUMAN_DECISION' : attempt.status,
    })), evidenceErrors, notClaimedCapabilities, { mode: normalized.mode }),
    releaseEligible: false,
    claimScope: normalized.claimScope,
    notClaimedCapabilities,
    deterministicFailures: Object.freeze(unique(deterministicFailures)),
    judgeHolds: Object.freeze(unique(judgeHolds)),
    blockers: Object.freeze(unique([...environmentBlockers, ...missingRequired.map((id) => `missing required contract ${id}`)])),
    evidenceErrors: Object.freeze(evidenceErrors),
    contractRows: Object.freeze(await allContractRows(normalized, requiredRows)),
    attempts: Object.freeze(entries),
    retainedAttemptStatuses: Object.freeze(allAttempts.map(({ contractId, variantId, attemptId, status }) => Object.freeze({
      contractId, variantId, attemptId, status,
    }))),
  }
  return Object.freeze({ ...verdict, technicalHandover: evaluateTechnicalHandover(verdict, normalized.bindings) })
}

/** Keep source/identity/cryptographic receipts deterministic while preserving every required visual judge. */
export function requiresAdvisoryJudge(definition, binding) {
  if (['source', 'external-human'].includes(binding.proofMode)) return false
  // C05's mandatory synthetic browser sibling supplies the visual judgment.
  // Private live coordinates/screenshots never enter an oracle-blind model packet.
  if (binding.contractId === 'C05' && binding.adapterId === 'live.get-only'
      && definition.bindings.some((entry) => entry.contractId === 'C05' && entry.mandatory
        && entry.proofMode === 'browser' && entry.adapterId === 'suite.browser')) return false
  if (binding.adapterId.startsWith('calibration.')) return true
  const contract = definition.registryCoverage.contracts.find((entry) => entry.id === binding.contractId)
  if (!contract) throw new Error('Advisory policy has no immutable registry contract.')
  return contract.judge === 'advisory'
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
  const file = await lstat(leasePath)
  if (!file.isFile() || file.isSymbolicLink() || file.size > 1024 * 1024) throw new Error('Cleanup lease ownership file is invalid.')
  const lease = JSON.parse(await readFile(leasePath, 'utf8'))
  const leaseRoot = path.dirname(path.resolve(leasePath))
  const root = path.dirname(path.dirname(leaseRoot))
  const expectedLockPath = path.join(root, 'campaign.lock')
  if (path.basename(leasePath) !== 'lease.json' || lease.schema !== 'sartracker-qualification-lease-v1'
      || lease.status !== 'ACQUIRED' || lease.campaignRoot !== root
      || path.basename(path.dirname(leaseRoot)) !== 'leases' || path.basename(leaseRoot) !== lease.leaseId
      || lease.campaignLockPath !== expectedLockPath || lease.host !== os.hostname()
      || !Number.isSafeInteger(lease.pid) || lease.pid <= 0
      || (lease.pid !== process.pid && processIsAlive(lease.pid))
      || await realpath(leaseRoot) !== leaseRoot) throw new Error('Cleanup lease or lock ownership is invalid.')
  const lockInfo = await lstat(expectedLockPath)
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink()) throw new Error('Cleanup campaign lock is not a regular owned file.')
  if (lockInfo.dev !== file.dev || lockInfo.ino !== file.ino) throw new Error('Cleanup campaign lock is not the published lease inode.')
  const lock = JSON.parse(await readFile(expectedLockPath, 'utf8'))
  if (['campaignId', 'definitionDigest', 'leaseId', 'pid', 'host', 'bootId', 'processStart'].some((key) => lock[key] !== lease[key])) {
    throw new Error('Cleanup campaign lock ownership differs from the lease.')
  }
  if (!Array.isArray(lease.disposableRoots) || lease.disposableRoots.length !== 3
      || lease.disposableRoots.map((directory) => path.basename(directory)).sort().join(',') !== 'archives,fixtures,profiles') {
    throw new Error('Cleanup disposable ownership inventory differs.')
  }
  const locksRoot = path.join(root, 'locks')
  const locksInfo = await lstat(locksRoot).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
  if (locksInfo !== null) {
    if (!locksInfo.isDirectory() || locksInfo.isSymbolicLink()) throw new Error('Cleanup resource-lock directory is not a regular owned directory.')
    const retainedLocks = await readdir(locksRoot, { withFileTypes: true })
    if (retainedLocks.length > 0) throw new Error('Cleanup blocked while resource locks remain; explicit manual recovery is required.')
  }
  const currentOwner = await processOwnerIdentity(process.pid)
  if (lease.pid === process.pid && !sameProcessOwner(lease, currentOwner)) {
    throw new Error('Cleanup lease PID was reused by a different process instance.')
  }
  for (const directory of lease.disposableRoots) {
    if (path.dirname(directory) !== leaseRoot || await realpath(directory) !== directory
        || !(await lstat(directory)).isDirectory()) throw new Error('Cleanup disposable path ownership differs.')
  }
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
  if (plan.mode === 'candidate') validateCandidateClaimScope(plan.claimScope)
  else if (plan.claimScope !== undefined && plan.claimScope !== null) throw new Error('Calibration plans cannot carry a candidate release claim scope.')
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
    validateQualificationPhase(binding)
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
    claimScope: definition.claimScope,
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
  if (binding.proofMode === 'external-human' && (binding.contractId !== 'C29'
      || binding.sessionKind !== 'pre-release-original-machine-training')) {
    throw new Error('External human evidence requires C29 pre-release original-machine training.')
  }
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
export async function materializeCaptures(captures, attemptDirectory, attemptsRoot, campaignMode = 'candidate') {
  if (!Array.isArray(captures)) throw new Error('Capture list must be an array.')
  const canonicalAttempt = await realpath(attemptDirectory)
  const canonicalAttemptsRoot = await realpath(attemptsRoot)
  const materialized = []
  for (const capture of captures) {
    if (capture === null || typeof capture !== 'object') throw new Error('Capture identity is invalid.')
    requireSafeId(capture.name, 'capture name')
    if (capture.path === undefined) {
      if (campaignMode !== 'calibration') throw new Error('Candidate capture requires a retained media path.')
      materialized.push(capture)
      continue
    }
    if (campaignMode !== 'calibration' && !Object.hasOwn(CAPTURE_BYTE_LIMITS, capture.kind)) {
      throw new Error('Candidate capture kind is not an approved retained media kind.')
    }
    if (typeof capture.path !== 'string' || capture.path === '') throw new Error('Capture path is invalid.')
    const source = path.resolve(capture.path)
    const sourceMetadata = await lstat(source)
    if (sourceMetadata.isSymbolicLink()) throw new Error('Capture path must not be a symbolic link.')
    if (!sourceMetadata.isFile()) throw new Error('Capture path must be a regular file.')
    const byteLimit = CAPTURE_BYTE_LIMITS[capture.kind]
    if (byteLimit !== undefined && sourceMetadata.size > byteLimit) {
      throw new Error(`Capture exceeds the ${byteLimit}-byte retained media bound.`)
    }
    const canonicalSource = await realpath(source)
    if (canonicalSource.startsWith(`${canonicalAttemptsRoot}${path.sep}`)
        && !canonicalSource.startsWith(`${canonicalAttempt}${path.sep}`)) {
      throw new Error('Capture media belongs to a different attempt.')
    }
    const identity = await strictFileIdentity(source, 'capture')
    if (capture.sha256 !== undefined && capture.sha256 !== identity.sha256) throw new Error('Capture bytes do not match the declared digest.')
    if (!canonicalSource.startsWith(`${canonicalAttempt}${path.sep}`)) {
      const name = `media-${capture.name}`
      const destination = path.join(attemptDirectory, name)
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
      await chmod(destination, 0o600)
      const copied = await strictFileIdentity(destination, 'materialized capture')
      const sourceAfterCopy = await strictFileIdentity(source, 'capture')
      if (copied.bytes !== identity.bytes || copied.sha256 !== identity.sha256
          || sourceAfterCopy.bytes !== identity.bytes || sourceAfterCopy.sha256 !== identity.sha256) {
        throw new Error('Capture bytes changed during retained media copy.')
      }
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
  if (definition.mode === 'candidate') {
    try {
      const source = await liveSourceIdentity()
      if (source.dirty || !sameSourceIdentity(source, definition.identities.source)) mismatches.push('live checkout differs from the exact clean campaign source')
    } catch { mismatches.push('live checkout identity could not be independently read') }
    try {
      if (definition.reviewedPlanIdentity?.path !== reviewedCandidatePlanPath()) throw new Error('reviewed plan path differs')
      const current = await strictFileIdentity(reviewedCandidatePlanPath(), 'reviewed candidate plan')
      const reviewed = JSON.parse(await readFile(current.path, 'utf8'))
      const reviewedHuman = reviewed.externalHuman
      const boundHuman = definition.externalHuman
      const humanTrustDiffers = boundHuman !== null && canonicalJson({
        authorityPath: boundHuman.authorityPath ?? null,
        authorizationPath: boundHuman.authorizationPath ?? null,
        trustedPublicKeySha256: boundHuman.trustedPublicKeySha256 ?? null,
      }) !== canonicalJson({
        authorityPath: reviewedHuman?.authorityPath ?? null,
        authorizationPath: reviewedHuman?.authorizationPath ?? null,
        trustedPublicKeySha256: reviewedHuman?.trustedPublicKeySha256 ?? null,
      })
      const reviewedRiskKey = reviewed.release?.riskAuthorityPublicKeySha256 ?? null
      const boundRiskKey = definition.releaseInputs?.riskAuthorityPublicKeySha256 ?? null
      const releaseTrustDiffers = boundRiskKey !== null && reviewedRiskKey !== boundRiskKey
      if (!sameIdentity(current, definition.reviewedPlanIdentity)
          || canonicalJson(reviewed.bindings) !== canonicalJson(definition.bindings)
          || !candidateClaimScopeMatchesReviewedPlan(reviewed.claimScope, definition.claimScope)
          || humanTrustDiffers || releaseTrustDiffers) {
        mismatches.push('candidate reviewed binding, claim scope or human trust root differs; runtime inputs cannot nominate a new authority')
      }
    } catch { mismatches.push('candidate reviewed binding matrix is unavailable or unbound') }
  }
  const identities = [
    ['contract registry', definition.identities.contractRegistry],
    ...definition.identities.fixtures.map((identity) => ['fixture', identity]),
    ...definition.identities.validators.map((identity) => ['validator', identity]),
    ...definition.identities.candidate.artifacts.map((identity) => ['artifact', identity]),
    ...(definition.runtimeInputs?.identities ?? []).map((identity) => ['runtime input', identity]),
    ...(definition.externalHuman ? [['human authority', definition.externalHuman.authorityIdentity],
      ['human authorization', definition.externalHuman.authorizationIdentity]] : []),
  ]
  for (const [label, identity] of identities) {
    try {
      const current = identity.kind === 'live-config-directory'
        ? await hashLiveConfigDirectory(identity.path) : await strictFileIdentity(identity.path, label)
      if (!sameIdentity(current, identity)) mismatches.push(`${label} identity changed: ${identity.path}`)
    } catch (error) {
      mismatches.push(`${label} identity unavailable: ${error.message}`)
    }
  }
  return mismatches
}

/** Locate the reviewed plan from the executing source tree, never runtime configuration. */
function reviewedCandidatePlanPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assurance/qualification-campaign-plan.json')
}

/** Ensure candidate coverage and make unresolved rows explicit blockers. */
export function validateBindingCoverage(definition) {
  const blockers = []
  const expected = definition.mode === 'candidate' ? REQUIRED_CANDIDATE_CONTRACTS : definition.requiredContracts
  if (definition.mode === 'candidate') blockers.push(...validateFixedCandidateFamilies(definition))
  if (definition.mode === 'candidate' && (definition.identities.candidate.candidateId === null || definition.identities.candidate.version === null)) {
    blockers.push('exact candidate id and version are missing')
  }
  if (definition.mode === 'candidate' && !definition.runtimeInputs) blockers.push('exact CI/runtime input handoff is missing; local artifact paths are not provenance or installation proof')
  for (const contractId of expected) {
    const bindings = definition.bindings.filter((binding) => binding.contractId === contractId && binding.mandatory)
    if (bindings.length === 0) blockers.push(`missing mandatory adapter binding for ${contractId}`)
    for (const binding of bindings) {
      if (definition.mode === 'candidate' && (binding.proofMode === 'synthetic'
          || binding.adapterId.startsWith('calibration.') || binding.receiptValidatorId.startsWith('calibration.'))) {
        blockers.push(`calibration evidence cannot satisfy candidate contract ${contractId}`)
      }
      if (!ADAPTERS.has(binding.adapterId)) blockers.push(`missing adapter ${binding.adapterId} for ${contractId}`)
      if (!RECEIPT_VALIDATORS.has(binding.receiptValidatorId)) blockers.push(`missing receipt validator ${binding.receiptValidatorId} for ${contractId}`)
      if (binding.adapterId.startsWith('release.') && !definition.releaseInputs) blockers.push(`missing exact release and rollback input handoff for ${contractId}`)
      if (binding.proofMode === 'ci-appimage' && !hasArtifact(definition, 'ci-appimage')) blockers.push(`missing exact CI AppImage artifact identity for ${contractId}`)
      if (binding.proofMode === 'installed-deb' && (!hasArtifact(definition, 'ci-deb') || !definition.runtimeInputs?.config.installedExecutablePath)) blockers.push(`missing exact installed deb artifact identity for ${contractId}`)
      if (binding.proofMode === 'external-human' && !hasArtifact(definition, 'ci-deb')) {
        blockers.push('C29 requires the exact CI Debian artifact; human authority is required at the later human acceptance stage')
      }
      const runtimeFixtures = definition.runtimeInputs?.config?.fixtures
      const packageScenario = binding.variantId?.replace(/-(?:appimage|installed)$/u, '')
      const requireRuntimeFixture = (role, reason) => {
        if (runtimeFixtures === null || typeof runtimeFixtures !== 'object' || Array.isArray(runtimeFixtures)
            || runtimeFixtures[role] === undefined) {
          blockers.push(reason)
        }
      }
      if (binding.adapterId === 'live.get-only') {
        requireRuntimeFixture('live-config', `${contractId} live.get-only requires the bound live-config fixture role`)
        requireRuntimeFixture('live-selector', `${contractId} live.get-only requires the bound live-selector fixture role`)
      }
      if (binding.adapterId === 'package.reviewed' && binding.contractId === 'C18') {
        requireRuntimeFixture('storage-mission', 'C18 package proof requires the bound storage-mission fixture role')
      }
      if (binding.adapterId === 'package.reviewed' && binding.contractId === 'C15' && packageScenario === 'private-offline-map') {
        requireRuntimeFixture('private-map', 'C15 private-map proof requires the bound private-map fixture role')
      }
      if (binding.adapterId === 'package.reviewed'
          && (binding.contractId === 'C01'
            || binding.contractId === 'C19' && packageScenario === 'legacy-startup-boundaries'
            || binding.contractId === 'C18' && packageScenario === 'disk-full')
          && !definition.runtimeInputs?.config?.enospcMount) {
        blockers.push(`${binding.contractId} physical disk-full proof requires a separately provisioned bounded enospcMount input`)
      }
      if (binding.adapterId === 'package.reviewed' && ['C07', 'C08'].includes(binding.contractId)) {
        requireRuntimeFixture(packageScenario, `${contractId} package proof requires the bound ${packageScenario} fixture role`)
      }
      if (binding.adapterId === 'soak.reviewed' && ['C24', 'C25'].includes(binding.contractId)
          && /^field-(?:960k|2m|local-1gib|device-modes)(?:-installed)?$/u.test(binding.variantId)) {
        const fixtureRole = binding.variantId.replace(/-installed$/u, '')
        if (runtimeFixtures === null || typeof runtimeFixtures !== 'object' || Array.isArray(runtimeFixtures)
            || (runtimeFixtures[fixtureRole] === undefined && runtimeFixtures.field === undefined)) {
          blockers.push(`${contractId} ${binding.variantId} requires the bound ${fixtureRole} or field fixture role`)
        }
      }
    }
  }
  return blockers
}

/**
 * Require the reviewed package and soak family rows before candidate admission.
 * Calibration plans deliberately do not enter this gate because they exercise
 * controller mechanics and must remain small, deterministic fixtures.
 *
 * @param {object} definition immutable campaign definition or coverage view
 * @returns {string[]} fixed-family blockers
 */
function validateFixedCandidateFamilies(definition) {
  const blockers = []
  const requiredFamilies = [
    ['C15', ['private-offline-map-appimage', 'private-offline-map-installed'], 'package.reviewed', 'package.receipt'],
    ['C25', REQUIRED_C25_CANDIDATE_VARIANTS, 'soak.reviewed', 'soak.receipt'],
    ['C28', REQUIRED_C28_CANDIDATE_VARIANTS, 'package.reviewed', 'package.receipt'],
  ]
  for (const [contractId, variants, adapterId, receiptValidatorId] of requiredFamilies) {
    for (const variantId of variants) {
      const proofMode = variantId.endsWith('-installed') ? 'installed-deb' : 'ci-appimage'
      const present = definition.bindings.some((binding) => binding.mandatory === true
        && binding.contractId === contractId
        && binding.variantId === variantId
        && binding.adapterId === adapterId
        && binding.receiptValidatorId === receiptValidatorId
        && binding.proofMode === proofMode)
      if (!present) blockers.push(`fixed mandatory candidate variant ${contractId}:${variantId} is missing for ${proofMode}`)
    }
  }
  return blockers
}

/** Check the required capability inventory without treating a missing tool as pass. */
function validateCapabilities(definition) {
  return validateHostCapabilities(definition)
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
  try {
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
  } catch (error) {
    if (isReceiptPersistenceError(error)) throw error
    throw createReceiptPersistenceError()
  }
}

/** Create the bounded typed signal used when canonical attempt persistence fails. */
function createReceiptPersistenceError() {
  const error = new Error('Qualification receipt persistence failed; manual recovery is required.')
  error.code = 'QUALIFICATION_RECEIPT_PERSISTENCE_FAILED'
  return error
}

/** Recognize the controller-only canonical persistence failure signal. */
function isReceiptPersistenceError(error) {
  return error !== null && typeof error === 'object'
    && error.code === 'QUALIFICATION_RECEIPT_PERSISTENCE_FAILED'
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
    ...(byId.get(contract.id)?.notClaimedCapabilities?.length ? {
      notClaimedCapabilities: byId.get(contract.id).notClaimedCapabilities,
    } : {}),
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
export async function readBoundJsonFile(filePath, label, maxBytes = 16 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error(`${label} bounded size is invalid.`)
  const resolved = path.resolve(filePath)
  const before = await lstat(resolved)
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${label} must be a regular file.`)
  if (before.size > maxBytes) throw new Error(`${label} exceeds its bounded size.`)
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const handle = await open(resolved, flags)
  try {
    const opened = await handle.stat()
    if (!sameFileMetadata(before, opened)) throw new Error(`${label} changed before its bound descriptor was opened.`)
    const boundedBytes = Buffer.allocUnsafe(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < boundedBytes.byteLength) {
      const read = await handle.read(boundedBytes, bytesRead, boundedBytes.byteLength - bytesRead, null)
      if (read.bytesRead === 0) break
      bytesRead += read.bytesRead
    }
    if (bytesRead > maxBytes) throw new Error(`${label} exceeds its bounded size.`)
    const bytes = boundedBytes.subarray(0, bytesRead)
    const after = await handle.stat()
    if (!sameFileMetadata(opened, after)) throw new Error(`${label} changed while being read.`)
    const value = JSON.parse(bytes.toString('utf8'))
    return Object.freeze({
      identity: Object.freeze({ path: resolved, bytes: bytes.byteLength, sha256: sha256(bytes) }),
      value,
    })
  } finally {
    await handle.close()
  }
}

/** Compare file metadata captured from one path and one bound descriptor. */
function sameFileMetadata(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

/** Reject symlinks before following a file identity. */
async function strictFileIdentity(filePath, label) {
  const resolved = path.resolve(filePath)
  const metadata = await lstat(resolved)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${filePath}.`)
  const identity = await hashCandidateFile(resolved)
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

/** Read the executing checkout directly; caller-supplied source claims are not execution proof. */
async function liveSourceIdentity() {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const options = { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
  const head = await execFile('git', ['rev-parse', 'HEAD'], options)
  const tree = await execFile('git', ['rev-parse', 'HEAD^{tree}'], options)
  const status = await execFile('git', ['status', '--porcelain'], options)
  return { sha: head.stdout.trim(), tree: tree.stdout.trim(), dirty: status.stdout.trim() !== '' }
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
