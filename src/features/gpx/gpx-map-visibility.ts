import { getEffectiveGpxTracksVisible } from '../layers/effective-overlay-visibility'
import type { LayerGroupVisibility } from '../layers/layer-visibility-store'

export type GpxMapVisibility = 'on_map' | 'group_hidden' | 'track_hidden'

/**
 * Says whether an imported track is drawn on the map, from the same state the
 * map overlay uses, so the GPX panel can never disagree with the map. A track
 * listed in the panel but hidden in Layers used to look imported yet absent
 * (Eamonn, PCLinuxOS, 1 Oct) [DON-319].
 */
export function describeGpxMapVisibility(
  importId: string,
  groupVisibility: Pick<LayerGroupVisibility, 'gpxTracks'>,
  hiddenGpxImportIds: readonly string[],
): GpxMapVisibility {
  if (!getEffectiveGpxTracksVisible(groupVisibility as LayerGroupVisibility)) return 'group_hidden'
  return hiddenGpxImportIds.includes(importId) ? 'track_hidden' : 'on_map'
}
