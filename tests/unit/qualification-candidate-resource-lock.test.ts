import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const executeSoakVariant = vi.fn()
const validateRetainedSoak = vi.fn()

vi.mock('../../scripts/qualification/soak-adapter.mjs', () => ({
  executeSoakVariant,
  validateRetainedSoak,
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

async function compileResourcePlan() {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-resource-lock-'))
  const fixturePath = path.join(temporaryRoot, 'fixture.json')
  await writeFile(fixturePath, '{"resource":"lock"}\n', 'utf8')
  return compileCampaignDefinition({
    plan: {
      schema: 'sartracker-qualification-campaign-plan-v1',
      campaignId: 'resource-lock-campaign',
      mode: 'calibration',
      releaseEligible: false,
      authorization: { issue: 'DON-254', explicitlyEnabled: true },
      registryPath,
      fixturePaths: [fixturePath],
      artifacts: [{ role: 'ci-appimage', path: fixturePath, localBuild: false }],
      requiredContracts: ['C00'],
      bindings: [{
        contractId: 'C00',
        variantId: 'soak-resource-lock',
        adapterId: 'soak.reviewed',
        receiptValidatorId: 'soak.receipt',
        proofMode: 'ci-appimage',
        capability: 'node',
        resourceKey: 'soak-resource',
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
})
