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

  return (
    <div
      className="absolute left-4 top-24 z-20 w-[18rem] rounded-2xl border border-stone-700 bg-stone-950/90 p-3 shadow-2xl shadow-black/40 backdrop-blur-sm"
      data-testid="drawing-toolbar"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-amber-300">Drawing Tools</p>
          <p className="mt-1 text-xs text-stone-400">
            One active tool at a time. `Esc` cancels. Double-click or right-click finishes multi-point tools.
          </p>
        </div>
        <div className="rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-300">
          Active: {activeDefinition?.label ?? 'Select'}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {DRAWING_TOOL_OPTIONS.map((option) => {
          const isActive = activeTool === option.value

          return (
            <button
              className={`min-h-12 rounded-xl border px-3 py-3 text-left text-sm transition ${
                isActive
                  ? 'border-amber-300 bg-amber-300/10 text-amber-50'
                  : 'border-stone-700 bg-stone-900 text-stone-200 hover:border-stone-500'
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
              <span className="mt-1 block text-xs text-stone-400">{option.hint}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-stone-500">
        LPB categories: {Object.values(LPB_CATEGORIES).map((category) => category.label).join(' · ')}
      </p>
    </div>
  )
}
