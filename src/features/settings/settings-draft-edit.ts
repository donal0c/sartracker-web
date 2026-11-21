import type { Dispatch, SetStateAction } from 'react'

import type { AppSettingsDraft } from './settings-types'

/** State setter shared by every Settings section; the draft is null until loaded. */
export type SettingsDraftSetter = Dispatch<SetStateAction<AppSettingsDraft | null>>

/** Validation errors keyed by field, as produced by validateSettingsDraft. */
export type SettingsValidationErrors = Readonly<Record<string, string | undefined>>

/**
 * Applies an edit to the loaded draft; does nothing before settings load.
 *
 * @param setDraft the Settings draft state setter
 * @param updater returns the edited draft
 */
export function updateDraft(
  setDraft: SettingsDraftSetter,
  updater: (current: AppSettingsDraft) => AppSettingsDraft,
): void {
  setDraft((current) => (current === null ? current : updater(current)))
}

/**
 * Parses a whole number typed into a settings field, keeping the previous value
 * while the text is not yet a number.
 */
export function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}
