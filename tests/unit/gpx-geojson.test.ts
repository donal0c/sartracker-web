import { describe, expect, it } from 'vitest'

import type { GpxTrackImport } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { createGpxFeatureCollection } from '../../src/features/gpx/gpx-geojson'

describe('gpx geojson', () => {
  it('produces features with correct properties from valid GPX imports', () => {
    const collection = createGpxFeatureCollection([createGpxImport('import-1')])

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.geometry.type).toBe('MultiLineString')
    expect(collection.features[0]?.properties.gpxImportId).toBe('import-1')
    expect(collection.features[0]?.properties.displayName).toBe('Track Alpha')
    expect(collection.features[0]?.properties.sourcePath).toBe('/tmp/track.gpx')
  })

  it('exposes per-import track colour from GPX metadata for map styling', () => {
    const collection = createGpxFeatureCollection([
      {
        ...createGpxImport('import-1'),
        metadata_json: JSON.stringify({ color: '#00B8FF', trackCount: 1, pointCount: 2 }),
      },
    ])

    expect(collection.features[0]?.properties.color).toBe('#00B8FF')
  })

  it('returns an empty collection for an empty imports array', () => {
    const collection = createGpxFeatureCollection([])
    expect(collection.features).toHaveLength(0)
  })

  it('silently skips imports with malformed geometry_json', () => {
    const collection = createGpxFeatureCollection([
      { ...createGpxImport('good'), geometry_json: validMultiLineString() },
      { ...createGpxImport('bad-json'), geometry_json: '{invalid json' },
    ])

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.properties.gpxImportId).toBe('good')
  })

  it('silently skips imports with wrong geometry type', () => {
    const collection = createGpxFeatureCollection([
      { ...createGpxImport('point-not-line'), geometry_json: '{"type":"Point","coordinates":[0,0]}' },
    ])

    expect(collection.features).toHaveLength(0)
  })

  it('handles multiple valid imports', () => {
    const collection = createGpxFeatureCollection([
      createGpxImport('import-1'),
      createGpxImport('import-2'),
    ])

    expect(collection.features).toHaveLength(2)
  })
})

function validMultiLineString(): string {
  return JSON.stringify({
    type: 'MultiLineString',
    coordinates: [[[-9.5, 52.0], [-9.4, 52.1]]],
  })
}

function createGpxImport(id: string): GpxTrackImport {
  return {
    id,
    mission_id: 'mission-1',
    source_path: '/tmp/track.gpx',
    file_name: 'track.gpx',
    display_name: 'Track Alpha',
    geometry_json: validMultiLineString(),
    metadata_json: null,
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
  }
}
