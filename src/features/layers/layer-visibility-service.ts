import type {
  DrawingType,
  HelicopterSlotKey,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'
import {
  GPX_TRACKS_GROUP_NODE_ID,
  getDrawingLayerNodeId,
  getHelicopterLayerNodeId,
  getMarkerLayerNodeId,
  HELICOPTERS_GROUP_NODE_ID,
  MAP_TOOLS_GROUP_NODE_ID,
  MEASUREMENTS_LAYER_NODE_ID,
  parseGpxImportLayerNodeId,
  parseFeatureNodeId,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
  TRACKING_GROUP_NODE_ID,
} from './layer-catalog-ids'
import { findCatalogNode, getDescendantNodeIds } from './layer-catalog-tree'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import type { LayerCatalogController } from './start-layer-catalog-runtime'
import type { LayerGroupVisibility } from './layer-visibility-store'

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

const HELICOPTER_SLOT_BY_LAYER_ID: Readonly<Record<string, HelicopterSlotKey>> = {
  [getHelicopterLayerNodeId('slot_1')]: 'slot_1',
  [getHelicopterLayerNodeId('slot_2')]: 'slot_2',
  [getHelicopterLayerNodeId('slot_3')]: 'slot_3',
  [getHelicopterLayerNodeId('slot_4')]: 'slot_4',
}

const GROUP_BY_NODE_ID: Readonly<Record<string, keyof LayerGroupVisibility>> = {
  [TRACKING_GROUP_NODE_ID]: 'tracking',
  [HELICOPTERS_GROUP_NODE_ID]: 'helicopters',
  [MAP_TOOLS_GROUP_NODE_ID]: 'mapTools',
  [GPX_TRACKS_GROUP_NODE_ID]: 'gpxTracks',
}

export type LayerVisibilityStoreAdapter = {
  readonly hiddenDeviceIds: readonly string[]
  readonly hiddenBreadcrumbDeviceIds: readonly string[]
  readonly hiddenMarkerIds: readonly string[]
  readonly hiddenDrawingIds: readonly string[]
  readonly hiddenHelicopterIds: readonly string[]
  readonly hiddenGpxImportIds: readonly string[]
  readonly setGroupVisibility: (group: keyof LayerGroupVisibility, visible: boolean) => void
  readonly toggleDeviceVisibility: (deviceId: string) => void
  readonly toggleBreadcrumbDeviceVisibility: (deviceId: string) => void
  readonly toggleMarkerVisibility: (markerId: string) => void
  readonly toggleDrawingVisibility: (drawingId: string) => void
  readonly toggleHelicopterVisibility: (helicopterId: string) => void
  readonly toggleGpxImportVisibility: (importId: string) => void
  readonly setMarkerTypeVisibility: (type: MarkerType, visible: boolean) => void
  readonly setDrawingTypeVisibility: (type: DrawingType, visible: boolean) => void
  readonly setHelicopterSlotVisibility: (slotKey: HelicopterSlotKey, visible: boolean) => void
  readonly setBreadcrumbsVisible: (visible: boolean) => void
  readonly setMeasurementsVisible: (visible: boolean) => void
  readonly showAllDevices: () => void
  readonly hideAllDevices: (deviceIds: readonly string[]) => void
  readonly showAllBreadcrumbDevices: () => void
  readonly hideAllBreadcrumbDevices: (deviceIds: readonly string[]) => void
}

/**
 * Reveals the Map Tools group and one operational child layer before arming a
 * map tool, so operators cannot create invisible measurements or drawings.
 */
export function revealMapToolLayerForOperation(
  root: LayerCatalogRootNode,
  controller: LayerCatalogController | null,
  childLayerNodeId: string,
  store: LayerVisibilityStoreAdapter,
): void {
  const nodeIds = [MAP_TOOLS_GROUP_NODE_ID, childLayerNodeId]
  applyVisibilityForNodeIds(root, nodeIds, true, store)
  void controller?.setNodeVisibilities(nodeIds, true)
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
  const hidden = {
    devices: new Set(store.hiddenDeviceIds), breadcrumbs: new Set(store.hiddenBreadcrumbDeviceIds),
    markers: new Set(store.hiddenMarkerIds), drawings: new Set(store.hiddenDrawingIds),
    helicopters: new Set(store.hiddenHelicopterIds), gpx: new Set(store.hiddenGpxImportIds),
  }
  for (const nodeId of nodeIds) {
    const group = GROUP_BY_NODE_ID[nodeId]
    if (group !== undefined) {
      store.setGroupVisibility(group, visible)
      continue
    }

    const featureNode = parseFeatureNodeId(nodeId)
    if (featureNode !== null) {
      if (featureNode.entityType === 'device') {
        toggleByHiddenSet(featureNode.entityId, visible, hidden.devices, store.toggleDeviceVisibility)
      } else if (featureNode.entityType === 'tracking-breadcrumb') {
        if (visible) store.setBreadcrumbsVisible(true)
        toggleByHiddenSet(
          featureNode.entityId,
          visible,
          hidden.breadcrumbs,
          store.toggleBreadcrumbDeviceVisibility,
        )
      } else if (featureNode.entityType === 'marker') {
        toggleByHiddenSet(featureNode.entityId, visible, hidden.markers, store.toggleMarkerVisibility)
      } else if (featureNode.entityType === 'drawing') {
        toggleByHiddenSet(featureNode.entityId, visible, hidden.drawings, store.toggleDrawingVisibility)
      } else if (featureNode.entityType === 'helicopter') {
        toggleByHiddenSet(featureNode.entityId, visible, hidden.helicopters, store.toggleHelicopterVisibility)
      } else if (featureNode.entityType === 'gpx') {
        toggleByHiddenSet(featureNode.entityId, visible, hidden.gpx, store.toggleGpxImportVisibility)
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

    const helicopterSlot = HELICOPTER_SLOT_BY_LAYER_ID[nodeId]
    if (helicopterSlot !== undefined) {
      store.setHelicopterSlotVisibility(helicopterSlot, visible)
      continue
    }

    const gpxImportId = parseGpxImportLayerNodeId(nodeId)
    if (gpxImportId !== null) {
      toggleByHiddenSet(gpxImportId, visible, hidden.gpx, store.toggleGpxImportVisibility)
      continue
    }

    if (nodeId === TRACKING_BREADCRUMBS_LAYER_NODE_ID) {
      const deviceIds = collectDeviceIdsFromTrackingLayer(root, TRACKING_BREADCRUMBS_LAYER_NODE_ID)
      store.setBreadcrumbsVisible(visible)
      if (visible) {
        store.showAllBreadcrumbDevices()
        hidden.breadcrumbs.clear()
      } else {
        store.hideAllBreadcrumbDevices(deviceIds)
        hidden.breadcrumbs = new Set(deviceIds)
      }
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
        hidden.devices.clear()
      } else {
        store.hideAllDevices(deviceIds)
        hidden.devices = new Set(deviceIds)
      }
    }
  }
}

/** Reads child identities from the category being changed. */
function collectDeviceIdsFromTrackingLayer(root: LayerCatalogRootNode, layerId = TRACKING_DEVICES_LAYER_NODE_ID): readonly string[] {
  const deviceLayer = root.children
    .flatMap((group) => group.children)
    .find((layer) => layer.id === layerId)
  if (deviceLayer === undefined) {
    return []
  }

  return deviceLayer.children
    .flatMap((feature) => (feature.entity?.type === 'device' ? [feature.entity.device.device_id] : []))
}

/** Applies each desired state once, including after a parent bulk change. */
function toggleByHiddenSet(
  entityId: string,
  visible: boolean,
  hiddenIds: Set<string>,
  toggle: (entityId: string) => void,
): void {
  const hidden = hiddenIds.has(entityId)
  if (visible && hidden) {
    toggle(entityId)
    hiddenIds.delete(entityId)
  } else if (!visible && !hidden) {
    toggle(entityId)
    hiddenIds.add(entityId)
  }
}
