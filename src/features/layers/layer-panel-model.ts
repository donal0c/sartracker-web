import {
  MEASUREMENTS_LAYER_NODE_ID,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from './layer-catalog-ids'
import type { LayerCatalogNode } from './layer-catalog-tree'

export type LayerInspectionCounts = {
  readonly trackingDeviceCount: number
  readonly trackingBreadcrumbCount: number
  readonly measurementCount: number
}

export type LayerNodeCountContext = {
  readonly trackingBreadcrumbCount: number
  readonly measurementCount: number
}

export type LayerInspectionRow = {
  readonly label: string
  readonly value: string
}

/**
 * Builds the operator-facing inspection rows for the selected layer tree node.
 */
export function buildLayerInspectionRows(
  node: LayerCatalogNode,
  counts: LayerInspectionCounts,
): readonly LayerInspectionRow[] {
  if (node.kind === 'group') {
    return [
      { label: 'Group Key', value: node.groupKey },
      { label: 'Child Layers', value: String(node.children.length) },
      { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
    ]
  }

  if (node.kind === 'layer') {
    if (node.id === TRACKING_BREADCRUMBS_LAYER_NODE_ID) {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Breadcrumb Points', value: String(counts.trackingBreadcrumbCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    if (node.id === TRACKING_DEVICES_LAYER_NODE_ID) {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Current Locations', value: String(counts.trackingDeviceCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    if (node.id === MEASUREMENTS_LAYER_NODE_ID) {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Active Measurements', value: String(counts.measurementCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    return [
      { label: 'Layer Key', value: node.layerKey },
      { label: 'Visible Items', value: `${node.summary.visibleCount}/${node.summary.totalCount}` },
      { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
    ]
  }

  if (node.kind === 'feature_item') {
    if (node.entity?.type === 'device') {
      return [
        { label: 'Device ID', value: node.entity.device.device_id },
        { label: 'Status', value: node.entity.device.status },
        { label: 'Last Seen', value: node.entity.device.last_seen ?? 'No fix' },
      ]
    }
    if (node.entity?.type === 'marker') {
      return [
        { label: 'Marker Type', value: node.entity.marker.type },
        { label: 'Coordinates', value: `${node.entity.marker.lat.toFixed(4)}, ${node.entity.marker.lon.toFixed(4)}` },
        { label: 'Updated', value: node.entity.marker.updated_at },
      ]
    }
    if (node.entity?.type === 'drawing') {
      return [
        { label: 'Drawing Type', value: node.entity.drawing.type },
        { label: 'Label', value: node.entity.drawing.label ?? 'None' },
        { label: 'Updated', value: node.entity.drawing.updated_at },
      ]
    }
    if (node.entity?.type === 'gpx_import') {
      return [
        { label: 'Source Path', value: node.entity.gpxImport.source_path },
        { label: 'File Name', value: node.entity.gpxImport.file_name },
        { label: 'Imported', value: node.entity.gpxImport.imported_at },
      ]
    }
  }

  return [
    { label: 'Node ID', value: node.id },
    { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
  ]
}

/**
 * Returns the compact count displayed beside a layer tree row.
 */
export function getLayerNodeCountLabel(
  node: LayerCatalogNode,
  context: LayerNodeCountContext,
): string {
  if (node.kind === 'group') {
    return String(node.children.length)
  }
  if (node.kind === 'layer') {
    if (node.id === TRACKING_BREADCRUMBS_LAYER_NODE_ID) {
      return String(context.trackingBreadcrumbCount)
    }
    if (node.id === MEASUREMENTS_LAYER_NODE_ID) {
      return String(context.measurementCount)
    }
    return String(node.summary.totalCount)
  }
  return ''
}

/**
 * Normalizes catalog node IDs into stable DOM test id suffixes.
 */
export function toLayerTreeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-')
}
