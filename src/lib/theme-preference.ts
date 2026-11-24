/**
 * Device-local display theme (DON-344).
 *
 * "light" is the default: light grey panels, dark writing, strong borders, as
 * the team asked (SAR-QA-029; simplification brief rule 13, "Higher contrast by
 * default"). "standard" is the dark theme, kept for night use.
 *
 * The saved key keeps its High contrast era name. 'true' means light and
 * 'false' means dark; nothing saved means the light default. 'false' is only
 * ever written by pressing the toggle, so it cannot tell "chose Dark" apart
 * from "turned High contrast on and off again" before DON-344: both stay dark.
 *
 * index.html repeats `readThemePreference` + `applySavedTheme` in a tiny inline
 * <head> script so the theme is on <html> before the first paint; a unit test
 * runs that script against this module so the two cannot drift.
 */
export type ThemeName = 'standard' | 'light'

/** Kept from the High contrast era; 'true' means light, 'false' means dark. */
export const THEME_KEY = 'sartracker:high-contrast'

/** The theme used when nothing usable is saved. */
export const DEFAULT_THEME: ThemeName = 'light'

/** Logged when storage cannot be read, so the fallback is never silent. */
export const THEME_READ_FAILURE = 'SAR Tracker could not read the saved theme; using the default Light theme.'

/** The saved theme, and whether storage could not be read at all. */
export interface ThemePreference {
  readonly theme: ThemeName
  readonly readFailed: boolean
}

/** Reads storage once, keeping the error so callers can surface it. */
function readStoredTheme(): { readonly theme: ThemeName; readonly error: unknown } {
  try {
    return { theme: window.localStorage.getItem(THEME_KEY) === 'false' ? 'standard' : DEFAULT_THEME, error: null }
  } catch (error) {
    return { theme: DEFAULT_THEME, error: error ?? new Error('Storage read failed') }
  }
}

/** Reads the device-local choice; a failed read falls back to the default. */
export function readThemePreference(): ThemePreference {
  const { theme, error } = readStoredTheme()
  return { theme, readFailed: error !== null }
}

/** Reads a device-local display choice without making startup depend on storage. */
export function readTheme(): ThemeName {
  return readThemePreference().theme
}

/** Puts a theme on the document root, where the stylesheet reads it. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}

/**
 * The theme on the page now: the saved choice applied before first paint, or a
 * later choice that applied but could not be saved. Falls back to the saved
 * preference when nothing has been applied yet.
 */
export function readAppliedTheme(): ThemeName {
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'standard') return applied
  return readTheme()
}

/** True when startup could not read the saved theme and used the default. */
export function themeReadFailed(): boolean {
  return document.documentElement.dataset.themeReadFailed === 'true'
}

/** Saves the choice for the next launch; false when storage refused the write. */
export function saveTheme(theme: ThemeName): boolean {
  try { window.localStorage.setItem(THEME_KEY, String(theme === 'light')); return true } catch { return false }
}

/** Applies the preference before runtime bootstrap, including boot and fault shells. */
export function applySavedTheme(): void {
  const { theme, error } = readStoredTheme()
  applyTheme(theme)
  if (error === null) return
  // The inline <head> script may already have reported this launch's failure.
  if (themeReadFailed()) return
  document.documentElement.dataset.themeReadFailed = 'true'
  console.error(THEME_READ_FAILURE, error)
}
