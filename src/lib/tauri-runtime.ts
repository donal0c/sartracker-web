/**
 * Returns whether the current renderer is running inside a Tauri host.
 */
export function isTauriRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in window
}
