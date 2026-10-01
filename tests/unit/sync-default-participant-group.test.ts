import { describe, expect, it, vi } from 'vitest'

import { syncDefaultParticipantGroup } from '../../src/features/participants/sync-default-participant-group'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/features/settings/settings-types'

/** Settings with the given team default group. */
function settings(group: { groupId: string; name: string } | null): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, missionDefaults: { ...DEFAULT_APP_SETTINGS.missionDefaults, defaultParticipantGroup: group } }
}

describe('team default group follows Settings [DON-296]', () => {
  it('applies the saved default at startup and after Settings is saved', async () => {
    const setDefaultGroup = vi.fn()
    const loadSettings = vi.fn()
      .mockResolvedValueOnce(settings({ groupId: '7', name: 'KMRT' }))
      .mockResolvedValueOnce(settings(null))
    const events = new EventTarget()

    const stop = syncDefaultParticipantGroup({ setDefaultGroup }, loadSettings, events)
    await vi.waitFor(() => expect(setDefaultGroup).toHaveBeenLastCalledWith('7'))

    events.dispatchEvent(new Event('sartracker:settings-updated'))
    await vi.waitFor(() => expect(setDefaultGroup).toHaveBeenLastCalledWith(null))

    stop()
    events.dispatchEvent(new Event('sartracker:settings-updated'))
    expect(loadSettings).toHaveBeenCalledTimes(2)
  })

  it('pre-ticks nothing when Settings cannot be read', async () => {
    const setDefaultGroup = vi.fn()
    syncDefaultParticipantGroup({ setDefaultGroup }, async () => { throw new Error('unreadable') }, new EventTarget())
    await vi.waitFor(() => expect(setDefaultGroup).toHaveBeenCalledWith(null))
  })
})
