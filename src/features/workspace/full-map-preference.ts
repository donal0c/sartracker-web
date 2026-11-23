const FULL_MAP_STORAGE_KEY = 'sartracker:workspace-full-map'

/**
 * Reads whether the operator last chose Full map (side panel closed). Full map
 * replaces Focus Mode, which was remembered across a reload or crash (DON-341).
 * Locked-down storage reads as "show the panel".
 */
export function readStoredFullMap(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(FULL_MAP_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** Remembers the operator's Full map / Show panel choice for reload and crash recovery. */
export function persistFullMap(fullMap: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(FULL_MAP_STORAGE_KEY, fullMap ? 'true' : 'false')
  } catch {
    // Full map still works for this session even if the choice cannot be saved.
  }
}
