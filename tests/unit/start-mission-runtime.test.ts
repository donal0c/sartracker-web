import { describe, expect, it, vi } from 'vitest'

import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionRuntime } from '../../src/features/mission/start-mission-runtime'

const ACTIVE_MISSION: Mission = {
  id: 'mission-active',
  name: 'Active Mission',
  status: 'active',
  start_time: '2026-04-09T10:00:00.000Z',
  pause_time: null,
  finish_time: null,
  paused_seconds: 0,
  notes: null,
  schema_version: 1,
}

const PAUSED_MISSION: Mission = {
  ...ACTIVE_MISSION,
  id: 'mission-paused',
  name: 'Paused Mission',
  status: 'paused',
  pause_time: '2026-04-09T10:30:00.000Z',
}

describe('startMissionRuntime', () => {
  it('treats an active persisted mission as recoverable by pausing it on startup', async () => {
    const pauseMission = vi.fn().mockResolvedValue({
      ...ACTIVE_MISSION,
      status: 'paused',
      pause_time: '2026-04-09T11:00:00.000Z',
    })
    const applyRuntime = vi.fn()

    await startMissionRuntime({
      missionStore: createMissionStoreStub({
        getRecoverableMission: vi.fn().mockResolvedValue(ACTIVE_MISSION),
        pauseMission,
      }),
      applyRuntime,
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    expect(pauseMission).toHaveBeenCalledWith('mission-active')
    expect(applyRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'recovery',
        recoverableMission: expect.objectContaining({ status: 'paused' }),
      }),
    )
  })

  it('resumes a recoverable mission into active runtime state', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        getRecoverableMission: vi.fn().mockResolvedValue(PAUSED_MISSION),
        resumeMission: vi.fn().mockResolvedValue({
          ...PAUSED_MISSION,
          status: 'active',
          pause_time: null,
          paused_seconds: 600,
        }),
      }),
      applyRuntime,
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await runtime.resumeRecoverableMission()

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'active',
        currentMission: expect.objectContaining({ status: 'active' }),
        recoverableMission: null,
      }),
    )
  })

  it('starts fresh by finishing the recoverable mission and returning to idle', async () => {
    const finishMission = vi.fn().mockResolvedValue({
      ...PAUSED_MISSION,
      status: 'finished',
      finish_time: '2026-04-09T11:00:00.000Z',
    })
    const applyRuntime = vi.fn()

    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        getRecoverableMission: vi.fn().mockResolvedValue(PAUSED_MISSION),
        finishMission,
      }),
      applyRuntime,
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await runtime.startFresh()

    expect(finishMission).toHaveBeenCalledWith('mission-paused')
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'idle',
        currentMission: null,
        recoverableMission: null,
      }),
    )
  })

  it('starts a mission with an explicit back-dated start time', async () => {
    const createMission = vi.fn().mockResolvedValue({
      ...ACTIVE_MISSION,
      name: 'Backdated',
      start_time: '2026-04-09T08:00:00.000Z',
    })

    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        createMission,
      }),
      applyRuntime: vi.fn(),
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await runtime.startMission({
      name: 'Backdated',
      startTime: '2026-04-09T08:00:00.000Z',
    })

    expect(createMission).toHaveBeenCalledWith({
      name: 'Backdated',
      start_time: '2026-04-09T08:00:00.000Z',
    })
  })

  it('rejects a future start time before it reaches the mission store', async () => {
    const createMission = vi.fn()
    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        createMission,
      }),
      applyRuntime: vi.fn(),
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await expect(
      runtime.startMission({
        name: 'Future Mission',
        startTime: '2026-04-09T11:30:00.000Z',
      }),
    ).rejects.toThrow('Mission start time cannot be in the future.')

    expect(createMission).not.toHaveBeenCalled()
  })

  it('pauses and resumes the current mission through the runtime controller', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        createMission: vi.fn().mockResolvedValue(ACTIVE_MISSION),
        pauseMission: vi.fn().mockResolvedValue(PAUSED_MISSION),
        resumeMission: vi.fn().mockResolvedValue(ACTIVE_MISSION),
      }),
      applyRuntime,
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await runtime.startMission({ name: 'Active Mission' })
    await runtime.pauseMission()
    await runtime.resumeMission()

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'active',
        currentMission: expect.objectContaining({ status: 'active' }),
      }),
    )
  })

  it('warns when a mission name matches an existing mission', async () => {
    const runtime = await startMissionRuntime({
      missionStore: createMissionStoreStub({
        listMissions: vi.fn().mockResolvedValue([{ id: 'finished-1', name: 'Training Run' }]),
      }),
      applyRuntime: vi.fn(),
      now: () => new Date('2026-04-09T11:00:00.000Z'),
    })

    await expect(runtime.hasMissionNameConflict('training run')).resolves.toBe(true)
    await expect(runtime.hasMissionNameConflict('Night Search')).resolves.toBe(false)
  })
})

function createMissionStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    createMission: vi.fn(),
    listMissions: vi.fn().mockResolvedValue([]),
    getRecoverableMission: vi.fn().mockResolvedValue(null),
    pauseMission: vi.fn(),
    resumeMission: vi.fn(),
    finishMission: vi.fn(),
    ...overrides,
  }
}
