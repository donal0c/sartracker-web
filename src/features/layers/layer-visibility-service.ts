import type { DrawingType, MarkerType } from '../../infrastructure/mission-store/tauri-mission-store'
import {
  getDrawingLayerNodeId,
  getMarkerLayerNodeId,
  MEASUREMENTS_LAYER_NODE_ID,
  parseFeatureNodeId,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from './layer-catalog-ids'
import { findCatalogNode, getDescendantNodeIds } from './layer-catalog-tree'
import type { LayerCatalogRootNode } from './layer-catalog-types'

const MARKER_TYPE_BY_LAYER_ID: Readonly<Record<string, MarkerType>> = {
  [getMarkerLayerNodeId('ipp_lkp')]: 'ipp_lkp',
  [getMarkerLayerNodeId('clue')]: 'clue',
  [getMarkerLayerNodeId('hazard')]: 'hazard',
  [getMarkerLayerNodeId('casualty')]: 'casualty',
}

const DRAWING_TYPE_BY_LAYER_ID: Readonly<Record<string, DrawingType>> = {
  [getDrawingLayerNodeId('line')]: 'line',
  [getDrawingLayerNodeId('search_area')]: 'search_area',
  [getDrawingLayerNodeId('range_ring')]: 'range_ring',
  [getDrawingLayerNodeId('bearing_line')]: 'bearing_line',
  [getDrawingLayerNodeId('search_sector')]: 'search_sector',
  [getDrawingLayerNodeId('text_label')]: 'text_label',
}

export type LayerVisibilityStoreAdapter = {
  readonly hiddenDeviceIds: readonly string[]
  readonly hiddenMarkerIds: readonly string[]
  readonly hiddenDrawingIds: readonly string[]
  readonly toggleDeviceVisibility: (deviceId: string) => void
  readonly toggleMarkerVisibility: (markerId: string) => void
  readonly toggleDrawingVisibility: (drawingId: string) => void
  readonly setMarkerTypeVisibility: (type: MarkerType, visible: boolean) => void
  readonly setDrawingTypeVisibility: (type: DrawingType, visible: boolean) => void
  readonly setBreadcrumbsVisible: (visible: boolean) => void
  readonly setMeasurementsVisible: (visible: boolean) => void
  readonly showAllDevices: () => void
  readonly hideAllDevices: (deviceIds: readonly string[]) => void
}

/**
 * Returns the selected node and all descendants to keep subtree visibility
 * updates consistent between catalog persistence and overlay visibility.
 */
export function collectSubtreeNodeIds(
  root: LayerCatalogRootNode,
  nodeId: string,
): readonly string[] {
  const node = findCatalogNode(root, nodeId)
  if (node === null) {
    return []
  }

  return [node.id, ...getDescendantNodeIds(node)]
}

/**
 * Applies visibility updates for catalog node ids to the flat runtime
 * visibility store so map filters update immediately.
 */
export function applyVisibilityForNodeIds(
  root: LayerCatalogRootNode,
  nodeIds: readonly string[],
  visible: boolean,
  store: LayerVisibilityStoreAdapter,
): void {
  for (const nodeId of nodeIds) {
    const featureNode = parseFeatureNodeId(nodeId)
    if (featureNode !== null) {
      if (featureNode.entityType === 'device') {
        toggleByHiddenList(featureNode.entityId, visible, store.hiddenDeviceIds, store.toggleDeviceVisibility)
      } else if (featureNode.entityType === 'marker') {
        toggleByHiddenList(featureNode.entityId, visible, store.hiddenMarkerIds, store.toggleMarkerVisibility)
      } else if (featureNode.entityType === 'drawing') {
        toggleByHiddenList(featureNode.entityId, visible, store.hiddenDrawingIds, store.toggleDrawingVisibility)
      }
      continue
    }

    const markerType = MARKER_TYPE_BY_LAYER_ID[nodeId]
    if (markerType !== undefined) {
      store.setMarkerTypeVisibility(markerType, visible)
      continue
    }

    const drawingType = DRAWING_TYPE_BY_LAYER_ID[nodeId]
    if (drawingType !== undefined) {
      store.setDrawingTypeVisibility(drawingType, visible)
      continue
    }

    if (nodeId === TRACKING_BREADCRUMBS_LAYER_NODE_ID) {
      store.setBreadcrumbsVisible(visible)
      continue
    }

    if (nodeId === MEASUREMENTS_LAYER_NODE_ID) {
      store.setMeasurementsVisible(visible)
      continue
    }

    if (nodeId === TRACKING_DEVICES_LAYER_NODE_ID) {
      const deviceIds = collectDeviceIdsFromTrackingLayer(root)
      if (visible) {
        store.showAllDevices()
      } else {
        store.hideAllDevices(deviceIds)
      }
    }
  }
}

function collectDeviceIdsFromTrackingLayer(root: LayerCatalogRootNode): readonly string[] {
  const deviceLayer = root.children
    .flatMap((group) => group.children)
    .find((layer) => layer.id === TRACKING_DEVICES_LAYER_NODE_ID)
  if (deviceLayer === undefined) {
    return []
  }

  return deviceLayer.children
    .flatMap((feature) => (feature.entity?.type === 'device' ? [feature.entity.device.device_id] : []))
}

function toggleByHiddenList(
  entityId: string,
  visible: boolean,
  hiddenIds: readonly string[],
  toggle: (entityId: string) => void,
): void {
  const hidden = hiddenIds.includes(entityId)
  if (visible && hidden) {
    toggle(entityId)
  } else if (!visible && !hidden) {
    toggle(entityId)
  }
}
