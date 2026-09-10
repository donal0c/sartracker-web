import { describe, expect, it } from 'vitest'
import { projectReplayMap } from '../../src/features/mission-review/replay-map-projection'

describe('replay map projection [DON-215]', () => {
  it.each([
    { type: 'unknown_kind', geometry_json: JSON.stringify({ type: 'Point', coordinates: [-9, 52] }) },
    { type: 'line', geometry_json: JSON.stringify({ type: 'LineString', coordinates: [[-9, 999], [-9, 52]] }) },
    { type: 'line', geometry_json: JSON.stringify({ type: 'GeometryCollection', geometries: [] }) },
  ])('retains valid evidence when one drawing cannot be projected: $type $geometry_json', (state) => {
    const result = projectReplayMap([
      { evidence_id: 'fix', source_type: 'traccar_fix', track_id: 'alpha', lat: 52, lon: -9, effective_at: '2026-09-09T10:00:00Z' },
    ], [
      { object_type: 'drawing', object_id: 'bad-drawing', operation: 'created', state },
      { object_type: 'marker', object_id: 'clue', operation: 'created', state: { id: 'clue', type: 'clue', name: 'Boot Print', lat: 52, lon: -9 } },
    ])
    expect(result.features.map((feature) => feature.properties?.category)).toEqual(['breadcrumbs', 'current', 'objects'])
    expect(result.limitations).toEqual([expect.objectContaining({ evidenceId: 'bad-drawing', code: 'object_not_projected' })])
  })
  it('preserves distinct retained LPB percentile labels', () => {
    const polygon = [[[-9.7,52],[-9.69,52],[-9.69,52.01],[-9.7,52]]]
    const result = projectReplayMap([], [{ object_type: 'drawing', object_id: 'rings', operation: 'created', state: {
      id: 'rings', type: 'range_ring', name: 'LPB search', label: 'LPB search',
      geometry_json: JSON.stringify({ type: 'MultiPolygon', coordinates: [polygon, polygon] }),
      metadata_json: JSON.stringify({ kind: 'range_ring', mode: 'lpb', center: [-9.7,52], radiiM: [800,2000], colors: ['#22C55E','#EAB308'], labels: ['25%','50%'], lpbCategory: 'hiker' }),
    } }])
    expect(result.features.filter((feature) => feature.properties?.featureKind === 'label').map((feature) => feature.properties?.label)).toEqual(['25%','50%'])
  })
  it('preserves recorded annotation text instead of replacing it with the object name', () => {
    const result = projectReplayMap([], [{ object_type: 'drawing', object_id: 'label', operation: 'created', state: {
      id: 'label', type: 'text_label', name: 'Annotation 1', label: 'DO NOT CROSS',
      geometry_json: JSON.stringify({ type: 'Point', coordinates: [-9, 52] }),
      metadata_json: JSON.stringify({ kind: 'text_label', text: 'DO NOT CROSS', point: [-9,52], fontSize: 18 }),
    } }])
    expect(result.features[0]?.properties?.label).toBe('DO NOT CROSS')
  })
  it('does not paint a mirrored search-area record twice', () => {
    const geometry_json = JSON.stringify({ type: 'Polygon', coordinates: [[[-9,52],[-9.1,52],[-9.1,52.1],[-9,52]]] })
    const projection = projectReplayMap([], [
      { object_type: 'drawing', object_id: 'area', operation: 'created', state: { name: 'Area', geometry_json } },
      { object_type: 'search_area', object_id: 'area', operation: 'created', state: { name: 'Area', legacy_drawing_id: 'area', geometry_json } },
    ])
    expect(projection.features).toHaveLength(1)
  })
  it('keeps dated evidence and current-at-time distinct, without connecting GPX gaps', () => {
    const projection = projectReplayMap([
      { evidence_id: 'a', source_type: 'traccar_fix', track_id: 'alpha', lat: 52, lon: -9, effective_at: '2026-09-09T10:00:00Z' },
      { evidence_id: 'b', source_type: 'traccar_fix', track_id: 'alpha', lat: 52.1, lon: -9, effective_at: '2026-09-09T10:01:00Z' },
      { evidence_id: 'g', source_type: 'gpx_point', track_id: 'import', lat: 52.2, lon: -9, effective_at: '2026-09-09T10:00:00Z' },
    ], [])
    expect(projection.features.filter((feature) => feature.properties?.category === 'current')).toHaveLength(1)
    expect(projection.features.filter((feature) => feature.properties?.category === 'gpx')).toHaveLength(1)
    expect(projection.features.every((feature) => feature.geometry.type === 'Point')).toBe(true)
  })
  it('renders retained shapes and rejects invalid coordinates rather than silently omitting evidence', () => {
    const projection = projectReplayMap([], [{ object_type: 'drawing', object_id: 'area', operation: 'updated', state: {
      name: 'Search area', geometry_json: JSON.stringify({ type: 'Polygon', coordinates: [[[-9,52],[-9.1,52],[-9.1,52.1],[-9,52]]] }),
    } }])
    expect(projection.features[0]?.geometry.type).toBe('Polygon')
    expect(projectReplayMap([{ evidence_id: 'bad', source_type: 'traccar_fix', track_id: 'x', lat: NaN, lon: -9, effective_at: '2026-09-09T10:00:00Z' }], []).limitations)
      .toEqual([expect.objectContaining({ code: 'track_not_projected', evidenceId: 'bad' })])
  })
})
