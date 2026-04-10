import { describe, expect, it } from 'vitest'

import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import type {
  Device,
  Drawing,
  Marker,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('layer catalog builder', () => {
  it('builds the canonical grouped tree with ordered feature items', () => {
    const root = buildLayerCatalogTree({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team')],
      markers: [
        createMarker('marker-2', 'Bravo Clue', 2),
        createMarker('marker-1', 'Alpha Clue', 1),
      ],
      drawings: [createDrawing('drawing-1', 'Sector Alpha', 1)],
      metadataEntries: [],
    })

    expect(root.children.map((group) => group.id)).toEqual([
      'group:tracking',
      'group:helicopters',
      'group:map-tools',
      'group:gpx-tracks',
    ])

    const clueLayer = root.children
      .flatMap((group) => group.children)
      .find((layer) => layer.id === 'layer:markers:clues')
    expect(clueLayer?.children.map((child) => child.displayLabel)).toEqual([
      'Alpha Clue',
      'Bravo Clue',
    ])
  })

  it('applies persisted aliases, visibility, and display order metadata', () => {
    const metadataEntries: readonly LayerCatalogMetadataEntry[] = [
      {
        missionId: 'mission-1',
        nodeId: 'group:map-tools',
        parentNodeId: 'root:mission-catalog',
        nodeKind: 'group',
        alias: 'Operational Tools',
        isFavorite: true,
        isVisible: true,
        displayOrder: 5,
        metadataJson: null,
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
      {
        missionId: 'mission-1',
        nodeId: 'feature:drawing:drawing-1',
        parentNodeId: 'layer:drawings:search-area',
        nodeKind: 'feature_item',
        alias: 'Sector Bravo',
        isFavorite: false,
        isVisible: false,
        displayOrder: 9,
        metadataJson: null,
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]

    const root = buildLayerCatalogTree({
      missionId: 'mission-1',
      devices: [],
      markers: [],
      drawings: [createDrawing('drawing-1', 'Sector Alpha', 1)],
      metadataEntries,
    })

    const mapToolsGroup = root.children.find((group) => group.id === 'group:map-tools')
    expect(mapToolsGroup).toMatchObject({
      displayLabel: 'Operational Tools',
      isFavorite: true,
      displayOrder: 5,
    })

    const searchAreaLayer = mapToolsGroup?.children.find(
      (layer) => layer.id === 'layer:drawings:search-area',
    )
    expect(searchAreaLayer?.children[0]).toMatchObject({
      displayLabel: 'Sector Bravo',
      isVisible: false,
      displayOrder: 9,
    })
  })
})

function createDevice(deviceId: string, name: string): Device {
  return {
    id: `device-${deviceId}`,
    mission_id: 'mission-1',
    device_id: deviceId,
    name,
    color: '#38bdf8',
    last_seen: '2026-04-10T10:00:00.000Z',
    status: 'online',
  }
}

function createMarker(id: string, name: string, displayOrder: number): Marker {
  return {
    id,
    mission_id: 'mission-1',
    type: 'clue',
    name,
    description: null,
    lat: 52,
    lon: -9.7,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
    display_order: displayOrder,
    subject_category: null,
    clue_type: 'Footprint',
    confidence: 0.5,
    found_by: 'Team 1',
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
  }
}

function createDrawing(id: string, name: string, displayOrder: number): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type: 'search_area',
    name,
    description: null,
    color: null,
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: null,
    display_order: displayOrder,
    geometry_json: '{}',
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}
