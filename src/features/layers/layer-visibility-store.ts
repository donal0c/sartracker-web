import { create } from 'zustand'

import type {
  Drawing,
  DrawingType,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import {
  getDrawingLayerNodeId,
  getMarkerLayerNodeId,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from './layer-catalog-ids'

export const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
  line: 'Lines',
  search_area: 'Search Areas',
  range_ring: 'Range Rings',
  bearing_line: 'Bearing Lines',
  search_sector: 'Search Sectors',
  text_label: 'Text Labels',
}

export const MARKER_TYPE_LABELS: Record<MarkerType, string> = {
  ipp_lkp: 'IPP / LKP',
  clue: 'Clues',
  hazard: 'Hazards',
  casualty: 'Casualties',
}

type LayerVisibilityState = {
  readonly panelExpanded: boolean
  readonly peopleSearch: string
  readonly hiddenDeviceIds: readonly string[]
  readonly markerTypeVisibility: Record<MarkerType, boolean>
  readonly drawingTypeVisibility: Record<DrawingType, boolean>
  readonly hiddenDrawingIds: readonly string[]
  readonly setPanelExpanded: (expanded: boolean) => void
  readonly setPeopleSearch: (value: string) => void
  readonly toggleDeviceVisibility: (deviceId: string) => void
  readonly showAllDevices: () => void
  readonly hideAllDevices: (deviceIds: readonly string[]) => void
  readonly setMarkerTypeVisibility: (type: MarkerType, visible: boolean) => void
  readonly showAllMarkerTypes: () => void
  readonly hideAllMarkerTypes: () => void
  readonly setDrawingTypeVisibility: (type: DrawingType, visible: boolean) => void
  readonly showAllDrawingTypes: () => void
  readonly hideAllDrawingTypes: () => void
  readonly toggleDrawingVisibility: (drawingId: string) => void
  readonly showAllDrawings: () => void
  readonly hideAllDrawings: (drawings: readonly Drawing[]) => void
  readonly hydrateCatalogVisibility: (root: LayerCatalogRootNode) => void
}

const DEFAULT_MARKER_TYPE_VISIBILITY: Record<MarkerType, boolean> = {
  ipp_lkp: true,
  clue: true,
  hazard: true,
  casualty: true,
}

const DEFAULT_DRAWING_TYPE_VISIBILITY: Record<DrawingType, boolean> = {
  line: true,
  search_area: true,
  range_ring: true,
  bearing_line: true,
  search_sector: true,
  text_label: true,
}

export const useLayerVisibilityStore = create<LayerVisibilityState>((set) => ({
  panelExpanded: true,
  peopleSearch: '',
  hiddenDeviceIds: [],
  markerTypeVisibility: DEFAULT_MARKER_TYPE_VISIBILITY,
  drawingTypeVisibility: DEFAULT_DRAWING_TYPE_VISIBILITY,
  hiddenDrawingIds: [],
  setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),
  setPeopleSearch: (value) => set({ peopleSearch: value }),
  toggleDeviceVisibility: (deviceId) =>
    set((state) => ({
      hiddenDeviceIds: state.hiddenDeviceIds.includes(deviceId)
        ? state.hiddenDeviceIds.filter((candidate) => candidate !== deviceId)
        : [...state.hiddenDeviceIds, deviceId],
    })),
  showAllDevices: () => set({ hiddenDeviceIds: [] }),
  hideAllDevices: (deviceIds) => set({ hiddenDeviceIds: [...deviceIds] }),
  setMarkerTypeVisibility: (type, visible) =>
    set((state) => ({
      markerTypeVisibility: {
        ...state.markerTypeVisibility,
        [type]: visible,
      },
    })),
  showAllMarkerTypes: () => set({ markerTypeVisibility: DEFAULT_MARKER_TYPE_VISIBILITY }),
  hideAllMarkerTypes: () =>
    set({
      markerTypeVisibility: {
        ipp_lkp: false,
        clue: false,
        hazard: false,
        casualty: false,
      },
    }),
  setDrawingTypeVisibility: (type, visible) =>
    set((state) => ({
      drawingTypeVisibility: {
        ...state.drawingTypeVisibility,
        [type]: visible,
      },
    })),
  showAllDrawingTypes: () => set({ drawingTypeVisibility: DEFAULT_DRAWING_TYPE_VISIBILITY }),
  hideAllDrawingTypes: () =>
    set({
      drawingTypeVisibility: {
        line: false,
        search_area: false,
        range_ring: false,
        bearing_line: false,
        search_sector: false,
        text_label: false,
      },
    }),
  toggleDrawingVisibility: (drawingId) =>
    set((state) => ({
      hiddenDrawingIds: state.hiddenDrawingIds.includes(drawingId)
        ? state.hiddenDrawingIds.filter((candidate) => candidate !== drawingId)
        : [...state.hiddenDrawingIds, drawingId],
    })),
  showAllDrawings: () => set({ hiddenDrawingIds: [] }),
  hideAllDrawings: (drawings) => set({ hiddenDrawingIds: drawings.map((drawing) => drawing.id) }),
  hydrateCatalogVisibility: (root) =>
    set({
      hiddenDeviceIds: collectHiddenDeviceIds(root),
      markerTypeVisibility: {
        ipp_lkp: readLayerVisibility(root, getMarkerLayerNodeId('ipp_lkp')),
        clue: readLayerVisibility(root, getMarkerLayerNodeId('clue')),
        hazard: readLayerVisibility(root, getMarkerLayerNodeId('hazard')),
        casualty: readLayerVisibility(root, getMarkerLayerNodeId('casualty')),
      },
      drawingTypeVisibility: {
        line: readLayerVisibility(root, getDrawingLayerNodeId('line')),
        search_area: readLayerVisibility(root, getDrawingLayerNodeId('search_area')),
        range_ring: readLayerVisibility(root, getDrawingLayerNodeId('range_ring')),
        bearing_line: readLayerVisibility(root, getDrawingLayerNodeId('bearing_line')),
        search_sector: readLayerVisibility(root, getDrawingLayerNodeId('search_sector')),
        text_label: readLayerVisibility(root, getDrawingLayerNodeId('text_label')),
      },
      hiddenDrawingIds: collectHiddenDrawingIds(root),
    }),
}))

export function isDeviceVisible(hiddenDeviceIds: readonly string[], deviceId: string): boolean {
  return !hiddenDeviceIds.includes(deviceId)
}

export function isMarkerTypeVisible(
  markerTypeVisibility: Record<MarkerType, boolean>,
  markerType: MarkerType,
): boolean {
  return markerTypeVisibility[markerType]
}

export function isDrawingVisible(
  drawingTypeVisibility: Record<DrawingType, boolean>,
  hiddenDrawingIds: readonly string[],
  drawing: Drawing,
): boolean {
  return drawingTypeVisibility[drawing.type] && !hiddenDrawingIds.includes(drawing.id)
}

function readLayerVisibility(root: LayerCatalogRootNode, layerId: string): boolean {
  const layer = root.children
    .flatMap((group) => group.children)
    .find((candidate) => candidate.id === layerId)

  return layer?.isVisible ?? true
}

function collectHiddenDeviceIds(root: LayerCatalogRootNode): readonly string[] {
  const deviceLayer = root.children
    .flatMap((group) => group.children)
    .find((candidate) => candidate.id === TRACKING_DEVICES_LAYER_NODE_ID)

  if (deviceLayer === undefined) {
    return []
  }

  if (!deviceLayer.isVisible) {
    return deviceLayer.children
      .flatMap((child) =>
        child.entity?.type === 'device' ? [child.entity.device.device_id] : [],
      )
  }

  return deviceLayer.children.flatMap((child) =>
    child.entity?.type === 'device' && !child.isVisible ? [child.entity.device.device_id] : [],
  )
}

function collectHiddenDrawingIds(root: LayerCatalogRootNode): readonly string[] {
  return root.children
    .flatMap((group) => group.children)
    .filter((layer) => layer.id.startsWith('layer:drawings:'))
    .flatMap((layer) =>
      layer.children.flatMap((child) =>
        child.entity?.type === 'drawing' && !child.isVisible ? [child.entity.drawing.id] : [],
      ),
    )
}
