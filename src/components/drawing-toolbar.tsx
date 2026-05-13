import { useState } from 'react'

import { useDrawingStore } from '../features/drawings/drawing-store'
import { LPB_CATEGORIES } from '../features/drawings/lpb-data'
import { useMeasurementStore } from '../features/measurements/measurement-store'
import { useMissionStore } from '../features/mission/mission-store'

const DRAWING_TOOL_OPTIONS = [
  { value: 'select', label: 'Select', hint: 'Edit and delete existing drawings' },
  { value: 'line', label: 'Line', hint: 'Click points, double-click or right-click to finish' },
  { value: 'search_area', label: 'Search Area', hint: 'Draw polygon then fill in search metadata' },
  { value: 'range_ring', label: 'Range Rings', hint: 'Click a centre point, then configure rings' },
  { value: 'bearing_line', label: 'Bearing', hint: 'Click an origin, then enter bearing and distance' },
  { value: 'search_sector', label: 'Sector', hint: 'Click a centre point, then set bearings and radius' },
  { value: 'text_label', label: 'Text Label', hint: 'Click a point, then enter label text and style' },
] as const

/**
 * Renders the map-local drawing toolbar with one active tool at a time.
 */
export function DrawingToolbar() {
  const controller = useDrawingStore((state) => state.controller)
  const activeTool = useDrawingStore((state) => state.activeTool)
  const dialog = useDrawingStore((state) => state.dialog)
  const measurementController = useMeasurementStore((state) => state.controller)
  const measurementMode = useMeasurementStore((state) => state.mode)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  const disabled = controller === null || missionId === null || missionPhase === 'recovery'
  const activeDefinition = DRAWING_TOOL_OPTIONS.find((option) => option.value === activeTool)
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="sar-control-dock absolute left-4 top-24 z-20 rounded"
      data-testid="drawing-toolbar"
    >
      {expanded ? (
        <div className="max-h-[calc(100vh-9rem)] w-[8.75rem] overflow-y-auto p-3">
          <div className="space-y-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">Drawing Tools</p>
              <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">
                {disabled ? 'mission required' : 'armed'}
              </p>
            </div>
            <button
              className="sar-button w-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
              data-testid="drawing-toolbar-collapse"
              onClick={() => setExpanded(false)}
              type="button"
            >
              Collapse
            </button>
          </div>

          <div className="mt-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-[0.16em] text-stone-100">
            Active: {activeDefinition?.label ?? 'Select'}
          </div>

          <div className="mt-3 grid gap-2">
            {DRAWING_TOOL_OPTIONS.map((option) => {
              const isActive = activeTool === option.value

              return (
                <button
                  className={`min-h-14 border px-2 py-2 text-center text-[11px] uppercase tracking-[0.08em] transition ${
                    isActive
                      ? 'border-amber-300 bg-amber-300/14 text-amber-50 shadow-[inset_0_0_0_1px_rgba(244,183,74,0.24)]'
                      : 'border-stone-700 bg-[var(--sar-panel-raised)] text-stone-200 hover:border-stone-400 hover:bg-stone-800'
                  } disabled:cursor-not-allowed disabled:opacity-55`}
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

                    if (option.value === 'select') {
                      controller.cancelActiveTool()
                      return
                    }

                    if (activeTool === option.value && dialog === null) {
                      controller.cancelActiveTool()
                      return
                    }

                    controller.setActiveTool(option.value)
                  }}
                  type="button"
                >
                  <span className="block font-black">{option.label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 border-t border-[var(--sar-line)] pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-stone-500">
            LPB {Object.values(LPB_CATEGORIES).length} categories
          </p>
        </div>
      ) : (
        <button
          className="flex items-center gap-3 px-4 py-3"
          data-testid="drawing-toolbar-expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">Drawing Tools</span>
          <span className="border border-[var(--sar-line)] bg-[var(--sar-panel-raised)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-200">
            Active: {activeDefinition?.label ?? 'Select'}
          </span>
          <svg className="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
