import { describe, expect, it, vi } from 'vitest'

import type {
  Device,
  Drawing,
  Marker,
  Mission,
  MissionEvent,
  MissionStoreInfo,
  Position,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionReviewRuntime } from '../../src/features/mission-review/start-mission-review-runtime'

describe('startMissionReviewRuntime', () => {
  it('loads the preferred mission review snapshot', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([SECOND_MISSION, FIRST_MISSION]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedMissionId: FIRST_MISSION.id,
        snapshot: expect.objectContaining({
          mission: FIRST_MISSION,
        }),
      }),
    )
  })

  it('keeps the latest refresh result when requests resolve out of order', async () => {
    const applyRuntime = vi.fn()
    let resolveFirstMission: ((value: readonly MissionEvent[]) => void) | null = null
    const listMissionEvents = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<readonly MissionEvent[]>((resolve) => {
            resolveFirstMission = resolve
          }),
      )
      .mockResolvedValueOnce([
        {
          id: 'event-second',
          mission_id: SECOND_MISSION.id,
          event_type: 'mission_created',
          timestamp: '2026-04-10T09:00:00.000Z',
          details_json: '{"name":"Second Mission"}',
        },
      ])

    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([SECOND_MISSION, FIRST_MISSION]),
        listMissionEvents,
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    const firstLoad = runtime.load(FIRST_MISSION.id)
    const secondLoad = runtime.load(SECOND_MISSION.id)
    await Promise.resolve()

    resolveFirstMission?.([
      {
        id: 'event-first',
        mission_id: FIRST_MISSION.id,
        event_type: 'mission_created',
        timestamp: '2026-04-10T08:00:00.000Z',
        details_json: '{"name":"First Mission"}',
      },
    ])

    await Promise.all([firstLoad, secondLoad])

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedMissionId: SECOND_MISSION.id,
        snapshot: expect.objectContaining({
          mission: SECOND_MISSION,
        }),
      }),
    )
  })

  it('surfaces an error when a store query fails during load', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
        listMarkers: vi.fn().mockRejectedValue(new Error('markers table corrupt')),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        loading: false,
        error: 'markers table corrupt',
      }),
    )
  })

  it('refreshes the currently selected mission', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(FIRST_MISSION.id)
    await runtime.refreshSelectedMission()

    const lastCall = applyRuntime.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({
      selectedMissionId: FIRST_MISSION.id,
      loading: false,
      refreshing: false,
    })
    expect(lastCall?.snapshot).not.toBeNull()
  })

  it('handles an empty mission list without crashing', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMissionReviewRuntime({
      missionStore: createMissionReviewStoreStub({
        listMissions: vi.fn().mockResolvedValue([]),
      }),
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.load(null)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        missions: [],
        selectedMissionId: null,
        snapshot: null,
        loading: false,
        error: null,
      }),
    )
  })
})

const FIRST_MISSION: Mission = {
  id: 'mission-1',
  name: 'First Mission',
  status: 'finished',
  start_time: '2026-04-10T08:00:00.000Z',
  pause_time: null,
  finish_time: '2026-04-10T09:00:00.000Z',
  paused_seconds: 0,
  notes: null,
  schema_version: 1,
}

const SECOND_MISSION: Mission = {
  ...FIRST_MISSION,
  id: 'mission-2',
  name: 'Second Mission',
  start_time: '2026-04-10T10:00:00.000Z',
  finish_time: '2026-04-10T11:00:00.000Z',
}

function createMissionReviewStoreStub(overrides: Record<string, unknown> = {}) {
  const info: MissionStoreInfo = {
    schema_version: 1,
    database_path: '/tmp/mission-store.sqlite',
    backup_path: '/tmp/mission-store.backup.sqlite',
  }
  const marker: Marker = {
    id: 'marker-1',
    mission_id: FIRST_MISSION.id,
    type: 'clue',
    name: 'Boot Print',
    description: null,
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-10T08:15:00.000Z',
    updated_at: '2026-04-10T08:15:00.000Z',
    display_order: 1,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
  }
  const device: Device = {
    id: 'device-1',
    mission_id: FIRST_MISSION.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    color: '#38bdf8',
    last_seen: '2026-04-10T08:20:00.000Z',
    status: 'online',
  }
  const position: Position = {
    id: 'position-1',
    mission_id: FIRST_MISSION.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    lat: 52.0599,
    lon: -9.5045,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    source: null,
    timestamp: '2026-04-10T08:20:00.000Z',
    data_origin: 'live',
  }
  const drawing: Drawing = {
    id: 'drawing-1',
    mission_id: FIRST_MISSION.id,
    type: 'line',
    name: 'Track Line',
    description: null,
    color: '#38bdf8',
    width: 2,
    distance_m: 1200,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: '{"type":"LineString","coordinates":[[-9.5,52.0],[-9.4,52.1]]}',
    metadata_json: null,
    created_at: '2026-04-10T08:30:00.000Z',
    updated_at: '2026-04-10T08:35:00.000Z',
  }

  return {
    info: vi.fn().mockResolvedValue(info),
    listMissions: vi.fn().mockResolvedValue([FIRST_MISSION]),
    listMissionEvents: vi.fn().mockResolvedValue([]),
    listMarkers: vi.fn().mockResolvedValue([marker]),
    listDevices: vi.fn().mockResolvedValue([device]),
    listPositions: vi.fn().mockResolvedValue([position]),
    listDrawings: vi.fn().mockResolvedValue([drawing]),
    listGpxImports: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}
