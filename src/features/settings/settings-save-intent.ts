import type { AppSettingsDraft } from './settings-types'

/**
 * Says why saving this draft would stop a live tracking connection, or returns
 * null when tracking would carry on. Save & Close keeps a connection the
 * coordinator already has (auto-connect only decides the connection at
 * startup), so only edits that switch tracking off are listed here
 * [DON-352, audit M-67].
 *
 * @param draft the settings about to be saved
 */
export function describeTrackingStopOnSave(draft: AppSettingsDraft): string | null {
  if (draft.dataSource.providerType !== 'traccar_http') {
    return 'The tracking provider is set to None.'
  }
  if (!draft.missionDefaults.autoRefreshEnabled) {
    return 'Auto-refresh is switched off.'
  }
  if (draft.dataSource.clearSecret && draft.dataSource.secretInput.trim() === '') {
    return 'The stored Traccar password or token will be cleared.'
  }
  return null
}
