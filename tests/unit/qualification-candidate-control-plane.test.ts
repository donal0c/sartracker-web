import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  computeCampaignVerdict,
  compileCampaignDefinition,
  createCampaignLease,
  ingestAdvisoryJudgeResult,
  preflightCampaign,
  runContractAttempt,
  verifyCampaignAttempt,
} from '../../scripts/qualification/control-plane.mjs'

const registryPath = path.resolve('docs/assurance/qualification-contracts.json')
const sourceIdentity = { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false }
let temporaryRoot: string | undefined

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

async function createFixture(): Promise<string> {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-candidate-control-'))
  const fixturePath = path.join(temporaryRoot, 'fixture.json')
  await writeFile(fixturePath, '{"calibration":true}\n', 'utf8')
  return fixturePath
}

function makePlan(fixturePath: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'sartracker-qualification-campaign-plan-v1',
    campaignId: 'calibration-campaign',
    mode: 'calibration',
    releaseEligible: false,
    authorization: { issue: 'DON-254', explicitlyEnabled: true },
    registryPath,
    fixturePaths: [fixturePath],
    validatorPaths: [path.resolve('scripts/qualification/control-plane.mjs')],
    requiredContracts: ['C00', 'C01'],
    bindings: [
      {
        contractId: 'C00',
        variantId: 'synthetic-pass',
        adapterId: 'calibration.pass',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        resourceKey: 'calibration',
        mandatory: true,
        command: ['internal-calibration', 'pass'],
      },
      {
        contractId: 'C01',
        variantId: 'synthetic-fail',
        adapterId: 'calibration.fail',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        resourceKey: 'calibration',
        mandatory: true,
        command: ['internal-calibration', 'fail'],
      },
    ],
    ...overrides,
  }
}

async function compilePlan(overrides: Record<string, unknown> = {}) {
  const fixturePath = await createFixture()
  const definition = await compileCampaignDefinition({
    plan: makePlan(fixturePath, overrides),
    sourceIdentity,
    outputPath: path.join(temporaryRoot!, 'campaign-definition.json'),
  })
  return { definition, fixturePath }
}

describe('qualification candidate control plane', () => {
  it('compiles an immutable exact-input definition and binds all identity classes', async () => {
    const { definition } = await compilePlan()

    expect(definition.schema).toBe('sartracker-qualification-campaign-definition-v1')
    expect(definition.immutable).toBe(true)
    expect(definition.identities.source).toEqual(sourceIdentity)
    expect(definition.identities.contractRegistry.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(definition.identities.fixtures).toHaveLength(1)
    expect(definition.identities.validators.length).toBeGreaterThan(0)
    expect(definition.definitionDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('fails candidate preflight closed when a mandatory adapter or receipt validator is unresolved', async () => {
    const { definition } = await compilePlan({
      mode: 'candidate',
      campaignId: 'beta13-candidate',
      requiredContracts: ['C00'],
      bindings: [{
        contractId: 'C00',
        variantId: 'appimage',
        adapterId: 'missing.adapter',
        receiptValidatorId: 'missing.receipt',
        proofMode: 'ci-appimage',
        capability: 'electron',
        mandatory: true,
        command: ['missing-adapter'],
        oracle: 'exact package identity',
      }],
    })

    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('ENVIRONMENT_BLOCKED')
    expect(preflight.blockers.join(' ')).toMatch(/adapter|receipt validator/u)
    expect(preflight.releaseEligible).toBe(false)
  })

  it('rejects changed fixture bytes and local substitutes for exact CI artifact rows', async () => {
    const fixturePath = await createFixture()
    const artifactPath = path.join(temporaryRoot!, 'local.AppImage')
    await writeFile(artifactPath, 'local-build\n', 'utf8')
    const { definition } = await compilePlan({
      mode: 'candidate',
      campaignId: 'candidate-identity-controls',
      requiredContracts: ['C00'],
      artifacts: [{ role: 'ci-appimage', path: artifactPath, localBuild: true }],
      fixturePaths: [fixturePath],
      bindings: [{
        contractId: 'C00',
        variantId: 'appimage',
        adapterId: 'missing.adapter',
        receiptValidatorId: 'missing.receipt',
        proofMode: 'ci-appimage',
        capability: 'node',
        mandatory: true,
        command: ['missing-adapter'],
        oracle: 'exact package identity',
      }],
    })
    await writeFile(fixturePath, '{"calibration":false}\n', 'utf8')

    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('ENVIRONMENT_BLOCKED')
    expect(preflight.blockers.join(' ')).toMatch(/fixture identity changed|exact CI AppImage artifact identity/u)
  })

  it('does not let an advisory judge pass override a deterministic failure', async () => {
    const { definition } = await compilePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C01',
      variantId: 'synthetic-fail',
    })
    await ingestAdvisoryJudgeResult({
      attemptDirectory: attempt.attemptDirectory,
      result: {
        schema: 'sartracker-oracle-blind-judge-result-v1',
        campaignId: definition.campaignId,
        attemptId: attempt.attemptId,
        packetSha256: attempt.judgePacketSha256,
        verdict: 'pass',
        observations: [],
      },
    })

    const verdict = await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })
    expect(verdict.verdict).toBe('FAIL')
    expect(verdict.releaseEligible).toBe(false)
    expect(verdict.deterministicFailures).toContain('C01')
  })

  it('does not treat an unsealed pass as campaign evidence', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-pass',
    })

    expect(attempt.status).toBe('PASS')
    const verdict = await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })
    expect(verdict.verdict).toBe('INVALID_EVIDENCE')
    expect(verdict.evidenceErrors.join(' ')).toMatch(/not sealed/u)
  })

  it('resumes an interrupted attempt only with identical inputs and rejects changed campaign identity', async () => {
    const { definition } = await compilePlan({
      bindings: [{
        contractId: 'C00',
        variantId: 'synthetic-interrupt',
        adapterId: 'calibration.interrupt',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        mandatory: true,
        command: ['internal-calibration', 'interrupt-resume'],
      }],
      requiredContracts: ['C00'],
    })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const interrupted = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-interrupt',
    })
    expect(interrupted.status).toBe('ABORTED_SAFE')

    const resumed = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-interrupt',
      resumeAttemptId: interrupted.attemptId,
    })
    expect(resumed.status).toBe('PASS')

    const changed = structuredClone(definition)
    changed.definitionDigest = 'c'.repeat(64)
    await expect(runContractAttempt({
      definition: changed,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-interrupt',
      resumeAttemptId: interrupted.attemptId,
    })).rejects.toThrow(/definition identity|input identity|immutable bytes/u)
  })

  it('seals attempts with an external anchor and independently rejects tampering and path escapes', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-pass',
    })
    const sealed = await ingestAdvisoryJudgeResult({
      attemptDirectory: attempt.attemptDirectory,
      result: {
        schema: 'sartracker-oracle-blind-judge-result-v1',
        campaignId: definition.campaignId,
        attemptId: attempt.attemptId,
        packetSha256: attempt.judgePacketSha256,
        verdict: 'pass',
        observations: [],
      },
    })
    await verifyCampaignAttempt({ attemptDirectory: attempt.attemptDirectory, anchorPath: sealed.anchorPath })

    await writeFile(path.join(attempt.attemptDirectory, 'receipt.json'), '{"tampered":true}\n', 'utf8')
    await expect(verifyCampaignAttempt({ attemptDirectory: attempt.attemptDirectory, anchorPath: sealed.anchorPath }))
      .rejects.toThrow(/changed after sealing/u)

    const outside = path.join(temporaryRoot!, 'outside.json')
    await writeFile(outside, '{}\n', 'utf8')
    const linked = path.join(attempt.attemptDirectory, 'escape.json')
    await symlink(outside, linked)
    await expect(verifyCampaignAttempt({ attemptDirectory: attempt.attemptDirectory, anchorPath: sealed.anchorPath }))
      .rejects.toThrow(/unlisted evidence|regular file/u)
  })

  it('does not delete an unknown disposable path when cleanup fails', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const lease = await createCampaignLease({ campaignRoot: temporaryRoot!, definition })
    const unknownDatabase = path.join(temporaryRoot!, 'unknown.sqlite')
    await writeFile(unknownDatabase, 'operational?\n', 'utf8')

    expect(lease.status).toBe('ACQUIRED')
    const state = JSON.parse(await readFile(lease.leasePath, 'utf8')) as { disposableRoots: string[] }
    const canonicalRoot = await realpath(temporaryRoot!)
    expect(state.disposableRoots.every((root) => root.startsWith(`${canonicalRoot}${path.sep}`))).toBe(true)
    const { cleanupCampaignLease } = await import('../../scripts/qualification/control-plane.mjs')
    const cleanup = await cleanupCampaignLease({ leasePath: lease.leasePath, simulateFailure: true })
    expect(cleanup.status).toBe('CLEANUP_BLOCKED')
    expect(await readFile(unknownDatabase, 'utf8')).toContain('operational?')
    expect(cleanup.quarantinePath).toBeTruthy()
  })
})
