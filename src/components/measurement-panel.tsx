import { useMeasurementStore } from '../features/measurements/measurement-store'
import { useDrawingStore } from '../features/drawings/drawing-store'
import { useMissionStore } from '../features/mission/mission-store'

/**
 * Renders the measurement tool controls and active measurement summaries.
 */
export function MeasurementPanel() {
  const controller = useMeasurementStore((state) => state.controller)
  const mode = useMeasurementStore((state) => state.mode)
  const measurements = useMeasurementStore((state) => state.measurements)
  const draftStart = useMeasurementStore((state) => state.draftStart)
  const drawingController = useDrawingStore((state) => state.controller)
  const drawingTool = useDrawingStore((state) => state.activeTool)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  const disabled = controller === null || missionId === null || missionPhase === 'recovery'
  const statusMessage =
    mode === 'armed'
      ? draftStart === null
        ? 'Click the first point on the map.'
        : 'Click the second point to complete the measurement.'
      : 'Ready to measure distance and bearing.'

  return (
    <section
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="measurement-panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
          Measurement
        </span>
        <span
          className={`text-[11px] font-bold uppercase ${
            mode === 'armed' ? 'text-cyan-300' : 'text-stone-500'
          }`}
          data-testid="measurement-mode"
        >
          {mode}
        </span>
      </div>

      <p
        className="rounded-xl border border-stone-800 bg-stone-900/30 px-3 py-2 text-[11px] text-stone-300"
        data-testid="measurement-status"
      >
        {statusMessage}
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          className="rounded-lg bg-cyan-700 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
          data-testid="measurement-arm-btn"
          disabled={disabled}
          onClick={() => {
            if (controller === null) {
              return
            }

            if (mode === 'armed') {
              controller.cancelMeasurement()
              return
            }

            if (drawingController !== null && drawingTool !== 'select') {
              drawingController.cancelActiveTool()
            }

            controller.armMeasurement()
          }}
          type="button"
        >
          {mode === 'armed' ? 'Cancel Measure' : 'Measure'}
        </button>
        <button
          className="rounded-lg bg-stone-800 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-stone-300 transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
          data-testid="measurement-clear-btn"
          disabled={controller === null || measurements.length === 0}
          onClick={() => controller?.clearMeasurements()}
          type="button"
        >
          Clear Measurements
        </button>
      </div>

      <div className="mt-4 border-t border-stone-800 pt-4">
        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-stone-500">
          <span>Active measurements</span>
          <span data-testid="measurement-count">{measurements.length}</span>
        </div>
        <div className="space-y-2" data-testid="measurement-list">
          {measurements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-800 bg-stone-950/20 px-3 py-2 text-[10px] font-medium italic text-stone-600">
              No active measurements.
            </div>
          ) : (
            measurements.map((measurement) => (
              <div
                className="rounded-xl border border-stone-800/50 bg-stone-900/30 px-3 py-2"
                data-testid={`measurement-item-${measurement.id}`}
                key={measurement.id}
              >
                <p className="font-mono text-[11px] text-cyan-100">{measurement.label}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
