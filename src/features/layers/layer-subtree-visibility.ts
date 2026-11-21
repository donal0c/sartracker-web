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
  /** Throws when this change no longer belongs to the open mission; run before every step. */
  readonly assertCurrent?: () => void
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
    // Work for a mission that is no longer open must not touch the open one's map.
    if (error instanceof StaleLayerVisibilityChangeError) throw error
    // A failed save must not look saved: put the map back to what was saved.
    if (input.readRoot !== undefined) reconcileWithSaved(input.readRoot(), touched)
    throw error
  }
}

/**
 * A queued show or hide was dropped because the mission it was made in is no
 * longer open. Nothing is wrong with the open mission; the change is not applied.
 */
export class StaleLayerVisibilityChangeError extends Error {
  constructor() {
    super('The mission this show or hide was made in is no longer open, so it was not applied.')
    this.name = 'StaleLayerVisibilityChangeError'
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
  /** The open mission's id; captured when the change is queued and checked before every step. */
  readonly readMissionId: () => string | null
  readonly readRoot: () => LayerCatalogRootNode
  readonly controller: LayerCatalogController | null
  readonly nodeId: string
  readonly visible: boolean
  readonly revealAncestors?: boolean
}): Promise<void> {
  // The queue outlives the panel, and the runtime follows whichever mission is
  // open, so a slow save must never let this change land in a later mission.
  const missionId = input.readMissionId()
  const assertCurrent = () => {
    if (input.readMissionId() !== missionId) throw new StaleLayerVisibilityChangeError()
  }
  const run = visibilityQueue.then(() => {
    assertCurrent()
    return setLayerSubtreeVisibility({ ...input, root: input.readRoot(), assertCurrent })
  })
  visibilityQueue = run.catch(() => undefined)
  return run
}

async function applyAndPersist(
  input: {
    readonly root: LayerCatalogRootNode
    readonly controller: LayerCatalogController | null
    readonly visible: boolean
    readonly revealAncestors?: boolean
    readonly assertCurrent?: () => void
  },
  nodeId: string,
  nodeIds: readonly string[],
  touched: Set<string>,
): Promise<void> {
  if (input.controller === null) return
  const assertCurrent = input.assertCurrent ?? (() => undefined)
  assertCurrent()
  applyVisibilityForNodeIds(
    input.root,
    nodeIds,
    input.visible,
    useLayerVisibilityStore.getState(),
  )
  await input.controller.setNodeVisibilities(nodeIds, input.visible)
  assertCurrent()
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
    if (siblingIds.length > 0) {
      await input.controller.setNodeVisibilities(siblingIds, false)
      assertCurrent()
    }
    applyVisibilityForNodeIds(input.root, hiddenGroups, true, useLayerVisibilityStore.getState())
    await input.controller.setNodeVisibilities(hiddenAncestors, true)
  }
}

/**
 * Sets the runtime visibility of each touched node to what the saved catalog
 * says: a node shows only when it and every group and layer above it are shown.
 *
 * Groups go first, then layers, then each person. Showing a layer shows
 * everyone under it, so each person's own saved state must be applied last or
 * a person saved as hidden would be shown again.
 */
function reconcileWithSaved(saved: LayerCatalogRootNode, touched: ReadonlySet<string>): void {
  const ordered = [...touched]
    .flatMap((id) => {
      const node = findCatalogNode(saved, id)
      if (node === null) return []
      const ancestors = findAncestorNodeIds(saved, id)
      const effective = node.isVisible && ancestors.every((ancestorId) => findCatalogNode(saved, ancestorId)?.isVisible !== false)
      return [{ id, depth: ancestors.length, effective }]
    })
    .sort((a, b) => a.depth - b.depth)
  for (const { id, effective } of ordered) {
    applyVisibilityForNodeIds(saved, [id], effective, useLayerVisibilityStore.getState())
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
