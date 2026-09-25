import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

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
import { ingestHumanTrainingEvidence, materializeCaptures, readBoundJsonFile, validateBindingCoverage } from '../../scripts/qualification/candidate-control-plane.mjs'
import { canonicalJson } from '../../scripts/qualification/control-plane.mjs'
import { C28_REQUIRED_VARIANTS } from '../../scripts/qualification/composite-coverage.mjs'
import { BETA13_CLAIM_SCOPE } from '../../scripts/qualification/product-capabilities.mjs'

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
  const plan = {
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
  if (plan.mode === 'candidate' && !Object.hasOwn(overrides, 'claimScope')) {
    return { ...plan, claimScope: BETA13_CLAIM_SCOPE }
  }
  return plan
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
  it('reports repeated prerequisite failures once without throwing or acquiring a lease', async () => {
    const { definition } = await compilePlan({
      requiredContracts: ['C00'],
      bindings: ['first', 'second'].map((variantId) => ({
        contractId: 'C00', variantId, adapterId: 'missing.adapter',
        receiptValidatorId: 'calibration.v1', proofMode: 'synthetic',
        capability: 'node', resourceKey: 'calibration', mandatory: true,
        command: ['internal-calibration', 'pass'],
      })),
    })
    const result = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(result.status).toBe('ENVIRONMENT_BLOCKED')
    expect(result.releaseEligible).toBe(false)
    expect(result.blockers).toEqual(['missing adapter missing.adapter for C00'])
    expect(result).not.toHaveProperty('lease')
  })

  it('requires retained and hashed media for candidate captures while preserving calibration pathless captures', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-capture-custody-'))
    const attemptsRoot = path.join(temporaryRoot, 'attempts')
    const attemptDirectory = path.join(attemptsRoot, 'attempt-1')
    await mkdir(attemptDirectory, { recursive: true })
    const source = path.join(temporaryRoot, 'capture.png')
    await writeFile(source, 'synthetic-image-bytes\n', 'utf8')

    await expect(materializeCaptures(
      [{ name: 'missing-path', kind: 'image' }],
      attemptDirectory,
      attemptsRoot,
      'candidate',
    )).rejects.toThrow(/retained media path/iu)

    const calibration = await materializeCaptures(
      [{ name: 'synthetic', kind: 'image' }],
      attemptDirectory,
      attemptsRoot,
      'calibration',
    )
    expect(calibration).toEqual([{ name: 'synthetic', kind: 'image' }])

    const materialized = await materializeCaptures(
      [{ name: 'captured', kind: 'image', path: source }],
      attemptDirectory,
      attemptsRoot,
      'candidate',
    )
    expect(materialized).toEqual([{
      name: 'captured', kind: 'image', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }])
    expect(await readFile(path.join(attemptDirectory, 'media-captured'), 'utf8'))
      .toBe('synthetic-image-bytes\n')
  })

  it('blocks packaged/live fixture role omissions before an adapter can spawn', () => {
    const base = {
      mode: 'candidate',
      requiredContracts: ['C05'],
      identities: {
        candidate: { candidateId: 'candidate', version: '0.1.0', artifacts: [
          { role: 'ci-appimage', localBuild: false },
          { role: 'ci-deb', localBuild: false },
        ] },
      },
      runtimeInputs: { config: { fixtures: {} } },
    }
    expect(validateBindingCoverage({
      ...base,
      bindings: [{ contractId: 'C05', adapterId: 'live.get-only', receiptValidatorId: 'live.receipt', proofMode: 'ci-appimage', mandatory: true }],
    }).join(' ')).toMatch(/live-config.*live-selector/iu)
    expect(validateBindingCoverage({
      ...base,
      requiredContracts: ['C18'],
      bindings: [{ contractId: 'C18', adapterId: 'package.reviewed', receiptValidatorId: 'package.receipt', proofMode: 'installed-deb', mandatory: true }],
    }).join(' ')).toMatch(/storage-mission/iu)
    expect(validateBindingCoverage({
      ...base,
      requiredContracts: ['C07'],
      bindings: [{ contractId: 'C07', variantId: 'paging-2m-1gib', adapterId: 'package.reviewed', receiptValidatorId: 'package.receipt', proofMode: 'installed-deb', mandatory: true }],
    }).join(' ')).toMatch(/paging-2m-1gib.*fixture/iu)
    expect(validateBindingCoverage({
      ...base,
      requiredContracts: ['C25'],
      bindings: [{ contractId: 'C25', variantId: 'field-960k-installed', adapterId: 'soak.reviewed', receiptValidatorId: 'soak.receipt', proofMode: 'installed-deb', mandatory: true }],
    }).join(' ')).toMatch(/C25.*field-960k-installed.*field fixture/iu)
  })

  it('requires the fixed C25 and C28 candidate families while leaving calibration permissive', () => {
    const base = {
      mode: 'candidate',
      requiredContracts: ['C25', 'C28'],
      identities: {
        candidate: { candidateId: 'candidate', version: '0.1.0', artifacts: [
          { role: 'ci-appimage', localBuild: false },
          { role: 'ci-deb', localBuild: false },
        ] },
      },
      runtimeInputs: { config: { fixtures: {}, installedExecutablePath: '/bound/installed/app' } },
    }
    const c25Variants = [
      'normal', 'extended', 'field-960k', 'field-2m', 'field-local-1gib', 'field-device-modes',
      'normal-installed', 'extended-installed', 'field-960k-installed', 'field-2m-installed',
      'field-local-1gib-installed', 'field-device-modes-installed',
    ].filter((variantId) => variantId !== 'field-2m-installed')
      .map((variantId) => ({
        contractId: 'C25', variantId, adapterId: 'soak.reviewed', receiptValidatorId: 'soak.receipt',
        proofMode: variantId.endsWith('-installed') ? 'installed-deb' : 'ci-appimage', mandatory: true,
      }))
    const c28Bindings = C28_REQUIRED_VARIANTS.flatMap((variantId) => ['appimage', 'installed']
      .filter((tier) => !(variantId === 'routine' && tier === 'installed'))
      .map((tier) => ({
        contractId: 'C28', variantId: `${variantId}-${tier}`, adapterId: 'package.reviewed',
        receiptValidatorId: 'package.receipt', proofMode: tier === 'installed' ? 'installed-deb' : 'ci-appimage', mandatory: true,
      })))
    const blockers = validateBindingCoverage({ ...base, bindings: [...c25Variants, ...c28Bindings] }).join(' ')
    expect(blockers).toMatch(/fixed mandatory candidate variant C25:field-2m-installed/u)
    expect(blockers).toMatch(/fixed mandatory candidate variant C28:routine-installed/u)

    const calibrationBlockers = validateBindingCoverage({
      ...base,
      mode: 'calibration',
      requiredContracts: ['C25'],
      bindings: [{ contractId: 'C25', variantId: 'calibration', adapterId: 'calibration.pass', receiptValidatorId: 'calibration.v1', proofMode: 'synthetic', mandatory: true }],
    }).join(' ')
    expect(calibrationBlockers).not.toMatch(/fixed mandatory candidate variant/u)
  })

  it('retains an environment-blocked result when the owned resource lock cannot be acquired', async () => {
    const { definition } = await compilePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('READY')
    await mkdir(path.join(temporaryRoot!, 'locks'), { recursive: true })
    await writeFile(path.join(temporaryRoot!, 'locks', 'calibration.lock'), '{"ownedBy":"test"}\n', 'utf8')

    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-pass',
    })
    expect(attempt.status).toBe('ENVIRONMENT_BLOCKED')
    expect(JSON.parse(await readFile(path.join(attempt.attemptDirectory, 'receipt.json'), 'utf8')).status)
      .toBe('ENVIRONMENT_BLOCKED')
    expect(await readFile(path.join(attempt.attemptDirectory, 'state.ndjson'), 'utf8')).toMatch(/blocked/u)
  })

  it('retains an environment-blocked result when the leased work root disappears during setup', async () => {
    const { definition } = await compilePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('READY')
    const fixturesRoot = preflight.lease?.disposableRoots.find((root) => path.basename(root) === 'fixtures')
    await rm(fixturesRoot!, { recursive: true, force: true })

    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-pass',
    })
    expect(attempt.status).toBe('ENVIRONMENT_BLOCKED')
    expect(JSON.parse(await readFile(path.join(attempt.attemptDirectory, 'result.json'), 'utf8')).reason)
      .toContain('Owned attempt setup')
    await expect(readFile(path.join(temporaryRoot!, 'locks', 'calibration.lock'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rechecks the executing source at verdict instead of trusting a retained source claim', async () => {
    await createFixture()
    const planPath = path.resolve('docs/assurance/qualification-campaign-plan.json')
    const reviewedPlan = JSON.parse(await readFile(planPath, 'utf8'))
    const bindings = reviewedPlan.bindings.filter((binding: { contractId: string }) => binding.contractId === 'C00')
    expect(bindings.length).toBeGreaterThan(0)
    const definition = await compileCampaignDefinition({
      plan: {
        ...reviewedPlan,
        campaignId: 'source-verdict-check',
        requiredContracts: ['C19', 'C24'],
        bindings,
      },
      planPath,
      sourceIdentity,
    })
    expect(definition.identities.validators.some((identity: { path: string }) => identity.path.endsWith('.py'))).toBe(true)
    const verdict = await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })
    expect(verdict.evidenceErrors.join(' ')).toMatch(/live checkout/iu)
    expect(verdict.notClaimedCapabilities.map((entry: { issueId: string; status: string }) => [entry.issueId, entry.status]))
      .toEqual([['DON-249', 'NOT_CLAIMED'], ['DON-250', 'NOT_CLAIMED'], ['DON-251', 'NOT_CLAIMED']])
    expect(verdict.contractRows.find((row: { contractId: string }) => row.contractId === 'C19')?.status).toBe('not-run')
    expect(verdict.contractRows.find((row: { contractId: string }) => row.contractId === 'C24')?.status).toBe('not-run')
    expect(verdict.blockers.join(' ')).toMatch(/missing mandatory adapter binding for C19/u)
    expect(verdict.blockers.join(' ')).toMatch(/missing mandatory adapter binding for C24/u)
    expect(verdict.blockers.join(' ')).toMatch(/missing required contract C19/u)
    expect(verdict.blockers.join(' ')).toMatch(/missing required contract C24/u)
  }, 120_000)
  it('rejects a substituted campaign lock path before deleting any leased data', async () => {
    const { definition, fixturePath } = await compilePlan()
    const lease = await createCampaignLease({ campaignRoot: temporaryRoot!, definition })
    const state = JSON.parse(await readFile(lease.leasePath, 'utf8'))
    await writeFile(lease.leasePath, JSON.stringify({ ...state, campaignLockPath: fixturePath }))
    const { cleanupCampaignLease } = await import('../../scripts/qualification/control-plane.mjs')
    await expect(cleanupCampaignLease({ leasePath: lease.leasePath })).rejects.toThrow(/ownership|lock/iu)
    expect(await readFile(fixturePath, 'utf8')).toContain('calibration')
    expect(await readFile(lease.leasePath, 'utf8')).toContain('ACQUIRED')
  })
  it.skipIf(process.platform !== 'linux')('compiles source regression suites with immutable test identities and preserves their proof tier', async () => {
    const fixturePath = await createFixture()
    const base = makePlan(fixturePath)
    const definition = await compileCampaignDefinition({ plan: { ...base, requiredContracts: ['C13'],
      bindings: [{ ...base.bindings[0], contractId: 'C13', variantId: 'source-regressions',
        adapterId: 'suite.source', receiptValidatorId: 'suite.receipt', proofMode: 'source',
        oracle: 'reviewed coordinate source regressions only' }],
    }, sourceIdentity })
    expect(definition.suiteExpectations['C13:source-regressions'].proofMode).toBe('source')
    expect(definition.suiteExpectations['C13:source-regressions'].testIds.length).toBeGreaterThan(0)
    expect(definition.suiteExpectations['C13:source-regressions'].sourceSha).toBe(sourceIdentity.sha)
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('READY')
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!,
      contractId: 'C13', variantId: 'source-regressions' })
    expect(attempt.status).toBe('PASS')
    await expect(readFile(path.join(attempt.attemptDirectory, 'judge-result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! }))
      .toMatchObject({ verdict: 'PASS', mode: 'calibration' })
    await writeFile(path.join(attempt.attemptDirectory, 'suite-report.json'), '{}')
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
  }, 60_000)
  it('rejects private key material before writing an immutable human authority definition', async () => {
    const fixturePath = await createFixture()
    const authorityPath = path.join(temporaryRoot!, 'private-authority.json')
    const keys = generateKeyPairSync('ed25519')
    await writeFile(authorityPath, JSON.stringify({ signerId: 'test', machineId: 'host', dataClass: 'synthetic',
      profileSha256: 'd'.repeat(64), publicKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }))
    await expect(compileCampaignDefinition({ plan: makePlan(fixturePath, {
      externalHuman: { authorityPath, authorizationPath: fixturePath },
    }), sourceIdentity })).rejects.toThrow(/public key/iu)
  })
  it('parses human authority from the same descriptor bytes whose identity it retains', async () => {
    await createFixture()
    const authorityPath = path.join(temporaryRoot!, 'authority-bound.json')
    const authority = { signerId: 'test-signer', machineId: 'host', dataClass: 'synthetic', profileSha256: 'd'.repeat(64), publicKey: 'public-key' }
    await writeFile(authorityPath, JSON.stringify(authority), 'utf8')
    const bound = await readBoundJsonFile(authorityPath, 'human authority')
    await writeFile(authorityPath, JSON.stringify({ ...authority, machineId: 'substituted' }), 'utf8')
    expect(bound.value).toEqual(authority)
    expect(bound.identity.sha256).toBe(createHash('sha256').update(JSON.stringify(authority)).digest('hex'))
  })
  it('rejects an oversized bound JSON file before parsing beyond its limit', async () => {
    await createFixture()
    const authorityPath = path.join(temporaryRoot!, 'authority-too-large.json')
    await writeFile(authorityPath, Buffer.alloc(16 * 1024 + 1, 0x20))
    await expect(readBoundJsonFile(authorityPath, 'human authority')).rejects.toThrow(/bounded size/iu)
  })
  it.each(['signed', 'missing-file', 'invalid-authority'])('retains the C29 submission outcome without a fabricated judge: %s', async (submission) => {
    const fixturePath = await createFixture()
    const keys = generateKeyPairSync('ed25519')
    const authorizationPath = path.join(temporaryRoot!, 'authorization.txt')
    await writeFile(authorizationPath, 'synthetic test authority only')
    const authorityPath = path.join(temporaryRoot!, 'authority.json')
    await writeFile(authorityPath, JSON.stringify({ signerId: 'test-signer', machineId: submission === 'invalid-authority' ? '' : 'original-test-host',
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      profileSha256: 'd'.repeat(64), dataClass: 'synthetic' }))
    const base = makePlan(fixturePath)
    const definition = await compileCampaignDefinition({ plan: { ...base,
      externalHuman: { authorityPath, authorizationPath },
      artifacts: [{ role: 'ci-deb', path: fixturePath, ciRunId: 1 }],
      requiredContracts: ['C29'], bindings: [{ ...base.bindings[0], contractId: 'C29',
        variantId: 'original-machine-training', adapterId: 'external.c29.training', receiptValidatorId: 'external.c29.receipt',
        proofMode: 'external-human', sessionKind: 'pre-release-original-machine-training', oracle: 'training-only named human acceptance' }],
    }, sourceIdentity })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('READY')
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C29', variantId: 'original-machine-training' })
    if (submission === 'invalid-authority') {
      expect(attempt.status).toBe('INVALID_EVIDENCE')
      expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
      return
    }
    expect(attempt.status).toBe('NEEDS_HUMAN_DECISION')
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('NEEDS_HUMAN_DECISION')
    const request = JSON.parse(await readFile(path.join(attempt.attemptDirectory, 'human-request.json'), 'utf8'))
    const evidence = Buffer.from('synthetic sanitized test notes')
    const payload = { schema: 'sartracker-team-training-evidence-v2', contractId: 'C29', proofMode: 'external-human',
      campaignId: request.campaignId, definitionDigest: request.definitionDigest, attemptId: attempt.attemptId,
      sourceSha: request.sourceSha, artifactSha256: request.artifactSha256,
      signerId: request.authority.signerId, machineId: request.authority.machineId, authorizationSha256: request.authority.authorizationSha256,
      profileSha256: request.authority.profileSha256, sessionKind: request.sessionKind, dataClass: 'synthetic',
      war13bCounted: false, originalMachine: true, sessionId: 'synthetic-session',
      startedAt: request.createdAt, endedAt: new Date(Date.parse(request.createdAt) + 1).toISOString(),
      primarySource: 'synthetic training reference', remainedAdvisory: true, fallbackSeconds: 30,
      comparisons: { opening: 1, transitions: 1, warnings: 1, close: 1, mismatches: 0 }, stopTriggers: [], disposition: 'accepted',
      evidenceSha256: createHash('sha256').update(evidence).digest('hex') }
    const envelopePath = path.join(temporaryRoot!, 'incoming.json')
    const evidencePath = path.join(temporaryRoot!, 'incoming.bin')
    if (submission === 'missing-file') {
      const result = await ingestHumanTrainingEvidence({ definition, preflight, campaignRoot: temporaryRoot!, attemptId: attempt.attemptId, envelopePath, evidencePath })
      expect(result.status).toBe('INVALID_EVIDENCE')
      expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
      await expect(ingestHumanTrainingEvidence({ definition, preflight, campaignRoot: temporaryRoot!, attemptId: attempt.attemptId, envelopePath, evidencePath })).rejects.toThrow(/pending|sealed/iu)
      return
    }
    await writeFile(envelopePath, JSON.stringify({ payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') }))
    await writeFile(evidencePath, evidence)
    const result = await ingestHumanTrainingEvidence({ definition, preflight, campaignRoot: temporaryRoot!, attemptId: attempt.attemptId, envelopePath, evidencePath })
    expect(result.status).toBe('PASS')
    await expect(readFile(path.join(attempt.attemptDirectory, 'judge-result.json'))).rejects.toThrow()
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('PASS')
    await writeFile(path.join(attempt.attemptDirectory, 'human-evidence.bin'), 'tampered')
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
  })

  it('keeps C29 external training authority distinct from installed-package proof', async () => {
    const fixturePath = await createFixture()
    const plan = makePlan(fixturePath)
    const binding = { ...plan.bindings[0], contractId: 'C29',
      variantId: 'original-machine-training', adapterId: 'external.c29.training',
      receiptValidatorId: 'external.c29.receipt', proofMode: 'external-human',
      sessionKind: 'pre-release-original-machine-training',
      oracle: 'externally supplied original-machine training acceptance',
    }
    const compiled = await compileCampaignDefinition({ plan: { ...plan,
      requiredContracts: ['C29'], bindings: [binding],
    }, sourceIdentity })
    expect(compiled.bindings[0].proofMode).toBe('external-human')
    for (const invalid of [
      { contractId: 'C28' },
      { sessionKind: 'post-publication-field-shadow' },
      { sessionKind: undefined },
    ]) {
      await expect(compileCampaignDefinition({ plan: { ...plan,
        requiredContracts: [invalid.contractId ?? 'C29'], bindings: [{ ...binding, ...invalid }],
      }, sourceIdentity })).rejects.toThrow(/external human|training/iu)
    }
  })

  it('blocks calibration adapters masquerading as candidate browser evidence', async () => {
    const fixturePath = await createFixture()
    const plan = makePlan(fixturePath)
    const definition = await compileCampaignDefinition({ plan: {
      ...plan, mode: 'candidate', candidateId: 'beta13', version: '0.1.0-beta.13',
      claimScope: BETA13_CLAIM_SCOPE,
      requiredContracts: Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, '0')}`),
      bindings: Array.from({ length: 30 }, (_, i) => ({ ...plan.bindings[0],
        contractId: `C${String(i).padStart(2, '0')}`, proofMode: 'browser', oracle: 'claimed browser proof',
      })),
    }, sourceIdentity })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('ENVIRONMENT_BLOCKED')
    expect(preflight.blockers.join(' ')).toMatch(/calibration/u)
    const forgedSource = await preflightCampaign({ definition, campaignRoot: temporaryRoot!, currentSourceIdentity: sourceIdentity })
    expect(forgedSource.blockers.join(' ')).toMatch(/live checkout/iu)
    expect(forgedSource.blockers.join(' ')).toMatch(/reviewed binding/iu)
  })

  it('rejects a preflight lease borrowed from a different campaign root', async () => {
    const { definition } = await compilePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    await expect(runContractAttempt({ definition, preflight, campaignRoot: path.join(temporaryRoot!, 'other-root'), contractId: 'C00', variantId: 'synthetic-pass' }))
      .rejects.toThrow(/lease/u)
  })

  it('requires every mandatory variant, not merely one pass per contract', async () => {
    const fixturePath = await createFixture()
    const plan = makePlan(fixturePath)
    const binding = plan.bindings[0]
    const definition = await compileCampaignDefinition({
      plan: { ...plan, requiredContracts: ['C00'], bindings: [binding, { ...binding, variantId: 'second-required' }] },
      sourceIdentity,
    })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: binding.variantId })
    await ingestAdvisoryJudgeResult({ attemptDirectory: attempt.attemptDirectory, result: {
      schema: 'sartracker-oracle-blind-judge-result-v1', campaignId: definition.campaignId,
      attemptId: attempt.attemptId, packetSha256: attempt.judgePacketSha256, verdict: 'pass', observations: [],
    } })
    const verdict = await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })
    expect(verdict.verdict).toBe('ENVIRONMENT_BLOCKED')
    expect(verdict.blockers.join(' ')).toContain('C00:second-required')
  })

  it('revalidates retained receipt semantics against its binding at verdict time', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'synthetic-pass' })
    const receiptPath = path.join(attempt.attemptDirectory, 'receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(receiptPath, JSON.stringify({ ...receipt, proofMode: 'installed-deb' }))
    await ingestAdvisoryJudgeResult({ attemptDirectory: attempt.attemptDirectory, result: {
      schema: 'sartracker-oracle-blind-judge-result-v1', campaignId: definition.campaignId,
      attemptId: attempt.attemptId, packetSha256: attempt.judgePacketSha256, verdict: 'pass', observations: [],
    } })
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
  })

  it.each(['INVALID_EVIDENCE', 'NEEDS_HUMAN_DECISION', 'CLEANUP_BLOCKED'])('does not mask a mandatory %s variant with a passing sibling', async (status) => {
    const fixturePath = await createFixture()
    const plan = makePlan(fixturePath)
    const binding = plan.bindings[0]
    const definition = await compileCampaignDefinition({ plan: {
      ...plan, requiredContracts: ['C00'], bindings: [binding, { ...binding, variantId: 'second-required' }],
    }, sourceIdentity })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    for (const variantId of ['synthetic-pass', 'second-required']) {
      const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId })
      if (variantId === 'synthetic-pass') {
        for (const name of ['receipt.json', 'result.json']) {
          const target = path.join(attempt.attemptDirectory, name)
          const value = JSON.parse(await readFile(target, 'utf8'))
          await writeFile(target, JSON.stringify({ ...value, status }))
        }
      }
      await ingestAdvisoryJudgeResult({ attemptDirectory: attempt.attemptDirectory, result: {
        schema: 'sartracker-oracle-blind-judge-result-v1', campaignId: definition.campaignId,
        attemptId: attempt.attemptId, packetSha256: attempt.judgePacketSha256, verdict: 'pass', observations: [],
      } })
    }
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe(status)
  })

  it('rechecks bound bytes after preflight before executing an attempt', async () => {
    const { definition, fixturePath } = await compilePlan()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    await writeFile(fixturePath, 'changed after preflight')
    await expect(runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'synthetic-pass' }))
      .rejects.toThrow(/identity changed/u)
  })

  it('rejects a verdict after validator bytes have changed', async () => {
    const fixturePath = await createFixture()
    const validatorPath = path.join(temporaryRoot!, 'validator.mjs')
    await writeFile(validatorPath, 'export const version = 1')
    const plan = makePlan(fixturePath)
    const definition = await compileCampaignDefinition({ plan: {
      ...plan, requiredContracts: ['C00'], bindings: [plan.bindings[0]], validatorPaths: [validatorPath],
    }, sourceIdentity })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'synthetic-pass' })
    await ingestAdvisoryJudgeResult({ attemptDirectory: attempt.attemptDirectory, result: {
      schema: 'sartracker-oracle-blind-judge-result-v1', campaignId: definition.campaignId,
      attemptId: attempt.attemptId, packetSha256: attempt.judgePacketSha256, verdict: 'pass', observations: [],
    } })
    await writeFile(validatorPath, 'export const version = 2')
    expect((await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })).verdict).toBe('INVALID_EVIDENCE')
  })

  it('does not accept sealed evidence belonging to another compiled campaign', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({ definition, preflight, campaignRoot: temporaryRoot!, contractId: 'C00', variantId: 'synthetic-pass' })
    await ingestAdvisoryJudgeResult({ attemptDirectory: attempt.attemptDirectory, result: {
      schema: 'sartracker-oracle-blind-judge-result-v1', campaignId: definition.campaignId,
      attemptId: attempt.attemptId, packetSha256: attempt.judgePacketSha256, verdict: 'pass', observations: [],
    } })
    const other = await compileCampaignDefinition({
      plan: makePlan(definition.identities.fixtures[0].path, { campaignId: 'other-campaign', requiredContracts: ['C00'] }), sourceIdentity,
    })
    const verdict = await computeCampaignVerdict({ definition: other, campaignRoot: temporaryRoot! })
    expect(verdict.verdict).toBe('INVALID_EVIDENCE')
  })
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

  it('allows an exact compile rerun but rejects replacement with different immutable bytes', async () => {
    const fixturePath = await createFixture()
    const outputPath = path.join(temporaryRoot!, 'campaign-definition.json')
    const plan = makePlan(fixturePath)
    const first = await compileCampaignDefinition({ plan, sourceIdentity, outputPath })
    const second = await compileCampaignDefinition({ plan, sourceIdentity, outputPath })
    expect(second.definitionDigest).toBe(first.definitionDigest)

    await expect(compileCampaignDefinition({
      plan: { ...plan, campaignId: 'different-campaign' },
      sourceIdentity,
      outputPath,
    })).rejects.toThrow(/differs; choose a new output path/u)
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

  it('fails candidate preflight when the compiled source SHA or tree changes', async () => {
    const { definition } = await compilePlan({
      mode: 'candidate',
      campaignId: 'candidate-source-identity',
      requiredContracts: ['C00'],
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

    const preflight = await preflightCampaign({
      definition,
      campaignRoot: temporaryRoot!,
      currentSourceIdentity: { ...sourceIdentity, sha: 'c'.repeat(40) },
    })
    expect(preflight.status).toBe('ENVIRONMENT_BLOCKED')
    expect(preflight.blockers).toContain('source identity differs from the immutable campaign definition')
  })

  it('keeps every C00-C29 row required in a candidate verdict', async () => {
    const { definition } = await compilePlan({
      mode: 'candidate',
      campaignId: 'candidate-coverage',
      candidateId: 'candidate-id',
      version: 'candidate-version',
      requiredContracts: ['C00'],
    })

    const verdict = await computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! })
    expect(verdict.verdict).toBe('INVALID_EVIDENCE')
    expect(verdict.evidenceErrors.join(' ')).toMatch(/reviewed binding/iu)
    expect(verdict.blockers).toContain('missing required contract C29')
    expect(verdict.contractRows.filter((row) => row.required)).toHaveLength(30)
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

  it('rejects a capture name before it can escape the attempt directory', async () => {
    const fixturePath = await createFixture()
    const { definition } = await compilePlan({
      requiredContracts: ['C00'],
      bindings: [{
        contractId: 'C00',
        variantId: 'synthetic-capture',
        adapterId: 'calibration.capture',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        mandatory: true,
        command: ['internal-calibration', 'capture'],
        captureName: '../../escaped',
        capturePath: fixturePath,
      }],
    })
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    const attempt = await runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-capture',
    })

    expect(attempt.status).toBe('INVALID_EVIDENCE')
    expect(await readFile(path.join(temporaryRoot!, 'escaped')).catch(() => '')).toBe('')
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

    const sealed = await ingestAdvisoryJudgeResult({
      attemptDirectory: resumed.attemptDirectory,
      result: {
        schema: 'sartracker-oracle-blind-judge-result-v1',
        campaignId: definition.campaignId,
        attemptId: resumed.attemptId,
        packetSha256: resumed.judgePacketSha256,
        verdict: 'pass',
        observations: [],
      },
    })
    await expect(computeCampaignVerdict({ definition, campaignRoot: temporaryRoot! }))
      .resolves.toMatchObject({ verdict: 'PASS' })
    await verifyCampaignAttempt({ attemptDirectory: resumed.attemptDirectory, anchorPath: sealed.anchorPath })
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

    await expect(runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'synthetic-pass',
      resumeAttemptId: attempt.attemptId,
    })).rejects.toThrow(/sealed/u)

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

  it('does not hand a live campaign lease to another process', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const lease = await createCampaignLease({ campaignRoot: temporaryRoot!, definition })
    const lockPath = path.join(temporaryRoot!, 'campaign.lock')
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>
    await writeFile(lockPath, JSON.stringify({ ...lock, pid: 1, host: os.hostname() }), 'utf8')

    await expect(createCampaignLease({ campaignRoot: temporaryRoot!, definition }))
      .rejects.toThrow(/held by live process/u)
    expect(lease.status).toBe('ACQUIRED')
  })
  it('rolls back unpublished lease roots when acquisition preparation fails', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'], baselinePorts: [0] })
    await expect(createCampaignLease({ campaignRoot: temporaryRoot!, definition })).rejects.toThrow(/baseline port/iu)
    expect(await readFile(path.join(temporaryRoot!, 'campaign.lock'), 'utf8').catch(() => null)).toBeNull()
    const leasesRoot = path.join(temporaryRoot!, 'leases')
    expect((await readdir(leasesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())).toHaveLength(0)
  })
  it('rejects a symlinked lease root before publishing campaign custody', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    await symlink(path.dirname(temporaryRoot!), path.join(temporaryRoot!, 'leases'))
    await expect(createCampaignLease({ campaignRoot: temporaryRoot!, definition })).rejects.toThrow(/real directory/iu)
    expect(await readFile(path.join(temporaryRoot!, 'campaign.lock'), 'utf8').catch(() => null)).toBeNull()
  })
  it('rejects cleanup when the lease PID is reused by a different process instance', async () => {
    const { definition } = await compilePlan({ requiredContracts: ['C00'] })
    const lease = await createCampaignLease({ campaignRoot: temporaryRoot!, definition })
    const state = JSON.parse(await readFile(lease.leasePath, 'utf8'))
    await writeFile(lease.leasePath, JSON.stringify({ ...state, processStart: 'reused-process-instance' }), 'utf8')
    const { cleanupCampaignLease } = await import('../../scripts/qualification/control-plane.mjs')
    await expect(cleanupCampaignLease({ leasePath: lease.leasePath })).rejects.toThrow(/PID|process instance|ownership/iu)
  })
})
