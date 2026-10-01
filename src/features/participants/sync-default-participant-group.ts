import type { AppSettings } from '../settings/settings-types'

const SETTINGS_UPDATED_EVENT = 'sartracker:settings-updated'

/**
 * Keeps the Start step's team default group in line with Settings: applied
 * at startup and again whenever Settings is saved. Unreadable settings
 * pre-tick nothing, so the coordinator chooses explicitly [DON-296].
 */
export function syncDefaultParticipantGroup(
  runtime: { readonly setDefaultGroup: (groupId: string | null) => void },
  loadSettings: () => Promise<AppSettings>,
  events: EventTarget,
): () => void {
  let generation = 0
  const refresh = () => {
    const current = ++generation
    void loadSettings()
      .then((settings) => settings.missionDefaults.defaultParticipantGroup?.groupId ?? null, () => null)
      .then((groupId) => { if (current === generation) runtime.setDefaultGroup(groupId) })
  }
  refresh()
  events.addEventListener(SETTINGS_UPDATED_EVENT, refresh)
  return () => {
    generation += 1
    events.removeEventListener(SETTINGS_UPDATED_EVENT, refresh)
  }
}
