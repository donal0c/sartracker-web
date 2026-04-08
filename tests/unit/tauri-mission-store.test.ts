import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('tauri mission store adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('forwards mission, device, and position commands through the Tauri boundary', async () => {
    const { createTauriMissionStore } = await import('../../src/infrastructure/mission-store/tauri-mission-store')

    invokeMock.mockResolvedValueOnce({ schema_version: 1 })
    invokeMock.mockResolvedValueOnce('/tmp/backup.sqlite')
    invokeMock.mockResolvedValueOnce({ id: 'm-1', status: 'active' })
    invokeMock.mockResolvedValueOnce({ id: 'd-1', device_id: 'tracker-1' })
    invokeMock.mockResolvedValueOnce([{ id: 'd-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce({ id: 'p-1', device_id: 'tracker-1' })
    invokeMock.mockResolvedValueOnce([{ id: 'p-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce([{ id: 'p-1', device_id: 'tracker-1' }])
    invokeMock.mockResolvedValueOnce(null)

    const store = createTauriMissionStore()

    await expect(store.info()).resolves.toEqual({ schema_version: 1 })
    await expect(store.syncBackup()).resolves.toBe('/tmp/backup.sqlite')
    await expect(store.createMission({ name: 'Training' })).resolves.toEqual({
      id: 'm-1',
      status: 'active',
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
    await expect(store.getActiveMission()).resolves.toBeNull()

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'mission_store_info')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sync_mission_store_backup')
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'create_mission', {
      input: { name: 'Training' },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'upsert_device', {
      input: {
        mission_id: 'm-1',
        device_id: 'tracker-1',
        name: 'Tracker One',
        color: '#00AAFF',
        status: 'unknown',
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'list_devices', { missionId: 'm-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'add_position', {
      input: {
        mission_id: 'm-1',
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(7, 'list_positions', {
      missionId: 'm-1',
      deviceId: 'tracker-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(8, 'latest_positions', {
      missionId: 'm-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(9, 'get_active_mission')
  })
})
