import { create } from 'zustand'

import type {
  Outing,
  OutingFixSummary,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { OutingRuntimeController } from './start-outing-runtime'

export type OutingRuntimeState = {
  readonly activeMissionId: string | null
  readonly outings: readonly Outing[]
  readonly fixSummary: OutingFixSummary | null
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
}

type OutingStoreState = OutingRuntimeState & {
  readonly controller: OutingRuntimeController | null
  readonly applyRuntime: (runtime: OutingRuntimeState) => void
  readonly applyController: (controller: OutingRuntimeController) => void
}

const EMPTY_OUTING_RUNTIME: OutingRuntimeState = {
  activeMissionId: null,
  outings: [],
  fixSummary: null,
  loading: false,
  saving: false,
  error: null,
}

export const useOutingStore = create<OutingStoreState>((set) => ({
  ...EMPTY_OUTING_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

/** Applies outing runtime state outside React render code. */
export function applyOutingRuntime(runtime: OutingRuntimeState): void {
  useOutingStore.setState(runtime)
}

/** Registers the outing runtime controller for operator controls. */
export function applyOutingController(controller: OutingRuntimeController): void {
  useOutingStore.setState({ controller })
}
