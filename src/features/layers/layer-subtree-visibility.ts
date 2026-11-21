import { useCoverageFilterStore } from '../tracking/coverage-filter-store'
import { applyCoverageVisibilityForNodeIds } from './coverage-layer-visibility'
import {
  GPX_TRACKS_GROUP_NODE_ID,
  HELICOPTERS_GROUP_NODE_ID,
  isCoverageNodeId,
  MAP_TOOLS_GROUP_NODE_ID,
  TRACKING_GROUP_NODE_ID,
} from './layer-catalog-ids'
import { findCatalogNode, getNodeChildren } from './layer-catalog-tree'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import {
  applyVisibilityForNodeIds,
  collectSubtreeNodeIds,
} from './layer-visibility-service'
import { useLayerVisibilityStore } from './layer-visibility-store'
import type { LayerCatalogController } from './start-layer-catalog-runtime'

/**
 * Shows or hides a catalog node and everything under it. Routes runtime-only
 * coverage filters away from catalog persistence.
 *
 * `revealAncestors` also switches on any hidden group above the node when
 * showing it. The simplified workspace does not list every group (Tracking
 * lives in the People panel), so without this a group hidden earlier would
 * leave the ticked layer invisible with no way to fix it [DON-341].
 */
export async function setLayerSubtreeVisibility(input: {
  readonly root: LayerCatalogRootNode
  readonly controller: LayerCatalogController | null
  readonly nodeId: string
  readonly visible: boolean
  readonly revealAncestors?: boolean
  /** The catalog as last saved; used to undo a failed save on the map. */
  readonly readRoot?: () => LayerCatalogRootNode
}): Promise<void> {
  const node = findCatalogNode(input.root, input.nodeId)
  if (node === null) return
  const nodeIds = collectSubtreeNodeIds(input.root, node.id)

  if (isCoverageNodeId(input.nodeId)) {
    applyCoverageVisibilityForNodeIds(
      input.root,
      nodeIds,
      input.visible,
      useCoverageFilterStore.getState(),
    )
    return
  }
  if (input.controller === null) return
  const touched = new Set<string>(nodeIds)
  try {
    await applyAndPersist(input, node.id, nodeIds, touched)
  } catch (error) {
    // A failed save must not look saved: put the map back to what was saved.
    if (input.readRoot !== undefined) reconcileWithSaved(input.readRoot(), touched)
    throw error
  }
}

let visibilityQueue: Promise<void> = Promise.resolve()

/**
 * Runs visibility changes one at a time, each against the catalog as last
 * saved. Two people ticked in quick succession would otherwise each capture the
 * hidden layer and save the other person hidden [DON-341]. Rejects when a save
 * fails, after the map is put back to what was saved.
 */
export function queueLayerSubtreeVisibility(input: {
  readonly readRoot: () => LayerCatalogRootNode
  readonly controller: LayerCatalogController | null
  readonly nodeId: string
  readonly visible: boolean
  readonly revealAncestors?: boolean
}): Promise<void> {
  const run = visibilityQueue.then(() => setLayerSubtreeVisibility({ ...input, root: input.readRoot() }))
  visibilityQueue = run.catch(() => undefined)
  return run
}

async function applyAndPersist(
  input: {
    readonly root: LayerCatalogRootNode
    readonly controller: LayerCatalogController | null
    readonly visible: boolean
    readonly revealAncestors?: boolean
  },
  nodeId: string,
  nodeIds: readonly string[],
  touched: Set<string>,
): Promise<void> {
  if (input.controller === null) return
  applyVisibilityForNodeIds(
    input.root,
    nodeIds,
    input.visible,
    useLayerVisibilityStore.getState(),
  )
  await input.controller.setNodeVisibilities(nodeIds, input.visible)
  if (input.visible && input.revealAncestors === true) {
    const hiddenAncestors = findAncestorNodeIds(input.root, nodeId)
      .filter((id) => findCatalogNode(input.root, id)?.isVisible === false || isHiddenGroup(id))
    if (hiddenAncestors.length === 0) return
    // Only the group flag goes through the runtime store: applying a layer node
    // there would also show every hidden person under it. The layer node itself
    // is persisted alone, so other people's own hidden choices are kept.
    const hiddenGroups = hiddenAncestors.filter((id) => GROUP_KEY_BY_NODE_ID[id] !== undefined)
    // People under a hidden layer may only inherit its hidden state. Save them
    // hidden first, so showing the layer for one person never shows the rest,
    // now or when the mission is reopened.
    const shown = new Set(nodeIds)
    const siblingIds = hiddenAncestors
      .filter((id) => GROUP_KEY_BY_NODE_ID[id] === undefined)
      .flatMap((id) => {
        const layer = findCatalogNode(input.root, id)
        return layer === null ? [] : getNodeChildren(layer).map((child) => child.id).filter((childId) => !shown.has(childId))
      })
    for (const id of [...siblingIds, ...hiddenAncestors]) touched.add(id)
    if (siblingIds.length > 0) await input.controller.setNodeVisibilities(siblingIds, false)
    applyVisibilityForNodeIds(input.root, hiddenGroups, true, useLayerVisibilityStore.getState())
    await input.controller.setNodeVisibilities(hiddenAncestors, true)
  }
}

/**
 * Sets the runtime visibility of each touched node to what the saved catalog
 * says: a node shows only when it and every group and layer above it are shown.
 */
function reconcileWithSaved(saved: LayerCatalogRootNode, touched: ReadonlySet<string>): void {
  const store = useLayerVisibilityStore.getState()
  const shown: string[] = []
  const hidden: string[] = []
  for (const id of touched) {
    const node = findCatalogNode(saved, id)
    if (node === null) continue
    const effective = node.isVisible && findAncestorNodeIds(saved, id)
      .every((ancestorId) => findCatalogNode(saved, ancestorId)?.isVisible !== false)
    ;(effective ? shown : hidden).push(id)
  }
  if (hidden.length > 0) applyVisibilityForNodeIds(saved, hidden, false, store)
  if (shown.length > 0) applyVisibilityForNodeIds(saved, shown, true, useLayerVisibilityStore.getState())
}

/** The group and layer nodes above a node, nearest last; never the root. */
function findAncestorNodeIds(root: LayerCatalogRootNode, nodeId: string): readonly string[] {
  for (const group of root.children) {
    if (group.id === nodeId) return []
    for (const layer of group.children) {
      if (layer.id === nodeId) return [group.id]
      if (layer.children.some((item) => item.id === nodeId)) return [group.id, layer.id]
    }
  }
  return []
}

/** Whether the runtime store currently hides this group, whatever the catalog snapshot says. */
function isHiddenGroup(nodeId: string): boolean {
  const groups = useLayerVisibilityStore.getState().groupVisibility
  const key = GROUP_KEY_BY_NODE_ID[nodeId]
  return key !== undefined && !groups[key]
}

const GROUP_KEY_BY_NODE_ID: Readonly<Record<string, keyof ReturnType<typeof useLayerVisibilityStore.getState>['groupVisibility']>> = {
  [TRACKING_GROUP_NODE_ID]: 'tracking',
  [HELICOPTERS_GROUP_NODE_ID]: 'helicopters',
  [MAP_TOOLS_GROUP_NODE_ID]: 'mapTools',
  [GPX_TRACKS_GROUP_NODE_ID]: 'gpxTracks',
}
