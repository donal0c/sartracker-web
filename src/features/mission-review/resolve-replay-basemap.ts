import { DEFAULT_BASEMAP_ID, isOfficialMapId, type RenderableMapId } from '../../lib/map-config'
import { readStoredMapPreference } from '../../lib/map-preferences'
import { resolveStartupMapRestore } from '../map/startup-map-restore'
import type { OfficialMapSettings } from '../settings/settings-types'

export type ReplayBasemap = {
  readonly mapId: RenderableMapId
  /** Visible reason when the operator's official map cannot be used offline. */
  readonly notice: string | null
}

/**
 * Chooses the Replay basemap from the operator's stored map. An official map
 * is used only when its local package is verified ready, because review is
 * often off-network; otherwise Replay uses the online default and states why,
 * with the same rule as startup restore [DON-314].
 */
export async function resolveReplayBasemap(
  loadOfficialMaps: () => Promise<OfficialMapSettings | null>,
): Promise<ReplayBasemap> {
  const storedMapId = readStoredMapPreference()
  if (storedMapId === null) return { mapId: DEFAULT_BASEMAP_ID, notice: null }
  if (!isOfficialMapId(storedMapId)) return { mapId: storedMapId, notice: null }

  const officialMaps = await loadOfficialMaps().catch(() => null)
  const restore = resolveStartupMapRestore({ storedMapId, officialMaps })
  if (restore.kind === 'restore') return { mapId: restore.mapId, notice: null }
  return {
    mapId: DEFAULT_BASEMAP_ID,
    notice: restore.kind === 'unavailable' ? restore.message : null,
  }
}
