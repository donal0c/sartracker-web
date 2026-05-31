export type DesktopRuntimeKind = 'browser' | 'electron' | 'tauri'

/**
 * Returns whether the current renderer is running inside a Tauri host.
 */
export function isTauriRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in window
}

/**
 * Returns whether the current renderer has SAR Tracker's Electron preload bridge.
 */
export function isElectronRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return 'sartrackerElectron' in window
}

/**
 * Names the current host runtime for branch decisions and diagnostics.
 */
export function getDesktopRuntimeKind(): DesktopRuntimeKind {
  if (isTauriRuntimeAvailable()) {
    return 'tauri'
  }

  if (isElectronRuntimeAvailable()) {
    return 'electron'
  }

  return 'browser'
}
