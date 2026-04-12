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
      className="absolute left-4 top-24 z-20 rounded-2xl border border-stone-700 bg-stone-950 shadow-2xl shadow-black/40"
      data-testid="drawing-toolbar"
    >
      {expanded ? (
        <div className="w-[18rem] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wider text-amber-300">Drawing Tools</p>
              <p className="mt-1 text-xs font-medium text-white">
                One active tool at a time. Esc cancels. Double-click or right-click finishes multi-point tools.
              </p>
            </div>
            <button
              className="rounded-lg border border-stone-600 bg-stone-800 px-2 py-1 text-xs font-semibold text-stone-200 hover:bg-stone-700"
              data-testid="drawing-toolbar-collapse"
              onClick={() => setExpanded(false)}
              type="button"
            >
              Collapse
            </button>
          </div>

          <div className="mt-2 rounded-full border border-stone-600 bg-stone-800 px-3 py-1 text-center text-[11px] font-semibold uppercase tracking-wider text-stone-100">
            Active: {activeDefinition?.label ?? 'Select'}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {DRAWING_TOOL_OPTIONS.map((option) => {
              const isActive = activeTool === option.value

              return (
                <button
                  className={`min-h-12 rounded-xl border px-3 py-3 text-left text-sm transition ${
                    isActive
                      ? 'border-amber-300 bg-amber-300/10 text-amber-50'
                      : 'border-stone-500 bg-stone-900 text-white hover:border-stone-400 hover:bg-stone-800'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
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
                  <span className="block font-semibold">{option.label}</span>
                  <span className="mt-1 block text-[13px] font-normal text-white">{option.hint}</span>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-xs font-medium text-white">
            LPB categories: {Object.values(LPB_CATEGORIES).map((category) => category.label).join(' · ')}
          </p>
        </div>
      ) : (
        <button
          className="flex items-center gap-3 px-4 py-3"
          data-testid="drawing-toolbar-expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <span className="text-[13px] font-semibold uppercase tracking-wider text-amber-300">Drawing Tools</span>
          <span className="rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-300">
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
