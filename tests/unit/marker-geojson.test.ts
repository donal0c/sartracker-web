import { describe, expect, it } from 'vitest'

import { createMarkerFeatureCollection } from '../../src/features/markers/marker-geojson'
import type { Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'

const MARKERS: readonly Marker[] = [
  {
    id: 'marker-1',
    mission_id: 'mission-1',
    type: 'ipp_lkp',
    name: 'IPP',
    description: null,
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-09T10:00:00.000Z',
    updated_at: '2026-04-09T10:00:00.000Z',
    display_order: 1,
    subject_category: 'Hiker',
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
  },
  {
    id: 'marker-2',
    mission_id: 'mission-1',
    type: 'hazard',
    name: 'Cliff edge',
    description: null,
    lat: 52.0603,
    lon: -9.5039,
    irish_grid_e: 496623,
    irish_grid_n: 591301,
    created_at: '2026-04-09T10:00:00.000Z',
    updated_at: '2026-04-09T10:00:00.000Z',
    display_order: 2,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: 'Cliff/Drop-off',
    severity: 'High',
    condition: null,
    treatment: null,
    evacuation_priority: null,
  },
]

describe('marker geojson', () => {
  it('creates overlay features with icon and label metadata', () => {
    const collection = createMarkerFeatureCollection(MARKERS)

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]?.properties).toMatchObject({
      markerId: 'marker-1',
      iconId: 'marker-ipp_lkp',
      labelColor: '#0066FF',
      name: 'IPP',
    })
    expect(collection.features[1]?.properties).toMatchObject({
      markerId: 'marker-2',
      iconId: 'marker-hazard',
      labelColor: '#8B0000',
      name: 'Cliff edge',
    })
  })
})
