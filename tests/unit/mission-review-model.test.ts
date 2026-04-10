import { describe, expect, it } from 'vitest'

import type {
  Device,
  Drawing,
  Marker,
  Mission,
  MissionEvent,
  MissionStoreInfo,
  Position,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import {
  buildMissionReviewSnapshot,
  filterMissionReviewMarkers,
} from '../../src/features/mission-review/mission-review-model'

describe('mission review model', () => {
  it('builds summary counts and readable audit rows', () => {
    const snapshot = buildMissionReviewSnapshot({
      mission: createMission(),
      info: createStoreInfo(),
      events: [
        createEvent('mission_created', {
          name: 'Review Mission',
        }),
        createEvent('marker_created', {
          marker_id: 'marker-1',
          marker_type: 'clue',
          name: 'Boot Print',
          updated_by: 'Ops Lead',
        }),
      ],
      markers: [createMarker()],
      devices: [createDevice()],
      positions: [createPosition()],
      drawings: [createDrawing()],
      layerMetadata: [] satisfies readonly LayerCatalogMetadataEntry[],
    })

    expect(snapshot.summary.layerCount).toBeGreaterThan(0)
    expect(snapshot.summary.featureCount).toBe(3)
    expect(snapshot.summary.markerCount).toBe(1)
    expect(snapshot.summary.drawingCount).toBe(1)
    expect(snapshot.summary.trackingDeviceCount).toBe(1)
    expect(snapshot.summary.breadcrumbCount).toBe(1)
    expect(snapshot.eventRows[0]?.title).toBe('Mission Created')
    expect(snapshot.eventRows[1]?.description).toContain('Boot Print')
    expect(snapshot.eventRows[1]?.description).toContain('Ops Lead')
    expect(snapshot.markerRows[0]?.detailRows.some((row) => row.label === 'Clue Type')).toBe(
      true,
    )
    expect(snapshot.markerRows[0]?.detailRows.some((row) => row.label === 'Updated By')).toBe(
      true,
    )
    expect(snapshot.markerRows[0]?.historyRows).toHaveLength(1)
  })

  it('filters marker rows by query and type', () => {
    const markerRows = buildMissionReviewSnapshot({
      mission: createMission(),
      info: createStoreInfo(),
      events: [],
      markers: [
        createMarker(),
        {
          ...createMarker(),
          id: 'marker-2',
          type: 'hazard',
          name: 'Loose Scree',
          description: 'Steep unstable slope',
          updated_by: null,
          coordinator_ids: null,
          attachment_path: null,
          hazard_type: 'terrain',
          clue_type: null,
        },
      ],
      devices: [],
      positions: [],
      drawings: [],
      layerMetadata: [],
    }).markerRows

    expect(filterMissionReviewMarkers(markerRows, { query: 'boot', type: 'all' })).toHaveLength(1)
    expect(filterMissionReviewMarkers(markerRows, { query: '', type: 'hazard' })).toHaveLength(1)
    expect(filterMissionReviewMarkers(markerRows, { query: 'terrain', type: 'hazard' })).toHaveLength(1)
  })
})

function createMission(): Mission {
  return {
    id: 'mission-1',
    name: 'Review Mission',
    status: 'finished',
    start_time: '2026-04-10T08:00:00.000Z',
    pause_time: null,
    finish_time: '2026-04-10T12:00:00.000Z',
    paused_seconds: 300,
    notes: 'Search completed successfully.',
    schema_version: 1,
  }
}

function createStoreInfo(): MissionStoreInfo {
  return {
    schema_version: 1,
    database_path: '/tmp/mission-store.sqlite',
    backup_path: '/tmp/mission-store.backup.sqlite',
  }
}

function createEvent(eventType: string, details: Record<string, unknown>): MissionEvent {
  return {
    id: `event-${eventType}`,
    mission_id: 'mission-1',
    event_type: eventType,
    timestamp: '2026-04-10T09:00:00.000Z',
    details_json: JSON.stringify(details),
  }
}

function createMarker(): Marker {
  return {
    id: 'marker-1',
    mission_id: 'mission-1',
    type: 'clue',
    name: 'Boot Print',
    description: 'Distinct tread pattern',
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-10T09:15:00.000Z',
    updated_at: '2026-04-10T09:20:00.000Z',
    display_order: 1,
    subject_category: 'Walker',
    clue_type: 'footwear',
    confidence: 0.8,
    found_by: 'Team Alpha',
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: 'Ops Lead',
    coordinator_ids: 'Coord 1, Coord 2',
    attachment_path: '/tmp/missions/mission-1/attachments/boot-print.jpg',
  }
}

function createDevice(): Device {
  return {
    id: 'device-1',
    mission_id: 'mission-1',
    device_id: 'alpha',
    name: 'Alpha Team',
    color: '#38bdf8',
    last_seen: '2026-04-10T10:00:00.000Z',
    status: 'online',
  }
}

function createPosition(): Position {
  return {
    id: 'position-1',
    mission_id: 'mission-1',
    device_id: 'alpha',
    name: 'Alpha Team',
    lat: 52.0599,
    lon: -9.5045,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    source: 'traccar',
    timestamp: '2026-04-10T10:00:00.000Z',
    data_origin: 'live',
  }
}

function createDrawing(): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'line',
    name: 'Track Line',
    description: null,
    color: '#38bdf8',
    width: 2,
    distance_m: 1200,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: '{"type":"LineString","coordinates":[[-9.5,52.0],[-9.4,52.1]]}',
    metadata_json: null,
    created_at: '2026-04-10T09:30:00.000Z',
    updated_at: '2026-04-10T09:35:00.000Z',
  }
}
