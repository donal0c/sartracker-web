import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { MissionReplayReadResult, MissionReplayTrackRecord } from '../../infrastructure/mission-store/tauri-mission-store'
import type { Drawing, Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import { createDrawingFeatureCollection } from '../drawings/drawing-geojson'
import { createMarkerFeatureCollection } from '../markers/marker-geojson'

type Track = Pick<MissionReplayTrackRecord, 'evidence_id' | 'source_type' | 'track_id' | 'lat' | 'lon' | 'effective_at'>
type ReplayObject = Pick<MissionReplayReadResult['objects'][number], 'object_type' | 'object_id' | 'operation' | 'state'>

/** Projects exact dated dots and retained object geometry; it never interpolates missing routes. */
export function projectReplayMap(tracks: readonly Track[], objects: readonly ReplayObject[]): FeatureCollection {
  const features: Feature[] = []
  const latest = new Map<string, Track>()
  const drawingGeometry = new Map(objects.filter((object) => object.object_type === 'drawing' && object.operation !== 'retired' && object.state.retired_at == null)
    .map((object) => [object.object_id, object.state.geometry_json]))
  for (const track of tracks) {
    assertCoordinate([track.lon, track.lat])
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [track.lon, track.lat] },
      properties: { category: track.source_type === 'gpx_point' ? 'gpx' : 'breadcrumbs', label: track.track_id, time: track.effective_at } })
    if (track.source_type === 'traccar_fix') {
      const previous = latest.get(track.track_id)
      if (previous === undefined || Date.parse(previous.effective_at) < Date.parse(track.effective_at)) latest.set(track.track_id, track)
    }
  }
  for (const track of latest.values()) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [track.lon, track.lat] },
    properties: { category: 'current', label: `${track.track_id} · last known at selected time`, time: track.effective_at } })
  for (const object of objects) {
    if (object.operation === 'retired' || object.state.retired_at != null) continue
    const state = object.state
    if (object.object_type === 'search_area' && typeof state.legacy_drawing_id === 'string'
      && typeof state.geometry_json === 'string' && drawingGeometry.get(state.legacy_drawing_id) === state.geometry_json) continue
    const label = typeof state.name === 'string' ? state.name : object.object_id
    if (object.object_type === 'marker') {
      assertCoordinate([state.lon, state.lat])
      if (!['ipp_lkp', 'clue', 'hazard', 'casualty'].includes(String(state.type))) throw new Error('Replay marker type is invalid.')
      features.push(...createMarkerFeatureCollection([state as unknown as Marker]).features.map((feature) => ({ ...feature,
        properties: { ...feature.properties, category: 'objects', label } })))
      continue
    }
    if (typeof state.geometry_json === 'string') {
      const geometry: unknown = JSON.parse(state.geometry_json)
      assertGeometry(geometry)
      if (object.object_type === 'drawing' && typeof state.type === 'string') {
        features.push(...createDrawingFeatureCollection([state as unknown as Drawing], null).features.map((feature) => ({ ...feature,
          properties: { ...feature.properties, category: 'objects', objectName: label } })))
        continue
      }
      features.push({ type: 'Feature', geometry, properties: { category: 'objects', label } })
    } else if (object.object_type === 'helicopter') {
      assertCoordinate([state.lon, state.lat])
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [state.lon as number, state.lat as number] },
        properties: { category: 'objects', label } })
    } else if (object.object_type === 'drawing' || object.object_type === 'search_area') {
      throw new Error(`Map geometry is unavailable for ${object.object_type} ${object.object_id}.`)
    }
  }
  return { type: 'FeatureCollection', features }
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
