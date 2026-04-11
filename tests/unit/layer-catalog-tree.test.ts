import { describe, expect, it } from 'vitest'

import {
  filterCatalogTree,
  findCatalogNode,
  getDescendantNodeIds,
  getSiblingNodeIds,
} from '../../src/features/layers/layer-catalog-tree'
import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import type { Drawing, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type { NormalizedTrackingDevice } from '../../src/features/tracking/tracking-types'

describe('layer catalog tree helpers', () => {
  it('finds nodes and descendant ids from the built catalog tree', () => {
    const root = createRoot()

    expect(findCatalogNode(root, 'layer:markers:clues')?.displayLabel).toBe('Clues')
    expect(getDescendantNodeIds(findCatalogNode(root, 'group:map-tools')!)).toContain(
      'feature:marker:marker-1',
    )
  })

  it('filters the tree while preserving matching ancestors', () => {
    const root = createRoot()
    const filteredRoot = filterCatalogTree(root, 'Boot')

    expect(filteredRoot.children).toHaveLength(1)
    expect(filteredRoot.children[0]?.id).toBe('group:map-tools')
    expect(filteredRoot.children[0]?.children[0]?.id).toBe('layer:markers:clues')
  })

  it('returns sibling node ids in display order', () => {
    const root = createRoot()

    expect(getSiblingNodeIds(root, 'feature:device:alpha')).toEqual([
      'feature:device:alpha',
      'feature:device:bravo',
    ])
  })
})

function createRoot() {
  return buildLayerCatalogTree({
    missionId: 'mission-1',
    devices: [createDevice('alpha', 'Alpha Team'), createDevice('bravo', 'Bravo Team')],
    markers: [createMarker()],
    drawings: [createDrawing()],
    gpxImports: [],
    metadataEntries: [],
  })
}

function createDevice(deviceId: string, name: string): NormalizedTrackingDevice {
  return {
    device_id: deviceId,
    name,
    last_seen: '2026-04-10T10:00:00.000Z',
    status: 'online',
    unique_id: null,
    category: null,
  }
}

function createMarker(): Marker {
  return {
    id: 'marker-1',
    mission_id: 'mission-1',
    type: 'clue',
    name: 'Boot Print',
    description: null,
    lat: 52,
    lon: -9.7,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
    display_order: 1,
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

function createDrawing(): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'search_area',
    name: 'Sector Alpha',
    description: null,
    color: null,
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: null,
    display_order: 1,
    geometry_json: '{}',
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}
