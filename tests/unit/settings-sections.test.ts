import { describe, expect, it } from 'vitest'

import {
  SETTINGS_SECTIONS,
  countValidationErrorsBySection,
  initialSettingsSection,
  sectionForValidationKey,
} from '../../src/features/settings/settings-sections'
import { DEFAULT_APP_SETTINGS, createSettingsDraft } from '../../src/features/settings/settings-types'
import { validateSettingsDraft } from '../../src/features/settings/settings-validation'

describe('Settings sections [DON-343]', () => {
  it('lists the five sections the team asked for, in their order', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      'Mission defaults',
      'Tracking sources',
      'Mapping',
      'Weather links',
      'Advanced',
    ])
  })

  it('opens on Tracking sources, and on Mission defaults when asked to focus the admin roster', () => {
    expect(initialSettingsSection(null)).toBe('tracking-sources')
    expect(initialSettingsSection('admin-roster')).toBe('mission-defaults')
  })

  it('points every validation error at the section that shows its field', () => {
    expect(sectionForValidationKey('baseUrl')).toBe('tracking-sources')
    expect(sectionForValidationKey('autoRefreshIntervalSeconds')).toBe('tracking-sources')
    expect(sectionForValidationKey('stationaryAttentionHeartbeatMinutes')).toBe('mission-defaults')
    expect(sectionForValidationKey('autoSaveIntervalSeconds')).toBe('advanced')
    expect(sectionForValidationKey('replayStart')).toBe('advanced')
    expect(sectionForValidationKey('weather.links')).toBe('weather-links')
    expect(sectionForValidationKey('weather.links.2.url')).toBe('weather-links')
  })

  it('never drops an unknown validation error from the menu counts', () => {
    expect(countValidationErrorsBySection({ someFutureField: 'Required.' }).advanced).toBe(1)
  })

  it('counts real validation errors against their sections', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    const errors = validateSettingsDraft({
      ...draft,
      missionDefaults: { ...draft.missionDefaults, autoSaveIntervalSeconds: 0 },
      weather: { links: [{ name: '', url: 'javascript:alert(1)' }] },
    })

    const counts = countValidationErrorsBySection(errors)

    expect(counts['weather-links']).toBe(2)
    expect(counts.advanced).toBe(1)
    expect(counts['tracking-sources']).toBe(0)
  })
})
