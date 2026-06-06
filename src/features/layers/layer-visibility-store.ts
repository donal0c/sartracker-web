import { create } from 'zustand'

import type {
  Drawing,
  DrawingType,
  HelicopterSlotKey,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import {
  GPX_TRACKS_GROUP_NODE_ID,
  getDrawingLayerNodeId,
  getHelicopterLayerNodeId,
  getMarkerLayerNodeId,
  HELICOPTERS_GROUP_NODE_ID,
  MAP_TOOLS_GROUP_NODE_ID,
  MEASUREMENTS_LAYER_NODE_ID,
  TRACKING_GROUP_NODE_ID,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from './layer-catalog-ids'

export type LayerGroupVisibility = {
  readonly tracking: boolean
  readonly helicopters: boolean
  readonly mapTools: boolean
  readonly gpxTracks: boolean
}

type LayerVisibilityState = {
  readonly hydratedMissionId: string | null
  readonly groupVisibility: LayerGroupVisibility
  readonly hiddenDeviceIds: readonly string[]
  readonly hiddenMarkerIds: readonly string[]
  readonly hiddenHelicopterIds: readonly string[]
  readonly hiddenGpxImportIds: readonly string[]
  readonly markerTypeVisibility: Record<MarkerType, boolean>
  readonly helicopterSlotVisibility: Record<HelicopterSlotKey, boolean>
  readonly drawingTypeVisibility: Record<DrawingType, boolean>
  readonly hiddenDrawingIds: readonly string[]
  readonly hiddenMeasurementIds: readonly string[]
  readonly breadcrumbsVisible: boolean
  readonly measurementsVisible: boolean
  readonly setGroupVisibility: (group: keyof LayerGroupVisibility, visible: boolean) => void
  readonly toggleDeviceVisibility: (deviceId: string) => void
  readonly toggleMarkerVisibility: (markerId: string) => void
  readonly toggleHelicopterVisibility: (helicopterId: string) => void
  readonly toggleGpxImportVisibility: (importId: string) => void
  readonly showAllDevices: () => void
  readonly hideAllDevices: (deviceIds: readonly string[]) => void
  readonly setMarkerTypeVisibility: (type: MarkerType, visible: boolean) => void
  readonly showAllMarkerTypes: () => void
  readonly hideAllMarkerTypes: () => void
  readonly setDrawingTypeVisibility: (type: DrawingType, visible: boolean) => void
  readonly setHelicopterSlotVisibility: (slotKey: HelicopterSlotKey, visible: boolean) => void
  readonly showAllDrawingTypes: () => void
  readonly hideAllDrawingTypes: () => void
  readonly toggleDrawingVisibility: (drawingId: string) => void
  readonly showAllDrawings: () => void
  readonly hideAllDrawings: (drawings: readonly Drawing[]) => void
  readonly toggleMeasurementVisibility: (measurementId: string) => void
  readonly setBreadcrumbsVisible: (visible: boolean) => void
  readonly setMeasurementsVisible: (visible: boolean) => void
  readonly hydrateCatalogVisibility: (missionId: string | null, root: LayerCatalogRootNode) => void
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

const DEFAULT_HELICOPTER_SLOT_VISIBILITY: Record<HelicopterSlotKey, boolean> = {
  slot_1: true,
  slot_2: true,
  slot_3: true,
  slot_4: true,
}

const DEFAULT_GROUP_VISIBILITY: LayerGroupVisibility = {
  tracking: true,
  helicopters: true,
  mapTools: true,
  gpxTracks: true,
}

export const useLayerVisibilityStore = create<LayerVisibilityState>((set) => ({
  hydratedMissionId: null,
  groupVisibility: DEFAULT_GROUP_VISIBILITY,
  hiddenDeviceIds: [],
  hiddenMarkerIds: [],
  hiddenHelicopterIds: [],
  hiddenGpxImportIds: [],
  markerTypeVisibility: DEFAULT_MARKER_TYPE_VISIBILITY,
  helicopterSlotVisibility: DEFAULT_HELICOPTER_SLOT_VISIBILITY,
  drawingTypeVisibility: DEFAULT_DRAWING_TYPE_VISIBILITY,
  hiddenDrawingIds: [],
  hiddenMeasurementIds: [],
  breadcrumbsVisible: true,
  measurementsVisible: true,
  setGroupVisibility: (group, visible) =>
    set((state) => ({
      groupVisibility: {
        ...state.groupVisibility,
        [group]: visible,
      },
    })),
  toggleDeviceVisibility: (deviceId) =>
    set((state) => ({
      hiddenDeviceIds: state.hiddenDeviceIds.includes(deviceId)
        ? state.hiddenDeviceIds.filter((candidate) => candidate !== deviceId)
        : [...state.hiddenDeviceIds, deviceId],
    })),
  toggleMarkerVisibility: (markerId) =>
    set((state) => ({
      hiddenMarkerIds: state.hiddenMarkerIds.includes(markerId)
        ? state.hiddenMarkerIds.filter((candidate) => candidate !== markerId)
        : [...state.hiddenMarkerIds, markerId],
    })),
  toggleHelicopterVisibility: (helicopterId) =>
    set((state) => ({
      hiddenHelicopterIds: state.hiddenHelicopterIds.includes(helicopterId)
        ? state.hiddenHelicopterIds.filter((candidate) => candidate !== helicopterId)
        : [...state.hiddenHelicopterIds, helicopterId],
    })),
  toggleGpxImportVisibility: (importId) =>
    set((state) => ({
      hiddenGpxImportIds: state.hiddenGpxImportIds.includes(importId)
        ? state.hiddenGpxImportIds.filter((candidate) => candidate !== importId)
        : [...state.hiddenGpxImportIds, importId],
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
  setHelicopterSlotVisibility: (slotKey, visible) =>
    set((state) => ({
      helicopterSlotVisibility: {
        ...state.helicopterSlotVisibility,
        [slotKey]: visible,
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
  toggleMeasurementVisibility: (measurementId) =>
    set((state) => ({
      hiddenMeasurementIds: state.hiddenMeasurementIds.includes(measurementId)
        ? state.hiddenMeasurementIds.filter((candidate) => candidate !== measurementId)
        : [...state.hiddenMeasurementIds, measurementId],
    })),
  setBreadcrumbsVisible: (visible) => set({ breadcrumbsVisible: visible }),
  setMeasurementsVisible: (visible) => set({ measurementsVisible: visible }),
  hydrateCatalogVisibility: (missionId, root) =>
    set((state) => {
      const nextHiddenDeviceIds = collectHiddenDeviceIds(root)
      const nextHiddenMarkerIds = collectHiddenMarkerIds(root)
      const nextHiddenHelicopterIds = collectHiddenHelicopterIds(root)
      const nextHiddenGpxImportIds = collectHiddenGpxImportIds(root)
      const nextHiddenDrawingIds = collectHiddenDrawingIds(root)
      const nextHiddenMeasurementIds = collectHiddenMeasurementIds(root)
      const nextGroupVisibility: LayerGroupVisibility = {
        tracking: readGroupVisibility(root, TRACKING_GROUP_NODE_ID),
        helicopters: readGroupVisibility(root, HELICOPTERS_GROUP_NODE_ID),
        mapTools: readGroupVisibility(root, MAP_TOOLS_GROUP_NODE_ID),
        gpxTracks: readGroupVisibility(root, GPX_TRACKS_GROUP_NODE_ID),
      }
      const nextMarkerTypeVisibility: Record<MarkerType, boolean> = {
        ipp_lkp: readLayerVisibility(root, getMarkerLayerNodeId('ipp_lkp')),
        clue: readLayerVisibility(root, getMarkerLayerNodeId('clue')),
        hazard: readLayerVisibility(root, getMarkerLayerNodeId('hazard')),
        casualty: readLayerVisibility(root, getMarkerLayerNodeId('casualty')),
      }
      const nextDrawingTypeVisibility: Record<DrawingType, boolean> = {
        line: readLayerVisibility(root, getDrawingLayerNodeId('line')),
        search_area: readLayerVisibility(root, getDrawingLayerNodeId('search_area')),
        range_ring: readLayerVisibility(root, getDrawingLayerNodeId('range_ring')),
        bearing_line: readLayerVisibility(root, getDrawingLayerNodeId('bearing_line')),
        search_sector: readLayerVisibility(root, getDrawingLayerNodeId('search_sector')),
        text_label: readLayerVisibility(root, getDrawingLayerNodeId('text_label')),
      }
      const nextHelicopterSlotVisibility: Record<HelicopterSlotKey, boolean> = {
        slot_1: readLayerVisibility(root, getHelicopterLayerNodeId('slot_1')),
        slot_2: readLayerVisibility(root, getHelicopterLayerNodeId('slot_2')),
        slot_3: readLayerVisibility(root, getHelicopterLayerNodeId('slot_3')),
        slot_4: readLayerVisibility(root, getHelicopterLayerNodeId('slot_4')),
      }
      const nextBreadcrumbsVisible = readLayerVisibility(root, TRACKING_BREADCRUMBS_LAYER_NODE_ID)
      const nextMeasurementsVisible = readLayerVisibility(root, MEASUREMENTS_LAYER_NODE_ID)

      // Preserve existing array/object references when values are unchanged to
      // avoid unnecessary re-renders in overlay hooks that depend on these values.
      const hiddenDeviceIds = shallowStringArrayEqual(state.hiddenDeviceIds, nextHiddenDeviceIds)
        ? state.hiddenDeviceIds
        : nextHiddenDeviceIds
      const hiddenMarkerIds = shallowStringArrayEqual(state.hiddenMarkerIds, nextHiddenMarkerIds)
        ? state.hiddenMarkerIds
        : nextHiddenMarkerIds
      const hiddenHelicopterIds = shallowStringArrayEqual(
        state.hiddenHelicopterIds,
        nextHiddenHelicopterIds,
      )
        ? state.hiddenHelicopterIds
        : nextHiddenHelicopterIds
      const hiddenGpxImportIds = shallowStringArrayEqual(state.hiddenGpxImportIds, nextHiddenGpxImportIds)
        ? state.hiddenGpxImportIds
        : nextHiddenGpxImportIds
      const hiddenDrawingIds = shallowStringArrayEqual(state.hiddenDrawingIds, nextHiddenDrawingIds)
        ? state.hiddenDrawingIds
        : nextHiddenDrawingIds
      const hiddenMeasurementIds = shallowStringArrayEqual(state.hiddenMeasurementIds, nextHiddenMeasurementIds)
        ? state.hiddenMeasurementIds
        : nextHiddenMeasurementIds
      const groupVisibility = shallowRecordEqual(state.groupVisibility, nextGroupVisibility)
        ? state.groupVisibility
        : nextGroupVisibility
      const markerTypeVisibility = shallowRecordEqual(state.markerTypeVisibility, nextMarkerTypeVisibility)
        ? state.markerTypeVisibility
        : nextMarkerTypeVisibility
      const drawingTypeVisibility = shallowRecordEqual(state.drawingTypeVisibility, nextDrawingTypeVisibility)
        ? state.drawingTypeVisibility
        : nextDrawingTypeVisibility
      const helicopterSlotVisibility = shallowRecordEqual(
        state.helicopterSlotVisibility,
        nextHelicopterSlotVisibility,
      )
        ? state.helicopterSlotVisibility
        : nextHelicopterSlotVisibility

      if (
        state.hydratedMissionId === missionId &&
        hiddenDeviceIds === state.hiddenDeviceIds &&
        hiddenMarkerIds === state.hiddenMarkerIds &&
        hiddenHelicopterIds === state.hiddenHelicopterIds &&
        hiddenGpxImportIds === state.hiddenGpxImportIds &&
        hiddenDrawingIds === state.hiddenDrawingIds &&
        hiddenMeasurementIds === state.hiddenMeasurementIds &&
        groupVisibility === state.groupVisibility &&
        markerTypeVisibility === state.markerTypeVisibility &&
        helicopterSlotVisibility === state.helicopterSlotVisibility &&
        drawingTypeVisibility === state.drawingTypeVisibility &&
        nextBreadcrumbsVisible === state.breadcrumbsVisible &&
        nextMeasurementsVisible === state.measurementsVisible
      ) {
        return state
      }

      return {
        hydratedMissionId: missionId,
        hiddenDeviceIds,
        hiddenMarkerIds,
        hiddenHelicopterIds,
        hiddenGpxImportIds,
        hiddenDrawingIds,
        hiddenMeasurementIds,
        groupVisibility,
        markerTypeVisibility,
        helicopterSlotVisibility,
        drawingTypeVisibility,
        breadcrumbsVisible: nextBreadcrumbsVisible,
        measurementsVisible: nextMeasurementsVisible,
      }
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

export function isMarkerVisible(
  markerTypeVisibility: Record<MarkerType, boolean>,
  hiddenMarkerIds: readonly string[],
  marker: { readonly id: string; readonly type: MarkerType },
): boolean {
  return markerTypeVisibility[marker.type] && !hiddenMarkerIds.includes(marker.id)
}

function readLayerVisibility(root: LayerCatalogRootNode, layerId: string): boolean {
  const layer = root.children
    .flatMap((group) => group.children)
    .find((candidate) => candidate.id === layerId)

  return layer?.isVisible ?? true
}

function readGroupVisibility(root: LayerCatalogRootNode, groupId: string): boolean {
  const group = root.children.find((candidate) => candidate.id === groupId)
  return group?.isVisible ?? true
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

function collectHiddenMeasurementIds(root: LayerCatalogRootNode): readonly string[] {
  return root.children
    .flatMap((group) => group.children)
    .filter((layer) => layer.id === MEASUREMENTS_LAYER_NODE_ID)
    .flatMap((layer) =>
      layer.children.flatMap((child) =>
        child.entity?.type === 'measurement' && !child.isVisible ? [child.entity.measurement.id] : [],
      ),
    )
}

function collectHiddenMarkerIds(root: LayerCatalogRootNode): readonly string[] {
  return root.children
    .flatMap((group) => group.children)
    .filter((layer) => layer.id.startsWith('layer:markers:'))
    .flatMap((layer) =>
      layer.children.flatMap((child) =>
        child.entity?.type === 'marker' && !child.isVisible ? [child.entity.marker.id] : [],
      ),
    )
}

function collectHiddenHelicopterIds(root: LayerCatalogRootNode): readonly string[] {
  return root.children
    .flatMap((group) => group.children)
    .filter((layer) => layer.id.startsWith('layer:helicopters:'))
    .flatMap((layer) =>
      layer.children.flatMap((child) =>
        child.entity?.type === 'helicopter' && !child.isVisible ? [child.entity.helicopter.id] : [],
      ),
    )
}

function shallowStringArrayEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }

  return true
}

function shallowRecordEqual<K extends string>(
  a: Record<K, boolean>,
  b: Record<K, boolean>,
): boolean {
  const keysA = Object.keys(a) as K[]
  const keysB = Object.keys(b) as K[]

  if (keysA.length !== keysB.length) {
    return false
  }

  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false
    }
  }

  return true
}

function collectHiddenGpxImportIds(root: LayerCatalogRootNode): readonly string[] {
  return root.children
    .flatMap((group) => group.children)
    .filter((layer) => layer.id.startsWith('layer:gpx:'))
    .flatMap((layer) =>
      layer.children.flatMap((child) =>
        child.entity?.type === 'gpx_import' &&
        (!layer.isVisible || !child.isVisible)
          ? [child.entity.gpxImport.id]
          : [],
      ),
    )
}
