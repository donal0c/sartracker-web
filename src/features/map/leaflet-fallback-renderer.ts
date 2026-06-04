import type { Feature, Geometry } from 'geojson'
import L from 'leaflet'

import { getBasemapById, MAP_CENTER, MAP_DEFAULT_ZOOM, type BasemapId } from '../../lib/map-config'
import type { Drawing, Marker, MarkerType } from '../../infrastructure/mission-store/tauri-mission-store'
import type { TrackingSnapshot } from '../tracking/tracking-types'
import { createDrawingFeatureCollection } from '../drawings/drawing-geojson'
import { createMarkerFeatureCollection } from '../markers/marker-geojson'
import { createTrackingFeatureCollection } from '../tracking/tracking-geojson'
import {
  DEFAULT_BREADCRUMB_SIZE,
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  clampBreadcrumbSize,
  type TrackingStylePreferences,
} from '../tracking/tracking-style-store'

export type LeafletFallbackOverlayInput = {
  readonly trackingSnapshot: TrackingSnapshot
  readonly trackingVisible: boolean
  readonly breadcrumbsVisible: boolean
  readonly hiddenDeviceIds: readonly string[]
  readonly trackingStyle?: TrackingStylePreferences
  readonly markers: readonly Marker[]
  readonly markerTypeVisibility: Record<MarkerType, boolean>
  readonly hiddenMarkerIds: readonly string[]
  readonly drawings: readonly Drawing[]
  readonly drawingTypeVisibility: Record<Drawing['type'], boolean>
  readonly hiddenDrawingIds: readonly string[]
  readonly selectedDrawingId: string | null
}

const MARKER_COLORS: Record<MarkerType, string> = {
  ipp_lkp: '#2563EB',
  clue: '#FFFFFF',
  hazard: '#DC2626',
  casualty: '#EF4444',
}

const IRELAND_MAX_BOUNDS = L.latLngBounds([51.25, -10.85], [55.55, -5.25])

/**
 * Creates the Leaflet map used by the non-WebGL read-only fallback.
 */
export function createLeafletFallbackMap(container: HTMLElement): L.Map {
  return L.map(container, {
    center: [MAP_CENTER[1], MAP_CENTER[0]],
    zoom: MAP_DEFAULT_ZOOM,
    maxBounds: IRELAND_MAX_BOUNDS,
    preferCanvas: true,
  })
}

/**
 * Creates a Leaflet raster tile layer for one of the app's locked basemaps.
 */
export function createLeafletBasemapLayer(basemapId: BasemapId): L.TileLayer {
  const basemap = getBasemapById(basemapId)
  return L.tileLayer(basemap.tiles[0], {
    attribution: basemap.attribution,
    maxZoom: basemap.maxZoom,
    tileSize: basemap.tileSize,
  })
}

/**
 * Renders the critical read-only SAR overlays into a Leaflet layer group.
 */
export function renderLeafletFallbackOverlays(
  layerGroup: L.LayerGroup,
  input: LeafletFallbackOverlayInput,
): void {
  layerGroup.clearLayers()

  if (input.trackingVisible) {
    renderTrackingOverlay(layerGroup, input)
  }

  renderMarkerOverlay(layerGroup, input)
  renderDrawingOverlay(layerGroup, input)
}

function renderTrackingOverlay(layerGroup: L.LayerGroup, input: LeafletFallbackOverlayInput): void {
  const hiddenDeviceIds = new Set(input.hiddenDeviceIds)
  const trackingStyle = input.trackingStyle ?? {
    deviceColors: {},
    breadcrumbSize: DEFAULT_BREADCRUMB_SIZE,
    breadcrumbTrailMode: DEFAULT_BREADCRUMB_TRAIL_MODE,
  }
  const breadcrumbSize = clampBreadcrumbSize(trackingStyle.breadcrumbSize)
  const tracking = createTrackingFeatureCollection(
    input.trackingSnapshot,
    5 * 60 * 1000,
    trackingStyle,
  )

  for (const feature of tracking.features) {
    const properties = feature.properties ?? {}
    const deviceId = readStringProperty(properties, 'deviceId')
    if (deviceId !== null && hiddenDeviceIds.has(deviceId)) {
      continue
    }

    if (feature.geometry.type === 'LineString') {
      if (!input.breadcrumbsVisible) {
        continue
      }
      L.polyline(toLatLngs(feature.geometry.coordinates), {
        color: readStringProperty(properties, 'color') ?? '#38BDF8',
        opacity: 0.92,
        weight: breadcrumbSize,
      }).addTo(layerGroup)
      continue
    }

    if (feature.geometry.type === 'Point') {
      if (readStringProperty(properties, 'featureKind') === 'breadcrumb') {
        if (!input.breadcrumbsVisible) {
          continue
        }

        L.circleMarker(toLatLng(feature.geometry.coordinates), {
          radius: breadcrumbSize / 2,
          color: '#020617',
          fillColor: readStringProperty(properties, 'color') ?? '#38BDF8',
          fillOpacity: 0.95,
          opacity: 1,
          weight: 2,
        }).addTo(layerGroup)
        continue
      }

      L.circleMarker(toLatLng(feature.geometry.coordinates), {
        radius: 9,
        color: readBooleanProperty(properties, 'stale') ? '#FACC15' : '#FFFFFF',
        fillColor: readStringProperty(properties, 'color') ?? '#38BDF8',
        fillOpacity: 0.95,
        opacity: 1,
        weight: 3,
      })
        .bindTooltip(readStringProperty(properties, 'name') ?? deviceId ?? 'Device', {
          direction: 'right',
          offset: [10, 0],
          permanent: true,
        })
        .addTo(layerGroup)
    }
  }
}

function renderMarkerOverlay(layerGroup: L.LayerGroup, input: LeafletFallbackOverlayInput): void {
  const hiddenMarkerIds = new Set(input.hiddenMarkerIds)
  const markers = createMarkerFeatureCollection(input.markers)

  for (const feature of markers.features) {
    const properties = feature.properties ?? {}
    const markerId = readStringProperty(properties, 'markerId')
    const markerType = readMarkerType(properties)
    if (
      markerId === null ||
      markerType === null ||
      hiddenMarkerIds.has(markerId) ||
      !input.markerTypeVisibility[markerType]
    ) {
      continue
    }

    L.circleMarker(toLatLng(feature.geometry.coordinates), {
      radius: markerType === 'casualty' ? 10 : 8,
      color: markerType === 'clue' ? '#111827' : '#FFFFFF',
      fillColor: MARKER_COLORS[markerType],
      fillOpacity: 0.98,
      opacity: 1,
      weight: 2.5,
    })
      .bindTooltip(readStringProperty(properties, 'name') ?? markerType, {
        className: 'sar-leaflet-label',
        direction: 'top',
        offset: [0, -8],
        permanent: true,
      })
      .addTo(layerGroup)
  }
}

function renderDrawingOverlay(layerGroup: L.LayerGroup, input: LeafletFallbackOverlayInput): void {
  const hiddenDrawingIds = new Set(input.hiddenDrawingIds)
  const drawings = createDrawingFeatureCollection(input.drawings, input.selectedDrawingId)

  for (const feature of drawings.features) {
    const properties = feature.properties ?? {}
    const drawingId = readStringProperty(properties, 'drawingId')
    const drawingType = readDrawingType(properties)
    if (
      drawingId === null ||
      drawingType === null ||
      hiddenDrawingIds.has(drawingId) ||
      !input.drawingTypeVisibility[drawingType]
    ) {
      continue
    }

    renderDrawingFeature(layerGroup, feature)
  }
}

function renderDrawingFeature(layerGroup: L.LayerGroup, feature: Feature<Geometry>): void {
  const properties = feature.properties ?? {}
  const strokeColor = readStringProperty(properties, 'strokeColor') ?? '#38BDF8'
  const fillColor = readStringProperty(properties, 'fillColor') ?? '#38BDF833'
  const weight = readNumberProperty(properties, 'width') ?? 2
  const selected = readBooleanProperty(properties, 'selected')

  if (feature.geometry.type === 'LineString') {
    const latLngs = toLatLngs(feature.geometry.coordinates)
    const strokeWeight = selected ? weight + 2 : weight
    // Dark casing under the coloured stroke for legibility on busy terrain.
    L.polyline(latLngs, {
      color: '#020617',
      opacity: 0.85,
      weight: strokeWeight + 3,
    }).addTo(layerGroup)
    L.polyline(latLngs, {
      color: strokeColor,
      opacity: 0.95,
      weight: strokeWeight,
    }).addTo(layerGroup)
    return
  }

  if (feature.geometry.type === 'Polygon') {
    const rings = feature.geometry.coordinates.map(toLatLngs)
    const strokeWeight = selected ? weight + 1.5 : weight
    L.polygon(rings, {
      color: '#020617',
      fill: false,
      opacity: 0.85,
      weight: strokeWeight + 3,
    }).addTo(layerGroup)
    L.polygon(rings, {
      color: strokeColor,
      fillColor,
      fillOpacity: selected ? 0.32 : 0.18,
      opacity: 0.95,
      weight: strokeWeight,
    }).addTo(layerGroup)
    return
  }

  if (feature.geometry.type === 'Point') {
    const label = readStringProperty(properties, 'label')
    const featureKind = readStringProperty(properties, 'featureKind')
    if (featureKind === 'label' && label !== null) {
      L.marker(toLatLng(feature.geometry.coordinates), {
        icon: L.divIcon({
          className: 'sar-leaflet-drawing-label',
          html: `<span>${escapeHtml(label)}</span>`,
          iconAnchor: [0, 0],
          iconSize: [1, 1],
        }),
      }).addTo(layerGroup)
      return
    }

    L.circleMarker(toLatLng(feature.geometry.coordinates), {
      radius: 4.5,
      color: '#0C0A09',
      fillColor: strokeColor,
      fillOpacity: 0.9,
      weight: 1.5,
    }).addTo(layerGroup)
  }
}

function readMarkerType(properties: GeoJSON.GeoJsonProperties): MarkerType | null {
  const value = readStringProperty(properties, 'markerType')
  return value === 'ipp_lkp' || value === 'clue' || value === 'hazard' || value === 'casualty'
    ? value
    : null
}

function readDrawingType(properties: GeoJSON.GeoJsonProperties): Drawing['type'] | null {
  const value = readStringProperty(properties, 'drawingType')
  return value === 'line' ||
    value === 'search_area' ||
    value === 'range_ring' ||
    value === 'bearing_line' ||
    value === 'search_sector' ||
    value === 'text_label'
    ? value
    : null
}

function readStringProperty(properties: GeoJSON.GeoJsonProperties, key: string): string | null {
  const value = properties?.[key]
  return typeof value === 'string' ? value : null
}

function readBooleanProperty(properties: GeoJSON.GeoJsonProperties, key: string): boolean {
  return properties?.[key] === true
}

function readNumberProperty(properties: GeoJSON.GeoJsonProperties, key: string): number | null {
  const value = properties?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toLatLng(coordinates: readonly number[]): L.LatLngExpression {
  return [coordinates[1] ?? 0, coordinates[0] ?? 0]
}

function toLatLngs(coordinates: readonly (readonly number[])[]): L.LatLngExpression[] {
  return coordinates.map(toLatLng)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
