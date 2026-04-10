import type { Drawing, Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import type { NormalizedTrackingDevice } from '../tracking/tracking-types'

export type LayerCatalogNodeKind = 'root' | 'group' | 'layer' | 'feature_item'

export type LayerCatalogGroupKey = 'tracking' | 'helicopters' | 'map_tools' | 'gpx_tracks'

export type LayerCatalogLayerKey =
  | 'tracking_devices'
  | 'tracking_breadcrumbs'
  | 'helicopter_slot_1'
  | 'helicopter_slot_2'
  | 'helicopter_slot_3'
  | 'helicopter_slot_4'
  | 'marker_ipp_lkp'
  | 'marker_clue'
  | 'marker_hazard'
  | 'marker_casualty'
  | 'drawing_line'
  | 'drawing_search_area'
  | 'drawing_range_ring'
  | 'drawing_bearing_line'
  | 'drawing_search_sector'
  | 'drawing_text_label'
  | 'measurement'
  | 'gpx_tracks'

export type LayerCatalogMetadataEntry = {
  readonly missionId: string
  readonly nodeId: string
  readonly parentNodeId: string | null
  readonly nodeKind: Exclude<LayerCatalogNodeKind, 'root'>
  readonly alias: string | null
  readonly isFavorite: boolean
  readonly isVisible: boolean
  readonly displayOrder: number
  readonly metadataJson: string | null
  readonly updatedAt: string
}

export type UpsertLayerCatalogMetadataInput = {
  readonly missionId: string
  readonly nodeId: string
  readonly parentNodeId: string | null
  readonly nodeKind: Exclude<LayerCatalogNodeKind, 'root'>
  readonly alias?: string | null
  readonly isFavorite?: boolean
  readonly isVisible?: boolean
  readonly displayOrder?: number
  readonly metadataJson?: string | null
}

type LayerCatalogBaseNode = {
  readonly id: string
  readonly kind: LayerCatalogNodeKind
  readonly label: string
  readonly alias: string | null
  readonly displayLabel: string
  readonly isFavorite: boolean
  readonly isVisible: boolean
  readonly displayOrder: number
  readonly parentId: string | null
}

export type LayerCatalogFeatureEntity =
  | { readonly type: 'device'; readonly device: NormalizedTrackingDevice }
  | { readonly type: 'marker'; readonly marker: Marker }
  | { readonly type: 'drawing'; readonly drawing: Drawing }

export type LayerCatalogFeatureItemNode = LayerCatalogBaseNode & {
  readonly kind: 'feature_item'
  readonly entity: LayerCatalogFeatureEntity | null
}

export type LayerCatalogLayerNode = LayerCatalogBaseNode & {
  readonly kind: 'layer'
  readonly layerKey: LayerCatalogLayerKey
  readonly summary: {
    readonly totalCount: number
    readonly visibleCount: number
  }
  readonly children: readonly LayerCatalogFeatureItemNode[]
}

export type LayerCatalogGroupNode = LayerCatalogBaseNode & {
  readonly kind: 'group'
  readonly groupKey: LayerCatalogGroupKey
  readonly children: readonly LayerCatalogLayerNode[]
}

export type LayerCatalogRootNode = LayerCatalogBaseNode & {
  readonly kind: 'root'
  readonly children: readonly LayerCatalogGroupNode[]
}

export type LayerCatalogBuildInput = {
  readonly missionId: string | null
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly metadataEntries: readonly LayerCatalogMetadataEntry[]
}

export type LayerCatalogTree = {
  readonly root: LayerCatalogRootNode
  readonly metadataEntries: readonly LayerCatalogMetadataEntry[]
}

export const LAYER_CATALOG_ROOT_ID = 'root:mission-catalog'

export function createEmptyLayerCatalogTree(): LayerCatalogTree {
  return {
    root: {
      id: LAYER_CATALOG_ROOT_ID,
      kind: 'root',
      label: 'Mission Catalog',
      alias: null,
      displayLabel: 'Mission Catalog',
      isFavorite: false,
      isVisible: true,
      displayOrder: 0,
      parentId: null,
      children: [],
    },
    metadataEntries: [],
  }
}
