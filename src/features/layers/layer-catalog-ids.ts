import type {
  DrawingType,
  HelicopterSlotKey,
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

export function getBreadcrumbDeviceFeatureNodeId(deviceId: string): string {
  return `feature:tracking-breadcrumb:${deviceId}`
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

/**
 * Parses a GPX import layer node id into its import id.
 */
export function parseGpxImportLayerNodeId(nodeId: string): string | null {
  const prefix = 'layer:gpx:'
  if (!nodeId.startsWith(prefix)) {
    return null
  }

  const importId = nodeId.slice(prefix.length)
  return importId.length > 0 ? importId : null
}

export function getGpxImportFeatureNodeId(importId: string): string {
  return `feature:gpx:${importId}`
}

export function getHelicopterLayerNodeId(slotKey: HelicopterSlotKey): string {
  switch (slotKey) {
    case 'slot_1':
      return 'layer:helicopters:slot-1'
    case 'slot_2':
      return 'layer:helicopters:slot-2'
    case 'slot_3':
      return 'layer:helicopters:slot-3'
    case 'slot_4':
      return 'layer:helicopters:slot-4'
  }
}

export function getHelicopterFeatureNodeId(helicopterId: string): string {
  return `feature:helicopter:${helicopterId}`
}

export function getMeasurementFeatureNodeId(measurementId: string): string {
  return `feature:measurement:${measurementId}`
}

/**
 * Parses a feature node id into its entity type and entity id.
 */
export function parseFeatureNodeId(
  nodeId: string,
): { readonly entityType: string; readonly entityId: string } | null {
  const match = /^feature:([^:]+):(.+)$/.exec(nodeId)
  if (match === null) {
    return null
  }

  const entityType = match[1]
  const entityId = match[2]
  if (entityType === undefined || entityId === undefined) {
    return null
  }
  return { entityType, entityId }
}
