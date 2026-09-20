import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const fsState = vi.hoisted(() => ({ failureCode: null as 'EIO' | 'ENOSPC' | null, writesBeforeFailure: null as number | null }))

const actualFs = await import('node:fs/promises')
const probeHandle = await actualFs.open('/dev/null', 'r')
const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as {
  writeFile: (...args: never[]) => Promise<unknown>
}
const originalFileHandleWriteFile = fileHandlePrototype.writeFile
fileHandlePrototype.writeFile = function writeFileWithInjectedFailure(this: unknown, ...args: never[]) {
  if (fsState.writesBeforeFailure !== null) {
    if (fsState.writesBeforeFailure > 0) {
      fsState.writesBeforeFailure -= 1
      return originalFileHandleWriteFile.apply(this, args)
    }
    fsState.writesBeforeFailure = null
    throw Object.assign(new Error('injected canonical receipt persistence failure'), { code: fsState.failureCode })
  }
  return originalFileHandleWriteFile.apply(this, args)
}
await probeHandle.close()

const {
  compileCampaignDefinition,
  preflightCampaign,
  runContractAttempt,
} = await import('../../scripts/qualification/candidate-control-plane.mjs')

const registryPath = path.resolve('docs/assurance/qualification-contracts.json')
const sourceIdentity = { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false }
let temporaryRoot: string | undefined

afterEach(async () => {
  fsState.failureCode = null
  fsState.writesBeforeFailure = null
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

afterAll(() => {
  fileHandlePrototype.writeFile = originalFileHandleWriteFile
})

async function compileCalibrationDefinition() {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-receipt-persistence-'))
  const fixturePath = path.join(temporaryRoot, 'fixture.json')
  await writeFile(fixturePath, '{"receipt":"persistence"}\n', 'utf8')
  return compileCampaignDefinition({
    plan: {
      schema: 'sartracker-qualification-campaign-plan-v1',
      campaignId: 'receipt-persistence-campaign',
      mode: 'calibration',
      releaseEligible: false,
      authorization: { issue: 'DON-254', explicitlyEnabled: true },
      registryPath,
      fixturePaths: [fixturePath],
      artifacts: [{ role: 'ci-appimage', path: fixturePath, localBuild: false }],
      requiredContracts: ['C00'],
      bindings: [{
        contractId: 'C00',
        variantId: 'receipt-persistence',
        adapterId: 'calibration.pass',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        resourceKey: 'receipt-persistence',
        mandatory: true,
        command: ['internal-calibration', 'pass'],
      }],
    },
    sourceIdentity,
  })
}

describe('candidate canonical receipt persistence custody', () => {
  it.each(['EIO', 'ENOSPC'] as const)('retains the resource lock and avoids fallback writes on %s', async (failureCode) => {
    fsState.failureCode = failureCode
    const definition = await compileCalibrationDefinition()
    const preflight = await preflightCampaign({ definition, campaignRoot: temporaryRoot! })
    expect(preflight.status).toBe('READY')
    fsState.writesBeforeFailure = 2

    await expect(runContractAttempt({
      definition,
      preflight,
      campaignRoot: temporaryRoot!,
      contractId: 'C00',
      variantId: 'receipt-persistence',
    })).rejects.toMatchObject({ code: 'QUALIFICATION_RECEIPT_PERSISTENCE_FAILED' })

    expect(await readFile(path.join(temporaryRoot!, 'locks', 'receipt-persistence.lock'), 'utf8')).toContain('receipt-persistence')
    const attemptDirectories = await readdir(path.join(temporaryRoot!, 'attempts'))
    expect(attemptDirectories).toHaveLength(1)
    const attemptDirectory = path.join(temporaryRoot!, 'attempts', attemptDirectories[0])
    await expect(readFile(path.join(attemptDirectory, 'result.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(attemptDirectory, 'state.ndjson'), 'utf8')).not.toMatch(/receipt-written|blocked/iu)
  })
})
