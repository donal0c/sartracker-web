import { useState } from 'react'

import { MarkerAtGridPanel } from './marker-at-grid-panel'
import { MeasurementPanel } from './measurement-panel'
import { useDrawingStore } from '../features/drawings/drawing-store'
import { LPB_CATEGORIES } from '../features/drawings/lpb-data'
import { getDrawingLayerNodeId, MEASUREMENTS_LAYER_NODE_ID } from '../features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { revealMapToolLayerForOperation } from '../features/layers/layer-visibility-service'
import { useMeasurementStore } from '../features/measurements/measurement-store'
import { useMissionStore } from '../features/mission/mission-store'

// "Select" is intentionally absent from the operator-facing tool list: it is
// the internal default/fallback mode the editor returns to after a tool
// completes or is cancelled (DON-72). Existing drawings stay editable via a
// normal map click in that fallback mode or through the Layers panel.
const DRAWING_TOOL_OPTIONS = [
  { value: 'line', label: 'Line', hint: 'Click points, double-click or right-click to finish' },
  { value: 'search_area', label: 'Search Area', hint: 'Draw polygon then fill in search metadata' },
  { value: 'range_ring', label: 'Range Rings', hint: 'Click a centre point, then configure rings' },
  { value: 'bearing_line', label: 'Bearing', hint: 'Click an origin, then enter bearing and distance' },
  { value: 'search_sector', label: 'Sector', hint: 'Click a centre point, then set bearings and radius' },
  { value: 'text_label', label: 'Text Label', hint: 'Click a point, then enter label text and style' },
] as const

type MapToolsPanel = 'measurements' | 'marker_at_grid' | null

/**
 * Renders the map-local tool toolbar with one active tool at a time.
 */
export function DrawingToolbar() {
  const controller = useDrawingStore((state) => state.controller)
  const activeTool = useDrawingStore((state) => state.activeTool)
  const dialog = useDrawingStore((state) => state.dialog)
  const measurementController = useMeasurementStore((state) => state.controller)
  const measurementMode = useMeasurementStore((state) => state.mode)
  const layerCatalogRoot = useLayerCatalogStore((state) => state.root)
  const layerCatalogController = useLayerCatalogStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  const disabled = controller === null || missionId === null || missionPhase === 'recovery'
  const activeDefinition =
    measurementMode === 'armed'
      ? { label: 'Measure' }
      : DRAWING_TOOL_OPTIONS.find((option) => option.value === activeTool)
  const [expanded, setExpanded] = useState(false)
  const [activePanel, setActivePanel] = useState<MapToolsPanel>(null)

  return (
    <div
      className="sar-control-dock absolute left-4 top-24 z-20 rounded"
      data-map-interaction-boundary="true"
      data-testid="drawing-toolbar"
    >
      {expanded ? (
        <div className="max-h-[calc(100vh-12rem)] w-72 overflow-y-auto p-3 data-[panel-open=true]:w-[34rem]" data-panel-open={activePanel === null ? 'false' : 'true'}>
          <button
            aria-expanded="true"
            className="w-full text-left"
            data-testid="drawing-toolbar-collapse"
            onClick={() => setExpanded(false)}
            type="button"
          >
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">Map Tools</p>
              <p
                className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300"
                data-testid="drawing-toolbar-active-mode"
              >
                {disabled ? 'Mission required' : activeDefinition?.label ?? 'Select'}
              </p>
            </div>
          </button>

          <div className={`mt-3 grid gap-3 ${activePanel === null ? 'grid-cols-1' : 'grid-cols-[9rem_minmax(0,1fr)]'}`}>
            <div className="grid gap-2">
              {DRAWING_TOOL_OPTIONS.map((option) => {
                const isActive = activeTool === option.value

                return (
                  <button
                    className={`min-h-14 border px-2 py-2 text-center text-[11px] uppercase tracking-[0.08em] transition ${
                      isActive
                        ? 'border-amber-300 bg-amber-300/22 text-amber-50 shadow-[inset_0_0_0_1px_rgba(244,183,74,0.4)]'
                        : 'border-stone-500 bg-[var(--sar-panel-raised)] text-stone-100 hover:border-amber-300 hover:bg-stone-800'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    data-testid={`drawing-tool-${option.value}`}
                    disabled={disabled}
                    key={option.value}
                    onClick={() => {
                      if (controller === null) {
                        return
                      }

                      if (measurementController !== null && measurementMode === 'armed') {
                        measurementController.cancelMeasurement()
                      }

                      setActivePanel(null)
                      if (activeTool === option.value && dialog === null) {
                        controller.cancelActiveTool()
                        return
                      }

                      revealMapToolLayerForOperation(
                        layerCatalogRoot,
                        layerCatalogController,
                        getDrawingLayerNodeId(option.value),
                        useLayerVisibilityStore.getState(),
                      )
                      controller.setActiveTool(option.value)
                    }}
                    type="button"
                  >
                    <span className="block font-black">{option.label}</span>
                  </button>
                )
              })}
              <button
                className={`min-h-14 border px-2 py-2 text-center text-[11px] uppercase tracking-[0.08em] transition ${
                  measurementMode === 'armed'
                    ? 'border-cyan-300 bg-cyan-300/22 text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.4)]'
                    : 'border-stone-500 bg-[var(--sar-panel-raised)] text-stone-100 hover:border-cyan-300 hover:bg-stone-800'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                data-testid="drawing-tool-measure"
                disabled={disabled || measurementController === null}
                onClick={() => {
                  if (controller === null || measurementController === null) {
                    return
                  }

                  setActivePanel('measurements')
                  if (measurementMode === 'armed') {
                    measurementController.cancelMeasurement()
                    return
                  }

                  controller.cancelActiveTool()
                  revealMapToolLayerForOperation(
                    layerCatalogRoot,
                    layerCatalogController,
                    MEASUREMENTS_LAYER_NODE_ID,
                    useLayerVisibilityStore.getState(),
                  )
                  measurementController.armMeasurement()
                }}
                type="button"
              >
                <span className="block font-black">Measure</span>
              </button>
              <button
                className={`min-h-14 border px-2 py-2 text-center text-[11px] uppercase tracking-[0.08em] transition ${
                  activePanel === 'marker_at_grid'
                    ? 'border-amber-300 bg-amber-300/22 text-amber-50 shadow-[inset_0_0_0_1px_rgba(244,183,74,0.4)]'
                    : 'border-stone-500 bg-[var(--sar-panel-raised)] text-stone-100 hover:border-amber-300 hover:bg-stone-800'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                data-testid="drawing-tool-marker_at_grid"
                disabled={disabled}
                onClick={() => {
                  if (controller === null) {
                    return
                  }

                  if (measurementController !== null && measurementMode === 'armed') {
                    measurementController.cancelMeasurement()
                  }

                  if (activeTool !== 'select' || dialog !== null) {
                    controller.cancelActiveTool()
                  }

                  setActivePanel((currentPanel) =>
                    currentPanel === 'marker_at_grid' ? null : 'marker_at_grid',
                  )
                }}
                type="button"
              >
                <span className="block font-black">Marker at GR</span>
              </button>
            </div>
            {activePanel === 'measurements' ? (
              <MeasurementPanel showArmControl={false} />
            ) : null}
            {activePanel === 'marker_at_grid' ? (
              <MarkerAtGridPanel />
            ) : null}
          </div>
          <p className="mt-3 border-t border-[var(--sar-line)] pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-stone-300">
            LPB {Object.values(LPB_CATEGORIES).length} categories
          </p>
        </div>
      ) : (
        <button
          className="flex items-center gap-3 px-4 py-3"
          aria-expanded="false"
          data-testid="drawing-toolbar-expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">Map Tools</span>
          <span
            className="border border-stone-500 bg-[var(--sar-panel-raised)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-50"
            data-testid="drawing-toolbar-active-mode"
          >
            {activeDefinition?.label ?? 'Select'}
          </span>
          <svg className="h-4 w-4 text-stone-200" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
