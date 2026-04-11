import type {
  DrawingType,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'

export const TRACKING_GROUP_NODE_ID = 'group:tracking'
export const HELICOPTERS_GROUP_NODE_ID = 'group:helicopters'
export const MAP_TOOLS_GROUP_NODE_ID = 'group:map-tools'
export const GPX_TRACKS_GROUP_NODE_ID = 'group:gpx-tracks'

export const TRACKING_DEVICES_LAYER_NODE_ID = 'layer:tracking:devices'
export const TRACKING_BREADCRUMBS_LAYER_NODE_ID = 'layer:tracking:breadcrumbs'
export const MEASUREMENTS_LAYER_NODE_ID = 'layer:map-tools:measurements'

export function getMarkerLayerNodeId(type: MarkerType): string {
  switch (type) {
    case 'ipp_lkp':
      return 'layer:markers:ipp-lkp'
    case 'clue':
      return 'layer:markers:clues'
    case 'hazard':
      return 'layer:markers:hazards'
    case 'casualty':
      return 'layer:markers:casualties'
  }
}

export function getDrawingLayerNodeId(type: DrawingType): string {
  switch (type) {
    case 'line':
      return 'layer:drawings:line'
    case 'search_area':
      return 'layer:drawings:search-area'
    case 'range_ring':
      return 'layer:drawings:range-ring'
    case 'bearing_line':
      return 'layer:drawings:bearing-line'
    case 'search_sector':
      return 'layer:drawings:search-sector'
    case 'text_label':
      return 'layer:drawings:text-label'
  }
}

export function getDeviceFeatureNodeId(deviceId: string): string {
  return `feature:device:${deviceId}`
}

export function getMarkerFeatureNodeId(markerId: string): string {
  return `feature:marker:${markerId}`
}

export function getDrawingFeatureNodeId(drawingId: string): string {
  return `feature:drawing:${drawingId}`
}

export function getGpxImportLayerNodeId(importId: string): string {
  return `layer:gpx:${importId}`
}

export function getGpxImportFeatureNodeId(importId: string): string {
  return `feature:gpx:${importId}`
}
