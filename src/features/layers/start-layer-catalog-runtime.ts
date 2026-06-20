import type {
  Drawing,
  GpxTrackImport,
  Helicopter,
  Marker,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { Measurement } from '../measurements/measurement-types'
import type { NormalizedTrackingDevice } from '../tracking/tracking-types'
import { buildLayerCatalogTree } from './layer-catalog-builder'
import type { LayerCatalogNode } from './layer-catalog-tree'
import { createEmptyLayerCatalogTree } from './layer-catalog-types'
import type {
  LayerCatalogMetadataEntry,
  LayerCatalogNodeKind,
  LayerCatalogRootNode,
  UpsertLayerCatalogMetadataInput,
} from './layer-catalog-types'

type LayerCatalogStoreBoundary = {
  readonly listMetadata: (missionId: string) => Promise<readonly LayerCatalogMetadataEntry[]>
  readonly upsertMetadata: (
    input: UpsertLayerCatalogMetadataInput,
  ) => Promise<LayerCatalogMetadataEntry>
}

export type LayerCatalogRuntimeState = {
  readonly missionId: string | null
  readonly root: LayerCatalogRootNode
  readonly metadataEntries: readonly LayerCatalogMetadataEntry[]
  readonly loading: boolean
  readonly error: string | null
  readonly selectedNodeId: string | null
}

type StartLayerCatalogRuntimeDependencies = {
  readonly layerCatalogStore: LayerCatalogStoreBoundary
  readonly applyRuntime: (runtime: LayerCatalogRuntimeState) => void
}

type RefreshCatalogInput = {
  readonly missionId: string | null
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly helicopters: readonly Helicopter[]
  readonly gpxImports: readonly GpxTrackImport[]
  readonly measurements: readonly Measurement[]
}

export type LayerCatalogController = {
  readonly refreshCatalog: (input: RefreshCatalogInput) => Promise<void>
  readonly forceRefresh: () => Promise<void>
  readonly selectNode: (nodeId: string | null) => void
  readonly renameNode: (nodeId: string, alias: string | null) => Promise<void>
  readonly setNodeVisibility: (nodeId: string, visible: boolean) => Promise<void>
  readonly setNodeVisibilities: (nodeIds: readonly string[], visible: boolean) => Promise<void>
  readonly reorderNode: (
    parentNodeId: string,
    orderedNodeIds: readonly string[],
  ) => Promise<void>
}

export async function startLayerCatalogRuntime(
  dependencies: StartLayerCatalogRuntimeDependencies,
): Promise<LayerCatalogController> {
  let missionId: string | null = null
  let root = createEmptyLayerCatalogTree().root
  let metadataEntries: readonly LayerCatalogMetadataEntry[] = []
  let loading = false
  let error: string | null = null
  let selectedNodeId: string | null = null
  let lastDevices: readonly NormalizedTrackingDevice[] = []
  let lastMarkers: readonly Marker[] = []
  let lastDrawings: readonly Drawing[] = []
  let lastHelicopters: readonly Helicopter[] = []
  let lastGpxImports: readonly GpxTrackImport[] = []
  let lastMeasurements: readonly Measurement[] = []
  let nodeIndex = buildNodeIndex(root)
  let latestRefreshRequestId = 0
  let refreshInvalidationVersion = 0
  let lastPublishedInputSignature: string | null = null

  publishRuntime()

  return {
    refreshCatalog: async (input) => {
      missionId = input.missionId
      lastDevices = input.devices
      lastMarkers = input.markers
      lastDrawings = input.drawings
      lastHelicopters = input.helicopters
      lastGpxImports = input.gpxImports
      lastMeasurements = input.measurements
      error = null

      if (missionId === null) {
        metadataEntries = []
        root = createEmptyLayerCatalogTree().root
        nodeIndex = buildNodeIndex(root)
        selectedNodeId = null
        loading = false
        lastPublishedInputSignature = null
        publishRuntime()
        return
      }

      const inputSignature = buildRefreshInputSignature(input)
      if (inputSignature === lastPublishedInputSignature) {
        return
      }

      const requestId = ++latestRefreshRequestId
      const invalidationVersionAtStart = refreshInvalidationVersion
      loading = true
      publishRuntime()
      try {
        const nextMetadataEntries = await dependencies.layerCatalogStore.listMetadata(missionId)
        if (
          requestId !== latestRefreshRequestId ||
          invalidationVersionAtStart !== refreshInvalidationVersion
        ) {
          return
        }
        metadataEntries = nextMetadataEntries
        lastPublishedInputSignature = inputSignature
        rebuild()
      } catch (runtimeError) {
        loading = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
        throw runtimeError
      }
    },
    forceRefresh: async () => {
      if (missionId === null) {
        return
      }

      loading = true
      error = null
      publishRuntime()
      try {
        const requestId = ++latestRefreshRequestId
        const invalidationVersionAtStart = refreshInvalidationVersion
        const nextMetadataEntries = await dependencies.layerCatalogStore.listMetadata(missionId)
        if (
          requestId !== latestRefreshRequestId ||
          invalidationVersionAtStart !== refreshInvalidationVersion
        ) {
          return
        }
        metadataEntries = nextMetadataEntries
        lastPublishedInputSignature = buildRefreshInputSignature({
          missionId,
          devices: lastDevices,
          markers: lastMarkers,
          drawings: lastDrawings,
          helicopters: lastHelicopters,
          gpxImports: lastGpxImports,
          measurements: lastMeasurements,
        })
        rebuild()
      } catch (runtimeError) {
        loading = false
        error = toErrorMessage(runtimeError)
        publishRuntime()
      }
    },
    selectNode: (nodeId) => {
      selectedNodeId = nodeId
      publishRuntime()
    },
    renameNode: async (nodeId, alias) => {
      await persistNodePatch(nodeId, { alias })
    },
    setNodeVisibility: async (nodeId, visible) => {
      await persistNodePatch(nodeId, { isVisible: visible })
    },
    setNodeVisibilities: async (nodeIds, visible) => {
      await persistNodePatches(nodeIds, { isVisible: visible })
    },
    reorderNode: async (parentNodeId, orderedNodeIds) => {
      refreshInvalidationVersion += 1
      const parent = requireNode(parentNodeId)
      const currentOrder = getChildNodeIds(parent)
      const nextOrder = mergeChildOrder(currentOrder, orderedNodeIds)

      for (const [index, nodeId] of nextOrder.entries()) {
        const node = requireNode(nodeId)
        const entry = findEntry(nodeId)
        await dependencies.layerCatalogStore.upsertMetadata({
          missionId: assertMissionId(),
          nodeId,
          parentNodeId: node.parentId,
          nodeKind: assertMutableNodeKind(node.kind),
          alias: entry?.alias ?? node.alias ?? null,
          isFavorite: entry?.isFavorite ?? node.isFavorite,
          isVisible: entry?.isVisible ?? node.isVisible,
          displayOrder: index,
          metadataJson: entry?.metadataJson ?? null,
        })
      }
      metadataEntries = await dependencies.layerCatalogStore.listMetadata(assertMissionId())
      rebuild()
    },
  }

  async function persistNodePatch(
    nodeId: string,
    patch: Partial<Pick<LayerCatalogMetadataEntry, 'alias' | 'isFavorite' | 'isVisible'>>,
  ): Promise<void> {
    await persistNodePatches([nodeId], patch)
  }

  async function persistNodePatches(
    nodeIds: readonly string[],
    patch: Partial<Pick<LayerCatalogMetadataEntry, 'alias' | 'isFavorite' | 'isVisible'>>,
  ): Promise<void> {
    refreshInvalidationVersion += 1
    const missionId = assertMissionId()
    const nextEntries = await Promise.all(
      nodeIds.map((nodeId) => {
        const node = requireNode(nodeId)
        const entry = findEntry(nodeId)
        return dependencies.layerCatalogStore.upsertMetadata({
          missionId,
          nodeId,
          parentNodeId: node.parentId,
          nodeKind: assertMutableNodeKind(node.kind),
          alias: patch.alias ?? entry?.alias ?? node.alias ?? null,
          isFavorite: patch.isFavorite ?? entry?.isFavorite ?? node.isFavorite,
          isVisible: patch.isVisible ?? entry?.isVisible ?? node.isVisible,
          displayOrder: entry?.displayOrder ?? node.displayOrder,
          metadataJson: entry?.metadataJson ?? null,
        })
      }),
    )
    metadataEntries = nextEntries.reduce(
      (currentEntries, nextEntry) => upsertMetadataEntry(currentEntries, nextEntry),
      metadataEntries,
    )
    rebuild()
  }

  function rebuild(): void {
    root = buildLayerCatalogTree({
      missionId,
      devices: lastDevices,
      markers: lastMarkers,
      drawings: lastDrawings,
      helicopters: lastHelicopters,
      gpxImports: lastGpxImports,
      measurements: lastMeasurements,
      metadataEntries,
    })
    nodeIndex = buildNodeIndex(root)
    loading = false
    error = null
    if (selectedNodeId !== null && !nodeIndex.has(selectedNodeId)) {
      selectedNodeId = null
    }
    publishRuntime()
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      missionId,
      root,
      metadataEntries,
      loading,
      error,
      selectedNodeId,
    })
  }

  function assertMissionId(): string {
    if (missionId === null) {
      throw new Error('Layer catalog is not attached to an active mission.')
    }

    return missionId
  }

  function findEntry(nodeId: string): LayerCatalogMetadataEntry | undefined {
    return metadataEntries.find((entry) => entry.nodeId === nodeId)
  }

  function requireNode(nodeId: string): LayerCatalogNode {
    const node = nodeIndex.get(nodeId)
    if (node === undefined) {
      throw new Error(`Layer catalog node was not found: ${nodeId}`)
    }

    return node
  }
}

function buildRefreshInputSignature(input: RefreshCatalogInput): string {
  if (input.missionId === null) {
    return 'mission:null'
  }

  return JSON.stringify({
    missionId: input.missionId,
    devices: input.devices.map((device) => ({
      id: device.device_id,
      name: device.name,
    })),
    markers: input.markers.map((marker) => ({
      id: marker.id,
      type: marker.type,
      name: marker.name,
      order: marker.display_order,
    })),
    drawings: input.drawings.map((drawing) => ({
      id: drawing.id,
      type: drawing.type,
      name: drawing.name,
      order: drawing.display_order,
    })),
    helicopters: input.helicopters.map((helicopter) => ({
      id: helicopter.id,
      slot: helicopter.slot_key,
      callSign: helicopter.call_sign,
    })),
    gpxImports: input.gpxImports.map((gpxImport) => ({
      id: gpxImport.id,
      name: gpxImport.display_name,
    })),
    measurements: (input.measurements ?? []).map((measurement) => ({
      id: measurement.id,
      label: measurement.label,
    })),
  })
}

function upsertMetadataEntry(
  entries: readonly LayerCatalogMetadataEntry[],
  nextEntry: LayerCatalogMetadataEntry,
): readonly LayerCatalogMetadataEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.nodeId === nextEntry.nodeId)
  if (existingIndex === -1) {
    return [...entries, nextEntry]
  }

  return entries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
}

function buildNodeIndex(root: LayerCatalogRootNode): Map<string, LayerCatalogNode> {
  const index = new Map<string, LayerCatalogNode>()
  index.set(root.id, root)

  for (const group of root.children) {
    index.set(group.id, group)
    for (const layer of group.children) {
      index.set(layer.id, layer)
      for (const featureItem of layer.children) {
        index.set(featureItem.id, featureItem)
      }
    }
  }

  return index
}

function getChildNodeIds(node: LayerCatalogNode): readonly string[] {
  switch (node.kind) {
    case 'root':
    case 'group':
    case 'layer':
      return node.children.map((child) => child.id)
    case 'feature_item':
      return []
  }
}

function mergeChildOrder(
  currentOrder: readonly string[],
  requestedOrder: readonly string[],
): readonly string[] {
  const remaining = currentOrder.filter((nodeId) => !requestedOrder.includes(nodeId))
  return [...requestedOrder.filter((nodeId) => currentOrder.includes(nodeId)), ...remaining]
}

function assertMutableNodeKind(
  nodeKind: LayerCatalogNodeKind,
): Exclude<LayerCatalogNodeKind, 'root'> {
  if (nodeKind === 'root') {
    throw new Error('Root node metadata is not persisted.')
  }

  return nodeKind
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Layer catalog operation failed.'
}
