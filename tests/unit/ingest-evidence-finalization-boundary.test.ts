import { describe, expect, it, vi } from 'vitest'

import { createIngestEvidenceFinalizationBoundary } from '../../src/features/tracking/ingest-evidence-finalization-boundary'

describe('ingest evidence finalization boundary [DON-268]', () => {
  it('flushes renderer-held mission evidence before finalization starts', async () => {
    let releaseFlush: (() => void) | undefined
    const flushMission = vi.fn(() => new Promise<void>((resolve) => {
      releaseFlush = resolve
    }))
    const finalizeMission = vi.fn().mockResolvedValue({ mission: { status: 'finalized' } })
    const missionStore = {
      marker: 'preserved',
      finalizeMission,
    }
    const bounded = createIngestEvidenceFinalizationBoundary(missionStore, { flushMission })

    const finalization = bounded.finalizeMission('mission-1')
    await vi.waitFor(() => expect(flushMission).toHaveBeenCalledWith('mission-1'))
    expect(finalizeMission).not.toHaveBeenCalled()

    releaseFlush?.()
    await expect(finalization).resolves.toEqual({ mission: { status: 'finalized' } })
    expect(finalizeMission).toHaveBeenCalledWith('mission-1')
    expect(bounded.marker).toBe('preserved')
  })

  it('does not start finalization when renderer evidence cannot flush', async () => {
    const finalizeMission = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      { finalizeMission },
      { flushMission: vi.fn().mockRejectedValue(new Error('evidence unavailable')) },
    )

    await expect(bounded.finalizeMission('mission-1')).rejects.toThrow('evidence unavailable')
    expect(finalizeMission).not.toHaveBeenCalled()
  })
})
