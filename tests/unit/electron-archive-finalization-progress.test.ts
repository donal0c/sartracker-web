import { afterEach, describe, expect, it, vi } from 'vitest'

import { finalizeAndVerifyArchive } from '../../scripts/electron-archive-lifecycle-smoke.mjs'

const operationId = 'aa915df2-319d-4fe4-9d61-b0f1061a884e'
const missionId = 'synthetic-progress-mission'
type Progress = { operationId: string; missionId: string; kind: string; phase: string }

/** Runs the real serialized collector against independently scheduled IPC result and progress. */
function createProgressHarness() {
  let listener: ((progress: Progress) => void) | null = null
  const unsubscribe = vi.fn(() => { listener = null })
  const finalized = {
    mission: { id: missionId, status: 'finalized' },
    archive: {
      mission_id: missionId, container_version: 2, status: 'verified',
      availability: 'present', ciphertext_sha256: 'a'.repeat(64), size_bytes: 1024,
    },
  }
  const finalize = vi.fn(async () => finalized)
  const browser: Record<string, unknown> = {
    sartrackerElectron: {
      missionStore: {
        issueMissionArchiveRecoveryCode: async () => ({ operationId, recoveryCode: 'synthetic-code' }),
        finalizeMission: finalize,
        getMission: async () => finalized.mission,
      },
      onMissionArchiveProgress: (callback: (progress: Progress) => void) => {
        listener = callback
        return unsubscribe
      },
    },
  }
  vi.stubGlobal('window', browser)
  return {
    page: {
      evaluate: async <T, A>(callback: (argument: A) => T, argument: A) => callback(argument),
      exposeFunction: async (name: string, callback: unknown) => { browser[name] = callback },
    },
    emit: (progress: Partial<Progress> = {}) => listener?.({
      operationId, missionId, kind: 'verify', phase: 'verified', ...progress,
    }),
    finalize,
    unsubscribe,
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('packaged finalization progress collection [DON-252]', () => {
  it('retains the listener when the verified result overtakes terminal progress', async () => {
    vi.useFakeTimers()
    const harness = createProgressHarness()
    let settled = false
    const operation = finalizeAndVerifyArchive(harness.page, missionId, 'synthetic-secret', () => undefined)
      .then((result) => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.finalize).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(harness.unsubscribe).not.toHaveBeenCalled()
    harness.emit()
    await expect(operation).resolves.toMatchObject({ verifyProgressPhases: ['verified'] })
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not accept another operation or mission terminal as verification evidence', async () => {
    vi.useFakeTimers()
    const harness = createProgressHarness()
    let settled = false
    const operation = finalizeAndVerifyArchive(harness.page, missionId, 'synthetic-secret', () => undefined)
      .then((result) => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(0)
    harness.emit({ operationId: 'another-operation' })
    harness.emit({ missionId: 'another-mission' })
    harness.emit({ kind: 'create' })
    harness.emit({ phase: 'proof' })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    harness.emit()
    const result = await operation
    expect(result.verifyProgressPhases).toEqual(['proof', 'verified'])
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('fails closed with a bounded timeout when terminal progress never arrives', async () => {
    vi.useFakeTimers()
    const harness = createProgressHarness()
    const operation = finalizeAndVerifyArchive(harness.page, missionId, 'synthetic-secret', () => undefined)
    const rejection = expect(operation).rejects.toThrow(/without terminal verified progress within 5000 ms/u)
    await vi.advanceTimersByTimeAsync(5_000)
    await rejection
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts terminal progress delivered before the result and clears its timeout', async () => {
    vi.useFakeTimers()
    const harness = createProgressHarness()
    const result = await harness.finalize()
    harness.finalize.mockImplementationOnce(async () => { harness.emit(); return result })
    await expect(finalizeAndVerifyArchive(harness.page, missionId, 'synthetic-secret', () => undefined))
      .resolves.toMatchObject({ verifyProgressPhases: ['verified'] })
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a finalization failure and releases its subscription immediately', async () => {
    vi.useFakeTimers()
    const harness = createProgressHarness()
    harness.finalize.mockRejectedValueOnce(new Error('Synthetic verification failed'))
    await expect(finalizeAndVerifyArchive(harness.page, missionId, 'synthetic-secret', () => undefined))
      .rejects.toThrow('Synthetic verification failed')
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
