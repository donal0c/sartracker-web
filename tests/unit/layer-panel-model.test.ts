import { describe, expect, it } from 'vitest'

import {
  buildLayerInspectionRows,
  getLayerNodeCountLabel,
  toLayerTreeTestId,
} from '../../src/features/layers/layer-panel-model'
import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import { findCatalogNode } from '../../src/features/layers/layer-catalog-tree'
import type { NormalizedTrackingDevice } from '../../src/features/tracking/tracking-types'
import type { Drawing, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('layer panel model', () => {
  it('builds operator inspection rows for tracking, measurement, and feature nodes', () => {
    const root = createRoot()

    expect(buildLayerInspectionRows(findCatalogNode(root, 'layer:tracking:devices')!, {
      trackingDeviceCount: 2,
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toContainEqual({ label: 'Tracking Devices', value: '2' })

    expect(buildLayerInspectionRows(findCatalogNode(root, 'layer:map-tools:measurements')!, {
      trackingDeviceCount: 2,
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toContainEqual({ label: 'Active Measurements', value: '3' })

    expect(buildLayerInspectionRows(findCatalogNode(root, 'feature:marker:marker-1')!, {
      trackingDeviceCount: 2,
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toContainEqual({ label: 'Marker Type', value: 'clue' })
  })

  it('keeps row count labels stable for operator-visible layer totals', () => {
    const root = createRoot()

    expect(getLayerNodeCountLabel(findCatalogNode(root, 'group:tracking')!, {
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toBe('2')
    expect(getLayerNodeCountLabel(findCatalogNode(root, 'layer:tracking:breadcrumbs')!, {
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toBe('8')
    expect(getLayerNodeCountLabel(findCatalogNode(root, 'layer:map-tools:measurements')!, {
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toBe('3')
    expect(getLayerNodeCountLabel(findCatalogNode(root, 'feature:device:alpha')!, {
      trackingBreadcrumbCount: 8,
      measurementCount: 3,
    })).toBe('')
  })

  it('normalizes layer node ids into stable test ids', () => {
    expect(toLayerTreeTestId('layer:map-tools:measurements')).toBe('layer-map-tools-measurements')
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
