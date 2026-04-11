import type {
  LayerCatalogFeatureItemNode,
  LayerCatalogGroupNode,
  LayerCatalogLayerNode,
  LayerCatalogRootNode,
} from './layer-catalog-types'

export type LayerCatalogNode =
  | LayerCatalogRootNode
  | LayerCatalogGroupNode
  | LayerCatalogLayerNode
  | LayerCatalogFeatureItemNode

export function getNodeChildren(node: LayerCatalogNode): readonly LayerCatalogNode[] {
  switch (node.kind) {
    case 'root':
    case 'group':
    case 'layer':
      return node.children
    case 'feature_item':
      return []
  }
}

export function hasNodeChildren(node: LayerCatalogNode): boolean {
  return getNodeChildren(node).length > 0
}

export function findCatalogNode(
  root: LayerCatalogRootNode,
  nodeId: string | null,
): LayerCatalogNode | null {
  if (nodeId === null) {
    return null
  }

  if (root.id === nodeId) {
    return root
  }

  for (const group of root.children) {
    if (group.id === nodeId) {
      return group
    }

    for (const layer of group.children) {
      if (layer.id === nodeId) {
        return layer
      }

      for (const featureItem of layer.children) {
        if (featureItem.id === nodeId) {
          return featureItem
        }
      }
    }
  }

  return null
}

export function getDescendantNodeIds(node: LayerCatalogNode): readonly string[] {
  return getNodeChildren(node).flatMap((child) => [child.id, ...getDescendantNodeIds(child)])
}

export function getSiblingNodeIds(
  root: LayerCatalogRootNode,
  nodeId: string,
): readonly string[] {
  const node = findCatalogNode(root, nodeId)
  if (node === null || node.parentId === null) {
    return []
  }

  const parent = findCatalogNode(root, node.parentId)
  if (parent === null) {
    return []
  }

  return getNodeChildren(parent).map((child) => child.id)
}

export function filterCatalogTree(
  root: LayerCatalogRootNode,
  query: string,
): LayerCatalogRootNode {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') {
    return root
  }

  const filteredGroups = root.children
    .map((group) => filterNode(group, normalizedQuery))
    .filter((node): node is LayerCatalogGroupNode => node !== null)

  return {
    ...root,
    children: filteredGroups,
  }
}

/**
 * Removes hidden nodes (isVisible === false) from the tree. Groups and layers
 * are kept if they have at least one visible descendant.
 */
export function filterHiddenNodes(root: LayerCatalogRootNode): LayerCatalogRootNode {
  const filteredGroups: LayerCatalogGroupNode[] = []

  for (const group of root.children) {
    const filteredLayers: LayerCatalogLayerNode[] = []

    for (const layer of group.children) {
      const filteredItems = layer.children.filter((item) => item.isVisible)
      if (!layer.isVisible && filteredItems.length === 0) {
        continue
      }

      filteredLayers.push({
        ...layer,
        children: filteredItems,
      })
    }

    if (!group.isVisible && filteredLayers.length === 0) {
      continue
    }

    filteredGroups.push({
      ...group,
      children: filteredLayers,
    })
  }

  return {
    ...root,
    children: filteredGroups,
  }
}

/**
 * Collects all expandable node IDs in the tree (groups and layers).
 */
export function collectAllExpandableNodeIds(root: LayerCatalogRootNode): readonly string[] {
  const ids: string[] = []
  for (const group of root.children) {
    ids.push(group.id)
    for (const layer of group.children) {
      ids.push(layer.id)
    }
  }
  return ids
}

function filterNode(
  node: LayerCatalogGroupNode | LayerCatalogLayerNode | LayerCatalogFeatureItemNode,
  query: string,
): LayerCatalogGroupNode | LayerCatalogLayerNode | LayerCatalogFeatureItemNode | null {
  if (node.kind === 'feature_item') {
    return matchesNode(node, query) ? node : null
  }

  const filteredChildren = node.children
    .map((child) => filterNode(child, query))
    .filter((child): child is LayerCatalogLayerNode | LayerCatalogFeatureItemNode => child !== null)

  if (matchesNode(node, query) || filteredChildren.length > 0) {
    return {
      ...node,
      children: filteredChildren,
    } as LayerCatalogGroupNode | LayerCatalogLayerNode
  }

  return null
}

function matchesNode(node: LayerCatalogNode, query: string): boolean {
  return [node.displayLabel, node.label, node.alias ?? '']
    .some((value) => value.toLowerCase().includes(query))
}
