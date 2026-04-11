import { describe, expect, it } from 'vitest'

import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import type {
  Device,
  Drawing,
  GpxTrackImport,
  Helicopter,
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
      helicopters: [createHelicopter('heli-1', 'slot_1', 'Rescue 118')],
      gpxImports: [],
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

    const helicopterLayer = root.children
      .flatMap((group) => group.children)
      .find((layer) => layer.id === 'layer:helicopters:slot-1')
    expect(helicopterLayer?.children[0]).toMatchObject({
      displayLabel: 'Rescue 118',
      entity: {
        type: 'helicopter',
      },
    })
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
      helicopters: [],
      gpxImports: [],
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

  it('creates one dynamic GPX layer per imported file under the GPX group', () => {
    const root = buildLayerCatalogTree({
      missionId: 'mission-1',
      devices: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [
        createGpxImport('gpx-2', 'Bravo Route', 2),
        createGpxImport('gpx-1', 'Alpha Route', 1),
      ],
      metadataEntries: [],
    })

    const gpxGroup = root.children.find((group) => group.id === 'group:gpx-tracks')
    expect(gpxGroup?.children.map((layer) => layer.displayLabel)).toEqual([
      'Alpha Route',
      'Bravo Route',
    ])
    expect(gpxGroup?.children[0]?.children[0]).toMatchObject({
      displayLabel: 'Alpha Route',
      entity: {
        type: 'gpx_import',
      },
    })
  })

  it('assigns helicopters to their canonical slot layers even when a slot is empty', () => {
    const root = buildLayerCatalogTree({
      missionId: 'mission-1',
      devices: [],
      markers: [],
      drawings: [],
      helicopters: [createHelicopter('heli-2', 'slot_3', 'Air Corps 1')],
      gpxImports: [],
      metadataEntries: [],
    })

    const helicopterGroup = root.children.find((group) => group.id === 'group:helicopters')
    expect(helicopterGroup?.children.map((layer) => [layer.id, layer.children.length])).toEqual([
      ['layer:helicopters:slot-1', 0],
      ['layer:helicopters:slot-2', 0],
      ['layer:helicopters:slot-3', 1],
      ['layer:helicopters:slot-4', 0],
    ])
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

function createGpxImport(id: string, displayName: string, order: number): GpxTrackImport {
  return {
    id,
    mission_id: 'mission-1',
    source_path: `/tracks/${displayName.toLowerCase().replace(/\s+/g, '-')}.gpx`,
    file_name: `${displayName.toLowerCase().replace(/\s+/g, '-')}.gpx`,
    display_name: displayName,
    geometry_json: '{"type":"MultiLineString","coordinates":[]}',
    metadata_json: JSON.stringify({ displayOrder: order }),
    imported_at: '2026-04-11T10:00:00.000Z',
    updated_at: '2026-04-11T10:00:00.000Z',
  }
}

function createHelicopter(
  id: string,
  slotKey: Helicopter['slot_key'],
  callSign: string,
): Helicopter {
  return {
    id,
    mission_id: 'mission-1',
    slot_key: slotKey,
    call_sign: callSign,
    hex_id: '4CA123',
    lat: 52.05,
    lon: -9.51,
    altitude: 1200,
    speed: 95,
    heading: 180,
    last_update: '2026-04-11T10:05:00.000Z',
    created_at: '2026-04-11T10:00:00.000Z',
    updated_at: '2026-04-11T10:05:00.000Z',
  }
}
