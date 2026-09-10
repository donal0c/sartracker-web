import type maplibregl from 'maplibre-gl'
import type { LayerVisibilityState } from '../layers/layer-visibility-store'
import { selectVisibleDrawings, selectVisibleMarkers } from '../layers/select-visible-map-evidence'
import { getEffectiveGpxTracksVisible } from '../layers/effective-overlay-visibility'

import { findNearestDrawingId } from '../drawings/drawing-hit-testing'
import { findNearestGpxImportId } from '../gpx/gpx-hit-testing'
import { findNearestMarkerId } from '../markers/marker-hit-testing'
import type {
  Drawing,
  GpxTrackImport,
  Marker,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { getInteractiveDrawingLayerIds, resolveClickedDrawingId } from './map-drawing-interactions'
import { getInteractiveMarkerLayerIds, resolveClickedMarkerId } from './map-marker-interactions'

/**
 * The single, documented priority order for live-map click targets.
 *
 * Priority (highest first):
 *   1. marker  — operator-placed safety-critical points (IPP, LKP, clue,
 *                hazard, casualty). Markers MUST never be silently swallowed
 *                by an enclosing polygon or an overlapping line.
 *   2. drawing — search areas, range rings, bearing lines, search sectors,
 *                lines, text labels.
 *   3. hidden_evidence — a hidden marker prevents accidental duplicate creation.
 *   4. empty   — no marker or drawing wins. A nearby GPX track is reported
 *                as a soft signal (`gpxNearbyImportId`) for callers that want
 *                to surface track context, but does not change the click
 *                outcome here. Empty clicks remain available for marker
 *                creation when the caller is in idle mode.
 *
 * The resolver is pure: it reads the map for projection and rendered features
 * and returns a verdict. All cross-feature priority lives here so individual
 * interaction hooks no longer race via `event.stopImmediatePropagation`.
 */

export type MapClickTargetKind = 'marker' | 'drawing' | 'hidden_evidence' | 'empty'

export type MapClickTarget = {
  readonly kind: MapClickTargetKind
  readonly id: string | null
  readonly gpxNearbyImportId: string | null
}

type ResolveClickedMapTargetArgs = {
  readonly visibility: LayerVisibilityState
  readonly map: maplibregl.Map
  readonly point: { readonly x: number; readonly y: number }
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly gpxImports: readonly GpxTrackImport[]
}

/**
 * Resolves which map feature, if any, an operator's click should select.
 *
 * Requires the current visibility state; callers cannot opt out of filtering.
 * Always tolerates malformed geometry. A click on
 * malformed data degrades to "no marker / no drawing wins", and the GPX soft
 * signal is `null` rather than undefined.
 */
export function resolveClickedMapTarget(args: ResolveClickedMapTargetArgs): MapClickTarget {
  const storedMarkers = args.markers
  const visibility = args.visibility
  args = { ...args,
    markers: selectVisibleMarkers(args.markers, visibility),
    drawings: selectVisibleDrawings(args.drawings, visibility),
    gpxImports: getEffectiveGpxTracksVisible(visibility.groupVisibility)
      ? args.gpxImports.filter((item) => !visibility.hiddenGpxImportIds.includes(item.id)) : [],
  }
  const markerId = pickMarkerId(args)
  const gpxNearbyImportId = pickGpxNearbyImportId(args)

  if (markerId !== null) {
    return { kind: 'marker', id: markerId, gpxNearbyImportId }
  }

  const drawingId = pickDrawingId(args)
  if (drawingId !== null) {
    return { kind: 'drawing', id: drawingId, gpxNearbyImportId }
  }

  const visibleMarkerIds = new Set(args.markers.map((marker) => marker.id))
  const hiddenMarkerId = findNearestMarkerId(args.map, args.point,
    storedMarkers.filter((marker) => !visibleMarkerIds.has(marker.id)))
  // Hidden evidence is never selected, but its location must not silently open duplicate creation.
  return { kind: hiddenMarkerId === null ? 'empty' : 'hidden_evidence', id: null, gpxNearbyImportId }
}

function pickMarkerId(args: ResolveClickedMapTargetArgs): string | null {
  const interactiveMarkerLayers = getInteractiveMarkerLayerIds(
    (layerId) => args.map.getLayer(layerId) !== undefined,
  )

  const renderedMarkerId =
    interactiveMarkerLayers.length === 0
      ? null
      : readMarkerIdFromRenderedFeatures(args.map, args.point, interactiveMarkerLayers)

  return resolveClickedMarkerId(
    args.markers.some((marker) => marker.id === renderedMarkerId) ? renderedMarkerId : null,
    findNearestMarkerId(args.map, args.point, args.markers),
  )
}

function pickDrawingId(args: ResolveClickedMapTargetArgs): string | null {
  const interactiveDrawingLayers = getInteractiveDrawingLayerIds(
    (layerId) => args.map.getLayer(layerId) !== undefined,
  )

  const renderedDrawingId =
    interactiveDrawingLayers.length === 0
      ? null
      : readDrawingIdFromRenderedFeatures(args.map, args.point, interactiveDrawingLayers)

  const renderedId = resolveClickedDrawingId(renderedDrawingId)
  if (renderedId !== null && args.drawings.some((drawing) => drawing.id === renderedId)) {
    return renderedId
  }

  return findNearestDrawingId(args.map, args.point, args.drawings)
}

function pickGpxNearbyImportId(args: ResolveClickedMapTargetArgs): string | null {
  if (args.gpxImports.length === 0) {
    return null
  }

  return findNearestGpxImportId(args.map, args.point, args.gpxImports)
}

function readMarkerIdFromRenderedFeatures(
  map: maplibregl.Map,
  point: { readonly x: number; readonly y: number },
  layers: readonly string[],
): unknown {
  const features = map.queryRenderedFeatures([point.x, point.y], { layers: [...layers] })
  const properties = features[0]?.properties
  if (properties === undefined || properties === null) {
    return null
  }
  return 'markerId' in properties ? properties.markerId : null
}

function readDrawingIdFromRenderedFeatures(
  map: maplibregl.Map,
  point: { readonly x: number; readonly y: number },
  layers: readonly string[],
): unknown {
  const features = map.queryRenderedFeatures([point.x, point.y], { layers: [...layers] })
  return features[0]?.properties?.drawingId ?? null
}
