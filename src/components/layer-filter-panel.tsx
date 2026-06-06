import { useEffect, useMemo, useState } from 'react'

import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import type { LayerCatalogNode } from '../features/layers/layer-catalog-tree'
import {
  collectAllExpandableNodeIds,
  filterCatalogTree,
  filterHiddenNodes,
  findCatalogNode,
  getNodeChildren,
  getSiblingNodeIds,
  hasNodeChildren,
} from '../features/layers/layer-catalog-tree'
import {
  buildLayerInspectionRows,
  getLayerNodeCountLabel,
  toLayerTreeTestId,
} from '../features/layers/layer-panel-model'
import { useLayerTreeUiStore } from '../features/layers/layer-tree-ui-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import {
  applyVisibilityForNodeIds,
  collectSubtreeNodeIds,
} from '../features/layers/layer-visibility-service'
import { useDrawingStore } from '../features/drawings/drawing-store'
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
  const resetExpandedNodeIds = useLayerTreeUiStore((state) => state.resetExpandedNodeIds)
  const showHidden = useLayerTreeUiStore((state) => state.showHidden)
  const setShowHidden = useLayerTreeUiStore((state) => state.setShowHidden)
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const measurements = useMeasurementStore((state) => state.measurements)

  const filteredRoot = useMemo(() => {
    const searched = filterCatalogTree(root, searchQuery)
    return showHidden ? searched : filterHiddenNodes(searched)
  }, [root, searchQuery, showHidden])
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
      className="sar-panel p-4 text-sm"
      data-testid="layer-panel"
    >
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--sar-line)] pb-3">
        <div>
          <h3 className="sar-section-label text-amber-300">
            Layer Workspace
          </h3>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-300">
            visibility and inspection
          </p>
        </div>
        <button
          className="sar-button px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em]"
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
            className="sar-input w-full px-3 py-2 text-xs"
            data-testid="layer-tree-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search layers and features..."
            value={searchQuery}
          />

          <div className="flex flex-wrap items-center gap-2">
            <label
              className="sar-toggle flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-stone-300"
              data-testid="layer-show-hidden-toggle"
            >
              <input
                checked={showHidden}
                className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
                onChange={(event) => setShowHidden(event.target.checked)}
                type="checkbox"
              />
              Show Hidden
            </label>
            <button
              className="sar-button px-2 py-1 text-[11px] font-semibold"
              data-testid="layer-expand-all-btn"
              onClick={() => resetExpandedNodeIds(collectAllExpandableNodeIds(root))}
              type="button"
            >
              Expand All
            </button>
            <button
              className="sar-button px-2 py-1 text-[11px] font-semibold"
              data-testid="layer-collapse-all-btn"
              onClick={() => resetExpandedNodeIds([])}
              type="button"
            >
              Collapse All
            </button>
            <button
              className="sar-button px-2 py-1 text-[11px] font-semibold"
              data-testid="layer-refresh-btn"
              onClick={() => void catalogController?.forceRefresh()}
              type="button"
            >
              Refresh
            </button>
          </div>

          {catalogError ? (
            <EmptyState message={catalogError} testId="layer-tree-error" />
          ) : null}

          <div className="sar-module">
            <div className="border-b border-stone-800/60 px-3 py-2">
              <p className="sar-section-label">
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
  const childCount = getLayerNodeCountLabel(
    props.node,
    {
      trackingBreadcrumbCount: props.trackingBreadcrumbCount,
      measurementCount: props.measurementCount,
    },
  )
  const rowSelected = props.selectedNodeId === props.node.id

  return (
    <div>
      <div
        className={`sar-tree-row mb-1 flex items-center gap-2 px-2 py-1.5 text-xs transition-colors ${
          rowSelected ? 'sar-tree-row-active' : 'text-stone-300'
        }`}
        data-testid={`layer-row-${toLayerTreeTestId(props.node.id)}`}
        style={{ paddingLeft: `${props.depth * 16 + 8}px` }}
      >
        {hasNodeChildren(props.node) ? (
          <button
            className="w-5 text-stone-300 hover:text-amber-200"
            data-testid={`layer-expand-${toLayerTreeTestId(props.node.id)}`}
            onClick={() => props.toggleNodeExpanded(props.node.id)}
            type="button"
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-5 text-stone-500">•</span>
        )}

        {props.node.kind !== 'root' ? (
          <input
            checked={props.node.isVisible}
            className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
            data-testid={`layer-visibility-${toLayerTreeTestId(props.node.id)}`}
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
          data-testid={`layer-select-${toLayerTreeTestId(props.node.id)}`}
          onClick={() => props.onSelect(props.node.id)}
          type="button"
        >
          <span className="truncate font-medium">{props.node.displayLabel}</span>
        </button>

        <span className="min-w-[2rem] text-right font-mono text-[11px] text-stone-300">
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
  const drawingController = useDrawingStore((state) => state.controller)

  if (selectedNode === null) {
    return <EmptyState message="Select a layer or feature from the tree above to inspect its properties." testId="layer-inspector-empty" />
  }

  const siblings = getSiblingNodeIds(props.root, selectedNode.id)
  const selectedIndex = siblings.indexOf(selectedNode.id)
  const canMoveUp = selectedIndex > 0
  const canMoveDown = selectedIndex !== -1 && selectedIndex < siblings.length - 1
  const editableDrawingId =
    selectedNode.kind === 'feature_item' && selectedNode.entity?.type === 'drawing'
      ? selectedNode.entity.drawing.id
      : null
  const inspectionRows = buildLayerInspectionRows(
    selectedNode,
    {
      trackingDeviceCount: props.trackingDeviceCount,
      trackingBreadcrumbCount: props.trackingBreadcrumbCount,
      measurementCount: props.measurementCount,
    },
  )

  return (
    <div
      className="sar-module p-4"
      data-testid="layer-inspector"
    >
      <div className="min-w-0">
        <p className="sar-section-label">
          Selected Layer
        </p>
        <h4
          className="mt-1 truncate font-mono text-sm font-bold text-stone-100"
          data-testid="layer-inspector-title"
        >
          {selectedNode.displayLabel}
        </h4>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-stone-300">
          {selectedNode.kind.replace('_', ' ')}
        </p>
      </div>

      {selectedNode.kind !== 'root' ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-stone-300">
              Alias
            </span>
            <div className="flex flex-wrap gap-2">
              <input
                className="sar-input min-w-40 flex-1 px-3 py-2 text-xs"
                data-testid="layer-alias-input"
                onChange={(event) => setAliasDraft(event.target.value)}
                value={aliasDraft}
              />
              <button
                className="sar-button px-3 py-2 text-[11px] font-semibold"
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
                className="sar-button px-3 py-2 text-[11px] font-semibold"
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
            {editableDrawingId !== null ? (
              <button
                className="sar-button px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="layer-edit-drawing-btn"
                disabled={drawingController === null}
                onClick={() => drawingController?.beginEdit(editableDrawingId)}
                type="button"
              >
                Edit Drawing
              </button>
            ) : null}
            <button
              className="sar-button px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
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
              className="sar-button px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
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

      {inspectionRows.length > 0 ? (
        <details className="mt-4">
          <summary className="sar-section-label cursor-pointer select-none text-[11px] text-stone-400 hover:text-stone-200">
            Details
          </summary>
          <div className="sar-readout mt-2 p-3">
            <dl className="space-y-2" data-testid="layer-inspector-details">
              {inspectionRows.map((row) => (
                <div className="flex items-start justify-between gap-4 text-xs" key={row.label}>
                  <dt className="text-stone-300">{row.label}</dt>
                  <dd className="text-right font-mono text-stone-200">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      ) : null}
    </div>
  )
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

  const nodeIds = collectSubtreeNodeIds(root, node.id)

  // 1. Immediately push to the visibility store so MapLibre filters update
  //    without waiting for the async persist → rebuild → bridge effect cycle.
  applyVisibilityForNodeIds(root, nodeIds, visible, useLayerVisibilityStore.getState())

  // 2. Persist the whole subtree as one catalog mutation. Rebuilding once keeps
  //    out-of-order child writes from briefly re-showing part of a hidden layer.
  await controller.setNodeVisibilities(nodeIds, visible)
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

function EmptyState(props: { readonly message: string; readonly testId?: string }) {
  return (
    <div
      className="rounded-lg border border-dashed border-stone-600 bg-stone-950/30 px-3 py-2 text-xs font-medium italic text-stone-300"
      data-testid={props.testId}
    >
      {props.message}
    </div>
  )
}
