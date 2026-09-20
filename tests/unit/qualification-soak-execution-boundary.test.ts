import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('../../scripts/qualification/owned-process.mjs', () => ({
  runOwnedProcess: vi.fn(),
}))

import { runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'
import { executeSoakVariant, executeSoakVariantInProcess, validateRetainedSoak } from '../../scripts/qualification/soak-adapter.mjs'

describe('soak execution boundary', () => {
  it('keeps the direct in-process validation path available to the worker', async () => {
    await expect(executeSoakVariantInProcess({
      normalized: { runtimeInputs: { config: {} } },
      binding: { contractId: 'C04', variantId: 'ci', proofMode: 'ci-appimage' },
      attemptDirectory: 'relative-attempt',
      workDirectory: '/tmp/sartracker-soak-boundary-work',
    })).rejects.toThrow(/attempt directory must be absolute/iu)
  })

  it('returns the completed receipt to the controller without an unbounded parent filesystem write', async () => {
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
      expect(await readdir(attemptDirectory)).toEqual([])
      expect(vi.mocked(runOwnedProcess)).toHaveBeenCalledOnce()
    } finally {
      await Promise.all([
        rm(attemptDirectory, { recursive: true, force: true }),
        rm(workDirectory, { recursive: true, force: true }),
      ])
    }
  })

  it('returns a code-only cleanup failure without requiring any parent receipt write or artifact rehash', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-write-failure-'))
    const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-boundary-write-work-'))
    const definition = { definitionDigest: 'd'.repeat(64), identities: {
      source: { sha: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false },
    } }
    const binding = { contractId: 'C04', variantId: 'ci', proofMode: 'ci-appimage' }
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
      const receipt = await executeSoakVariant({
        normalized: definition,
        binding,
        attemptDirectory,
        workDirectory,
      })
      expect(receipt.workerExecution).toMatchObject({ failureCode: 'WORKER_TIMEOUT_CLEANUP_UNPROVEN', resourceCleanupBlocked: true })
      await expect(validateRetainedSoak(receipt, binding, { definition, attemptDirectory }))
        .resolves.toMatchObject({ status: 'INVALID_EVIDENCE' })
      expect(await readdir(attemptDirectory)).toEqual([])
      for (const invalid of [
        { ...receipt, status: 'PASS' },
        { ...receipt, validation: { ...receipt.validation, passed: true } },
        { ...receipt, sourceSha: 'f'.repeat(40) },
        { ...receipt, definitionDigest: 'e'.repeat(64) },
        { ...receipt, workerExecution: { ...receipt.workerExecution, failureCode: 'UNREVIEWED' } },
        { ...receipt, workerExecution: { ...receipt.workerExecution, failureCode: 'toString' } },
        { ...receipt, workerExecution: { ...receipt.workerExecution, cleanupVerified: true } },
      ]) {
        await expect(validateRetainedSoak(invalid, binding, { definition, attemptDirectory })).rejects.toThrow()
      }
    } finally {
      vi.mocked(runOwnedProcess).mockReset()
      await Promise.all([
        rm(attemptDirectory, { recursive: true, force: true }),
        rm(workDirectory, { recursive: true, force: true }),
      ])
    }
  })
})
