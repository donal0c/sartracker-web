import type {
  Drawing,
  GpxTrackImport,
  Helicopter,
  Marker,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { NormalizedTrackingDevice } from '../tracking/tracking-types'
import {
  type LayerCatalogBuildInput,
  type LayerCatalogFeatureItemNode,
  type LayerCatalogGroupKey,
  type LayerCatalogGroupNode,
  type LayerCatalogLayerKey,
  type LayerCatalogLayerNode,
  type LayerCatalogMetadataEntry,
  type LayerCatalogRootNode,
  LAYER_CATALOG_ROOT_ID,
} from './layer-catalog-types'
import {
  getDeviceFeatureNodeId,
  getDrawingFeatureNodeId,
  getDrawingLayerNodeId,
  getGpxImportFeatureNodeId,
  getGpxImportLayerNodeId,
  getHelicopterFeatureNodeId,
  getHelicopterLayerNodeId,
  getMarkerFeatureNodeId,
  getMarkerLayerNodeId,
  GPX_TRACKS_GROUP_NODE_ID,
  HELICOPTERS_GROUP_NODE_ID,
  MAP_TOOLS_GROUP_NODE_ID,
  MEASUREMENTS_LAYER_NODE_ID,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
  TRACKING_GROUP_NODE_ID,
} from './layer-catalog-ids'

const GROUP_DEFINITIONS: readonly {
  readonly key: LayerCatalogGroupKey
  readonly id: string
  readonly label: string
  readonly displayOrder: number
}[] = [
  { key: 'tracking', id: TRACKING_GROUP_NODE_ID, label: 'Tracking', displayOrder: 10 },
  { key: 'helicopters', id: HELICOPTERS_GROUP_NODE_ID, label: 'Helicopters', displayOrder: 20 },
  { key: 'map_tools', id: MAP_TOOLS_GROUP_NODE_ID, label: 'Map Tools', displayOrder: 30 },
  { key: 'gpx_tracks', id: GPX_TRACKS_GROUP_NODE_ID, label: 'GPX Tracks', displayOrder: 40 },
]

const LAYER_DEFINITIONS: readonly {
  readonly key: LayerCatalogLayerKey
  readonly id: string
  readonly parentId: string
  readonly label: string
  readonly displayOrder: number
}[] = [
  { key: 'tracking_devices', id: TRACKING_DEVICES_LAYER_NODE_ID, parentId: TRACKING_GROUP_NODE_ID, label: 'People', displayOrder: 10 },
  { key: 'tracking_breadcrumbs', id: TRACKING_BREADCRUMBS_LAYER_NODE_ID, parentId: TRACKING_GROUP_NODE_ID, label: 'Breadcrumbs', displayOrder: 20 },
  { key: 'helicopter_slot_1', id: 'layer:helicopters:slot-1', parentId: HELICOPTERS_GROUP_NODE_ID, label: 'Rescue 118', displayOrder: 10 },
  { key: 'helicopter_slot_2', id: 'layer:helicopters:slot-2', parentId: HELICOPTERS_GROUP_NODE_ID, label: 'Rescue 115', displayOrder: 20 },
  { key: 'helicopter_slot_3', id: 'layer:helicopters:slot-3', parentId: HELICOPTERS_GROUP_NODE_ID, label: 'Air Corps 1', displayOrder: 30 },
  { key: 'helicopter_slot_4', id: 'layer:helicopters:slot-4', parentId: HELICOPTERS_GROUP_NODE_ID, label: 'Air Corps 2', displayOrder: 40 },
  { key: 'marker_ipp_lkp', id: getMarkerLayerNodeId('ipp_lkp'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'IPP / LKP', displayOrder: 10 },
  { key: 'marker_clue', id: getMarkerLayerNodeId('clue'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Clues', displayOrder: 20 },
  { key: 'marker_hazard', id: getMarkerLayerNodeId('hazard'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Hazards', displayOrder: 30 },
  { key: 'marker_casualty', id: getMarkerLayerNodeId('casualty'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Casualties', displayOrder: 40 },
  { key: 'drawing_line', id: getDrawingLayerNodeId('line'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Lines', displayOrder: 50 },
  { key: 'drawing_search_area', id: getDrawingLayerNodeId('search_area'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Search Areas', displayOrder: 60 },
  { key: 'drawing_range_ring', id: getDrawingLayerNodeId('range_ring'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Range Rings', displayOrder: 70 },
  { key: 'drawing_bearing_line', id: getDrawingLayerNodeId('bearing_line'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Bearing Lines', displayOrder: 80 },
  { key: 'drawing_search_sector', id: getDrawingLayerNodeId('search_sector'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Sectors', displayOrder: 90 },
  { key: 'drawing_text_label', id: getDrawingLayerNodeId('text_label'), parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Text Labels', displayOrder: 100 },
  { key: 'measurement', id: MEASUREMENTS_LAYER_NODE_ID, parentId: MAP_TOOLS_GROUP_NODE_ID, label: 'Measurements', displayOrder: 110 },
]

export function buildLayerCatalogTree(input: LayerCatalogBuildInput): LayerCatalogRootNode {
  const metadataIndex = new Map(input.metadataEntries.map((entry) => [entry.nodeId, entry]))

  const featureItemsByLayer = new Map<string, LayerCatalogFeatureItemNode[]>()

  addDeviceItems(featureItemsByLayer, input.devices, metadataIndex)
  addHelicopterItems(featureItemsByLayer, input.helicopters ?? [], metadataIndex)
  addMarkerItems(featureItemsByLayer, input.markers, metadataIndex)
  addDrawingItems(featureItemsByLayer, input.drawings, metadataIndex)

  const layers = [
    ...LAYER_DEFINITIONS.map((layer) => {
      const layerMetadata = metadataIndex.get(layer.id)
      const children = [...(featureItemsByLayer.get(layer.id) ?? [])].sort(compareNodes)
      return {
        id: layer.id,
        kind: 'layer',
        layerKey: layer.key,
        label: layer.label,
        alias: layerMetadata?.alias ?? null,
        displayLabel: layerMetadata?.alias?.trim() ? layerMetadata.alias : layer.label,
        isFavorite: layerMetadata?.isFavorite ?? false,
        isVisible: layerMetadata?.isVisible ?? true,
        displayOrder: layerMetadata?.displayOrder ?? layer.displayOrder,
        parentId: layer.parentId,
        summary: {
          totalCount: children.length,
          visibleCount: children.filter((child) => child.isVisible).length,
        },
        children,
      } satisfies LayerCatalogLayerNode
    }),
    ...buildGpxLayers(input.gpxImports, metadataIndex),
  ]

  const groups = GROUP_DEFINITIONS.map((group) => {
    const groupMetadata = metadataIndex.get(group.id)
    const children = layers
      .filter((layer) => layer.parentId === group.id)
      .sort(compareNodes)

    return {
      id: group.id,
      kind: 'group',
      groupKey: group.key,
      label: group.label,
      alias: groupMetadata?.alias ?? null,
      displayLabel: groupMetadata?.alias?.trim() ? groupMetadata.alias : group.label,
      isFavorite: groupMetadata?.isFavorite ?? false,
      isVisible: groupMetadata?.isVisible ?? true,
      displayOrder: groupMetadata?.displayOrder ?? group.displayOrder,
      parentId: LAYER_CATALOG_ROOT_ID,
      children,
    } satisfies LayerCatalogGroupNode
  }).sort(compareNodes)

  return {
    id: LAYER_CATALOG_ROOT_ID,
    kind: 'root',
    label: 'Mission Catalog',
    alias: null,
    displayLabel: 'Mission Catalog',
    isFavorite: false,
    isVisible: true,
    displayOrder: 0,
    parentId: null,
    children: groups,
  }
}

function buildGpxLayers(
  gpxImports: readonly GpxTrackImport[],
  metadataIndex: Map<string, LayerCatalogMetadataEntry>,
): readonly LayerCatalogLayerNode[] {
  return gpxImports
    .map((gpxImport, index) => {
      const layerId = getGpxImportLayerNodeId(gpxImport.id)
      const layerMetadata = metadataIndex.get(layerId)
      const featureId = getGpxImportFeatureNodeId(gpxImport.id)
      const featureMetadata = metadataIndex.get(featureId)
      const child = createFeatureItem({
        id: featureId,
        parentId: layerId,
        label: gpxImport.display_name,
        fallbackOrder: index + 1,
        metadataIndex,
        entity: { type: 'gpx_import', gpxImport },
      })

      return {
        id: layerId,
        kind: 'layer',
        layerKey: 'gpx_tracks',
        label: gpxImport.display_name,
        alias: layerMetadata?.alias ?? null,
        displayLabel: layerMetadata?.alias?.trim() ? layerMetadata.alias : gpxImport.display_name,
        isFavorite: layerMetadata?.isFavorite ?? false,
        isVisible: layerMetadata?.isVisible ?? true,
        displayOrder: layerMetadata?.displayOrder ?? 10_000,
        parentId: GPX_TRACKS_GROUP_NODE_ID,
        summary: {
          totalCount: 1,
          visibleCount: child.isVisible ? 1 : 0,
        },
        children: [
          featureMetadata === undefined
            ? child
            : {
                ...child,
                alias: featureMetadata.alias ?? null,
                displayLabel: featureMetadata.alias?.trim() ? featureMetadata.alias : child.label,
                isFavorite: featureMetadata.isFavorite,
                isVisible: featureMetadata.isVisible,
                displayOrder: featureMetadata.displayOrder,
              },
        ],
      } satisfies LayerCatalogLayerNode
    })
    .sort(compareNodes)
}

function addDeviceItems(
  target: Map<string, LayerCatalogFeatureItemNode[]>,
  devices: readonly NormalizedTrackingDevice[],
  metadataIndex: Map<string, LayerCatalogMetadataEntry>,
): void {
  const layerId = TRACKING_DEVICES_LAYER_NODE_ID
  const items = devices.map((device, index) =>
    createFeatureItem({
      id: getDeviceFeatureNodeId(device.device_id),
      parentId: layerId,
      label: device.name,
      fallbackOrder: index,
      metadataIndex,
      entity: { type: 'device', device },
    }),
  )
  target.set(layerId, items)
}

function addMarkerItems(
  target: Map<string, LayerCatalogFeatureItemNode[]>,
  markers: readonly Marker[],
  metadataIndex: Map<string, LayerCatalogMetadataEntry>,
): void {
  const groups = new Map<string, LayerCatalogFeatureItemNode[]>()
  for (const marker of markers) {
    const layerId = getMarkerLayerNodeId(marker.type)
    const items = groups.get(layerId) ?? []
    items.push(
      createFeatureItem({
        id: getMarkerFeatureNodeId(marker.id),
        parentId: layerId,
        label: marker.name,
        fallbackOrder: marker.display_order,
        metadataIndex,
        entity: { type: 'marker', marker },
      }),
    )
    groups.set(layerId, items)
  }

  for (const [layerId, items] of groups) {
    target.set(layerId, items)
  }
}

function addHelicopterItems(
  target: Map<string, LayerCatalogFeatureItemNode[]>,
  helicopters: readonly Helicopter[],
  metadataIndex: Map<string, LayerCatalogMetadataEntry>,
): void {
  const groups = new Map<string, LayerCatalogFeatureItemNode[]>()
  for (const helicopter of helicopters) {
    const layerId = getHelicopterLayerNodeId(helicopter.slot_key)
    const items = groups.get(layerId) ?? []
    items.push(
      createFeatureItem({
        id: getHelicopterFeatureNodeId(helicopter.id),
        parentId: layerId,
        label: helicopter.call_sign,
        fallbackOrder: 0,
        metadataIndex,
        entity: { type: 'helicopter', helicopter },
      }),
    )
    groups.set(layerId, items)
  }

  for (const [layerId, items] of groups) {
    target.set(layerId, items)
  }
}

function addDrawingItems(
  target: Map<string, LayerCatalogFeatureItemNode[]>,
  drawings: readonly Drawing[],
  metadataIndex: Map<string, LayerCatalogMetadataEntry>,
): void {
  const groups = new Map<string, LayerCatalogFeatureItemNode[]>()
  for (const drawing of drawings) {
    const layerId = getDrawingLayerNodeId(drawing.type)
    const items = groups.get(layerId) ?? []
    items.push(
      createFeatureItem({
        id: getDrawingFeatureNodeId(drawing.id),
        parentId: layerId,
        label: drawing.name,
        fallbackOrder: drawing.display_order,
        metadataIndex,
        entity: { type: 'drawing', drawing },
      }),
    )
    groups.set(layerId, items)
  }

  for (const [layerId, items] of groups) {
    target.set(layerId, items)
  }
}

function createFeatureItem(args: {
  readonly id: string
  readonly parentId: string
  readonly label: string
  readonly fallbackOrder: number
  readonly metadataIndex: Map<string, LayerCatalogMetadataEntry>
  readonly entity: LayerCatalogFeatureItemNode['entity']
}): LayerCatalogFeatureItemNode {
  const metadata = args.metadataIndex.get(args.id)
  return {
    id: args.id,
    kind: 'feature_item',
    label: args.label,
    alias: metadata?.alias ?? null,
    displayLabel: metadata?.alias?.trim() ? metadata.alias : args.label,
    isFavorite: metadata?.isFavorite ?? false,
    isVisible: metadata?.isVisible ?? true,
    displayOrder: metadata?.displayOrder ?? args.fallbackOrder,
    parentId: args.parentId,
    entity: args.entity,
  }
}

function compareNodes(
  left: { readonly displayOrder: number; readonly displayLabel: string },
  right: { readonly displayOrder: number; readonly displayLabel: string },
): number {
  if (left.displayOrder !== right.displayOrder) {
    return left.displayOrder - right.displayOrder
  }

  return left.displayLabel.localeCompare(right.displayLabel)
}
