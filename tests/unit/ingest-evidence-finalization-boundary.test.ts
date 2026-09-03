import { describe, expect, it, vi } from 'vitest'

import { createIngestEvidenceFinalizationBoundary } from '../../src/features/tracking/ingest-evidence-finalization-boundary'
import { createRejectionEvidenceDelivery } from '../../src/features/tracking/rejection-evidence-delivery'

const CUSTODY = Object.freeze({
  operationId: '11111111-1111-4111-8111-111111111111',
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})

describe('ingest evidence finalization boundary [DON-268]', () => {
  it('drains and seals renderer evidence before committing mission finish', async () => {
    const finishMission = vi.fn().mockResolvedValue({ id: 'mission-1', status: 'finished' })
    const runWithMissionFinishFence = vi.fn(async (
      missionId: string,
      operation: () => Promise<unknown>,
    ) => {
      expect(missionId).toBe('mission-1')
      return operation()
    })
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finishMission,
        finalizeMission: vi.fn(),
        unlockFinalizedMission: vi.fn(),
      },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence,
        runWithMissionFinalizationFence: vi.fn(),
        reopenMissionEvidenceAfterUnlock: vi.fn(),
      },
    )

    await expect(bounded.finishMission('mission-1')).resolves.toMatchObject({
      status: 'finished',
    })
    expect(runWithMissionFinishFence).toHaveBeenCalledWith('mission-1', expect.any(Function))
    expect(finishMission).toHaveBeenCalledWith('mission-1')
  })

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
      runWithMissionFinishFence: vi.fn(),
      runWithMissionFinalizationFence: async (_missionId, operation) => {
        await flushMission('mission-1')
        return operation()
      },
      reopenMissionEvidenceAfterUnlock: vi.fn(),
    })

    const finalization = bounded.finalizeMission('mission-1', CUSTODY)
    await vi.waitFor(() => expect(flushMission).toHaveBeenCalledWith('mission-1'))
    expect(finalizeMission).not.toHaveBeenCalled()

    releaseFlush?.()
    await expect(finalization).resolves.toEqual({ mission: { status: 'finalized' } })
    expect(finalizeMission).toHaveBeenCalledWith('mission-1', CUSTODY)
    expect(bounded.marker).toBe('preserved')
  })

  it('does not start finalization when renderer evidence cannot flush', async () => {
    const finalizeMission = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      { finalizeMission },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence: vi.fn().mockRejectedValue(
          new Error('evidence unavailable'),
        ),
        reopenMissionEvidenceAfterUnlock: vi.fn(),
      },
    )

    await expect(bounded.finalizeMission('mission-1', CUSTODY)).rejects.toThrow('evidence unavailable')
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
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence,
        reopenMissionEvidenceAfterUnlock: vi.fn(),
      },
    )

    const finalization = bounded.finalizeMission('mission-1', CUSTODY)
    await vi.waitFor(() => expect(finalizeMission).toHaveBeenCalledWith('mission-1', CUSTODY))
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

    await expect(bounded.finalizeMission('mission-1', CUSTODY)).resolves.toMatchObject({
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

    await expect(bounded.finalizeMission('mission-1', CUSTODY)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    expect(missionStore.finalizeMission).toHaveBeenCalledTimes(2)
  })

  it('reopens renderer evidence after a successful archive correction restore', async () => {
    const restoreMissionForCorrection = vi.fn().mockResolvedValue({
      mission: { id: 'mission-1', status: 'finished' },
      correction: { committed: true, cleanupComplete: true },
    })
    const reopenMissionEvidenceAfterUnlock = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finalizeMission: vi.fn(),
        unlockFinalizedMission: vi.fn(),
        restoreMissionForCorrection,
      },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence: vi.fn(),
        reopenMissionEvidenceAfterUnlock,
      },
    )

    await expect(bounded.restoreMissionForCorrection?.({
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: 'operation-1',
      sessionId: 'session-1',
      admin_name: 'Duty Admin',
      reason: 'Correction restore',
    })).resolves.toMatchObject({ correction: { committed: true } })
    expect(reopenMissionEvidenceAfterUnlock).toHaveBeenCalledWith('mission-1')
  })

  it('does not reopen renderer evidence when correction cleanup remains unresolved', async () => {
    const restoreMissionForCorrection = vi.fn().mockResolvedValue({
      mission: { id: 'mission-1', status: 'finished' },
      correction: { committed: true, cleanupComplete: false },
    })
    const reopenMissionEvidenceAfterUnlock = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finalizeMission: vi.fn(),
        unlockFinalizedMission: vi.fn(),
        restoreMissionForCorrection,
      },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence: vi.fn(),
        reopenMissionEvidenceAfterUnlock,
      },
    )

    await expect(bounded.restoreMissionForCorrection?.({
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: 'operation-1',
      sessionId: 'session-1',
      admin_name: 'Duty Admin',
      reason: 'Correction restore',
    })).resolves.toMatchObject({ correction: { cleanupComplete: false } })
    expect(reopenMissionEvidenceAfterUnlock).not.toHaveBeenCalled()
  })

  it('reopens renderer evidence for a legacy successful correction result without an envelope', async () => {
    const restoreMissionForCorrection = vi.fn().mockResolvedValue({
      mission: { id: 'mission-1', status: 'finished' },
    })
    const reopenMissionEvidenceAfterUnlock = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finalizeMission: vi.fn(),
        unlockFinalizedMission: vi.fn(),
        restoreMissionForCorrection,
      },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence: vi.fn(),
        reopenMissionEvidenceAfterUnlock,
      },
    )

    await bounded.restoreMissionForCorrection?.({
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: 'operation-1',
      sessionId: 'session-1',
      admin_name: 'Duty Admin',
      reason: 'Legacy successful correction result',
    })
    expect(reopenMissionEvidenceAfterUnlock).toHaveBeenCalledWith('mission-1')
  })

  it('does not reopen renderer evidence when attachment custody remains fenced', async () => {
    const restoreMissionForCorrection = vi.fn().mockResolvedValue({
      mission: { id: 'mission-1', status: 'finished' },
      correction: {
        committed: true,
        cleanupComplete: true,
        failureCode: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      },
    })
    const reopenMissionEvidenceAfterUnlock = vi.fn()
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finalizeMission: vi.fn(),
        unlockFinalizedMission: vi.fn(),
        restoreMissionForCorrection,
      },
      {
        flushMission: vi.fn(),
        runWithMissionFinishFence: vi.fn(),
        runWithMissionFinalizationFence: vi.fn(),
        reopenMissionEvidenceAfterUnlock,
      },
    )

    await expect(bounded.restoreMissionForCorrection?.({
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: 'operation-1',
      sessionId: 'session-1',
      admin_name: 'Duty Admin',
      reason: 'Retain the attachment custody fence.',
    })).resolves.toMatchObject({ correction: { cleanupComplete: true } })
    expect(reopenMissionEvidenceAfterUnlock).not.toHaveBeenCalled()
  })

  it('does not let a stale finalization continuation reseal evidence after unlock', async () => {
    let status: 'finished' | 'finalized' = 'finished'
    let confirmFinalizationCommitted: (() => void) | undefined
    let releaseFinalizationReturn: (() => void) | undefined
    const finalizationCommitted = new Promise<void>((resolve) => {
      confirmFinalizationCommitted = resolve
    })
    const missionStore = {
      finalizeMission: vi.fn(async (missionId: string) => {
        if (status !== 'finished') throw new Error('Mission must be finished.')
        status = 'finalized'
        confirmFinalizationCommitted?.()
        await new Promise<void>((resolve) => {
          releaseFinalizationReturn = resolve
        })
        return { mission: { id: missionId, status: 'finalized' as const } }
      }),
      unlockFinalizedMission: vi.fn(async (input: {
        readonly mission_id: string
        readonly admin_name: string
        readonly reason: string
      }) => {
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

    const staleFinalization = bounded.finalizeMission('mission-1', CUSTODY)
    await finalizationCommitted
    await expect(bounded.unlockFinalizedMission({
      mission_id: 'mission-1',
      admin_name: 'Duty Admin',
      reason: 'Correction requested during delayed finalization response.',
    })).resolves.toMatchObject({ status: 'finished' })

    releaseFinalizationReturn?.()
    await expect(staleFinalization).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    expect(() => evidence.record([], {
      missionId: 'mission-1',
      observedAt: '2026-08-23T09:32:00.000Z',
    })).not.toThrow()
  })
})
