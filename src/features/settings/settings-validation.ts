import type { AppSettingsDraft } from './settings-types'

export type SettingsValidationErrors = Partial<Record<string, string>>

/**
 * Validates the settings draft before it can be tested or saved.
 */
export function validateSettingsDraft(draft: AppSettingsDraft): SettingsValidationErrors {
  const errors: SettingsValidationErrors = {}

  if (
    !Number.isInteger(draft.missionDefaults.autoRefreshIntervalSeconds) ||
    draft.missionDefaults.autoRefreshIntervalSeconds < 5 ||
    draft.missionDefaults.autoRefreshIntervalSeconds > 3600
  ) {
    errors.autoRefreshIntervalSeconds = 'Auto-refresh interval must be between 5 and 3600 seconds.'
  }

  if (
    !Number.isInteger(draft.missionDefaults.autoSaveIntervalSeconds) ||
    draft.missionDefaults.autoSaveIntervalSeconds < 5 ||
    draft.missionDefaults.autoSaveIntervalSeconds > 3600
  ) {
    errors.autoSaveIntervalSeconds = 'Auto-save interval must be between 5 and 3600 seconds.'
  }

  if (draft.dataSource.providerType === 'traccar_http') {
    try {
      const parsed = new URL(draft.dataSource.baseUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.baseUrl = 'Provider URL must use http or https.'
      }
    } catch {
      errors.baseUrl = 'Provider URL must be a valid absolute URL.'
    }

    if (draft.dataSource.authMode === 'basic' && draft.dataSource.email.trim() === '') {
      errors.email = 'Email is required for basic authentication.'
    }

    const requiresSecret =
      !draft.dataSource.secretPresent && !draft.dataSource.clearSecret && draft.dataSource.secretInput.trim() === ''
    if (requiresSecret) {
      errors.secretInput =
        draft.dataSource.authMode === 'basic'
          ? 'Password is required for basic authentication.'
          : 'Bearer token is required for bearer authentication.'
    }

    if (draft.dataSource.replayEnabled) {
      if (draft.dataSource.replayStart.trim() === '') {
        errors.replayStart = 'Replay start time is required when replay defaults are enabled.'
      } else if (Number.isNaN(Date.parse(draft.dataSource.replayStart))) {
        errors.replayStart = 'Replay start must be a valid local datetime.'
      }

      if (
        !Number.isInteger(draft.dataSource.replayDurationHours) ||
        draft.dataSource.replayDurationHours < 1 ||
        draft.dataSource.replayDurationHours > 24
      ) {
        errors.replayDurationHours = 'Replay duration must be between 1 and 24 hours.'
      }
    }
  }

  if (draft.dataSource.providerType !== 'traccar_http' && draft.dataSource.replayEnabled) {
    errors.replayEnabled = 'Replay defaults are only available for the Traccar HTTP provider.'
  }

  return errors
}

export function normalizeRosterInput(value: string): readonly string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, values) => line !== '' && values.indexOf(line) === index)
}

export function formatRosterInput(values: readonly string[]): string {
  return values.join('\n')
}
