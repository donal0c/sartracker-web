import L from 'leaflet'
import { describe, expect, it } from 'vitest'

import { renderLeafletFallbackOverlays } from '../../src/features/map/leaflet-fallback-renderer'
import { syncTrackingOverlay } from '../../src/features/tracking/sync-tracking-overlay'
import {
  createBreadcrumbFeatureCollection,
  createTrackingFeatureCollection,
  DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
} from '../../src/features/tracking/tracking-geojson'
import type { BreadcrumbTrailMode } from '../../src/features/tracking/tracking-style-store'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'
import {
  createDrawingRecorderMap,
  readDrawnFeaturesAtEveryOperatorZoom,
  TRAIL_DRAWING_LAYER_IDS,
  type DrawingRecorderMap,
  type RecordedFeature,
} from '../support/maplibre-drawn-features'

/**
 * LIV-5 [DON-338]: a lone fix (a one-point trail segment between two silences
 * of more than 30 minutes, or a device's only fix) must still be drawn on the
 * live trail, on the WebGL map and on the Leaflet fallback, in both trail
 * modes. It is drawn as its own trail point, never as a current-position
 * marker and never with a label.
 */

const START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const SILENCE_MS = 31 * 60_000
const LONE_FIX_KIND = 'breadcrumbLoneFix'
const LONE_FIX_LAYER_ID = 'tracking-breadcrumbs-lone-fix'

/** Builds one fix in the shape the live accumulator publishes. */
function fix(deviceId: string, id: string, timestampMs: number, lat: number, lon = -6.3): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
    lat,
    lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(timestampMs).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

/**
 * Searcher: five fixes, a 31-minute silence, one lone fix, a 31-minute
 * silence, five fixes. Solo: a device with exactly one fix. Still: two fixes
 * at the identical spot between silences (a zero-length line).
 */
function createRoute(): readonly NormalizedTrackingPosition[] {
  const searcher: NormalizedTrackingPosition[] = []
  let timestampMs = START_MS
  let lat = 53.2
  for (let index = 0; index < 5; index += 1) {
    searcher.push(fix('searcher', `a-${index}`, timestampMs, lat))
    timestampMs += 10_000
    lat += 0.0001
  }
  timestampMs += SILENCE_MS
  lat += 0.001
  searcher.push(fix('searcher', 'lone', timestampMs, lat))
  timestampMs += SILENCE_MS
  lat += 0.001
  for (let index = 0; index < 5; index += 1) {
    searcher.push(fix('searcher', `b-${index}`, timestampMs, lat))
    timestampMs += 10_000
    lat += 0.0001
  }
  return [
    ...searcher,
    fix('solo', 'solo-only', START_MS + 5_000, 53.5, -6.1),
    fix('still', 'still-1', START_MS + 5_000, 53.6, -6.0),
    fix('still', 'still-2', START_MS + 15_000, 53.6, -6.0),
  ]
}

function createSnapshot(breadcrumbs: readonly NormalizedTrackingPosition[]): TrackingSnapshot {
  return { devices: [], positions: [], breadcrumbs }
}

const createRecordingMap = createDrawingRecorderMap

/**
 * Returns fixes of the route that no visible trail layer draws: a trail layer
 * must exist, be visible and have a filter that accepts the feature.
 */
function findFixesNotDrawnOnWebGlMap(
  map: DrawingRecorderMap,
  fixes: readonly NormalizedTrackingPosition[],
): readonly string[] {
  const key = (lon: number, lat: number) => `${lon.toFixed(7)}:${lat.toFixed(7)}`
  const drawn = new Set<string>()
  for (const { feature } of readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: TRAIL_DRAWING_LAYER_IDS })) {
    if (feature.geometry.type === 'LineString') {
      for (const [lon, lat] of feature.geometry.coordinates as readonly (readonly [number, number])[]) {
        drawn.add(key(lon, lat))
      }
    } else if (feature.geometry.type === 'Point') {
      const [lon, lat] = feature.geometry.coordinates as readonly [number, number]
      drawn.add(key(lon, lat))
    }
  }
  return fixes.filter((position) => !drawn.has(key(position.lon, position.lat))).map((position) => position.id)
}

/** The sorted full-rebuild description of a snapshot, for comparison with incremental state. */
function describeFullBuild(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  style: { readonly deviceColors: Record<string, string>; readonly breadcrumbSize: number; readonly breadcrumbTrailMode: BreadcrumbTrailMode },
): readonly string[] {
  const fullBuild = createTrackingFeatureCollection(
    createSnapshot(breadcrumbs),
    DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
    style,
  )
  return describeSource(fullBuild.features as unknown as RecordedFeature[])
}

/** Sorted (id, kind, geometry) triples for comparing incremental and full builds. */
function describeSource(features: readonly RecordedFeature[]): readonly string[] {
  return features
    .map((feature) => JSON.stringify([feature.id, feature.properties.featureKind, feature.geometry]))
    .sort()
}

describe('[DON-338] LIV-5 lone fixes stay on the live trail', () => {
  it('emits every lone fix and zero-length segment from the GeoJSON builder as a lone-fix point', () => {
    const route = createRoute()
    const collection = createBreadcrumbFeatureCollection(
      createSnapshot(route),
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      { deviceColors: { searcher: '#F97316' } },
    )
    const lonePoints = collection.features.filter(
      (feature) => feature.properties.featureKind === LONE_FIX_KIND,
    )

    expect(lonePoints.map((feature) => [feature.properties.deviceId, feature.geometry.coordinates]).sort())
      .toEqual([
        ['searcher', [route[5]!.lon, route[5]!.lat]],
        ['solo', [-6.1, 53.5]],
        ['still', [-6.0, 53.6]],
      ].sort())
    for (const point of lonePoints) {
      expect(point.geometry.type).toBe('Point')
      expect(typeof point.id).toBe('string')
      expect(point.properties).not.toHaveProperty('name')
    }
    expect(lonePoints.find((point) => point.properties.deviceId === 'searcher')?.properties.color)
      .toBe('#F97316')
    expect(
      collection.features.filter((feature) => feature.properties.featureKind === 'breadcrumbLine'),
    ).toHaveLength(2)
  })

  it.each<BreadcrumbTrailMode>(['line', 'dots'])(
    'draws every stored fix on the WebGL map in %s mode, without a label or current-position styling',
    (mode) => {
      const route = createRoute()
      const map = createRecordingMap()

      syncTrackingOverlay(map as never, createSnapshot(route), [], [], true, {
        deviceColors: {},
        breadcrumbSize: 8,
        breadcrumbTrailMode: mode,
      })

      expect(findFixesNotDrawnOnWebGlMap(map, route)).toEqual([])
      const loneLayer = map.layers.get(LONE_FIX_LAYER_ID)
      expect(loneLayer?.type).toBe('circle')
      expect(loneLayer?.paint?.['circle-color']).toEqual(['get', 'color'])
      expect(loneLayer?.layout?.['text-field']).toBeUndefined()
      for (const markerLayerId of [
        'tracking-devices-circle',
        'tracking-devices-halo',
        'tracking-devices-attention',
        'tracking-devices-label',
      ]) {
        expect(JSON.stringify(map.layers.get(markerLayerId)?.filter)).not.toContain(LONE_FIX_KIND)
      }
      const layerOrder = map.layerOrder
      expect(layerOrder.indexOf(LONE_FIX_LAYER_ID)).toBeLessThan(
        layerOrder.indexOf('tracking-devices-circle'),
      )
    },
  )

  it('applies trail visibility and hidden-device filters to lone fixes exactly as to the line', () => {
    const route = createRoute()
    const drawnDevices = (map: DrawingRecorderMap, layerId: string) =>
      [...new Set(readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: [layerId] })
        .map(({ feature }) => feature.properties.deviceId))].sort()

    const shownMap = createRecordingMap()
    syncTrackingOverlay(shownMap as never, createSnapshot(route), [], [], true)
    expect(drawnDevices(shownMap, LONE_FIX_LAYER_ID)).toEqual(['searcher', 'solo', 'still'])
    expect(findFixesNotDrawnOnWebGlMap(shownMap, route)).toEqual([])

    const hiddenMap = createRecordingMap()
    syncTrackingOverlay(hiddenMap as never, createSnapshot(route), [], ['searcher'], true)
    expect(drawnDevices(hiddenMap, LONE_FIX_LAYER_ID)).toEqual(['solo', 'still'])
    expect(drawnDevices(hiddenMap, 'tracking-breadcrumbs-line')).toEqual([])

    const offMap = createRecordingMap()
    syncTrackingOverlay(offMap as never, createSnapshot(route), [], [], false)
    expect(readDrawnFeaturesAtEveryOperatorZoom(offMap, { layerIds: TRAIL_DRAWING_LAYER_IDS })).toEqual([])
  })

  it('keeps lone fixes correct through incremental source diffs as fixes arrive', () => {
    const route = createRoute()
    const searcherFixes = route.filter((position) => position.device_id === 'searcher')
    const others = route.filter((position) => position.device_id !== 'searcher')
    const style = { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'line' as const }
    const steps: (readonly NormalizedTrackingPosition[])[] = [
      [...others, ...searcherFixes.slice(0, 5)],
      // The lone fix arrives after the first silence.
      [...others, ...searcherFixes.slice(0, 6)],
      // A second fix 10 s later turns the lone fix into a line.
      [
        ...others,
        ...searcherFixes.slice(0, 6),
        fix('searcher', 'lone-follow', Date.parse(searcherFixes[5]!.timestamp) + 10_000, searcherFixes[5]!.lat + 0.0001),
      ],
    ]
    const withoutFollow: readonly NormalizedTrackingPosition[] = [...others, ...searcherFixes]

    // Second run starts with the lone fix already in the first full build, so
    // removing it later depends on the source state recording lone-fix IDs.
    for (const sequence of [[...steps, withoutFollow], [...steps.slice(1), withoutFollow]]) {
      const map = createRecordingMap()
      for (const breadcrumbs of sequence) {
        syncTrackingOverlay(map as never, createSnapshot(breadcrumbs), [], [], true, style)
        const fullBuild = createTrackingFeatureCollection(
          createSnapshot(breadcrumbs),
          DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
          style,
        )
        expect(describeSource(map.sourceData.get('tracking') ?? []))
          .toEqual(describeSource(fullBuild.features as unknown as RecordedFeature[]))
        expect(findFixesNotDrawnOnWebGlMap(map, breadcrumbs)).toEqual([])
      }
      expect(map.incrementalUpdates).toBeGreaterThan(0)
    }
  })

  it('keeps lone fixes correct when an earlier segment arrives late and segment indexes shift', () => {
    const route = createRoute()
    const style = { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'line' as const }
    // A fix recorded 40 minutes before the searcher's first fix, delivered late:
    // it becomes the device's first segment, so every later segment index shifts.
    const lateEarly = fix('searcher', 'late-early', START_MS - 40 * 60_000, 53.19)
    // A late fix 40 minutes after the still device's last fix: a new lone segment at the end.
    const lateStill = fix('still', 'late-still', START_MS + 15_000 + 40 * 60_000, 53.61, -6.0)
    const sequences: (readonly (readonly NormalizedTrackingPosition[])[])[] = [
      [route, [...route, lateEarly]],
      [route, [lateEarly, ...route]],
      [route, [...route, lateEarly], [...route, lateEarly, lateStill]],
      [route, [...route, lateEarly], route],
    ]
    for (const sequence of sequences) {
      const map = createRecordingMap()
      for (const breadcrumbs of sequence) {
        syncTrackingOverlay(map as never, createSnapshot(breadcrumbs), [], [], true, style)
        expect(describeSource(map.sourceData.get('tracking') ?? []))
          .toEqual(describeFullBuild(breadcrumbs, style))
        expect(findFixesNotDrawnOnWebGlMap(map, breadcrumbs)).toEqual([])
      }
      expect(map.incrementalUpdates, 'the late segment must go through the incremental diff').toBeGreaterThan(0)
    }
  })

  it('removes a device\'s lone fixes when the device leaves the snapshot', () => {
    const route = createRoute()
    const style = { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'line' as const }
    const withoutSolo = route.filter((position) => position.device_id !== 'solo')
    const searcherOnly = route.filter((position) => position.device_id === 'searcher')
    const map = createRecordingMap()
    for (const breadcrumbs of [route, withoutSolo, searcherOnly, route]) {
      syncTrackingOverlay(map as never, createSnapshot(breadcrumbs), [], [], true, style)
      expect(describeSource(map.sourceData.get('tracking') ?? []))
        .toEqual(describeFullBuild(breadcrumbs, style))
      expect(findFixesNotDrawnOnWebGlMap(map, breadcrumbs)).toEqual([])
    }
    expect(map.incrementalUpdates, 'device removal must go through the incremental diff').toBeGreaterThan(0)
    expect(
      readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: [LONE_FIX_LAYER_ID] })
        .map(({ feature }) => feature.properties.deviceId)
        .sort(),
    ).toEqual(['searcher', 'solo', 'still'])
  })

  it.each<BreadcrumbTrailMode>(['line', 'dots'])(
    'draws every stored fix on the Leaflet fallback in %s mode, lone fixes without a label',
    (mode) => {
      const route = createRoute()
      const group = L.layerGroup()

      renderLeafletFallbackOverlays(group, {
        trackingSnapshot: createSnapshot(route),
        trackingVisible: true,
        breadcrumbsVisible: true,
        hiddenDeviceIds: ['searcher', 'solo', 'still'],
        hiddenBreadcrumbDeviceIds: [],
        trackingStyle: { deviceColors: { solo: '#22C55E' }, breadcrumbSize: 8, breadcrumbTrailMode: mode },
        exactBreadcrumbDotState: mode === 'dots' ? { status: 'loading', missionId: 'mission-1' } : undefined,
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
      })

      // Current-position markers are hidden, so every circle left is a trail point.
      const key = (lng: number, lat: number) => `${lng.toFixed(7)}:${lat.toFixed(7)}`
      const drawn = new Set<string>()
      for (const layer of group.getLayers()) {
        if (layer instanceof L.CircleMarker) {
          expect(layer.getTooltip()).toBeUndefined()
          drawn.add(key(layer.getLatLng().lng, layer.getLatLng().lat))
          continue
        }
        if (layer instanceof L.Polyline) {
          const points = (layer.getLatLngs() as L.LatLng[]).map((point) => key(point.lng, point.lat))
          if (new Set(points).size < 2) continue
          for (const point of points) drawn.add(point)
        }
      }
      expect(route.filter((position) => !drawn.has(key(position.lon, position.lat))).map((position) => position.id))
        .toEqual([])
      const soloPoint = group.getLayers().find(
        (layer): layer is L.CircleMarker =>
          layer instanceof L.CircleMarker && layer.getLatLng().lat === 53.5,
      )
      expect(soloPoint?.options.fillColor).toBe('#22C55E')
    },
  )
})
