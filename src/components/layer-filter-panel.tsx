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

  return (
    <section
      className="mt-6 rounded-2xl border border-stone-700 bg-stone-950/70 p-4 text-sm text-stone-300"
      data-testid="layer-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-100">Layer Filters</h3>
          <p className="mt-1 text-xs text-stone-400">
            Right-sidebar visibility controls for people, markers, and drawings.
          </p>
        </div>
        <button
          className="rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-xs text-stone-200"
          data-testid="layer-panel-toggle"
          onClick={() => setPanelExpanded(!panelExpanded)}
          type="button"
        >
          {panelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {panelExpanded ? (
        <div className="mt-5 space-y-5">
          <div data-testid="layer-section-people">
            <SectionHeader
              actionAllOff={() => hideAllDevices(trackingSnapshot.devices.map((device) => device.device_id))}
              actionAllOn={showAllDevices}
              title="People"
            />
            <label className="mt-3 block text-xs text-stone-400">
              Filter people
              <input
                className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                data-testid="layer-people-search"
                onChange={(event) => setPeopleSearch(event.target.value)}
                placeholder="Search by device name"
                value={peopleSearch}
              />
            </label>
            <div className="mt-3 space-y-2">
              {filteredDevices.length === 0 ? (
                <EmptyRow message="No tracked devices match the current filter." />
              ) : (
                filteredDevices.map((device) => (
                  <label
                    className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900/70 px-3 py-2"
                    key={device.device_id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <input
                        checked={isDeviceVisible(hiddenDeviceIds, device.device_id)}
                        data-testid={`layer-device-toggle-${device.device_id}`}
                        onChange={() => toggleDeviceVisibility(device.device_id)}
                        type="checkbox"
                      />
                      <span
                        className="h-3 w-3 rounded-full border border-stone-950"
                        style={{ backgroundColor: createDeviceColor(device.device_id) }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-stone-100">{device.name}</p>
                        <p className="text-xs text-stone-400">
                          Last seen: {device.last_seen ?? 'No fix yet'}
                        </p>
                      </div>
                    </div>
                    <span className="ml-3 text-xs uppercase tracking-[0.2em] text-stone-500">
                      {device.status}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div data-testid="layer-section-markers">
            <SectionHeader
              actionAllOff={hideAllMarkerTypes}
              actionAllOn={showAllMarkerTypes}
              title="Markers"
            />
            <div className="mt-3 space-y-2">
              {(Object.keys(MARKER_TYPE_LABELS) as MarkerType[]).map((type) => (
                <label
                  className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900/70 px-3 py-2"
                  key={type}
                >
                  <div className="flex items-center gap-3">
                    <input
                      checked={isMarkerTypeVisible(markerTypeVisibility, type)}
                      data-testid={`layer-marker-toggle-${type}`}
                      onChange={(event) => setMarkerTypeVisibility(type, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="text-sm text-stone-100">{MARKER_TYPE_LABELS[type]}</span>
                  </div>
                  <span className="text-xs text-stone-400">{markerCounts[type]}</span>
                </label>
              ))}
            </div>
          </div>

          <div data-testid="layer-section-drawings">
            <SectionHeader
              actionAllOff={() => {
                hideAllDrawingTypes()
                hideAllDrawings(drawings)
              }}
              actionAllOn={() => {
                showAllDrawingTypes()
                showAllDrawings()
              }}
              title="Drawings"
            />
            <div className="mt-3 space-y-2">
              {(Object.keys(DRAWING_TYPE_LABELS) as DrawingType[]).map((type) => (
                <label
                  className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900/70 px-3 py-2"
                  key={type}
                >
                  <div className="flex items-center gap-3">
                    <input
                      checked={drawingTypeVisibility[type]}
                      data-testid={`layer-drawing-type-toggle-${type}`}
                      onChange={(event) => setDrawingTypeVisibility(type, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="text-sm text-stone-100">{DRAWING_TYPE_LABELS[type]}</span>
                  </div>
                  <span className="text-xs text-stone-400">{drawingCounts[type]}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {drawingsLoading ? (
                <EmptyRow message="Loading drawings..." />
              ) : drawings.length === 0 ? (
                <EmptyRow message="No drawings in the current mission yet." />
              ) : (
                drawings.map((drawing) => (
                  <label
                    className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900/60 px-3 py-2"
                    key={drawing.id}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        checked={isDrawingVisible(drawingTypeVisibility, hiddenDrawingIds, drawing)}
                        data-testid={`layer-drawing-toggle-${drawing.id}`}
                        onChange={() => toggleDrawingVisibility(drawing.id)}
                        type="checkbox"
                      />
                      <div>
                        <p className="text-sm text-stone-100">{drawing.name}</p>
                        <p className="text-xs text-stone-400">{DRAWING_TYPE_LABELS[drawing.type]}</p>
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Visible drawings: {drawingSummary.visibleCount}/{drawingSummary.totalCount}
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
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-200">
        {props.title}
      </h4>
      <div className="flex gap-2 text-xs">
        <button
          className="rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-stone-300"
          onClick={props.actionAllOn}
          type="button"
        >
          All On
        </button>
        <button
          className="rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-stone-300"
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
    <div className="rounded-xl border border-dashed border-stone-700 bg-stone-900/40 px-3 py-3 text-xs text-stone-500">
      {props.message}
    </div>
  )
}
