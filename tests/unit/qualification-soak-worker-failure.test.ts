import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../scripts/qualification/owned-process.mjs', () => ({ runOwnedProcess: vi.fn() }))

import { runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'
import { compileCampaignDefinition, preflightCampaign, runContractAttempt, cleanupCampaignLease } from '../../scripts/qualification/candidate-control-plane.mjs'

const roots: string[] = []
afterEach(async () => {
  vi.mocked(runOwnedProcess).mockReset()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('soak worker failure terminal evidence', () => {
  it.each([
    { cleanup: true, timedOut: true, supervisorPid: 1234, status: 'INVALID_EVIDENCE', code: 'WORKER_TIMEOUT_CLEAN' },
    { cleanup: false, timedOut: true, supervisorPid: 1234, status: 'CLEANUP_BLOCKED', code: 'WORKER_TIMEOUT_CLEANUP_UNPROVEN' },
    { cleanup: false, timedOut: false, supervisorPid: null, status: 'INVALID_EVIDENCE', code: 'WORKER_UNAVAILABLE' },
  ])('retains $status after $code through the real validator', async ({ cleanup, timedOut, supervisorPid, status, code }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-terminal-'))
    roots.push(root)
    const fixture = path.join(root, 'fixture.json')
    await writeFile(fixture, '{"synthetic":"failure-only"}\n', 'utf8')
    const definition = await compileCampaignDefinition({
      plan: {
        schema: 'sartracker-qualification-campaign-plan-v1',
        campaignId: 'soak-worker-failure', mode: 'calibration', releaseEligible: false,
        authorization: { issue: 'DON-254', explicitlyEnabled: true },
        registryPath: path.resolve('docs/assurance/qualification-contracts.json'),
        fixturePaths: [fixture], artifacts: [{ role: 'ci-appimage', path: fixture, localBuild: false }],
        requiredContracts: ['C04'],
        bindings: [{ contractId: 'C04', variantId: 'ci', adapterId: 'soak.reviewed',
          receiptValidatorId: 'soak.receipt', proofMode: 'ci-appimage', capability: 'node',
          resourceKey: 'soak-terminal', mandatory: true, oracle: 'actual code-only failure validator', command: ['fixed-worker'] }],
      },
      sourceIdentity: { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false },
    })
    const preflight = await preflightCampaign({ definition, campaignRoot: root })
    expect(preflight.status).toBe('READY')
    vi.mocked(runOwnedProcess).mockResolvedValueOnce({
      supervisorPid, processError: supervisorPid === null ? 'unavailable' : 'timeout',
      timedOut, zeroDescendantsAfterRun: cleanup, exitCode: null, signal: null, stdout: '',
    })
    const result = await runContractAttempt({ definition, preflight, campaignRoot: root, contractId: 'C04', variantId: 'ci' })
    expect(result.status).toBe(status)
    expect(result.releaseEligible).toBe(false)
    const receipt = JSON.parse(await readFile(path.join(result.attemptDirectory, 'receipt.json'), 'utf8'))
    expect(receipt.status).toBe(status)
    expect(receipt.observed.workerExecution.failureCode).toBe(code)
    expect(receipt.observed.rawReportPath).toBeNull()
    expect(JSON.parse(await readFile(path.join(result.attemptDirectory, 'result.json'), 'utf8')).status).toBe(status)
    expect(await readFile(path.join(result.attemptDirectory, 'state.ndjson'), 'utf8')).toContain('receipt-written')
    const lock = path.join(root, 'locks', 'soak-terminal.lock')
    if (status === 'CLEANUP_BLOCKED') {
      expect(await readFile(lock, 'utf8')).toContain('soak-terminal')
      await expect(cleanupCampaignLease({ leasePath: preflight.lease!.leasePath })).rejects.toThrow(/resource locks remain/iu)
    } else {
      await expect(readFile(lock, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
