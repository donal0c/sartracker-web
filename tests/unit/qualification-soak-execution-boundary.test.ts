import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('../../scripts/qualification/owned-process.mjs', () => ({
  runOwnedProcess: vi.fn(),
}))

import { runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'
import { executeSoakVariant, executeSoakVariantInProcess } from '../../scripts/qualification/soak-adapter.mjs'

describe('soak execution boundary', () => {
  it('keeps the direct in-process validation path available to the worker', async () => {
    await expect(executeSoakVariantInProcess({
      normalized: { runtimeInputs: { config: {} } },
      binding: { contractId: 'C04', variantId: 'ci', proofMode: 'ci-appimage' },
      attemptDirectory: 'relative-attempt',
      workDirectory: '/tmp/sartracker-soak-boundary-work',
    })).rejects.toThrow(/attempt directory must be absolute/iu)
  })

  it('writes one completed receipt after a bounded worker result', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-attempt-'))
    const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-work-'))
    const workerReceipt = {
      schema: 'sartracker-soak-adapter-receipt-v1',
      status: 'PASS',
      contractId: 'C04',
      variantId: 'ci',
      proofMode: 'ci-appimage',
    }
    vi.mocked(runOwnedProcess).mockResolvedValueOnce({
      supervisorPid: 1234,
      processError: null,
      timedOut: false,
      zeroDescendantsAfterRun: true,
      exitCode: 0,
      signal: null,
      stdout: `${JSON.stringify({
        schema: 'sartracker-soak-worker-result-v1',
        status: 'completed',
        receipt: workerReceipt,
      })}\n`,
    })

    try {
      const receipt = await executeSoakVariant({
        normalized: { definitionDigest: 'd'.repeat(64) },
        binding: { contractId: 'C04', variantId: 'ci', proofMode: 'ci-appimage' },
        attemptDirectory,
        workDirectory,
      })

      expect(receipt.workerExecution).toMatchObject({
        status: 'COMPLETED',
        cleanupVerified: true,
        resourceCleanupBlocked: false,
      })
      const retained = JSON.parse(await readFile(path.join(attemptDirectory, 'soak-adapter-receipt.json'), 'utf8'))
      expect(retained).toEqual(receipt)
      expect(vi.mocked(runOwnedProcess)).toHaveBeenCalledOnce()
    } finally {
      await Promise.all([
        rm(attemptDirectory, { recursive: true, force: true }),
        rm(workDirectory, { recursive: true, force: true }),
      ])
    }
  })

  it('returns a code-only cleanup marker when the invalid receipt cannot be retained', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-write-failure-'))
    const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-write-work-'))
    await writeFile(path.join(attemptDirectory, 'soak-adapter-receipt.json'), '{}\n', 'utf8')
    vi.mocked(runOwnedProcess).mockResolvedValueOnce({
      supervisorPid: 1234,
      processError: null,
      timedOut: true,
      zeroDescendantsAfterRun: false,
      exitCode: null,
      signal: 'SIGKILL',
      stdout: '',
    })

    try {
      await expect(executeSoakVariant({
        normalized: { definitionDigest: 'd'.repeat(64) },
        binding: { contractId: 'C04', variantId: 'ci', proofMode: 'ci-appimage' },
        attemptDirectory,
        workDirectory,
      })).rejects.toMatchObject({
        code: 'SOAK_RESOURCE_CLEANUP_BLOCKED',
        resourceCleanupBlocked: true,
      })
    } finally {
      vi.mocked(runOwnedProcess).mockReset()
      await Promise.all([
        rm(attemptDirectory, { recursive: true, force: true }),
        rm(workDirectory, { recursive: true, force: true }),
      ])
    }
  })
})
