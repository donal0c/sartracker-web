/**
 * Device-local display theme (DON-344).
 *
 * "standard" is the dark theme and stays the default. "light" is the light grey
 * high-contrast theme the team asked for (SAR-QA-029); it replaced the old black
 * "High contrast" theme, so the saved key keeps its old name and an operator who
 * chose High contrast before now opens in the light theme.
 *
 * index.html repeats `readTheme` + `applySavedTheme` in a tiny inline <head>
 * script so the theme is on <html> before the first paint; a unit test runs that
 * script against this module so the two cannot drift.
 */
export type ThemeName = 'standard' | 'light'

/** Kept from the High contrast era; the value 'true' means the light theme. */
export const THEME_KEY = 'sartracker:high-contrast'

/** Reads a device-local display choice without making startup depend on storage. */
export function readTheme(): ThemeName {
  try { return window.localStorage.getItem(THEME_KEY) === 'true' ? 'light' : 'standard' } catch { return 'standard' }
}

/** Puts a theme on the document root, where the stylesheet reads it. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}

/** Saves the choice for the next launch; false when storage refused the write. */
export function saveTheme(theme: ThemeName): boolean {
  try { window.localStorage.setItem(THEME_KEY, String(theme === 'light')); return true } catch { return false }
}

/** Applies the preference before runtime bootstrap, including boot and fault shells. */
export function applySavedTheme(): void {
  applyTheme(readTheme())
}
