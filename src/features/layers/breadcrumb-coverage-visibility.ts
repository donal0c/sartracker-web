import type { LayerCatalogRootNode } from './layer-catalog-types'

/** Resolves the same catalog selection for both rendered coverage and its operator claim. */
export function resolveCatalogBreadcrumbOmissions(root: LayerCatalogRootNode, deviceIds: readonly string[], historyOmissions: readonly string[]): readonly string[] {
  const group = root.children.find((entry) => entry.id === 'group:tracking')
  const layer = group?.children.find((entry) => entry.id === 'layer:tracking:breadcrumbs')
  return resolveBreadcrumbOmissions(deviceIds, group?.isVisible === false ? false : layer?.isVisible ?? true,
    group?.isVisible === false ? [] : layer?.children.flatMap((child) => child.entity?.type === 'device'
      ? [{ deviceId: child.entity.device.device_id, visible: child.isVisible }] : []) ?? [], historyOmissions)
}

/** Combines existing catalog defaults/overrides with mission-history display omissions. */
export function resolveBreadcrumbOmissions(
  deviceIds: readonly string[],
  categoryDefault: boolean,
  overrides: readonly { readonly deviceId: string; readonly visible: boolean }[],
  historyOmissions: readonly string[],
): readonly string[] {
  const visibility = new Map(overrides.map((entry) => [entry.deviceId, entry.visible]))
  const omitted = new Set(historyOmissions)
  return deviceIds.filter((id) => omitted.has(id) || !(visibility.get(id) ?? categoryDefault))
}
