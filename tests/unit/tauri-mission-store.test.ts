import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('tauri mission store adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('forwards every mission store command through the Tauri boundary', async () => {
    const { createTauriMissionStore } = await import('../../src/infrastructure/mission-store/tauri-mission-store')

    invokeMock.mockResolvedValueOnce({ schema_version: 1 })
    invokeMock.mockResolvedValueOnce('/tmp/backup.sqlite')
    invokeMock.mockResolvedValueOnce({ mission_id: 'm-1', archive_path: '/tmp/m-1.zip' })
    invokeMock.mockResolvedValueOnce({ id: 'm-1', status: 'active', start_time: '2026-04-09T08:00:00.000Z' })
    invokeMock.mockResolvedValueOnce({ id: 'd-1', device_id: 'tracker-1' })
    invokeMock.mockResolvedValueOnce({ id: 'd-1', device_id: 'tracker-1' })
    invokeMock.mockResolvedValueOnce([{ id: 'd-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce({ id: 'p-1', device_id: 'tracker-1' })
    invokeMock.mockResolvedValueOnce([{ id: 'p-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce([{ id: 'p-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce({ id: 'mk-1', type: 'clue' })
    invokeMock.mockResolvedValueOnce({ id: 'mk-1', type: 'clue' })
    invokeMock.mockResolvedValueOnce([{ id: 'mk-1', type: 'clue' }])
    invokeMock.mockResolvedValueOnce(true)
    invokeMock.mockResolvedValueOnce({ id: 'dr-1', type: 'line' })
    invokeMock.mockResolvedValueOnce({ id: 'dr-1', type: 'line' })
    invokeMock.mockResolvedValueOnce([{ id: 'dr-1', type: 'line' }])
    invokeMock.mockResolvedValueOnce(true)
    invokeMock.mockResolvedValueOnce([{ id: 'e-1', event_type: 'mission_created' }])
    invokeMock.mockResolvedValueOnce({ id: 'm-1', status: 'active' })
    invokeMock.mockResolvedValueOnce([{ id: 'm-1', status: 'active' }])
    invokeMock.mockResolvedValueOnce(null)
    invokeMock.mockResolvedValueOnce({ id: 'm-2', status: 'paused' })
    invokeMock.mockResolvedValueOnce({ id: 'm-2', status: 'paused' })
    invokeMock.mockResolvedValueOnce({ id: 'm-2', status: 'active' })
    invokeMock.mockResolvedValueOnce({ id: 'm-2', status: 'finished' })

    const store = createTauriMissionStore()

    await expect(store.info()).resolves.toEqual({ schema_version: 1 })
    await expect(store.syncBackup()).resolves.toBe('/tmp/backup.sqlite')
    await expect(store.createMissionArchive('m-1')).resolves.toEqual({
      mission_id: 'm-1',
      archive_path: '/tmp/m-1.zip',
    })
    await expect(store.createMission({ name: 'Training', start_time: '2026-04-09T08:00:00.000Z' })).resolves.toEqual({
      id: 'm-1',
      status: 'active',
      start_time: '2026-04-09T08:00:00.000Z',
    })
    await expect(
      store.upsertDevice({
        mission_id: 'm-1',
        device_id: 'tracker-1',
        name: 'Tracker One',
        color: '#00AAFF',
        status: 'unknown',
      }),
    ).resolves.toEqual({ id: 'd-1', device_id: 'tracker-1' })
    await expect(store.getDevice('m-1', 'tracker-1')).resolves.toEqual({
      id: 'd-1',
      device_id: 'tracker-1',
    })
    await expect(store.listDevices('m-1')).resolves.toEqual([{ id: 'd-1', device_id: 'tracker-1' }])
    await expect(
      store.addPosition({
        mission_id: 'm-1',
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
      }),
    ).resolves.toEqual({ id: 'p-1', device_id: 'tracker-1' })
    await expect(store.listPositions('m-1', 'tracker-1')).resolves.toEqual([
      { id: 'p-1', device_id: 'tracker-1' },
    ])
    await expect(store.latestPositions('m-1')).resolves.toEqual([
      { id: 'p-1', device_id: 'tracker-1' },
    ])
    await expect(
      store.upsertMarker({
        mission_id: 'm-1',
        type: 'clue',
        name: 'Boot Print',
        lat: 52.0599,
        lon: -9.5045,
        irish_grid_e: 496584,
        irish_grid_n: 591256,
        display_order: 1,
      }),
    ).resolves.toEqual({ id: 'mk-1', type: 'clue' })
    await expect(store.getMarker('mk-1')).resolves.toEqual({ id: 'mk-1', type: 'clue' })
    await expect(store.listMarkers('m-1')).resolves.toEqual([{ id: 'mk-1', type: 'clue' }])
    await expect(store.deleteMarker('mk-1')).resolves.toBe(true)
    await expect(
      store.upsertDrawing({
        mission_id: 'm-1',
        type: 'line',
        name: 'Track Line',
        display_order: 1,
        geometry_json: '{"type":"LineString","coordinates":[[-9.5,52.0],[-9.4,52.1]]}',
      }),
    ).resolves.toEqual({ id: 'dr-1', type: 'line' })
    await expect(store.getDrawing('dr-1')).resolves.toEqual({ id: 'dr-1', type: 'line' })
    await expect(store.listDrawings('m-1')).resolves.toEqual([{ id: 'dr-1', type: 'line' }])
    await expect(store.deleteDrawing('dr-1')).resolves.toBe(true)
    await expect(store.listMissionEvents('m-1')).resolves.toEqual([
      { id: 'e-1', event_type: 'mission_created' },
    ])
    await expect(store.getMission('m-1')).resolves.toEqual({ id: 'm-1', status: 'active' })
    await expect(store.listMissions()).resolves.toEqual([{ id: 'm-1', status: 'active' }])
    await expect(store.getActiveMission()).resolves.toBeNull()
    await expect(store.getRecoverableMission()).resolves.toEqual({ id: 'm-2', status: 'paused' })
    await expect(store.pauseMission('m-2')).resolves.toEqual({ id: 'm-2', status: 'paused' })
    await expect(store.resumeMission('m-2')).resolves.toEqual({ id: 'm-2', status: 'active' })
    await expect(store.finishMission('m-2')).resolves.toEqual({ id: 'm-2', status: 'finished' })

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'mission_store_info')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sync_mission_store_backup')
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'create_mission_archive', {
      missionId: 'm-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'create_mission', {
      input: {
        name: 'Training',
        start_time: '2026-04-09T08:00:00.000Z',
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'upsert_device', {
      input: {
        mission_id: 'm-1',
        device_id: 'tracker-1',
        name: 'Tracker One',
        color: '#00AAFF',
        status: 'unknown',
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'get_device', {
      missionId: 'm-1',
      deviceId: 'tracker-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(7, 'list_devices', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(8, 'add_position', {
      input: {
        mission_id: 'm-1',
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(9, 'list_positions', {
      missionId: 'm-1',
      deviceId: 'tracker-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(10, 'latest_positions', {
      missionId: 'm-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(11, 'upsert_marker', {
      input: {
        mission_id: 'm-1',
        type: 'clue',
        name: 'Boot Print',
        lat: 52.0599,
        lon: -9.5045,
        irish_grid_e: 496584,
        irish_grid_n: 591256,
        display_order: 1,
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(12, 'get_marker', { markerId: 'mk-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(13, 'list_markers', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(14, 'delete_marker', { markerId: 'mk-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(15, 'upsert_drawing', {
      input: {
        mission_id: 'm-1',
        type: 'line',
        name: 'Track Line',
        display_order: 1,
        geometry_json:
          '{"type":"LineString","coordinates":[[-9.5,52.0],[-9.4,52.1]]}',
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(16, 'get_drawing', { drawingId: 'dr-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(17, 'list_drawings', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(18, 'delete_drawing', { drawingId: 'dr-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(19, 'list_mission_events', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(20, 'get_mission', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(21, 'list_missions')
    expect(invokeMock).toHaveBeenNthCalledWith(22, 'get_active_mission')
    expect(invokeMock).toHaveBeenNthCalledWith(23, 'get_recoverable_mission')
    expect(invokeMock).toHaveBeenNthCalledWith(24, 'pause_mission', { missionId: 'm-2' })
    expect(invokeMock).toHaveBeenNthCalledWith(25, 'resume_mission', { missionId: 'm-2' })
    expect(invokeMock).toHaveBeenNthCalledWith(26, 'finish_mission', { missionId: 'm-2' })
  })
})
