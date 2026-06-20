import { useState } from 'react'
import { useMeasurementStore } from '../features/measurements/measurement-store'
import { useDrawingStore } from '../features/drawings/drawing-store'
import { MEASUREMENTS_LAYER_NODE_ID } from '../features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { revealMapToolLayerForOperation } from '../features/layers/layer-visibility-service'
import { useMissionStore } from '../features/mission/mission-store'

type MeasurementPanelProps = {
  readonly className?: string
  readonly showArmControl?: boolean
}

/**
 * Renders the measurement tool controls and active measurement summaries.
 */
export function MeasurementPanel({
  className = '',
  showArmControl = true,
}: MeasurementPanelProps = {}) {
  const controller = useMeasurementStore((state) => state.controller)
  const mode = useMeasurementStore((state) => state.mode)
  const measurements = useMeasurementStore((state) => state.measurements)
  const draftStart = useMeasurementStore((state) => state.draftStart)
  const drawingController = useDrawingStore((state) => state.controller)
  const drawingTool = useDrawingStore((state) => state.activeTool)
  const layerCatalogRoot = useLayerCatalogStore((state) => state.root)
  const layerCatalogController = useLayerCatalogStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  const [clearConfirmationVisible, setClearConfirmationVisible] = useState(false)
  const disabled = controller === null || missionId === null || missionPhase === 'recovery'
  const statusMessage =
    mode === 'armed'
      ? draftStart === null
        ? 'Click the first point on the map.'
        : 'Click the second point to complete the measurement.'
      : 'Ready to measure distance and bearing.'

  return (
    <section
      className={`sar-module p-4 text-sm ${className}`}
      data-testid="measurement-panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-stone-100">
          Measurement
        </span>
        <span
          className={`text-[11px] font-bold uppercase ${
            mode === 'armed' ? 'text-cyan-200' : 'text-stone-300'
          }`}
          data-testid="measurement-mode"
        >
          {mode}
        </span>
      </div>

      <p
        className="sar-readout px-3 py-2 text-[13px] text-stone-100"
        data-testid="measurement-status"
      >
        {statusMessage}
      </p>

      <div className={`mt-4 grid gap-2 ${showArmControl ? 'sm:grid-cols-2' : ''}`}>
        {showArmControl ? (
          <button
            className="rounded-lg border border-cyan-400/55 bg-cyan-700 px-3 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50"
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

              revealMapToolLayerForOperation(
                layerCatalogRoot,
                layerCatalogController,
                MEASUREMENTS_LAYER_NODE_ID,
                useLayerVisibilityStore.getState(),
              )
              controller.armMeasurement()
            }}
            type="button"
          >
            {mode === 'armed' ? 'Cancel Measure' : 'Measure'}
          </button>
        ) : null}
        {clearConfirmationVisible ? (
          <div
            className="col-span-full rounded-xl border border-rose-400/40 bg-rose-950/40 p-3 text-sm text-rose-100"
            data-testid="measurement-clear-confirmation"
          >
            <p className="font-semibold text-xs">Clear all {measurements.length} measurement{measurements.length !== 1 ? 's' : ''}?</p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-lg border border-rose-300/50 bg-rose-400/20 px-3 py-1.5 text-xs font-semibold text-rose-50"
                data-testid="measurement-clear-confirm-btn"
                onClick={() => {
                  controller?.clearMeasurements()
                  setClearConfirmationVisible(false)
                }}
                type="button"
              >
                Clear All
              </button>
              <button
                className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-1.5 text-xs font-semibold text-stone-200"
                data-testid="measurement-clear-keep-btn"
                onClick={() => setClearConfirmationVisible(false)}
                type="button"
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button
            className="sar-button px-3 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em]"
            data-testid="measurement-clear-btn"
            disabled={controller === null || measurements.length === 0}
            onClick={() => setClearConfirmationVisible(true)}
            type="button"
          >
            Clear Measurements
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-[var(--sar-line)] pt-4">
        <div className="mb-2 flex items-center justify-between text-[13px] font-semibold uppercase tracking-wider text-stone-200">
          <span>Active Measurements</span>
          <span data-testid="measurement-count">{measurements.length}</span>
        </div>
        <div className="space-y-2" data-testid="measurement-list">
          {measurements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-600 bg-stone-950/30 px-3 py-2 text-xs font-medium italic text-stone-300">
              {showArmControl
                ? 'No active measurements. Click Measure above to start.'
                : 'No active measurements. Use Measure in Map Tools to start.'}
            </div>
          ) : (
            measurements.map((measurement) => (
              <div
                className="rounded-xl border border-stone-700 bg-stone-900/40 px-3 py-2"
                data-testid={`measurement-item-${measurement.id}`}
                key={measurement.id}
              >
                <p className="font-mono text-[12px] font-semibold text-cyan-100">{measurement.label}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
