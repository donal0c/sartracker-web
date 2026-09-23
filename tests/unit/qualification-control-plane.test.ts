import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildJudgePacket,
  compileCoverageRegistry,
  evaluateCandidate,
  fileIdentity,
  qualificationVerdictExitCode,
  verifySealedResult,
  writeSealedResult,
} from '../../scripts/qualification/control-plane.mjs'

const registryPath = path.resolve('docs/assurance/qualification-contracts.json')
const sourceIdentity = { sha: 'a'.repeat(40), dirty: false }
let temporaryRoot: string | undefined

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('qualification control plane', () => {
  it('treats a computed scope-limited verdict as a successful command result while retaining its hold', () => {
    expect(qualificationVerdictExitCode({ verdict: 'PASS' })).toBe(0)
    expect(qualificationVerdictExitCode({ verdict: 'SCOPE_LIMITED', releaseEligible: false })).toBe(0)
    expect(qualificationVerdictExitCode({ verdict: 'FAIL' })).toBe(1)
    expect(qualificationVerdictExitCode({ verdict: 'ENVIRONMENT_BLOCKED' })).toBe(2)
  })

  it('compiles exactly C00-C29 with complete unique release-critical hazard ownership', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const compiled = compileCoverageRegistry(registry)

    expect(compiled.contracts).toHaveLength(30)
    expect(compiled.coverage).toHaveLength(registry.releaseCriticalHazards.length)
  })

  it('fails when a contract is missing or release-critical ownership is duplicated', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(() => compileCoverageRegistry({ ...registry, contracts: registry.contracts.slice(1) }))
      .toThrow(/missing=C00/u)

    const duplicate = structuredClone(registry)
    duplicate.contracts[1].hazards.push(duplicate.contracts[0].hazards[0])
    expect(() => compileCoverageRegistry(duplicate)).toThrow(`duplicate=${registry.contracts[0].hazards[0]}`)

    const selfOmitted = structuredClone(registry)
    selfOmitted.releaseCriticalHazards = selfOmitted.releaseCriticalHazards.filter((hazard: string) => hazard !== 'TRK-001')
    selfOmitted.contracts.find((contract: { id: string }) => contract.id === 'C04').hazards = []
    expect(() => compileCoverageRegistry(selfOmitted)).toThrow(/missing=TRK-001/u)

    const missingChange = structuredClone(registry)
    missingChange.programmeChanges = missingChange.programmeChanges.filter((change: string) => change !== 'BCP-17')
    expect(() => compileCoverageRegistry(missingChange)).toThrow(/missing=BCP-17/u)

    const missingAuthority = structuredClone(registry)
    for (const contract of missingAuthority.contracts) {
      contract.authorities = contract.authorities.filter((authority: string) => authority !== 'SAR-QA-022')
    }
    expect(() => compileCoverageRegistry(missingAuthority)).toThrow(/missing=SAR-QA-022/u)

    const inventedGate = structuredClone(registry)
    inventedGate.contracts[0].releaseGates.push('invented-release-gate')
    expect(() => compileCoverageRegistry(inventedGate)).toThrow(/unexpected values/u)
  })

  it('keeps final candidate execution disabled until the separately authorized campaign', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(() => evaluateCandidate({
      registry,
      mode: 'candidate',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: registry.contracts.map(({ id }: { id: string }) => ({ contractId: id, status: 'pass' })),
      judgeResults: registry.contracts.map(({ id }: { id: string }) => ({ contractId: id, verdict: 'pass' })),
    })).toThrow(/immutable campaign definition/u)
  })

  it('does not accept an unvalidated immutable/releaseEligible pair as candidate authority', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(() => evaluateCandidate({
      registry,
      mode: 'candidate',
      identities: { source: { ...sourceIdentity, tree: 'b'.repeat(40) }, fixtures: [], artifacts: [] },
      contractResults: registry.contracts.map(({ id }: { id: string }) => ({ contractId: id, status: 'pass' })),
      campaignDefinition: { immutable: true, releaseEligible: false },
    })).toThrow(/validated immutable campaign definition|digest/u)
  })

  it('creates an oracle-blind advisory packet without deterministic answers', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'dry-run',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: [],
    })
    const packet = buildJudgePacket({
      attemptId: 'dry-run-1',
      result,
      captures: [{ name: 'shell-startup', kind: 'image', sha256: 'b'.repeat(64) }],
    })

    expect(packet.advisoryOnly).toBe(true)
    expect(packet.deterministicVerdictWithheld).toBe(true)
    expect(JSON.stringify(packet)).not.toContain(result.deterministicFailures.join(','))
  })

  it('binds fixture bytes and rejects evidence changed after sealing', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-qualification-control-'))
    const fixturePath = path.join(temporaryRoot, 'fixture.json')
    await writeFile(fixturePath, '{"fixture":true}\n', 'utf8')
    const identity = await fileIdentity(fixturePath)
    expect(identity.sha256).toMatch(/^[a-f0-9]{64}$/u)

    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'dry-run',
      identities: { source: sourceIdentity, fixtures: [identity], artifacts: [] },
      contractResults: [],
    })
    const judgePacket = buildJudgePacket({ attemptId: 'dry-run-seal', result })
    const sealed = await writeSealedResult({
      outputRoot: temporaryRoot,
      attemptId: 'dry-run-seal',
      result,
      judgePacket,
    })
    await expect(verifySealedResult(sealed.attemptDirectory, sealed.anchorPath)).resolves.toBe(true)

    await writeFile(sealed.resultPath, '{"tampered":true}\n', 'utf8')
    await expect(verifySealedResult(sealed.attemptDirectory, sealed.anchorPath)).rejects.toThrow(/changed after sealing/u)
  })

  it('rejects an absent anchor, extra evidence and symlinks escaping the attempt', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-qualification-closed-set-'))
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'dry-run',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: [],
    })
    const judgePacket = buildJudgePacket({ attemptId: 'dry-run-closed-set', result })
    const sealed = await writeSealedResult({
      outputRoot: temporaryRoot,
      attemptId: 'dry-run-closed-set',
      result,
      judgePacket,
    })

    await expect(verifySealedResult(sealed.attemptDirectory, undefined)).rejects.toThrow(/external anchor is required/u)
    const extraPath = path.join(sealed.attemptDirectory, 'unlisted.json')
    await writeFile(extraPath, '{}\n', 'utf8')
    await expect(verifySealedResult(sealed.attemptDirectory, sealed.anchorPath)).rejects.toThrow(/unlisted evidence/u)
    await rm(extraPath)

    const outsidePath = path.join(temporaryRoot, 'outside.json')
    await writeFile(outsidePath, '{}\n', 'utf8')
    await rm(sealed.resultPath)
    await symlink(outsidePath, sealed.resultPath)
    await expect(verifySealedResult(sealed.attemptDirectory, sealed.anchorPath)).rejects.toThrow(/not a regular file/u)
  })

  it('rejects a symbolic-link evidence root before writing outside the requested boundary', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-qualification-root-link-'))
    const externalRoot = path.join(temporaryRoot, 'external')
    const linkedRoot = path.join(temporaryRoot, 'evidence')
    await mkdir(externalRoot)
    await symlink(externalRoot, linkedRoot)

    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'dry-run',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: [],
    })
    const judgePacket = buildJudgePacket({ attemptId: 'dry-run-root-link', result })

    await expect(writeSealedResult({
      outputRoot: linkedRoot,
      attemptId: 'dry-run-root-link',
      result,
      judgePacket,
    })).rejects.toThrow(/evidence root must not be a symbolic link/u)
    await expect(readFile(path.join(externalRoot, 'dry-run-root-link', 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a sealed attempt directory replaced by a symbolic link', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-qualification-attempt-link-'))
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'dry-run',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: [],
    })
    const judgePacket = buildJudgePacket({ attemptId: 'dry-run-attempt-link', result })
    const sealed = await writeSealedResult({
      outputRoot: temporaryRoot,
      attemptId: 'dry-run-attempt-link',
      result,
      judgePacket,
    })
    const movedAttempt = path.join(temporaryRoot, 'moved-attempt')
    await rename(sealed.attemptDirectory, movedAttempt)
    await symlink(movedAttempt, sealed.attemptDirectory)

    await expect(verifySealedResult(sealed.attemptDirectory, sealed.anchorPath)).rejects.toThrow(/attempt directory must be a real directory/u)
  })
})
