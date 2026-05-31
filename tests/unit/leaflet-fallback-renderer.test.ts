import L from 'leaflet'
import { describe, expect, it, vi } from 'vitest'

import {
  createLeafletBasemapLayer,
  renderLeafletFallbackOverlays,
} from '../../src/features/map/leaflet-fallback-renderer'
import type { Drawing, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('Leaflet fallback renderer', () => {
  it('uses the same locked raster basemap catalogue as MapLibre', () => {
    const layer = createLeafletBasemapLayer('esri_topo')
    Object.assign(layer, { _tileZoom: 12 })

    expect(layer.getTileUrl({ x: 345, y: 678, z: 12 })).toBe(
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/678/345',
    )
  })

  it('renders tracking, marker, and drawing features into a read-only layer group', () => {
    const group = L.layerGroup()
    const addLayer = vi.spyOn(group, 'addLayer')

    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: true,
      breadcrumbsVisible: true,
      hiddenDeviceIds: [],
      markers: [createMarker()],
      markerTypeVisibility: {
        ipp_lkp: true,
        clue: true,
        hazard: true,
        casualty: true,
      },
      hiddenMarkerIds: [],
      drawings: [createDrawing()],
      drawingTypeVisibility: {
        line: true,
        search_area: true,
        range_ring: true,
        bearing_line: true,
        search_sector: true,
        text_label: true,
      },
      hiddenDrawingIds: [],
      selectedDrawingId: null,
    })

    expect(addLayer.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(group.getLayers())).toHaveLength(addLayer.mock.calls.length)
  })

  it('honours hidden device, marker, and drawing visibility inputs', () => {
    const group = L.layerGroup()
    const addLayer = vi.spyOn(group, 'addLayer')

    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: true,
      breadcrumbsVisible: true,
      hiddenDeviceIds: ['alpha'],
      markers: [createMarker()],
      markerTypeVisibility: {
        ipp_lkp: false,
        clue: true,
        hazard: true,
        casualty: true,
      },
      hiddenMarkerIds: [],
      drawings: [createDrawing()],
      drawingTypeVisibility: {
        line: false,
        search_area: false,
        range_ring: false,
        bearing_line: false,
        search_sector: false,
        text_label: false,
      },
      hiddenDrawingIds: [],
      selectedDrawingId: null,
    })

    expect(addLayer).not.toHaveBeenCalled()
    expect(group.getLayers()).toHaveLength(0)
  })
})

function createTrackingSnapshot(): TrackingSnapshot {
  return {
    devices: [
      {
        id: 'device-alpha',
        mission_id: 'mission-1',
        device_id: 'alpha',
        name: 'Alpha Team',
        color: '#38BDF8',
        last_seen: '2026-05-31T10:00:00.000Z',
        status: 'online',
      },
    ],
    positions: [
      {
        id: 'position-alpha',
        mission_id: 'mission-1',
        device_id: 'alpha',
        name: 'Alpha Team',
        lat: 52.001,
        lon: -9.701,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        source: null,
        timestamp: '2026-05-31T10:00:00.000Z',
        data_origin: 'live',
        device_cache_stale: false,
      },
    ],
    breadcrumbs: [
      {
        id: 'breadcrumb-1',
        mission_id: 'mission-1',
        device_id: 'alpha',
        name: 'Alpha Team',
        lat: 52,
        lon: -9.7,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        source: null,
        timestamp: '2026-05-31T09:59:00.000Z',
        data_origin: 'live',
      },
      {
        id: 'breadcrumb-2',
        mission_id: 'mission-1',
        device_id: 'alpha',
        name: 'Alpha Team',
        lat: 52.001,
        lon: -9.701,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        source: null,
        timestamp: '2026-05-31T10:00:00.000Z',
        data_origin: 'live',
      },
    ],
  }
}

function createMarker(): Marker {
  return {
    id: 'marker-1',
    mission_id: 'mission-1',
    type: 'ipp_lkp',
    name: 'LKP',
    description: null,
    lat: 52.002,
    lon: -9.702,
    irish_grid_e: 490000,
    irish_grid_n: 590000,
    created_at: '2026-05-31T10:00:00.000Z',
    updated_at: '2026-05-31T10:00:00.000Z',
    display_order: 1,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
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
    color: '#F59E0B',
    width: 2,
    distance_m: null,
    temporary_measure: null,
    label: 'Sector Alpha',
    display_order: 1,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.71, 52], [-9.7, 52.01], [-9.69, 52], [-9.71, 52]]],
    }),
    metadata_json: JSON.stringify({
      kind: 'search_area',
      team: null,
      status: 'Planned',
      poaPercent: null,
      terrain: null,
      notes: null,
      areaSqM: 100,
    }),
    created_at: '2026-05-31T10:00:00.000Z',
    updated_at: '2026-05-31T10:00:00.000Z',
  }
}
