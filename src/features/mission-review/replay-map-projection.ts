import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { MissionReplayReadResult, MissionReplayTrackRecord } from '../../infrastructure/mission-store/tauri-mission-store'
import type { Drawing, Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import { createDrawingFeatureCollection } from '../drawings/drawing-geojson'
import { createMarkerFeatureCollection } from '../markers/marker-geojson'

type Track = Pick<MissionReplayTrackRecord, 'evidence_id' | 'source_type' | 'track_id' | 'lat' | 'lon' | 'effective_at'>
type ReplayObject = Pick<MissionReplayReadResult['objects'][number], 'object_type' | 'object_id' | 'operation' | 'state'>

export type ReplayProjectionLimitation = {
  readonly code: 'object_not_projected' | 'track_not_projected'
  readonly evidenceId: string
  readonly message: string
}
export type ReplayProjectedCollection = FeatureCollection & { readonly limitations: readonly ReplayProjectionLimitation[] }

/** Projects exact dated dots and retained object geometry; it never interpolates missing routes. */
export function projectReplayMap(tracks: readonly Track[], objects: readonly ReplayObject[]): ReplayProjectedCollection {
  const features: Feature[] = []
  const limitations: ReplayProjectionLimitation[] = []
  const latest = new Map<string, Track>()
  const drawingGeometry = new Map<string, unknown>()
  for (const track of tracks) {
    try { assertCoordinate([track.lon, track.lat]) } catch {
      limitations.push({ code: 'track_not_projected', evidenceId: track.evidence_id,
        message: `Track record ${track.evidence_id} has an invalid map coordinate and is not drawn.` })
      continue
    }
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [track.lon, track.lat] },
      properties: { category: track.source_type === 'gpx_point' ? 'gpx' : 'breadcrumbs', label: track.track_id, time: track.effective_at } })
    if (track.source_type === 'traccar_fix') {
      const previous = latest.get(track.track_id)
      if (previous === undefined || Date.parse(previous.effective_at) < Date.parse(track.effective_at)) latest.set(track.track_id, track)
    }
  }
  for (const track of latest.values()) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [track.lon, track.lat] },
    properties: { category: 'current', label: `${track.track_id} · last known at selected time`, time: track.effective_at } })
  // Admit drawings before mirrored search-area records, but only deduplicate shapes actually drawn.
  const ordered = [...objects.filter((object) => object.object_type === 'drawing'),
    ...objects.filter((object) => object.object_type !== 'drawing')]
  for (const object of ordered) {
    try {
      features.push(...projectRetainedObject(object, drawingGeometry))
    } catch (error) {
      limitations.push({ code: 'object_not_projected', evidenceId: object.object_id,
        message: `Retained ${object.object_type} ${object.object_id} is not drawn. ${error instanceof SyntaxError
          ? 'Its recorded geometry or style data could not be read.'
          : error instanceof Error ? error.message : 'Its recorded map data is unsupported.'}` })
    }
  }
  return { type: 'FeatureCollection', features, limitations }
}

/** Projects one retained object atomically, recording only successfully drawn mirrors. */
function projectRetainedObject(object: ReplayObject, drawingGeometry: Map<string, unknown>): Feature[] {
  if (object.operation === 'retired' || object.state.retired_at != null) return []
  const state = object.state
  if (object.object_type === 'search_area' && typeof state.legacy_drawing_id === 'string'
    && typeof state.geometry_json === 'string' && drawingGeometry.get(state.legacy_drawing_id) === state.geometry_json) return []
  const label = typeof state.name === 'string' ? state.name : object.object_id
  if (object.object_type === 'marker') {
    assertCoordinate([state.lon, state.lat])
    if (!['ipp_lkp', 'clue', 'hazard', 'casualty'].includes(String(state.type))) throw new Error('Replay marker type is invalid.')
    return createMarkerFeatureCollection([state as unknown as Marker]).features.map((feature) => ({ ...feature,
      properties: { ...feature.properties, category: 'objects', label } }))
  }
  if (typeof state.geometry_json === 'string') {
    const geometry: unknown = JSON.parse(state.geometry_json)
    assertGeometry(geometry)
    if (object.object_type === 'drawing' && typeof state.type === 'string') {
      if (!['line', 'search_area', 'range_ring', 'bearing_line', 'search_sector', 'text_label'].includes(state.type)) {
        throw new Error('The retained drawing type is unsupported.')
      }
      const projected = createDrawingFeatureCollection([state as unknown as Drawing], null).features
      for (const feature of projected) assertGeometry(feature.geometry)
      const result = projected.map((feature) => ({ ...feature,
        properties: { ...feature.properties, category: 'objects', objectName: label } }))
      drawingGeometry.set(object.object_id, state.geometry_json)
      return result
    }
    const result: Feature = { type: 'Feature', geometry, properties: { category: 'objects', label } }
    if (object.object_type === 'drawing') drawingGeometry.set(object.object_id, state.geometry_json)
    return [result]
  } else if (object.object_type === 'drawing' || object.object_type === 'search_area') {
    throw new Error(`Map geometry is unavailable for ${object.object_type} ${object.object_id}.`)
  }
  return []
}

/** Rejects non-finite or out-of-range WGS84 map coordinates. */
function assertCoordinate(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])
    || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error('Replay contains an invalid map coordinate.')
}

/** Checks coordinate nesting before retained GeoJSON reaches the renderer. */
function assertGeometry(value: unknown): asserts value is Geometry {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('coordinates' in value)) throw new Error('Replay geometry is invalid.')
  const depths: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }
  const depth = typeof value.type === 'string' ? depths[value.type] : undefined
  if (depth === undefined) throw new Error('Replay geometry type is unsupported.')
  validateCoordinates(value.coordinates, depth)
}

/** Validates each coordinate in a supported GeoJSON geometry. */
function validateCoordinates(value: unknown, depth: number): void {
  if (depth === 0) { assertCoordinate(value); return }
  if (!Array.isArray(value) || value.length === 0) throw new Error('Replay geometry has no coordinates.')
  for (const child of value) validateCoordinates(child, depth - 1)
}
