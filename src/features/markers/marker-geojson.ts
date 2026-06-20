import type { FeatureCollection, Point } from 'geojson'

import type { Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import { getMarkerVisualSpec } from './marker-definitions'
import { defaultMarkerLabelSize } from './marker-draft'

export function createMarkerFeatureCollection(
  markers: readonly Marker[],
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => {
      const visualSpec = getMarkerVisualSpec(marker.type)

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [marker.lon, marker.lat] as [number, number],
        },
        properties: {
          markerId: marker.id,
          name: marker.name,
          markerType: marker.type,
          iconId: visualSpec.iconId,
          labelColor: visualSpec.labelColor,
          labelSize: marker.label_size ?? defaultMarkerLabelSize(marker.type),
        },
      }
    }),
  }
}
