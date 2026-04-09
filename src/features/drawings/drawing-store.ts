import { create } from 'zustand'

import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import type { DrawingRuntimeController } from './start-drawing-runtime'

export type DrawingRuntimeState = {
  readonly activeMissionId: string | null
  readonly drawings: readonly Drawing[]
  readonly loading: boolean
  readonly error: string | null
}

type DrawingStoreState = DrawingRuntimeState & {
  readonly controller: DrawingRuntimeController | null
  readonly applyRuntime: (runtime: DrawingRuntimeState) => void
  readonly applyController: (controller: DrawingRuntimeController) => void
}

const EMPTY_DRAWING_RUNTIME: DrawingRuntimeState = {
  activeMissionId: null,
  drawings: [],
  loading: false,
  error: null,
}

export const useDrawingStore = create<DrawingStoreState>((set) => ({
  ...EMPTY_DRAWING_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyDrawingRuntime(runtime: DrawingRuntimeState): void {
  useDrawingStore.setState(runtime)
}

export function applyDrawingController(controller: DrawingRuntimeController): void {
  useDrawingStore.setState({ controller })
}
