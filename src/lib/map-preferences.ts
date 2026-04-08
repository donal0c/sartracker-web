import { DEFAULT_BASEMAP_ID, getBasemapById, type BasemapId } from './map-config'

export const BASEMAP_STORAGE_KEY = 'sartracker.map.basemap'

/**
 * Reads the persisted basemap preference with safe fallback behaviour.
 */
export function readStoredBasemap(): BasemapId {
  if (typeof window === 'undefined') {
    return DEFAULT_BASEMAP_ID
  }

  try {
    const candidate = window.localStorage.getItem(BASEMAP_STORAGE_KEY)

    if (candidate === null) {
      return DEFAULT_BASEMAP_ID
    }

    return getBasemapById(candidate as BasemapId).id
  } catch {
    return DEFAULT_BASEMAP_ID
  }
}

/**
 * Persists the operator's basemap preference when storage is available.
 */
export function persistBasemapPreference(basemapId: BasemapId): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, basemapId)
  } catch {
    // Storage can be unavailable in private or locked-down environments.
  }
}
