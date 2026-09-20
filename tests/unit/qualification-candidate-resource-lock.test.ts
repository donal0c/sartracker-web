import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANONICAL_INSTALLED_EXECUTABLE_PATH, hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { hashLiveConfigDirectory } from '../../scripts/qualification/live-config-identity.mjs'

const {
  executeSoakVariant,
  validateRetainedSoak,
  executePackageVariant,
  validateRetainedPackage,
  executeLiveVariant,
  validateRetainedLive,
  executeSuiteVariant,
  validateRetainedSuite,
  compileSuiteBinding,
} = vi.hoisted(() => ({
  executeSoakVariant: vi.fn(),
  validateRetainedSoak: vi.fn(),
  executePackageVariant: vi.fn(),
  validateRetainedPackage: vi.fn(),
  executeLiveVariant: vi.fn(),
  validateRetainedLive: vi.fn(),
  executeSuiteVariant: vi.fn(),
  validateRetainedSuite: vi.fn(),
  compileSuiteBinding: vi.fn(),
}))

vi.mock('../../scripts/qualification/soak-adapter.mjs', () => ({
  executeSoakVariant,
  validateRetainedSoak,
}))
vi.mock('../../scripts/qualification/package-adapter.mjs', () => ({
  executePackageVariant,
  validateRetainedPackage,
}))
vi.mock('../../scripts/qualification/live-adapter.mjs', () => ({
  executeLiveVariant,
  validateRetainedLive,
}))
vi.mock('../../scripts/qualification/suite-adapter.mjs', () => ({
  compileSuiteBinding,
  executeSuiteVariant,
  validateRetainedSuite,
}))

import {
  cleanupCampaignLease,
  compileCampaignDefinition,
  preflightCampaign,
  runContractAttempt,
} from '../../scripts/qualification/candidate-control-plane.mjs'

const registryPath = path.resolve('docs/assurance/qualification-contracts.json')
const sourceIdentity = { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false }
let temporaryRoot: string | undefined

afterEach(async () => {
  vi.clearAllMocks()
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

async function compileResourcePlan({
  adapterId = 'soak.reviewed',
  receiptValidatorId = 'soak.receipt',
  proofMode = 'ci-appimage',
  variantId = 'resource-lock',
} = {}) {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-resource-lock-'))
  const fixturePath = path.join(temporaryRoot, 'fixture.json')
  await writeFile(fixturePath, '{"resource":"lock"}\n', 'utf8')
  const resourceKey = adapterId === 'soak.reviewed' ? 'soak-resource' : `${adapterId.replaceAll('.', '-')}-resource`
  const bindingVariantId = adapterId === 'soak.reviewed' && variantId === 'resource-lock'
    ? 'soak-resource-lock'
    : `${adapterId.replaceAll('.', '-')}-${variantId}`
  let runtimeInputPath: string | undefined
  if (adapterId === 'live.get-only') {
    const archivePath = path.join(temporaryRoot, 'archive.zip')
    const appImagePath = path.join(temporaryRoot, 'candidate.AppImage')
    const debPath = path.join(temporaryRoot, 'candidate.deb')
    await Promise.all([archivePath, appImagePath, debPath].map((filename) => writeFile(filename, path.basename(filename))))
    const liveConfigPath = path.join(temporaryRoot, 'live-config')
    await mkdir(liveConfigPath)
    await writeFile(path.join(liveConfigPath, 'settings.json'), '{}')
    await writeFile(path.join(liveConfigPath, 'credentials.json'), '{}')
    const liveSelectorPath = path.join(temporaryRoot, 'live-selector.json')
    await writeFile(liveSelectorPath, '{}')
    const [archive, appImage, deb, liveConfig, liveSelector] = await Promise.all([
      hashCandidateFile(archivePath),
      hashCandidateFile(appImagePath),
      hashCandidateFile(debPath),
      hashLiveConfigDirectory(liveConfigPath),
      hashCandidateFile(liveSelectorPath),
    ])
    runtimeInputPath = path.join(temporaryRoot, 'runtime-inputs.json')
    await writeFile(runtimeInputPath, JSON.stringify({
      schema: 'sartracker-candidate-runtime-inputs-v1',
      ci: {
        schema: 'sartracker-candidate-ci-artifacts-v1',
        version: '0.1.0-beta.13',
        provenance: { sourceSha: sourceIdentity.sha, runId: 1, runAttempt: 1, artifactId: 2 },
        archive,
        installers: [{ ...appImage, role: 'ci-appimage' }, { ...deb, role: 'ci-deb' }],
      },
      installedExecutablePath: CANONICAL_INSTALLED_EXECUTABLE_PATH,
      fixtures: {
        'live-config': { path: liveConfig.path, bytes: liveConfig.bytes, sha256: liveConfig.sha256 },
        'live-selector': liveSelector,
      },
    }))
  }
  return compileCampaignDefinition({
    plan: {
      schema: 'sartracker-qualification-campaign-plan-v1',
      campaignId: 'resource-lock-campaign',
      mode: 'calibration',
      releaseEligible: false,
      authorization: { issue: 'DON-254', explicitlyEnabled: true },
      version: '0.1.0-beta.13',
      registryPath,
      ...(runtimeInputPath === undefined ? {} : { runtimeInputPath }),
      fixturePaths: [fixturePath],
      artifacts: [{ role: 'ci-appimage', path: fixturePath, localBuild: false }],
      requiredContracts: ['C00'],
      bindings: [{
        contractId: 'C00',
        variantId: bindingVariantId,
        adapterId,
        receiptValidatorId,
        proofMode,
        capability: 'node',
        resourceKey,
        mandatory: true,
        oracle: 'mocked bounded worker cleanup outcome',
        command: ['mock-soak'],
      }],
    },
    sourceIdentity,
  })
}

function cleanupBlockedExecution() {
  return {
    schema: 'sartracker-soak-adapter-receipt-v1',
    status: 'INVALID_EVIDENCE',
    workerExecution: { resourceCleanupBlocked: true },
    evidence: [],
    captures: [],
  }
}

function cleanupBlockedError(adapterId: string) {
  return Object.assign(new Error('bounded cleanup failure'), {
    code: 'OWNED_PROCESS_CLEANUP_BLOCKED',
    adapterId,
    resourceCleanupBlocked: true,
  })
}

const nonSoakAdapters = [
  { adapterId: 'live.get-only', receiptValidatorId: 'live.receipt', proofMode: 'ci-appimage', execute: executeLiveVariant, validate: validateRetainedLive },
  { adapterId: 'package.reviewed', receiptValidatorId: 'package.receipt', proofMode: 'ci-appimage', execute: executePackageVariant, validate: validateRetainedPackage },
  { adapterId: 'suite.source', receiptValidatorId: 'suite.receipt', proofMode: 'source', execute: executeSuiteVariant, validate: validateRetainedSuite },
] as const

describe('candidate resource lock custody', () => {
  it('retains a cleanup-blocked lock and blocks the next attempt until manual recovery', async () => {
    executeSoakVariant.mockResolvedValue(cleanupBlockedExecution())
    validateRetainedSoak.mockResolvedValue({ status: 'INVALID_EVIDENCE' })
    const definition = await compileResourcePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })

    const first = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'soak-resource-lock',
    })
    expect(first.status).toBe('CLEANUP_BLOCKED')
    expect(JSON.parse(await readFile(path.join(first.attemptDirectory, 'result.json'), 'utf8')).status)
      .toBe('CLEANUP_BLOCKED')
    expect(await readFile(path.join(temporaryRoot!, 'locks', 'soak-resource.lock'), 'utf8')).toContain('soak-resource')

    const second = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'soak-resource-lock',
    })
    expect(second.status).toBe('ENVIRONMENT_BLOCKED')
    await expect(cleanupCampaignLease({ leasePath: preflight.lease!.leasePath }))
      .rejects.toThrow(/resource locks remain|manual recovery/iu)
  })

  it('releases the resource lock after a normal failed execution', async () => {
    executeSoakVariant.mockResolvedValue({
      ...cleanupBlockedExecution(),
      status: 'FAIL',
      workerExecution: { resourceCleanupBlocked: false },
    })
    validateRetainedSoak.mockResolvedValue({ status: 'FAIL' })
    const definition = await compileResourcePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })

    const attempt = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'soak-resource-lock',
    })
    expect(attempt.status).toBe('FAIL')
    await expect(readFile(path.join(temporaryRoot!, 'locks', 'soak-resource.lock'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains the lock when cleanup-unproven receipt persistence fails', async () => {
    const error = Object.assign(new Error('opaque receipt write failure'), {
      code: 'SOAK_RESOURCE_CLEANUP_BLOCKED',
      resourceCleanupBlocked: true,
    })
    executeSoakVariant.mockRejectedValue(error)
    const definition = await compileResourcePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })

    const first = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'soak-resource-lock',
    })
    expect(first.status).toBe('CLEANUP_BLOCKED')
    expect(await readFile(path.join(temporaryRoot!, 'locks', 'soak-resource.lock'), 'utf8')).toContain('soak-resource')
    await expect(runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'soak-resource-lock',
    })).resolves.toMatchObject({ status: 'ENVIRONMENT_BLOCKED' })
  })

  it.each(nonSoakAdapters)('retains the lock for a typed cleanup failure from $adapterId', async ({ adapterId, receiptValidatorId, proofMode, execute }) => {
    execute.mockRejectedValue(cleanupBlockedError(adapterId))
    const definition = await compileResourcePlan({ adapterId, receiptValidatorId, proofMode })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const variantId = `${adapterId.replaceAll('.', '-')}-resource-lock`

    const first = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId,
    })
    expect(first.status).toBe('CLEANUP_BLOCKED')
    expect(await readFile(path.join(temporaryRoot!, 'locks', `${adapterId.replaceAll('.', '-')}-resource.lock`), 'utf8')).toContain('resource')
    await expect(runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId,
    })).resolves.toMatchObject({ status: 'ENVIRONMENT_BLOCKED' })
  })

  it.each(nonSoakAdapters)('retains the lock for a returned cleanup marker from $adapterId', async ({ adapterId, receiptValidatorId, proofMode, execute, validate }) => {
    execute.mockResolvedValue({ status: 'INVALID_EVIDENCE', resourceCleanupBlocked: true, observed: {}, evidence: [], captures: [] })
    validate.mockResolvedValue({ status: 'INVALID_EVIDENCE' })
    const definition = await compileResourcePlan({ adapterId, receiptValidatorId, proofMode, variantId: 'returned-marker' })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const variantId = `${adapterId.replaceAll('.', '-')}-returned-marker`

    const first = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId,
    })
    expect(first.status).toBe('CLEANUP_BLOCKED')
    await expect(cleanupCampaignLease({ leasePath: preflight.lease!.leasePath }))
      .rejects.toThrow(/resource locks remain|manual recovery/iu)
  })

  it.each(nonSoakAdapters)('releases the lock after a clean failed $adapterId execution', async ({ adapterId, receiptValidatorId, proofMode, execute, validate }) => {
    execute.mockResolvedValue({ status: 'FAIL', observed: {}, evidence: [], captures: [], resourceCleanupBlocked: false })
    validate.mockResolvedValue({ status: 'FAIL' })
    const definition = await compileResourcePlan({ adapterId, receiptValidatorId, proofMode, variantId: 'clean-fail' })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const variantId = `${adapterId.replaceAll('.', '-')}-clean-fail`

    const attempt = await runContractAttempt({
      definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId,
    })
    expect(attempt.status).toBe('FAIL')
    await expect(readFile(path.join(temporaryRoot!, 'locks', `${adapterId.replaceAll('.', '-')}-resource.lock`), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
