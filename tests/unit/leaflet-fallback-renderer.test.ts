import L from 'leaflet'
import { describe, expect, it, vi } from 'vitest'

import {
  createLeafletBasemapLayer,
  renderLeafletFallbackOverlays,
} from '../../src/features/map/leaflet-fallback-renderer'
import type { Drawing, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { getMarkerImageSvg } from '../../src/features/markers/sync-marker-overlay'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import type { ExactBreadcrumbDotState } from '../../src/features/tracking/exact-breadcrumb-dot-controller'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

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
      hiddenBreadcrumbDeviceIds: [],
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

  it('applies configured breadcrumb colour and size to fallback breadcrumb lines', () => {
    const group = L.layerGroup()

    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: true,
      breadcrumbsVisible: true,
      hiddenDeviceIds: [],
      hiddenBreadcrumbDeviceIds: [],
      trackingStyle: {
        deviceColors: { alpha: '#F97316' },
        breadcrumbSize: 7,
        breadcrumbTrailMode: 'line',
      },
      markers: [],
      markerTypeVisibility: {
        ipp_lkp: true,
        clue: true,
        hazard: true,
        casualty: true,
      },
      hiddenMarkerIds: [],
      drawings: [],
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

    const breadcrumbLine = group.getLayers().find((layer) => layer instanceof L.Polyline)
    expect(breadcrumbLine).toBeDefined()
    expect((breadcrumbLine as L.Polyline).options.color).toBe('#F97316')
    expect((breadcrumbLine as L.Polyline).options.weight).toBe(7)
  })

  it('renders only the authoritative exact page as dots in the Leaflet fallback', () => {
    const group = L.layerGroup()
    const exactPosition = {
      ...createTrackingSnapshot().breadcrumbs[0]!,
      id: 'exact-1',
      lat: 53.1234567,
      lon: -8.7654321,
    }

    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: true,
      breadcrumbsVisible: true,
      hiddenDeviceIds: [],
      hiddenBreadcrumbDeviceIds: [],
      trackingStyle: {
        deviceColors: {},
        breadcrumbSize: 8,
        breadcrumbTrailMode: 'dots',
      },
      exactBreadcrumbDotState: {
        status: 'ready',
        missionId: 'mission-1',
        positions: [exactPosition],
        totalPositionCount: 1,
        pagePositionCount: 1,
        fromTimestamp: exactPosition.timestamp,
        toTimestamp: exactPosition.timestamp,
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null,
      },
      markers: [],
      markerTypeVisibility: {
        ipp_lkp: true,
        clue: true,
        hazard: true,
        casualty: true,
      },
      hiddenMarkerIds: [],
      drawings: [],
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

    const renderedCoordinates = group.getLayers()
      .filter((layer): layer is L.CircleMarker => layer instanceof L.CircleMarker)
      .map((layer) => [layer.getLatLng().lat, layer.getLatLng().lng])
    expect(renderedCoordinates).toContainEqual([53.1234567, -8.7654321])
    expect(renderedCoordinates).not.toContainEqual([52, -9.7])
  })

  it.each(['newest page', 'earlier page', 'loading', 'unavailable'] as const)(
    'draws the whole-trail line under exact dots for one device past 10,000 fixes (%s) [DON-338]',
    (scenario) => {
      const fixes = createLongTrail(12_000)
      const accumulator = createBreadcrumbAccumulator()
      accumulator.ingest(fixes)
      const trail = accumulator.compact()
      const snapshot: TrackingSnapshot = {
        devices: [],
        positions: [],
        breadcrumbs: trail.positions,
        breadcrumbMetadata: trail.metadata,
      }
      const page = scenario === 'newest page'
        ? fixes.slice(-10_000)
        : scenario === 'earlier page'
          ? fixes.slice(0, 2_000)
          : []
      const state: ExactBreadcrumbDotState = scenario === 'loading'
        ? { status: 'loading', missionId: 'mission-1' }
        : scenario === 'unavailable'
          ? { status: 'unavailable', missionId: 'mission-1', message: 'Exact breadcrumb dots are unavailable.' }
          : {
              status: 'ready',
              missionId: 'mission-1',
              positions: page,
              totalPositionCount: fixes.length,
              pagePositionCount: page.length,
              fromTimestamp: page[0]!.timestamp,
              toTimestamp: page.at(-1)!.timestamp,
              hasEarlier: scenario === 'newest page',
              hasLater: scenario === 'earlier page',
              earlierCursor: scenario === 'newest page' ? 'earlier' : null,
              laterCursor: scenario === 'earlier page' ? 'later' : null,
            }
      const group = L.layerGroup()

      renderLeafletFallbackOverlays(group, {
        ...createEmptyOverlayInput(),
        trackingSnapshot: snapshot,
        trackingStyle: { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'dots' },
        exactBreadcrumbDotState: state,
      })

      const lineSpans = group.getLayers()
        .filter((layer): layer is L.Polyline => layer instanceof L.Polyline && !(layer instanceof L.Polygon))
        .map((line) => {
          const latitudes = (line.getLatLngs() as L.LatLng[]).map((point) => point.lat)
          return { south: Math.min(...latitudes), north: Math.max(...latitudes) }
        })
      const notOnLine = fixes.filter((fix) => !lineSpans.some((span) =>
        fix.lat >= span.south - LONG_TRAIL_LAT_STEP / 4 &&
        fix.lat <= span.north + LONG_TRAIL_LAT_STEP / 4)).length
      expect(notOnLine, `fixes not on the drawn whole-trail line (${scenario})`).toBe(0)

      const dotLatitudes = group.getLayers()
        .filter((layer): layer is L.CircleMarker => layer instanceof L.CircleMarker)
        .map((dot) => dot.getLatLng().lat)
      expect(dotLatitudes).toEqual(page.map((fix) => fix.lat))
    },
    30_000,
  )

  it('hides the whole-trail line and the dots of a hidden trail in dots mode', () => {
    const fixes = createLongTrail(20)
    const group = L.layerGroup()

    renderLeafletFallbackOverlays(group, {
      ...createEmptyOverlayInput(),
      trackingSnapshot: { devices: [], positions: [], breadcrumbs: fixes },
      hiddenBreadcrumbDeviceIds: ['long-trail-device'],
      trackingStyle: { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'dots' },
      exactBreadcrumbDotState: {
        status: 'ready',
        missionId: 'mission-1',
        positions: fixes,
        totalPositionCount: fixes.length,
        pagePositionCount: fixes.length,
        fromTimestamp: fixes[0]!.timestamp,
        toTimestamp: fixes.at(-1)!.timestamp,
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null,
      },
    })

    expect(group.getLayers()).toHaveLength(0)
  })

  it('draws the casualty with the same white-disc red-star symbol as MapLibre [DON-368]', () => {
    const group = L.layerGroup()
    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: false,
      breadcrumbsVisible: false,
      hiddenDeviceIds: [],
      hiddenBreadcrumbDeviceIds: [],
      markers: [{ ...createMarker(), id: 'casualty-1', type: 'casualty', name: 'Walker' }],
      markerTypeVisibility: { ipp_lkp: true, clue: true, hazard: true, casualty: true },
      hiddenMarkerIds: [],
      drawings: [],
      drawingTypeVisibility: {
        line: true, search_area: true, range_ring: true, bearing_line: true, search_sector: true, text_label: true,
      },
      hiddenDrawingIds: [],
      selectedDrawingId: null,
    })

    const casualty = group.getLayers().filter((layer): layer is L.Marker => layer instanceof L.Marker)
    expect(casualty).toHaveLength(1)
    const icon = casualty[0].options.icon as L.DivIcon
    expect(icon.options.html).toBe(getMarkerImageSvg('casualty'))
    expect(icon.options.iconSize).toEqual([60, 60])
    expect(casualty[0].getTooltip()?.getContent()).toBe('Walker')
    expect(group.getLayers().some((layer) => layer instanceof L.CircleMarker)).toBe(false)
  })

  it('honours hidden device, marker, and drawing visibility inputs', () => {
    const group = L.layerGroup()
    const addLayer = vi.spyOn(group, 'addLayer')

    renderLeafletFallbackOverlays(group, {
      trackingSnapshot: createTrackingSnapshot(),
      trackingVisible: true,
      breadcrumbsVisible: true,
      hiddenDeviceIds: ['alpha'],
      hiddenBreadcrumbDeviceIds: ['alpha'],
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

const LONG_TRAIL_LAT_STEP = 0.00001

/** One searcher walking due north, a fix every 3 s, no gap and no stop. */
function createLongTrail(count: number): NormalizedTrackingPosition[] {
  const startMs = Date.parse('2026-11-07T08:00:00.000Z')
  return Array.from({ length: count }, (_, index) => ({
    id: `long-fix-${index}`,
    device_id: 'long-trail-device',
    lat: 53.2 + index * LONG_TRAIL_LAT_STEP,
    lon: -6.3,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(startMs + (index + 1) * 3_000).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }))
}

/** Overlay input with tracking visible and every other layer empty. */
function createEmptyOverlayInput(): Parameters<typeof renderLeafletFallbackOverlays>[1] {
  return {
    trackingSnapshot: { devices: [], positions: [], breadcrumbs: [] },
    trackingVisible: true,
    breadcrumbsVisible: true,
    hiddenDeviceIds: [],
    hiddenBreadcrumbDeviceIds: [],
    markers: [],
    markerTypeVisibility: { ipp_lkp: true, clue: true, hazard: true, casualty: true },
    hiddenMarkerIds: [],
    drawings: [],
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
  }
}
