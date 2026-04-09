import { create } from 'zustand'

import type { Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import type { MarkerDraft } from './marker-draft'
import type { MarkerRuntimeController } from './start-marker-runtime'

export type MarkerDialogState = {
  readonly mode: 'create' | 'edit'
  readonly draft: MarkerDraft
}

export type MarkerRuntimeState = {
  readonly activeMissionId: string | null
  readonly markers: readonly Marker[]
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly dialog: MarkerDialogState | null
}

type MarkerStoreState = MarkerRuntimeState & {
  readonly controller: MarkerRuntimeController | null
  readonly applyRuntime: (runtime: MarkerRuntimeState) => void
  readonly applyController: (controller: MarkerRuntimeController) => void
}

const EMPTY_MARKER_RUNTIME: MarkerRuntimeState = {
  activeMissionId: null,
  markers: [],
  loading: false,
  saving: false,
  error: null,
  dialog: null,
}

export const useMarkerStore = create<MarkerStoreState>((set) => ({
  ...EMPTY_MARKER_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyMarkerRuntime(runtime: MarkerRuntimeState): void {
  useMarkerStore.setState(runtime)
}

export function applyMarkerController(controller: MarkerRuntimeController): void {
  useMarkerStore.setState({ controller })
}
