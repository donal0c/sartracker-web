import { describe, expect, it, vi } from 'vitest'

import {
  createDeferredMissionEvidenceQueue,
} from '../../src/features/tracking/deferred-mission-evidence'

describe('deferred mission evidence queue [DON-276]', () => {
  it('retains every accepted entry under an open mission observation until persistence settles', async () => {
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
    expect(observations.every((observation) => observation.complete.mock.calls.length === 0))
      .toBe(true)

    await queue.flushMission('mission-1')

    expect(persist.mock.calls).toEqual([
      ['mission-1', 'fix-a'],
      ['mission-1', 'fix-b'],
    ])
    expect(observations.every((observation) => observation.complete.mock.calls.length === 1))
      .toBe(true)
    expect(queue.pendingCount('mission-1')).toBe(0)
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

  it('converts bounded overflow and unavailable-stop entries to durable mission loss before release', async () => {
    const completions: Array<ReturnType<typeof vi.fn>> = []
    const marker = vi.fn().mockResolvedValue(undefined)
    const queue = createDeferredMissionEvidenceQueue<string>({
      capacity: 2,
      beginObservation: (missionId) => {
        const complete = vi.fn()
        completions.push(complete)
        return { missionId, complete }
      },
      persist: vi.fn(),
      markEvidenceLoss: marker,
    })

    queue.enqueue('mission-1', 'fix-a')
    queue.enqueue('mission-1', 'fix-b')
    queue.enqueue('mission-1', 'fix-c')
    await queue.settleForStop(() => false)

    expect(marker).toHaveBeenCalledTimes(3)
    expect(marker).toHaveBeenCalledWith('mission-1', 'mission_persistence_failed')
    expect(completions.every((complete) => complete.mock.calls.length === 1)).toBe(true)
    expect(queue.pendingCount('mission-1')).toBe(0)
  })
})
