import type { Feature, FeatureCollection, MultiLineString } from 'geojson'

import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'

type GpxFeatureProperties = {
  readonly gpxImportId: string
  readonly displayName: string
  readonly sourcePath: string
}

/**
 * Builds the map overlay feature collection for persisted GPX imports.
 */
export function createGpxFeatureCollection(
  imports: readonly GpxTrackImport[],
): FeatureCollection<MultiLineString, GpxFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: imports.flatMap(createImportFeature),
  }
}

function createImportFeature(
  entry: GpxTrackImport,
): readonly Feature<MultiLineString, GpxFeatureProperties>[] {
  const geometry = parseMultiLineGeometry(entry.geometry_json)
  if (geometry === null) {
    return []
  }

  return [
    {
      type: 'Feature',
      geometry,
      properties: {
        gpxImportId: entry.id,
        displayName: entry.display_name,
        sourcePath: entry.source_path,
      },
    },
  ]
}

function parseMultiLineGeometry(rawGeometry: string): MultiLineString | null {
  try {
    const geometry = JSON.parse(rawGeometry) as MultiLineString
    return geometry.type === 'MultiLineString' ? geometry : null
  } catch {
    return null
  }
}
