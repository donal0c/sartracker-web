import {
  DEFAULT_BASEMAP_ID,
  getBasemapById,
  getOfficialMapById,
  isOfficialMapId,
  type BasemapId,
  type OfficialMapId,
  type RenderableMapId,
} from './map-config'

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

    if (isOfficialMapId(candidate as RenderableMapId)) {
      return DEFAULT_BASEMAP_ID
    }

    return getBasemapById(candidate as BasemapId).id
  } catch {
    return DEFAULT_BASEMAP_ID
  }
}

/**
 * Reads the operator's last chosen map, including an official map, so startup
 * can restore it once its local package is verified [DON-304]. Returns null
 * when nothing valid is stored or storage is unavailable.
 */
export function readStoredMapPreference(): RenderableMapId | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const candidate = window.localStorage.getItem(BASEMAP_STORAGE_KEY)
    if (candidate === null) {
      return null
    }
    return isOfficialMapId(candidate as RenderableMapId)
      ? getOfficialMapById(candidate as OfficialMapId).id
      : getBasemapById(candidate as BasemapId).id
  } catch {
    return null
  }
}

/**
 * Persists the operator's basemap preference when storage is available.
 */
export function persistBasemapPreference(basemapId: RenderableMapId): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, basemapId)
  } catch {
    // Storage can be unavailable in private or locked-down environments.
  }
}
