import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildJudgePacket,
  compileCoverageRegistry,
  evaluateCandidate,
  fileIdentity,
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
    expect(() => compileCoverageRegistry(duplicate)).toThrow(/duplicate=PKG-001/u)
  })

  it('never lets an advisory judge pass override an unrun deterministic contract', async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const result = evaluateCandidate({
      registry,
      mode: 'candidate',
      identities: { source: sourceIdentity, fixtures: [], artifacts: [] },
      contractResults: registry.contracts.slice(1).map(({ id }: { id: string }) => ({ contractId: id, status: 'pass' })),
      judgeResults: [{ contractId: 'C00', verdict: 'pass' }],
    })

    expect(result.verdict).toBe('HOLD')
    expect(result.releaseEligible).toBe(false)
    expect(result.deterministicFailures).toEqual(['C00'])
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
})
