import { useCoverageFilterStore } from '../tracking/coverage-filter-store'
import { applyCoverageVisibilityForNodeIds } from './coverage-layer-visibility'
import { isCoverageNodeId } from './layer-catalog-ids'
import { findCatalogNode } from './layer-catalog-tree'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import {
  applyVisibilityForNodeIds,
  collectSubtreeNodeIds,
} from './layer-visibility-service'
import { useLayerVisibilityStore } from './layer-visibility-store'
import type { LayerCatalogController } from './start-layer-catalog-runtime'

/** Routes runtime-only coverage filters away from catalog persistence. */
export async function setLayerSubtreeVisibility(input: {
  readonly root: LayerCatalogRootNode
  readonly controller: LayerCatalogController | null
  readonly nodeId: string
  readonly visible: boolean
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
}
