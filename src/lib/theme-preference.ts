export const THEME_KEY = 'sartracker:high-contrast'

/** Reads a device-local display choice without making startup depend on storage. */
export function readTheme(): boolean {
  try { return window.localStorage.getItem(THEME_KEY) === 'true' } catch { return false }
}

/** Applies the preference before runtime bootstrap, including boot and fault shells. */
export function applySavedTheme(): void {
  document.documentElement.dataset.theme = readTheme() ? 'high-contrast' : 'standard'
}
