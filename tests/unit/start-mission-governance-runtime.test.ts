import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  FinalizeMissionResult,
  Mission,
  MissionArchiveInfo,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionGovernanceRuntime } from '../../src/features/mission/start-mission-governance-runtime'

const FINISHED_MISSION: Mission = {
  id: 'mission-finished',
  name: 'Finished Mission',
  status: 'finished',
  start_time: '2026-04-09T10:00:00.000Z',
  pause_time: null,
  finish_time: '2026-04-09T12:00:00.000Z',
  paused_seconds: 0,
  notes: null,
  schema_version: 1,
}

const FINALIZED_MISSION: Mission = {
  ...FINISHED_MISSION,
  id: 'mission-finalized',
  name: 'Finalized Mission',
  status: 'finalized',
}

const ARCHIVED_FINISHED_MISSION: Mission = {
  ...FINISHED_MISSION,
  status: 'finalized',
}

const CUSTODY = Object.freeze({
  operationId: '11111111-1111-4111-8111-111111111111',
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})

describe('startMissionGovernanceRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes a recovery-required governance mission after startup custody recovery settles', async () => {
    vi.useFakeTimers()
    const recoveryMission = { ...FINISHED_MISSION, storage_state: 'recovery_required' as const }
    const listMissions = vi.fn()
      .mockResolvedValueOnce([recoveryMission])
      .mockResolvedValueOnce([FINISHED_MISSION])
    const applyRuntime = vi.fn()

    await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({ listMissions }),
      applyRuntime,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: recoveryMission,
      governanceEvidenceHealth: expect.objectContaining({ state: 'healthy' }),
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(listMissions).toHaveBeenCalledTimes(2)
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINISHED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({ state: 'healthy' }),
    })
  })

  it('hydrates the exact finished mission evidence health for restart governance [DON-276]', async () => {
    const applyRuntime = vi.fn()
    const getIngestEvidenceHealth = vi.fn().mockResolvedValue({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      affectedDeviceCount: 0,
      conflictDeviceIds: [],
    })

    await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions: vi.fn().mockResolvedValue([FINISHED_MISSION]),
        getIngestEvidenceHealth,
      }),
      applyRuntime,
    })

    expect(getIngestEvidenceHealth).toHaveBeenCalledWith(FINISHED_MISSION.id)
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINISHED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
      }),
    })
  })

  it('surfaces the newest finished or finalized mission as the governance target', async () => {
    const applyRuntime = vi.fn()

    await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions: vi.fn().mockResolvedValue([FINALIZED_MISSION, FINISHED_MISSION]),
      }),
      applyRuntime,
    })

    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINALIZED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({ state: 'healthy' }),
    })
  })

  it('refreshes governance mission after finalizing', async () => {
    const applyRuntime = vi.fn()
    const requestAutosaveSync = vi.fn().mockResolvedValue(undefined)
    const archive: MissionArchiveInfo = {
      mission_id: FINISHED_MISSION.id,
      archive_path: '/tmp/mission-finished.zip',
      created_at: '2026-04-10T13:00:00.000Z',
    }
    const finalizeResult: FinalizeMissionResult = {
      mission: { id: FINISHED_MISSION.id, status: 'finalized' },
      archive,
    }

    const listMissions = vi
      .fn()
      .mockResolvedValueOnce([FINISHED_MISSION])
      .mockResolvedValueOnce([ARCHIVED_FINISHED_MISSION])
    const finalizeMission = vi.fn().mockResolvedValue(finalizeResult)

    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions,
        finalizeMission,
      }),
      applyRuntime,
      requestAutosaveSync,
    })

    await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id, CUSTODY))
      .resolves.toEqual(finalizeResult)
    expect(finalizeMission).toHaveBeenCalledWith(FINISHED_MISSION.id, CUSTODY)
    expect(requestAutosaveSync).toHaveBeenCalledWith('mission-finalize')
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: ARCHIVED_FINISHED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({ state: 'healthy' }),
    })
  })

  it('returns durable finalization and publishes terminal truth when reconciliation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const applyRuntime = vi.fn()
    const finalizeResult: FinalizeMissionResult = {
      mission: { id: FINISHED_MISSION.id, status: 'finalized' },
      archive: {
        mission_id: FINISHED_MISSION.id,
        archive_path: '/tmp/mission-finished.sararch',
        created_at: '2026-08-30T09:00:00.000Z',
      } as MissionArchiveInfo,
    }
    try {
      const runtime = await startMissionGovernanceRuntime({
        missionStore: createMissionGovernanceStoreStub({
          listMissions: vi.fn()
            .mockResolvedValueOnce([FINISHED_MISSION])
            .mockRejectedValueOnce(new Error('post-success refresh unavailable')),
          finalizeMission: vi.fn().mockResolvedValue(finalizeResult),
        }),
        applyRuntime,
      })

      await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id, CUSTODY))
        .resolves.toEqual(finalizeResult)
      expect(applyRuntime).toHaveBeenLastCalledWith({
        governanceMission: ARCHIVED_FINISHED_MISSION,
        governanceEvidenceHealth: expect.any(Object),
      })
      expect(warn).toHaveBeenCalledWith(
        'Mission governance refresh failed after archive operation.',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('preserves the authoritative finalization rejection when failure reconciliation also fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const terminalFailure = Object.assign(new Error('closed verification failure'), {
      code: 'ARCHIVE_VERIFY_FAILED',
    })
    try {
      const runtime = await startMissionGovernanceRuntime({
        missionStore: createMissionGovernanceStoreStub({
          listMissions: vi.fn()
            .mockResolvedValueOnce([FINISHED_MISSION])
            .mockRejectedValueOnce(new Error('post-failure refresh unavailable')),
          finalizeMission: vi.fn().mockRejectedValue(terminalFailure),
        }),
        applyRuntime: vi.fn(),
      })

      await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id, CUSTODY))
        .rejects.toBe(terminalFailure)
      expect(warn).toHaveBeenCalledWith(
        'Mission governance refresh failed after archive operation.',
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('delegates one-time archive recovery issuance and sender-owned cancellation', async () => {
    const issueMissionArchiveRecoveryCode = vi.fn().mockResolvedValue({
      operationId: CUSTODY.operationId,
      recoveryCode: CUSTODY.recoveryCode,
      expiresAt: '2026-08-29T20:10:00.000Z',
    })
    const cancelMissionArchiveOperation = vi.fn().mockResolvedValue(true)
    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        issueMissionArchiveRecoveryCode,
        cancelMissionArchiveOperation,
      }),
      applyRuntime: vi.fn(),
    })

    await expect(runtime.issueGovernanceArchiveRecoveryCode(FINISHED_MISSION.id))
      .resolves.toMatchObject({ operationId: CUSTODY.operationId })
    await expect(runtime.cancelGovernanceArchiveOperation(CUSTODY.operationId)).resolves.toBe(true)
    expect(issueMissionArchiveRecoveryCode).toHaveBeenCalledWith(FINISHED_MISSION.id)
    expect(cancelMissionArchiveOperation).toHaveBeenCalledWith(CUSTODY.operationId)
  })

  it('loads the latest cleanup checklist and refreshes the archived mission after completion', async () => {
    const archive = {
      id: 'archive-current',
      mission_id: FINALIZED_MISSION.id,
      revision_sequence: 2,
      status: 'verified',
      container_version: 2,
    } as MissionArchiveInfo
    const eligibility = {
      eligible: false,
      blockers: ['fresh_non_machine_unlock_required'] as const,
      storageState: 'live' as const,
    }
    const archivedMission = { ...FINALIZED_MISSION, storage_state: 'archived' as const }
    const listMissionArchives = vi.fn().mockResolvedValue([
      { ...archive, id: 'archive-prior', revision_sequence: 1, status: 'superseded' },
      archive,
    ])
    const getMissionCleanupEligibility = vi.fn().mockResolvedValue(eligibility)
    const startMissionCleanup = vi.fn().mockResolvedValue({
      missionId: FINALIZED_MISSION.id,
      archiveId: archive.id,
      state: 'completed',
      storageState: 'archived',
      movedRows: 23,
    })
    const requestAutosaveSync = vi.fn().mockResolvedValue(undefined)
    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions: vi.fn()
          .mockResolvedValueOnce([FINALIZED_MISSION])
          .mockResolvedValueOnce([archivedMission]),
        listMissionArchives,
        getMissionCleanupEligibility,
        startMissionCleanup,
      }),
      applyRuntime: vi.fn(),
      requestAutosaveSync,
    })

    await expect(runtime.readGovernanceCleanupState(FINALIZED_MISSION.id)).resolves.toEqual({
      archive,
      eligibility,
    })
    expect(getMissionCleanupEligibility).toHaveBeenCalledWith({
      missionId: FINALIZED_MISSION.id,
      archiveId: archive.id,
    })
    const input = {
      missionId: FINALIZED_MISSION.id,
      archiveId: archive.id,
      operationId: '22222222-2222-4222-8222-222222222222',
      slotType: 'passphrase' as const,
      secret: 'Four calm words 2026!',
      confirmation: FINALIZED_MISSION.name,
    }
    await expect(runtime.startGovernanceCleanup(input)).resolves.toMatchObject({
      state: 'completed',
      storageState: 'archived',
      movedRows: 23,
    })
    expect(startMissionCleanup).toHaveBeenCalledWith(input)
    expect(requestAutosaveSync).toHaveBeenCalledWith('mission-cleanup')
  })

  it('refreshes mission-scoped health when finalization is blocked by a later loss [DON-276]', async () => {
    const applyRuntime = vi.fn()
    const getIngestEvidenceHealth = vi.fn()
      .mockResolvedValueOnce({
        state: 'healthy',
        reason: null,
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      })
      .mockResolvedValueOnce({
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      })
    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions: vi.fn().mockResolvedValue([FINISHED_MISSION]),
        getIngestEvidenceHealth,
        finalizeMission: vi.fn().mockRejectedValue(
          new Error('Degraded evidence health blocks finalization.'),
        ),
      }),
      applyRuntime,
    })

    await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id, CUSTODY)).rejects.toThrow(
      /evidence health blocks finalization/i,
    )
    expect(getIngestEvidenceHealth).toHaveBeenCalledTimes(2)
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINISHED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
      }),
    })
  })

  it('refreshes governance mission after unlocking', async () => {
    const applyRuntime = vi.fn()
    const requestAutosaveSync = vi.fn().mockResolvedValue(undefined)
    const listMissions = vi
      .fn()
      .mockResolvedValueOnce([FINALIZED_MISSION])
      .mockResolvedValueOnce([FINISHED_MISSION])
    const unlockFinalizedMission = vi.fn().mockResolvedValue(FINISHED_MISSION)

    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions,
        unlockFinalizedMission,
      }),
      applyRuntime,
      requestAutosaveSync,
    })

    await expect(
      runtime.unlockGovernanceMission({
        mission_id: FINALIZED_MISSION.id,
        admin_name: 'Ops Lead',
        reason: 'Need to edit mission data',
      }),
    ).resolves.toEqual(FINISHED_MISSION)

    expect(unlockFinalizedMission).toHaveBeenCalledWith({
      mission_id: FINALIZED_MISSION.id,
      admin_name: 'Ops Lead',
      reason: 'Need to edit mission data',
    })
    expect(requestAutosaveSync).toHaveBeenCalledWith('mission-unlock')
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINISHED_MISSION,
      governanceEvidenceHealth: expect.objectContaining({ state: 'healthy' }),
    })
  })

  it('records an evidence-loss acknowledgement and requests a durable backup [DON-276]', async () => {
    const requestAutosaveSync = vi.fn().mockResolvedValue(undefined)
    const acknowledgeIngestEvidenceLoss = vi.fn().mockResolvedValue({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      affectedDeviceCount: 0,
      conflictDeviceIds: [],
      acknowledgedLoss: {
        adminName: 'Ops Lead',
        reason: 'Known runtime loss reviewed.',
        acknowledgedAt: '2026-08-26T17:00:00.000Z',
      },
    })
    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({ acknowledgeIngestEvidenceLoss }),
      applyRuntime: vi.fn(),
      requestAutosaveSync,
    })

    await expect(runtime.acknowledgeGovernanceEvidenceLoss({
      mission_id: FINISHED_MISSION.id,
      admin_name: 'Ops Lead',
      reason: 'Known runtime loss reviewed.',
    })).resolves.toMatchObject({
      state: 'critical',
      acknowledgedLoss: { adminName: 'Ops Lead' },
    })
    expect(acknowledgeIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: FINISHED_MISSION.id,
      admin_name: 'Ops Lead',
      reason: 'Known runtime loss reviewed.',
    })
    expect(requestAutosaveSync).toHaveBeenCalledWith('mission-evidence-loss-acknowledgement')
  })

  it('does not fail a completed governance transition when autosave request reports failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const archive: MissionArchiveInfo = {
      mission_id: FINISHED_MISSION.id,
      archive_path: '/tmp/mission-finished.zip',
      created_at: '2026-04-10T13:00:00.000Z',
    }
    const finalizeResult: FinalizeMissionResult = {
      mission: { id: FINISHED_MISSION.id, status: 'finalized' },
      archive,
    }

    try {
      const runtime = await startMissionGovernanceRuntime({
        missionStore: createMissionGovernanceStoreStub({
          listMissions: vi
            .fn()
            .mockResolvedValueOnce([FINISHED_MISSION])
            .mockResolvedValueOnce([ARCHIVED_FINISHED_MISSION]),
          finalizeMission: vi.fn().mockResolvedValue(finalizeResult),
        }),
        applyRuntime: vi.fn(),
        requestAutosaveSync: vi.fn().mockRejectedValue(new Error('backup unavailable')),
      })

      await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id, CUSTODY)).resolves.toEqual(
        finalizeResult,
      )
    } finally {
      warn.mockRestore()
    }
  })
})

function createMissionGovernanceStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    listMissions: vi.fn().mockResolvedValue([]),
    getIngestEvidenceHealth: vi.fn().mockResolvedValue({
      state: 'healthy',
      reason: null,
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      affectedDeviceCount: 0,
      conflictDeviceIds: [],
    }),
    finalizeMission: vi.fn(),
    issueMissionArchiveRecoveryCode: vi.fn(),
    cancelMissionArchiveOperation: vi.fn(),
    listMissionArchives: vi.fn(),
    getMissionCleanupEligibility: vi.fn(),
    startMissionCleanup: vi.fn(),
    acknowledgeIngestEvidenceLoss: vi.fn(),
    unlockFinalizedMission: vi.fn(),
    ...overrides,
  }
}
