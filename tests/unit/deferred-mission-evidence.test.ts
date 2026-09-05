import { describe, expect, it, vi } from 'vitest'

import {
  createDeferredMissionEvidenceQueue,
} from '../../src/features/tracking/deferred-mission-evidence'

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('deferred mission evidence queue [DON-276]', () => {
  it('uses one guardian observation for every retained mission payload', async () => {
    const observations: Array<{ missionId: string | null; complete: ReturnType<typeof vi.fn> }> = []
    const persist = vi.fn(async (_missionId: string, payload: string) => payload)
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 8,
      beginObservation: (missionId) => {
        const observation = { missionId, complete: vi.fn() }
        observations.push(observation)
        return observation
      },
      persist,
      markEvidenceLoss: vi.fn(),
    })

    queue.enqueue('mission-1', 'fix-a')
    queue.enqueue('mission-1', 'fix-b')

    expect(queue.pendingCount('mission-1')).toBe(2)
    expect(observations[0]?.complete).not.toHaveBeenCalled()
    expect(observations[1]?.complete).toHaveBeenCalledOnce()

    await queue.flushMission('mission-1')

    expect(persist.mock.calls).toEqual([
      ['mission-1', 'fix-a'],
      ['mission-1', 'fix-b'],
    ])
    expect(observations[0]?.complete).toHaveBeenCalledOnce()
    expect(observations[1]?.complete).toHaveBeenCalledOnce()
    expect(queue.pendingCount('mission-1')).toBe(0)
  })

  it('coalesces only an exact represented payload while retaining its guardian', async () => {
    const firstComplete = vi.fn()
    const duplicateComplete = vi.fn()
    const persist = vi.fn().mockResolvedValue(undefined)
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: vi.fn(),
      persist,
      markEvidenceLoss: vi.fn(),
      payloadKey: (payload) => payload,
    })

    queue.enqueueOwned('mission-1', 'fix-a', {
      missionId: 'mission-1', complete: firstComplete,
    })
    queue.enqueueOwned('mission-1', 'fix-a', {
      missionId: 'mission-1', complete: duplicateComplete,
    })

    expect(queue.pendingCount()).toBe(1)
    expect(firstComplete).not.toHaveBeenCalled()
    expect(duplicateComplete).toHaveBeenCalledOnce()

    await queue.flushMission('mission-1')
    expect(persist).toHaveBeenCalledOnce()
    expect(firstComplete).toHaveBeenCalledOnce()
  })

  it('applies its capacity globally across missions', async () => {
    const marker = vi.fn().mockResolvedValue(undefined)
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: vi.fn(),
      persist: vi.fn().mockResolvedValue(undefined),
      markEvidenceLoss: marker,
      payloadKey: (payload) => payload,
    })

    queue.enqueueOwned('mission-a', 'fix-a', {
      missionId: 'mission-a', complete: vi.fn(),
    })
    queue.enqueueOwned('mission-b', 'fix-b', {
      missionId: 'mission-b', complete: vi.fn(),
    })
    queue.enqueueOwned('mission-c', 'fix-c', {
      missionId: 'mission-c', complete: vi.fn(),
    })

    expect(queue.pendingCount()).toBe(2)
    await vi.waitFor(() => expect(marker).toHaveBeenCalledWith(
      'mission-c',
      'renderer_pending_capacity_exhausted',
    ))
    await queue.settleForStop(() => true)
  })

  it('refuses Finish actionably while participant scope is unavailable without discharging tokens', async () => {
    const complete = vi.fn()
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 8,
      beginObservation: (missionId) => ({ missionId, complete }),
      persist: vi.fn(),
      markEvidenceLoss: vi.fn(),
    })
    queue.enqueue('mission-1', 'fix-a')

    await expect(queue.settleMissionForFinish('mission-1', false)).rejects.toThrow(
      /participant scope.*retry Finish/iu,
    )
    expect(complete).not.toHaveBeenCalled()
    expect(queue.pendingCount('mission-1')).toBe(1)
  })

  it('refuses ownership when the mission observation scope closed before transfer', () => {
    const complete = vi.fn()
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 8,
      beginObservation: () => ({ missionId: null, complete }),
      persist: vi.fn(),
      markEvidenceLoss: vi.fn(),
    })

    expect(queue.enqueue('mission-1', 'fix-a')).toBe(false)
    expect(queue.pendingCount()).toBe(0)
    expect(complete).not.toHaveBeenCalled()
  })

  it('bounds retained payloads and coalesces overflow under one durable loss owner', async () => {
    const completions: Array<ReturnType<typeof vi.fn>> = []
    const marker = vi.fn().mockResolvedValue(undefined)
    const firstPersistence = createDeferred<string>()
    let persistenceCount = 0
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: (missionId) => {
        const complete = vi.fn()
        completions.push(complete)
        return { missionId, complete }
      },
      persist: vi.fn(async (_missionId, payload) => {
        persistenceCount += 1
        return persistenceCount === 1 ? firstPersistence.promise : payload
      }),
      markEvidenceLoss: marker,
      payloadKey: (payload) => payload,
    })

    queue.enqueue('mission-1', 'fix-a')
    queue.requestFlushMission('mission-1')
    queue.enqueue('mission-1', 'fix-b')
    for (let index = 0; index < 1_000; index += 1) {
      queue.enqueue('mission-1', `overflow-${index}`)
    }
    await vi.waitFor(() => expect(marker).toHaveBeenCalledOnce())

    expect(queue.pendingCount('mission-1')).toBeLessThanOrEqual(2)
    expect(marker).toHaveBeenCalledWith(
      'mission-1',
      'renderer_pending_capacity_exhausted',
    )
    expect(completions[0]).not.toHaveBeenCalled()
    expect(completions.slice(1).every((complete) => complete.mock.calls.length === 1))
      .toBe(true)

    firstPersistence.resolve('fix-a')
    await queue.settleForStop(() => true)

    expect(marker).toHaveBeenCalledOnce()
    expect(completions.every((complete) => complete.mock.calls.length === 1)).toBe(true)
    expect(queue.pendingCount('mission-1')).toBe(0)
  })

  it('retains its guardian when a durable loss marker fails and retries explicitly', async () => {
    const guardian = vi.fn()
    const redundant = vi.fn()
    const marker = vi.fn()
      .mockRejectedValueOnce(new Error('marker unavailable'))
      .mockResolvedValue(undefined)
    const persistence = createDeferred<string>()
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 1,
      beginObservation: vi.fn(),
      persist: async () => persistence.promise,
      markEvidenceLoss: marker,
    })

    expect(queue.enqueueOwned(
      'mission-1',
      'fix-a',
      { missionId: 'mission-1', complete: guardian },
    )).toBe(true)
    queue.requestFlushMission('mission-1')
    expect(queue.enqueueOwned(
      'mission-1',
      'fix-b',
      { missionId: 'mission-1', complete: redundant },
    )).toBe(true)
    await vi.waitFor(() => expect(marker).toHaveBeenCalledOnce())
    expect(guardian).not.toHaveBeenCalled()

    persistence.resolve('fix-a')
    await expect(queue.flushMission('mission-1')).resolves.toBeUndefined()
    expect(marker).toHaveBeenCalledTimes(2)
    expect(guardian).toHaveBeenCalledOnce()
    expect(redundant).toHaveBeenCalledOnce()
  })

  it('resumes bounded FIFO retention when capacity becomes available after overflow', async () => {
    const firstPersistence = createDeferred<string>()
    const lossMarker = createDeferred<void>()
    const persist = vi.fn()
      .mockReturnValueOnce(firstPersistence.promise)
      .mockResolvedValue('persisted')
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 1,
      beginObservation: vi.fn(),
      persist,
      markEvidenceLoss: vi.fn(() => lossMarker.promise),
      payloadKey: (payload) => payload,
    })

    queue.enqueueOwned('mission-1', 'fix-a', {
      missionId: 'mission-1', complete: vi.fn(),
    })
    queue.requestFlushMission('mission-1')
    queue.enqueueOwned('mission-1', 'overflow-b', {
      missionId: 'mission-1', complete: vi.fn(),
    })
    firstPersistence.resolve('fix-a')
    await vi.waitFor(() => expect(queue.pendingCount('mission-1')).toBe(0))

    queue.enqueueOwned('mission-1', 'fix-c', {
      missionId: 'mission-1', complete: vi.fn(),
    })
    expect(queue.pendingCount('mission-1')).toBe(1)

    lossMarker.resolve()
    await queue.flushMission('mission-1')
    expect(persist.mock.calls.map(([, payload]) => payload)).toEqual([
      'fix-a',
      'fix-c',
    ])
  })

  it('waits every stop obligation, including a state admitted during the stop barrier', async () => {
    const missionAPersistence = createDeferred<string>()
    const missionBLossMarker = createDeferred<void>()
    const missionAGuardian = vi.fn()
    const missionBGuardian = vi.fn()
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: vi.fn(),
      persist: vi.fn((missionId) =>
        missionId === 'mission-a' ? missionAPersistence.promise : Promise.resolve('ok')),
      markEvidenceLoss: vi.fn((missionId) =>
        missionId === 'mission-b' ? missionBLossMarker.promise : Promise.resolve()),
    })

    queue.enqueueOwned('mission-a', 'fix-a', {
      missionId: 'mission-a', complete: missionAGuardian,
    })
    let stopSettled = false
    const stop = queue.settleForStop(() => true).then(() => {
      stopSettled = true
    })
    queue.enqueueOwned('mission-b', 'late-fix-b', {
      missionId: 'mission-b', complete: missionBGuardian,
    })

    missionAPersistence.resolve('fix-a')
    await vi.waitFor(() => expect(missionAGuardian).toHaveBeenCalledOnce())
    expect(stopSettled).toBe(false)
    expect(missionBGuardian).not.toHaveBeenCalled()

    missionBLossMarker.resolve()
    await stop
    expect(missionBGuardian).toHaveBeenCalledOnce()
  })

  it('waits other missions before reporting one failed stop marker', async () => {
    const missionBMarker = createDeferred<void>()
    const missionBGuardian = vi.fn()
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: vi.fn(),
      persist: vi.fn(),
      markEvidenceLoss: vi.fn((missionId) =>
        missionId === 'mission-a'
          ? Promise.reject(new Error('mission-a marker failed'))
          : missionBMarker.promise),
    })
    queue.enqueueOwned('mission-a', 'fix-a', {
      missionId: 'mission-a', complete: vi.fn(),
    })
    queue.enqueueOwned('mission-b', 'fix-b', {
      missionId: 'mission-b', complete: missionBGuardian,
    })

    let stopRejected = false
    const stop = queue.settleForStop(() => false).catch((error: unknown) => {
      stopRejected = true
      throw error
    })
    await vi.waitFor(() => expect(queue.pendingCount()).toBe(0))
    expect(stopRejected).toBe(false)
    expect(missionBGuardian).not.toHaveBeenCalled()

    missionBMarker.resolve()
    await expect(stop).rejects.toThrow('mission-a marker failed')
    expect(missionBGuardian).toHaveBeenCalledOnce()
  })
})
