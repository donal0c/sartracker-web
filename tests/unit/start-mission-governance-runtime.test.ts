import { describe, expect, it, vi } from 'vitest'

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

describe('startMissionGovernanceRuntime', () => {
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
    })
  })

  it('refreshes governance mission after finalizing', async () => {
    const applyRuntime = vi.fn()
    const archive: MissionArchiveInfo = {
      mission_id: FINISHED_MISSION.id,
      archive_path: '/tmp/mission-finished.zip',
      created_at: '2026-04-10T13:00:00.000Z',
    }
    const finalizeResult: FinalizeMissionResult = {
      mission: FINALIZED_MISSION,
      archive,
    }

    const listMissions = vi
      .fn()
      .mockResolvedValueOnce([FINISHED_MISSION])
      .mockResolvedValueOnce([FINALIZED_MISSION])
    const finalizeMission = vi.fn().mockResolvedValue(finalizeResult)

    const runtime = await startMissionGovernanceRuntime({
      missionStore: createMissionGovernanceStoreStub({
        listMissions,
        finalizeMission,
      }),
      applyRuntime,
    })

    await expect(runtime.finalizeGovernanceMission(FINISHED_MISSION.id)).resolves.toEqual(finalizeResult)
    expect(finalizeMission).toHaveBeenCalledWith(FINISHED_MISSION.id)
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINALIZED_MISSION,
    })
  })

  it('refreshes governance mission after unlocking', async () => {
    const applyRuntime = vi.fn()
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
    expect(applyRuntime).toHaveBeenLastCalledWith({
      governanceMission: FINISHED_MISSION,
    })
  })
})

function createMissionGovernanceStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    listMissions: vi.fn().mockResolvedValue([]),
    finalizeMission: vi.fn(),
    unlockFinalizedMission: vi.fn(),
    ...overrides,
  }
}
