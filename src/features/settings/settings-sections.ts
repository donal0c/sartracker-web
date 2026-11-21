import type { SettingsFocusTarget } from './settings-workspace-store'

/** The five Settings sections the team asked for (SAR-QA-028), in menu order. */
export const SETTINGS_SECTION_IDS = [
  'mission-defaults',
  'tracking-sources',
  'mapping',
  'weather-links',
  'advanced',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export type SettingsSectionDefinition = {
  readonly id: SettingsSectionId
  readonly label: string
  readonly description: string
}

/** Labels and one-line descriptions shown in the Settings menu. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: 'mission-defaults',
    label: 'Mission defaults',
    description: 'Who can coordinate, and when a still device needs attention.',
  },
  {
    id: 'tracking-sources',
    label: 'Tracking sources',
    description: 'Your team’s default Traccar group and the Traccar connection.',
  },
  {
    id: 'mapping',
    label: 'Mapping',
    description: 'Official map source, offline packages and coordinate display.',
  },
  {
    id: 'weather-links',
    label: 'Weather links',
    description: 'Named weather websites opened from the Weather menu.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Storage, backups, tracking cache, replay and repair. Change only when asked by support.',
  },
]

/**
 * Settings opens on Tracking sources: it holds the team's default group and the
 * Traccar connection, the setup coordinators return to most often.
 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'tracking-sources'

const VALIDATION_KEY_SECTIONS: Readonly<Record<string, SettingsSectionId>> = {
  stationaryAttentionHeartbeatMinutes: 'mission-defaults',
  stationaryAttentionMovementFloorM: 'mission-defaults',
  stationaryAttentionAccuracyFactor: 'mission-defaults',
  stationaryAttentionOutlierRejectM: 'mission-defaults',
  autoRefreshIntervalSeconds: 'tracking-sources',
  baseUrl: 'tracking-sources',
  email: 'tracking-sources',
  secretInput: 'tracking-sources',
  autoSaveIntervalSeconds: 'advanced',
  replayEnabled: 'advanced',
  replayStart: 'advanced',
  replayDurationHours: 'advanced',
}

/**
 * Returns the section that shows the field behind a validation error key, so
 * the menu can point the operator at a section that blocks saving. An unknown
 * key maps to Advanced rather than being dropped, so no blocking error is
 * ever hidden from the menu.
 *
 * @param key a key produced by validateSettingsDraft
 */
export function sectionForValidationKey(key: string): SettingsSectionId {
  if (key === 'weather.links' || key.startsWith('weather.links.')) {
    return 'weather-links'
  }
  return VALIDATION_KEY_SECTIONS[key] ?? 'advanced'
}

/**
 * Counts validation errors per section for the menu badges.
 *
 * @param errors the current validation errors keyed by field
 */
export function countValidationErrorsBySection(
  errors: Readonly<Record<string, string | undefined>>,
): Readonly<Record<SettingsSectionId, number>> {
  const counts: Record<SettingsSectionId, number> = {
    'mission-defaults': 0,
    'tracking-sources': 0,
    mapping: 0,
    'weather-links': 0,
    advanced: 0,
  }
  for (const [key, message] of Object.entries(errors)) {
    if (message === undefined || message === '') continue
    counts[sectionForValidationKey(key)] += 1
  }
  return counts
}

/**
 * Chooses the section to show when Settings opens.
 *
 * @param focusTarget a field another workflow asked Settings to focus, if any
 */
export function initialSettingsSection(focusTarget: SettingsFocusTarget | null): SettingsSectionId {
  if (focusTarget === 'admin-roster') return 'mission-defaults'
  return DEFAULT_SETTINGS_SECTION
}
