import { useMemo } from 'react'

import { useDrawingStore } from '../features/drawings/drawing-store'
import {
  DRAWING_TYPE_LABELS,
  isDeviceVisible,
  isDrawingVisible,
  isMarkerTypeVisible,
  MARKER_TYPE_LABELS,
  useLayerVisibilityStore,
} from '../features/layers/layer-visibility-store'
import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import {
  getDeviceFeatureNodeId,
  getDrawingFeatureNodeId,
  getDrawingLayerNodeId,
  getMarkerLayerNodeId,
} from '../features/layers/layer-catalog-ids'
import { buildDrawingVisibilitySummary } from '../features/layers/map-layer-filters'
import { useMarkerStore } from '../features/markers/marker-store'
import { createDeviceColor } from '../features/tracking/tracking-color'
import { useTrackingStore } from '../features/tracking/tracking-store'
import type {
  DrawingType,
  MarkerType,
} from '../infrastructure/mission-store/tauri-mission-store'

/**
 * Renders the right-sidebar layer/filter panel for tracking, markers, and drawings.
 */
export function LayerFilterPanel() {
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const markers = useMarkerStore((state) => state.markers)
  const drawings = useDrawingStore((state) => state.drawings)
  const drawingsLoading = useDrawingStore((state) => state.loading)
  const catalogController = useLayerCatalogStore((state) => state.controller)
  const panelExpanded = useLayerVisibilityStore((state) => state.panelExpanded)
  const peopleSearch = useLayerVisibilityStore((state) => state.peopleSearch)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const markerTypeVisibility = useLayerVisibilityStore((state) => state.markerTypeVisibility)
  const drawingTypeVisibility = useLayerVisibilityStore((state) => state.drawingTypeVisibility)
  const hiddenDrawingIds = useLayerVisibilityStore((state) => state.hiddenDrawingIds)
  const setPanelExpanded = useLayerVisibilityStore((state) => state.setPanelExpanded)
  const setPeopleSearch = useLayerVisibilityStore((state) => state.setPeopleSearch)
  const toggleDeviceVisibility = useLayerVisibilityStore((state) => state.toggleDeviceVisibility)
  const showAllDevices = useLayerVisibilityStore((state) => state.showAllDevices)
  const hideAllDevices = useLayerVisibilityStore((state) => state.hideAllDevices)
  const setMarkerTypeVisibility = useLayerVisibilityStore((state) => state.setMarkerTypeVisibility)
  const showAllMarkerTypes = useLayerVisibilityStore((state) => state.showAllMarkerTypes)
  const hideAllMarkerTypes = useLayerVisibilityStore((state) => state.hideAllMarkerTypes)
  const setDrawingTypeVisibility = useLayerVisibilityStore((state) => state.setDrawingTypeVisibility)
  const showAllDrawingTypes = useLayerVisibilityStore((state) => state.showAllDrawingTypes)
  const hideAllDrawingTypes = useLayerVisibilityStore((state) => state.hideAllDrawingTypes)
  const toggleDrawingVisibility = useLayerVisibilityStore((state) => state.toggleDrawingVisibility)
  const showAllDrawings = useLayerVisibilityStore((state) => state.showAllDrawings)
  const hideAllDrawings = useLayerVisibilityStore((state) => state.hideAllDrawings)

  const filteredDevices = useMemo(() => {
    const search = peopleSearch.trim().toLowerCase()
    return trackingSnapshot.devices.filter((device) => {
      if (search === '') {
        return true
      }

      return device.name.toLowerCase().includes(search)
    })
  }, [peopleSearch, trackingSnapshot.devices])

  const markerCounts = useMemo(
    () =>
      markers.reduce(
        (counts, marker) => ({
          ...counts,
          [marker.type]: counts[marker.type] + 1,
        }),
        {
          ipp_lkp: 0,
          clue: 0,
          hazard: 0,
          casualty: 0,
        } satisfies Record<MarkerType, number>,
      ),
    [markers],
  )

  const drawingCounts = useMemo(
    () =>
      drawings.reduce(
        (counts, drawing) => ({
          ...counts,
          [drawing.type]: counts[drawing.type] + 1,
        }),
        {
          line: 0,
          search_area: 0,
          range_ring: 0,
          bearing_line: 0,
          search_sector: 0,
          text_label: 0,
        } satisfies Record<DrawingType, number>,
      ),
    [drawings],
  )

  const drawingSummary = buildDrawingVisibilitySummary(
    drawings,
    drawingTypeVisibility,
    hiddenDrawingIds,
  )

  function persistNodeVisibility(nodeId: string, visible: boolean): void {
    if (catalogController === null) {
      return
    }

    void catalogController.setNodeVisibility(nodeId, visible).catch(() => undefined)
  }

  function persistManyNodeVisibilities(
    nodeIds: readonly string[],
    visible: boolean,
  ): void {
    if (catalogController === null) {
      return
    }

    void Promise.all(
      nodeIds.map((nodeId) => catalogController.setNodeVisibility(nodeId, visible)),
    ).catch(() => undefined)
  }

  return (
    <section
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="layer-panel"
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <h3 className="font-bold uppercase tracking-wider text-stone-400 text-[11px]">Layer Filters</h3>
        <button
          className="rounded-lg bg-stone-800 hover:bg-stone-700 active:bg-stone-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 transition-colors"
          data-testid="layer-panel-toggle"
          onClick={() => setPanelExpanded(!panelExpanded)}
          type="button"
        >
          {panelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {panelExpanded ? (
        <div className="space-y-6">
          <div data-testid="layer-section-people">
            <SectionHeader
              actionAllOff={() => {
                hideAllDevices(trackingSnapshot.devices.map((device) => device.device_id))
                persistManyNodeVisibilities(
                  trackingSnapshot.devices.map((device) => getDeviceFeatureNodeId(device.device_id)),
                  false,
                )
              }}
              actionAllOn={() => {
                showAllDevices()
                persistManyNodeVisibilities(
                  trackingSnapshot.devices.map((device) => getDeviceFeatureNodeId(device.device_id)),
                  true,
                )
              }}
              title="People"
            />
            <div className="mt-3">
              <input
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-700 outline-none focus:border-amber-500/50 transition-colors"
                data-testid="layer-people-search"
                onChange={(event) => setPeopleSearch(event.target.value)}
                placeholder="Search Teams..."
                value={peopleSearch}
              />
            </div>
            <div className="mt-3 space-y-1">
              {filteredDevices.length === 0 ? (
                <EmptyRow message="No devices match filter." />
              ) : (
                filteredDevices.map((device) => (
                  <label
                    className="flex items-center justify-between rounded-xl border border-stone-800/50 bg-stone-900/40 px-3 py-2 hover:bg-stone-900/60 transition-colors"
                    key={device.device_id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <input
                        className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
                        checked={isDeviceVisible(hiddenDeviceIds, device.device_id)}
                        data-testid={`layer-device-toggle-${device.device_id}`}
                        onChange={(event) => {
                          toggleDeviceVisibility(device.device_id)
                          persistNodeVisibility(
                            getDeviceFeatureNodeId(device.device_id),
                            event.target.checked,
                          )
                        }}
                        type="checkbox"
                      />
                      <span
                        className="h-2 w-2 rounded-full border border-stone-950"
                        style={{ backgroundColor: createDeviceColor(device.device_id) }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-stone-200">{device.name}</p>
                        <p className="text-[10px] font-mono text-stone-500">
                          {device.last_seen ? new Date(device.last_seen).toLocaleTimeString() : 'NO FIX'}
                        </p>
                      </div>
                    </div>
                    <span className="ml-3 text-[10px] font-bold uppercase tracking-tight text-stone-500">
                      {device.status}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div data-testid="layer-section-markers">
            <SectionHeader
              actionAllOff={() => {
                hideAllMarkerTypes()
                persistManyNodeVisibilities(
                  (Object.keys(MARKER_TYPE_LABELS) as MarkerType[]).map((type) =>
                    getMarkerLayerNodeId(type),
                  ),
                  false,
                )
              }}
              actionAllOn={() => {
                showAllMarkerTypes()
                persistManyNodeVisibilities(
                  (Object.keys(MARKER_TYPE_LABELS) as MarkerType[]).map((type) =>
                    getMarkerLayerNodeId(type),
                  ),
                  true,
                )
              }}
              title="Markers"
            />
            <div className="mt-3 space-y-1">
              {(Object.keys(MARKER_TYPE_LABELS) as MarkerType[]).map((type) => (
                <label
                  className="flex items-center justify-between rounded-xl border border-stone-800/50 bg-stone-900/40 px-3 py-1.5 hover:bg-stone-900/60 transition-colors"
                  key={type}
                >
                  <div className="flex items-center gap-3">
                    <input
                        className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
                        checked={isMarkerTypeVisible(markerTypeVisibility, type)}
                        data-testid={`layer-marker-toggle-${type}`}
                        onChange={(event) => {
                          setMarkerTypeVisibility(type, event.target.checked)
                          persistNodeVisibility(
                            getMarkerLayerNodeId(type),
                            event.target.checked,
                          )
                        }}
                        type="checkbox"
                      />
                    <span className="text-xs font-medium text-stone-300">{MARKER_TYPE_LABELS[type]}</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-stone-500">{markerCounts[type]}</span>
                </label>
              ))}
            </div>
          </div>

          <div data-testid="layer-section-drawings">
            <SectionHeader
              actionAllOff={() => {
                hideAllDrawingTypes()
                hideAllDrawings(drawings)
                persistManyNodeVisibilities(
                  (Object.keys(DRAWING_TYPE_LABELS) as DrawingType[]).map((type) =>
                    getDrawingLayerNodeId(type),
                  ),
                  false,
                )
                persistManyNodeVisibilities(
                  drawings.map((drawing) => getDrawingFeatureNodeId(drawing.id)),
                  false,
                )
              }}
              actionAllOn={() => {
                showAllDrawingTypes()
                showAllDrawings()
                persistManyNodeVisibilities(
                  (Object.keys(DRAWING_TYPE_LABELS) as DrawingType[]).map((type) =>
                    getDrawingLayerNodeId(type),
                  ),
                  true,
                )
                persistManyNodeVisibilities(
                  drawings.map((drawing) => getDrawingFeatureNodeId(drawing.id)),
                  true,
                )
              }}
              title="Drawings"
            />
            <div className="mt-3 space-y-1">
              {(Object.keys(DRAWING_TYPE_LABELS) as DrawingType[]).map((type) => (
                <label
                  className="flex items-center justify-between rounded-xl border border-stone-800/50 bg-stone-900/40 px-3 py-1.5 hover:bg-stone-900/60 transition-colors"
                  key={type}
                >
                  <div className="flex items-center gap-3">
                    <input
                        className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
                        checked={drawingTypeVisibility[type]}
                        data-testid={`layer-drawing-type-toggle-${type}`}
                        onChange={(event) => {
                          setDrawingTypeVisibility(type, event.target.checked)
                          persistNodeVisibility(
                            getDrawingLayerNodeId(type),
                            event.target.checked,
                          )
                        }}
                        type="checkbox"
                      />
                    <span className="text-xs font-medium text-stone-300">{DRAWING_TYPE_LABELS[type]}</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-stone-500">{drawingCounts[type]}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 space-y-1">
              {drawingsLoading ? (
                <EmptyRow message="Syncing drawings..." />
              ) : drawings.length === 0 ? (
                <EmptyRow message="No drawings in session." />
              ) : (
                drawings.map((drawing) => (
                  <label
                    className="flex items-center justify-between rounded-xl border border-stone-800/50 bg-stone-900/30 px-3 py-1.5"
                    key={drawing.id}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        className="rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/30"
                        checked={isDrawingVisible(drawingTypeVisibility, hiddenDrawingIds, drawing)}
                        data-testid={`layer-drawing-toggle-${drawing.id}`}
                        onChange={(event) => {
                          toggleDrawingVisibility(drawing.id)
                          persistNodeVisibility(
                            getDrawingFeatureNodeId(drawing.id),
                            event.target.checked,
                          )
                        }}
                        type="checkbox"
                      />
                      <div>
                        <p className="text-xs font-medium text-stone-300">{drawing.name}</p>
                        <p className="text-[10px] uppercase text-stone-600 font-bold">{DRAWING_TYPE_LABELS[drawing.type]}</p>
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <p className="mt-3 text-[10px] font-bold text-stone-600 uppercase tracking-tighter text-right">
              VISIBLE: {drawingSummary.visibleCount}/{drawingSummary.totalCount}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SectionHeader(props: {
  readonly title: string
  readonly actionAllOn: () => void
  readonly actionAllOff: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-800/50 pb-2">
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-stone-500">
        {props.title}
      </h4>
      <div className="flex gap-2">
        <button
          className="rounded bg-stone-800 hover:bg-stone-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400 transition-colors"
          onClick={props.actionAllOn}
          type="button"
        >
          All On
        </button>
        <button
          className="rounded bg-stone-800 hover:bg-stone-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400 transition-colors"
          onClick={props.actionAllOff}
          type="button"
        >
          All Off
        </button>
      </div>
    </div>
  )
}

function EmptyRow(props: { readonly message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-800 bg-stone-950/20 px-3 py-2 text-[10px] font-medium text-stone-600 italic">
      {props.message}
    </div>
  )
}
