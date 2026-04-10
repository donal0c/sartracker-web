import { create } from 'zustand'

import type { MeasurementRuntimeController } from './start-measurement-runtime'
import type { MeasurementRuntimeState } from './measurement-types'

type MeasurementStoreState = MeasurementRuntimeState & {
  readonly controller: MeasurementRuntimeController | null
  readonly applyRuntime: (runtime: MeasurementRuntimeState) => void
  readonly applyController: (controller: MeasurementRuntimeController) => void
}

const EMPTY_MEASUREMENT_RUNTIME: MeasurementRuntimeState = {
  activeMissionId: null,
  mode: 'idle',
  measurements: [],
  draftStart: null,
  hoverPoint: null,
}

export const useMeasurementStore = create<MeasurementStoreState>((set) => ({
  ...EMPTY_MEASUREMENT_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

/**
 * Applies measurement runtime state from the non-React controller boundary.
 */
export function applyMeasurementRuntime(runtime: MeasurementRuntimeState): void {
  useMeasurementStore.setState(runtime)
}

/**
 * Registers the measurement runtime controller for UI consumers.
 */
export function applyMeasurementController(
  controller: MeasurementRuntimeController,
): void {
  useMeasurementStore.setState({ controller })
}
