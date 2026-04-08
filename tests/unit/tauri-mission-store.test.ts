import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('tauri mission store adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('forwards mission commands through the Tauri boundary', async () => {
    const { createTauriMissionStore } = await import('../../src/infrastructure/mission-store/tauri-mission-store')

    invokeMock.mockResolvedValueOnce({ schema_version: 1 })
    invokeMock.mockResolvedValueOnce('/tmp/backup.sqlite')
    invokeMock.mockResolvedValueOnce({ id: 'm-1', status: 'active' })
    invokeMock.mockResolvedValueOnce(null)

    const store = createTauriMissionStore()

    await expect(store.info()).resolves.toEqual({ schema_version: 1 })
    await expect(store.syncBackup()).resolves.toBe('/tmp/backup.sqlite')
    await expect(store.createMission({ name: 'Training' })).resolves.toEqual({
      id: 'm-1',
      status: 'active',
    })
    await expect(store.getActiveMission()).resolves.toBeNull()

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'mission_store_info')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sync_mission_store_backup')
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'create_mission', {
      input: { name: 'Training' },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'get_active_mission')
  })
})
