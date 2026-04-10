import type { CoordinateDisplayMode } from '../features/settings/settings-types'

export const COORDINATE_DISPLAY_MODE_STORAGE_KEY = 'sartracker.ui.coordinate-display-mode'

export function readCoordinateDisplayMode(): CoordinateDisplayMode {
  if (typeof window === 'undefined') {
    return 'wgs84_first'
  }

  try {
    const value = window.localStorage.getItem(COORDINATE_DISPLAY_MODE_STORAGE_KEY)
    return value === 'tm65_first' ? 'tm65_first' : 'wgs84_first'
  } catch {
    return 'wgs84_first'
  }
}

export function persistCoordinateDisplayMode(mode: CoordinateDisplayMode): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(COORDINATE_DISPLAY_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore local preference persistence failures in locked-down browsers.
  }
}
