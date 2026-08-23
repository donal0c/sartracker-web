import { describe, expect, it, vi } from 'vitest'

import { createIngestEvidenceFinalizationBoundary } from '../../src/features/tracking/ingest-evidence-finalization-boundary'
import { createRejectionEvidenceDelivery } from '../../src/features/tracking/rejection-evidence-delivery'

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
    const bounded = createIngestEvidenceFinalizationBoundary(missionStore, {
      flushMission,
      runWithMissionFinalizationFence: async (_missionId, operation) => {
        await flushMission('mission-1')
        return operation()
      },
    })

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
      {
        flushMission: vi.fn(),
        runWithMissionFinalizationFence: vi.fn().mockRejectedValue(
          new Error('evidence unavailable'),
        ),
      },
    )

    await expect(bounded.finalizeMission('mission-1')).rejects.toThrow('evidence unavailable')
    expect(finalizeMission).not.toHaveBeenCalled()
  })

  it('holds the renderer mission-acceptance fence across the finalization call', async () => {
    let releaseFinalization: (() => void) | undefined
    const finalizeMission = vi.fn(() => new Promise((resolve) => {
      releaseFinalization = () => resolve({ mission: { status: 'finalized' } })
    }))
    const runWithMissionFinalizationFence = vi.fn(async (
      missionId: string,
      operation: () => Promise<unknown>,
    ) => {
      expect(missionId).toBe('mission-1')
      return operation()
    })
    const bounded = createIngestEvidenceFinalizationBoundary(
      { finalizeMission },
      {
        flushMission: vi.fn(),
        runWithMissionFinalizationFence,
      },
    )

    const finalization = bounded.finalizeMission('mission-1')
    await vi.waitFor(() => expect(finalizeMission).toHaveBeenCalledWith('mission-1'))
    expect(runWithMissionFinalizationFence).toHaveBeenCalledTimes(1)

    releaseFinalization?.()
    await expect(finalization).resolves.toEqual({ mission: { status: 'finalized' } })
  })

  it('reopens renderer evidence only after a successful same-process admin unlock', async () => {
    let status: 'finished' | 'finalized' = 'finished'
    const missionStore = {
      finalizeMission: vi.fn(async (missionId: string) => {
        if (status !== 'finished') throw new Error('Mission must be finished.')
        status = 'finalized'
        return { mission: { id: missionId, status } }
      }),
      unlockFinalizedMission: vi.fn(async (input: {
        readonly mission_id: string
        readonly admin_name: string
        readonly reason: string
      }) => {
        if (input.admin_name !== 'Duty Admin') throw new Error('Admin is not authorized.')
        if (status !== 'finalized') throw new Error('Mission must be finalized.')
        status = 'finished'
        return { id: input.mission_id, status }
      }),
    }
    const evidence = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: vi.fn(async (input) => ({
          acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
          health: {
            state: 'healthy' as const,
            reason: null,
            pendingCount: 0,
            corruptCount: 0,
            conflictCount: 0,
            rejectedCount: 0,
            affectedDeviceCount: 0,
            conflictDeviceIds: [],
          },
        })),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
    })
    const bounded = createIngestEvidenceFinalizationBoundary(missionStore, evidence)

    await expect(bounded.finalizeMission('mission-1')).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    expect(() => evidence.record([], {
      missionId: 'mission-1',
      observedAt: '2026-08-23T09:30:00.000Z',
    })).toThrow(/acceptance.*sealed/iu)

    await expect(bounded.unlockFinalizedMission({
      mission_id: 'mission-1',
      admin_name: 'Unlisted Admin',
      reason: 'Unauthorized attempt.',
    })).rejects.toThrow('Admin is not authorized')
    expect(() => evidence.record([], {
      missionId: 'mission-1',
      observedAt: '2026-08-23T09:30:30.000Z',
    })).toThrow(/acceptance.*sealed/iu)

    await expect(bounded.unlockFinalizedMission({
      mission_id: 'mission-1',
      admin_name: 'Duty Admin',
      reason: 'Correction requested during review.',
    })).resolves.toMatchObject({ status: 'finished' })
    expect(() => evidence.record([], {
      missionId: 'mission-1',
      observedAt: '2026-08-23T09:31:00.000Z',
    })).not.toThrow()

    await expect(bounded.finalizeMission('mission-1')).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    expect(missionStore.finalizeMission).toHaveBeenCalledTimes(2)
  })
})
