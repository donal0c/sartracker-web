import { findCatalogNode } from './layer-catalog-tree'
import type { LayerCatalogRootNode } from './layer-catalog-types'

export type CoverageVisibilityAdapter = {
  readonly setDeviceVisibility: (deviceId: string, visible: boolean) => void
  readonly setPeriodVisibility: (periodKey: string, visible: boolean) => void
}

/** Applies coverage filter rows only to renderer state and performs no store I/O. */
export function applyCoverageVisibilityForNodeIds(
  root: LayerCatalogRootNode,
  nodeIds: readonly string[],
  visible: boolean,
  store: CoverageVisibilityAdapter,
): void {
  for (const nodeId of nodeIds) {
    const node = findCatalogNode(root, nodeId)
    if (node?.kind !== 'feature_item') continue
    if (node.entity?.type === 'coverage_device') {
      store.setDeviceVisibility(node.entity.deviceId, visible)
    } else if (node.entity?.type === 'coverage_period') {
      store.setPeriodVisibility(node.entity.periodKey, visible)
    }
  }
}
