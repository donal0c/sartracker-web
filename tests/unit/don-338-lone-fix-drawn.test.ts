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

type RecordedFeature = {
  readonly id?: string | number
  readonly geometry: { readonly type: string; readonly coordinates: unknown }
  readonly properties: { readonly featureKind?: string; readonly deviceId?: string; readonly color?: string }
}

type RecordedLayer = {
  readonly id: string
  readonly type: string
  readonly source: string
  filter?: unknown
  readonly layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

/** Records MapLibre sources and layers, applying incremental diffs by feature ID. */
function createRecordingMap() {
  const layers = new Map<string, RecordedLayer>()
  const sourceData = new Map<string, RecordedFeature[]>()
  let incrementalUpdates = 0
  const handles = new Map<string, unknown>()
  return {
    layers,
    sourceData,
    get incrementalUpdates() {
      return incrementalUpdates
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    // A stable handle per source, as MapLibre returns, so incremental diffs are used.
    getSource: (id: string) => {
      if (!sourceData.has(id)) return undefined
      const existing = handles.get(id)
      if (existing !== undefined) return existing
      const handle = {
            setData: (data: { features: RecordedFeature[] }) => {
              sourceData.set(id, [...data.features])
            },
            updateData: (diff: { remove?: (string | number)[]; add?: RecordedFeature[] }) => {
              incrementalUpdates += 1
              const removed = new Set(diff.remove ?? [])
              const current = (sourceData.get(id) ?? []).filter(
                (feature) => feature.id === undefined || !removed.has(feature.id),
              )
              for (const feature of diff.add ?? []) {
                if (current.some((existing) => existing.id === feature.id)) {
                  throw new Error(`Duplicate feature id added: ${String(feature.id)}`)
                }
                current.push(feature)
              }
              sourceData.set(id, current)
            },
          }
      handles.set(id, handle)
      return handle
    },
    addLayer: (spec: RecordedLayer) => {
      layers.set(spec.id, spec)
    },
    addSource: (id: string, config: { data: { features: RecordedFeature[] } }) => {
      sourceData.set(id, [...config.data.features])
    },
    getFilter: (id: string) => layers.get(id)?.filter,
    getPaintProperty: (id: string, property: string) => layers.get(id)?.paint?.[property],
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.filter = filter
    },
    setPaintProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.paint = { ...(layer.paint ?? {}), [property]: value }
    },
  }
}

/** Returns fixes of the route that no visible trail geometry on the tracking source draws. */
function findFixesNotDrawnOnWebGlMap(
  map: ReturnType<typeof createRecordingMap>,
  fixes: readonly NormalizedTrackingPosition[],
): readonly string[] {
  const features = map.sourceData.get('tracking') ?? []
  const lineLayer = map.layers.get('tracking-breadcrumbs-line')
  const loneLayer = map.layers.get(LONE_FIX_LAYER_ID)
  const lineVisible = lineLayer !== undefined && !JSON.stringify(lineLayer.filter).includes('__hidden__')
  const loneVisible = loneLayer !== undefined &&
    loneLayer.source === 'tracking' &&
    JSON.stringify(loneLayer.filter).includes(LONE_FIX_KIND) &&
    !JSON.stringify(loneLayer.filter).includes('__hidden__')
  const key = (lon: number, lat: number) => `${lon.toFixed(7)}:${lat.toFixed(7)}`
  const drawn = new Set<string>()
  for (const feature of features) {
    if (
      lineVisible &&
      feature.properties.featureKind === 'breadcrumbLine' &&
      feature.geometry.type === 'LineString'
    ) {
      const coordinates = feature.geometry.coordinates as readonly (readonly [number, number])[]
      const distinct = new Set(coordinates.map(([lon, lat]) => key(lon, lat)))
      // MapLibre draws nothing for a zero-length line.
      if (distinct.size < 2) continue
      for (const entry of distinct) drawn.add(entry)
    }
    if (
      loneVisible &&
      feature.properties.featureKind === LONE_FIX_KIND &&
      feature.geometry.type === 'Point'
    ) {
      const [lon, lat] = feature.geometry.coordinates as readonly [number, number]
      drawn.add(key(lon, lat))
    }
  }
  return fixes.filter((position) => !drawn.has(key(position.lon, position.lat))).map((position) => position.id)
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
      const layerOrder = [...map.layers.keys()]
      expect(layerOrder.indexOf(LONE_FIX_LAYER_ID)).toBeLessThan(
        layerOrder.indexOf('tracking-devices-circle'),
      )
    },
  )

  it('applies trail visibility and hidden-device filters to lone fixes exactly as to the line', () => {
    const route = createRoute()
    const hiddenMap = createRecordingMap()
    syncTrackingOverlay(hiddenMap as never, createSnapshot(route), [], ['searcher'], true)
    expect(JSON.stringify(hiddenMap.getFilter(LONE_FIX_LAYER_ID))).toContain('searcher')

    const offMap = createRecordingMap()
    syncTrackingOverlay(offMap as never, createSnapshot(route), [], [], false)
    expect(JSON.stringify(offMap.getFilter(LONE_FIX_LAYER_ID))).toContain('__hidden__')
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
