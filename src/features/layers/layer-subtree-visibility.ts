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
  applyVisibilityForNodeIds(
    input.root,
    nodeIds,
    input.visible,
    useLayerVisibilityStore.getState(),
  )
  await input.controller.setNodeVisibilities(nodeIds, input.visible)
  if (input.visible && input.revealAncestors === true) {
    const hiddenAncestors = findAncestorNodeIds(input.root, node.id)
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
    if (siblingIds.length > 0) await input.controller.setNodeVisibilities(siblingIds, false)
    applyVisibilityForNodeIds(input.root, hiddenGroups, true, useLayerVisibilityStore.getState())
    await input.controller.setNodeVisibilities(hiddenAncestors, true)
  }
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
