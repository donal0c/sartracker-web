import { useEffect, useMemo, useState } from 'react'

import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import type { LayerCatalogNode } from '../features/layers/layer-catalog-tree'
import {
  filterCatalogTree,
  findCatalogNode,
  getDescendantNodeIds,
  getNodeChildren,
  getSiblingNodeIds,
  hasNodeChildren,
} from '../features/layers/layer-catalog-tree'
import { useLayerTreeUiStore } from '../features/layers/layer-tree-ui-store'
import { useMeasurementStore } from '../features/measurements/measurement-store'
import { useTrackingStore } from '../features/tracking/tracking-store'

/**
 * Renders the operational layer tree and feature inspection workspace.
 */
export function LayerFilterPanel() {
  const root = useLayerCatalogStore((state) => state.root)
  const selectedNodeId = useLayerCatalogStore((state) => state.selectedNodeId)
  const catalogController = useLayerCatalogStore((state) => state.controller)
  const catalogLoading = useLayerCatalogStore((state) => state.loading)
  const catalogError = useLayerCatalogStore((state) => state.error)
  const panelExpanded = useLayerTreeUiStore((state) => state.panelExpanded)
  const searchQuery = useLayerTreeUiStore((state) => state.searchQuery)
  const expandedNodeIds = useLayerTreeUiStore((state) => state.expandedNodeIds)
  const setPanelExpanded = useLayerTreeUiStore((state) => state.setPanelExpanded)
  const setSearchQuery = useLayerTreeUiStore((state) => state.setSearchQuery)
  const toggleNodeExpanded = useLayerTreeUiStore((state) => state.toggleNodeExpanded)
  const setNodeExpanded = useLayerTreeUiStore((state) => state.setNodeExpanded)
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const measurements = useMeasurementStore((state) => state.measurements)

  const filteredRoot = useMemo(
    () => filterCatalogTree(root, searchQuery),
    [root, searchQuery],
  )
  const selectedNode = useMemo(
    () => findCatalogNode(root, selectedNodeId),
    [root, selectedNodeId],
  )

  useEffect(() => {
    if (searchQuery.trim() === '') {
      return
    }

    for (const group of filteredRoot.children) {
      setNodeExpanded(group.id, true)
      for (const layer of group.children) {
        setNodeExpanded(layer.id, true)
      }
    }
  }, [filteredRoot, searchQuery, setNodeExpanded])

  return (
    <section
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="layer-panel"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
            Layer Workspace
          </h3>
          <p className="mt-1 text-[10px] text-stone-600">
            Catalog, visibility, aliases, and inspection.
          </p>
        </div>
        <button
          className="rounded-lg bg-stone-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 transition-colors hover:bg-stone-700 active:bg-stone-900"
          data-testid="layer-panel-toggle"
          onClick={() => setPanelExpanded(!panelExpanded)}
          type="button"
        >
          {panelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {panelExpanded ? (
        <div className="space-y-4">
          <input
            className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-700 outline-none transition-colors focus:border-amber-500/50"
            data-testid="layer-tree-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search layers and features..."
            value={searchQuery}
          />

          {catalogError ? (
            <EmptyState message={catalogError} testId="layer-tree-error" />
          ) : null}

          <div className="rounded-xl border border-stone-800/60 bg-stone-900/30">
            <div className="border-b border-stone-800/60 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
                Layer Tree
              </p>
            </div>

            <div className="max-h-[24rem] overflow-y-auto px-2 py-2" data-testid="layer-tree">
              {catalogLoading ? (
                <EmptyState message="Syncing layer catalog..." />
              ) : filteredRoot.children.length === 0 ? (
                <EmptyState message="No catalog nodes match the current filter." />
              ) : (
                filteredRoot.children.map((node) => (
                  <TreeNodeRow
                    controller={catalogController}
                    depth={0}
                    expandedNodeIds={expandedNodeIds}
                    key={node.id}
                    measurementCount={measurements.length}
                    onSelect={catalogController?.selectNode ?? (() => undefined)}
                    root={root}
                    selectedNodeId={selectedNodeId}
                    toggleNodeExpanded={toggleNodeExpanded}
                    trackingBreadcrumbCount={trackingSnapshot.breadcrumbs.length}
                    node={node}
                  />
                ))
              )}
            </div>
          </div>

          <LayerInspector
            controller={catalogController}
            key={selectedNode?.id ?? 'empty'}
            measurementCount={measurements.length}
            root={root}
            selectedNode={selectedNode}
            trackingDeviceCount={trackingSnapshot.devices.length}
            trackingBreadcrumbCount={trackingSnapshot.breadcrumbs.length}
          />
        </div>
      ) : null}
    </section>
  )
}

function TreeNodeRow(props: {
  readonly node: LayerCatalogNode
  readonly root: ReturnType<typeof useLayerCatalogStore.getState>['root']
  readonly controller: ReturnType<typeof useLayerCatalogStore.getState>['controller']
  readonly selectedNodeId: string | null
  readonly expandedNodeIds: readonly string[]
  readonly depth: number
  readonly toggleNodeExpanded: (nodeId: string) => void
  readonly onSelect: (nodeId: string | null) => void
  readonly trackingBreadcrumbCount: number
  readonly measurementCount: number
}) {
  const isExpanded = props.expandedNodeIds.includes(props.node.id)
  const children = getNodeChildren(props.node)
  const childCount = getNodeCountLabel(
    props.node,
    props.trackingBreadcrumbCount,
    props.measurementCount,
  )
  const rowSelected = props.selectedNodeId === props.node.id

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
          rowSelected ? 'bg-amber-500/10 text-amber-100' : 'text-stone-300 hover:bg-stone-900/50'
        }`}
        data-testid={`layer-row-${toTestId(props.node.id)}`}
        style={{ paddingLeft: `${props.depth * 16 + 8}px` }}
      >
        {hasNodeChildren(props.node) ? (
          <button
            className="w-5 text-stone-500"
            data-testid={`layer-expand-${toTestId(props.node.id)}`}
            onClick={() => props.toggleNodeExpanded(props.node.id)}
            type="button"
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-5 text-stone-700">•</span>
        )}

        {props.node.kind !== 'root' ? (
          <input
            checked={props.node.isVisible}
            className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
            data-testid={`layer-visibility-${toTestId(props.node.id)}`}
            onChange={(event) =>
              void setSubtreeVisibility(
                props.root,
                props.controller,
                props.node.id,
                event.target.checked,
              )
            }
            type="checkbox"
          />
        ) : null}

        <button
          className="min-w-0 flex-1 truncate text-left"
          data-testid={`layer-select-${toTestId(props.node.id)}`}
          onClick={() => props.onSelect(props.node.id)}
          type="button"
        >
          <span className="truncate font-medium">{props.node.displayLabel}</span>
        </button>

        {props.node.kind !== 'root' ? (
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              props.node.isFavorite
                ? 'bg-amber-500/20 text-amber-200'
                : 'text-stone-600 hover:bg-stone-800 hover:text-stone-300'
            }`}
            data-testid={`layer-favorite-${toTestId(props.node.id)}`}
            onClick={() => void props.controller?.toggleFavorite(props.node.id)}
            type="button"
          >
            ★
          </button>
        ) : null}

        <span className="min-w-[2rem] text-right font-mono text-[10px] text-stone-500">
          {childCount}
        </span>
      </div>

      {isExpanded
        ? children.map((child) => (
            <TreeNodeRow
              controller={props.controller}
              depth={props.depth + 1}
              expandedNodeIds={props.expandedNodeIds}
              key={child.id}
              measurementCount={props.measurementCount}
              node={child}
              onSelect={props.onSelect}
              root={props.root}
              selectedNodeId={props.selectedNodeId}
              toggleNodeExpanded={props.toggleNodeExpanded}
              trackingBreadcrumbCount={props.trackingBreadcrumbCount}
            />
          ))
        : null}
    </div>
  )
}

function LayerInspector(props: {
  readonly root: ReturnType<typeof useLayerCatalogStore.getState>['root']
  readonly selectedNode: LayerCatalogNode | null
  readonly controller: ReturnType<typeof useLayerCatalogStore.getState>['controller']
  readonly trackingDeviceCount: number
  readonly trackingBreadcrumbCount: number
  readonly measurementCount: number
}) {
  const selectedNode = props.selectedNode
  const [aliasDraft, setAliasDraft] = useState(selectedNode?.alias ?? '')

  if (selectedNode === null) {
    return <EmptyState message="Select a layer or feature to inspect it." testId="layer-inspector-empty" />
  }

  const siblings = getSiblingNodeIds(props.root, selectedNode.id)
  const selectedIndex = siblings.indexOf(selectedNode.id)
  const canMoveUp = selectedIndex > 0
  const canMoveDown = selectedIndex !== -1 && selectedIndex < siblings.length - 1
  const inspectionRows = buildInspectionRows(
    selectedNode,
    props.trackingDeviceCount,
    props.trackingBreadcrumbCount,
    props.measurementCount,
  )

  return (
    <div
      className="rounded-xl border border-stone-800/60 bg-stone-900/30 p-4"
      data-testid="layer-inspector"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
            Inspection
          </p>
          <h4
            className="mt-1 truncate font-mono text-sm font-bold text-stone-100"
            data-testid="layer-inspector-title"
          >
            {selectedNode.displayLabel}
          </h4>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-stone-600">
            {selectedNode.kind.replace('_', ' ')}
          </p>
        </div>
        <button
          className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
            selectedNode.isFavorite
              ? 'bg-amber-500/20 text-amber-200'
              : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
          }`}
          data-testid="layer-inspector-favorite"
          onClick={() =>
            selectedNode.kind !== 'root'
              ? void props.controller?.toggleFavorite(selectedNode.id)
              : undefined
          }
          type="button"
        >
          {selectedNode.isFavorite ? 'Favorited' : 'Favorite'}
        </button>
      </div>

      {selectedNode.kind !== 'root' ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              Alias
            </span>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 outline-none transition-colors focus:border-amber-500/50"
                data-testid="layer-alias-input"
                onChange={(event) => setAliasDraft(event.target.value)}
                value={aliasDraft}
              />
              <button
                className="rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:bg-stone-700"
                data-testid="layer-alias-save"
                onClick={() =>
                  void props.controller?.renameNode(
                    selectedNode.id,
                    aliasDraft.trim() === '' ? null : aliasDraft.trim(),
                  )
                }
                type="button"
              >
                Save
              </button>
              <button
                className="rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:bg-stone-700"
                data-testid="layer-alias-clear"
                onClick={() => {
                  setAliasDraft('')
                  void props.controller?.renameNode(selectedNode.id, null)
                }}
                type="button"
              >
                Clear
              </button>
            </div>
          </label>

          <div className="flex gap-2">
            <button
              className="rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="layer-move-up"
              disabled={!canMoveUp}
              onClick={() =>
                void reorderNodeRelative(
                  props.root,
                  props.controller,
                  selectedNode.id,
                  -1,
                )
              }
              type="button"
            >
              Move Up
            </button>
            <button
              className="rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="layer-move-down"
              disabled={!canMoveDown}
              onClick={() =>
                void reorderNodeRelative(
                  props.root,
                  props.controller,
                  selectedNode.id,
                  1,
                )
              }
              type="button"
            >
              Move Down
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-stone-800/60 bg-stone-950/40 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-stone-500">
          Details
        </p>
        <dl className="space-y-2" data-testid="layer-inspector-details">
          {inspectionRows.map((row) => (
            <div className="flex items-start justify-between gap-4 text-xs" key={row.label}>
              <dt className="text-stone-500">{row.label}</dt>
              <dd className="text-right font-mono text-stone-200">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function buildInspectionRows(
  node: LayerCatalogNode,
  trackingDeviceCount: number,
  trackingBreadcrumbCount: number,
  measurementCount: number,
): readonly { readonly label: string; readonly value: string }[] {
  if (node.kind === 'group') {
    return [
      { label: 'Group Key', value: node.groupKey },
      { label: 'Child Layers', value: String(node.children.length) },
      { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
    ]
  }

  if (node.kind === 'layer') {
    if (node.id === 'layer:tracking:breadcrumbs') {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Breadcrumb Points', value: String(trackingBreadcrumbCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    if (node.id === 'layer:tracking:devices') {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Tracking Devices', value: String(trackingDeviceCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    if (node.id === 'layer:map-tools:measurements') {
      return [
        { label: 'Layer Key', value: node.layerKey },
        { label: 'Active Measurements', value: String(measurementCount) },
        { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
      ]
    }
    return [
      { label: 'Layer Key', value: node.layerKey },
      { label: 'Visible Items', value: `${node.summary.visibleCount}/${node.summary.totalCount}` },
      { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
    ]
  }

  if (node.kind === 'feature_item') {
    if (node.entity?.type === 'device') {
      return [
        { label: 'Device ID', value: node.entity.device.device_id },
        { label: 'Status', value: node.entity.device.status },
        { label: 'Last Seen', value: node.entity.device.last_seen ?? 'No fix' },
      ]
    }
    if (node.entity?.type === 'marker') {
      return [
        { label: 'Marker Type', value: node.entity.marker.type },
        { label: 'Coordinates', value: `${node.entity.marker.lat.toFixed(4)}, ${node.entity.marker.lon.toFixed(4)}` },
        { label: 'Updated', value: node.entity.marker.updated_at },
      ]
    }
    if (node.entity?.type === 'drawing') {
      return [
        { label: 'Drawing Type', value: node.entity.drawing.type },
        { label: 'Label', value: node.entity.drawing.label ?? 'None' },
        { label: 'Updated', value: node.entity.drawing.updated_at },
      ]
    }
    if (node.entity?.type === 'gpx_import') {
      return [
        { label: 'Source Path', value: node.entity.gpxImport.source_path },
        { label: 'File Name', value: node.entity.gpxImport.file_name },
        { label: 'Imported', value: node.entity.gpxImport.imported_at },
      ]
    }
  }

  return [
    { label: 'Node ID', value: node.id },
    { label: 'Visible', value: node.isVisible ? 'Yes' : 'No' },
    { label: 'Favorite', value: node.isFavorite ? 'Yes' : 'No' },
  ]
}

async function setSubtreeVisibility(
  root: ReturnType<typeof useLayerCatalogStore.getState>['root'],
  controller: ReturnType<typeof useLayerCatalogStore.getState>['controller'],
  nodeId: string,
  visible: boolean,
): Promise<void> {
  if (controller === null) {
    return
  }

  const node = findCatalogNode(root, nodeId)
  if (node === null) {
    return
  }

  const nodeIds = [node.id, ...getDescendantNodeIds(node)]
  await Promise.all(nodeIds.map((candidateNodeId) => controller.setNodeVisibility(candidateNodeId, visible)))
}

async function reorderNodeRelative(
  root: ReturnType<typeof useLayerCatalogStore.getState>['root'],
  controller: ReturnType<typeof useLayerCatalogStore.getState>['controller'],
  nodeId: string,
  direction: -1 | 1,
): Promise<void> {
  if (controller === null) {
    return
  }

  const node = findCatalogNode(root, nodeId)
  if (node === null || node.parentId === null) {
    return
  }

  const siblings = [...getSiblingNodeIds(root, nodeId)]
  const currentIndex = siblings.indexOf(nodeId)
  const targetIndex = currentIndex + direction
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= siblings.length) {
    return
  }

  ;[siblings[currentIndex], siblings[targetIndex]] = [
    siblings[targetIndex]!,
    siblings[currentIndex]!,
  ]

  await controller.reorderNode(node.parentId, siblings)
}

function getNodeCountLabel(
  node: LayerCatalogNode,
  trackingBreadcrumbCount: number,
  measurementCount: number,
): string {
  if (node.kind === 'group') {
    return String(node.children.length)
  }
  if (node.kind === 'layer') {
    if (node.id === 'layer:tracking:breadcrumbs') {
      return String(trackingBreadcrumbCount)
    }
    if (node.id === 'layer:map-tools:measurements') {
      return String(measurementCount)
    }
    return String(node.summary.totalCount)
  }
  return ''
}

function toTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-')
}

function EmptyState(props: { readonly message: string; readonly testId?: string }) {
  return (
    <div
      className="rounded-xl border border-dashed border-stone-800 bg-stone-950/20 px-3 py-2 text-[10px] font-medium italic text-stone-600"
      data-testid={props.testId}
    >
      {props.message}
    </div>
  )
}
