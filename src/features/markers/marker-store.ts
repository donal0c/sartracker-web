import { create } from 'zustand'

import type { Marker } from '../../infrastructure/mission-store/tauri-mission-store'
import type { MarkerDraft } from './marker-draft'
import type { MarkerRuntimeController } from './start-marker-runtime'

export type MarkerDialogState = {
  readonly sessionId: number
  readonly mode: 'create' | 'edit'
  readonly draft: MarkerDraft
  readonly baselineDraft: MarkerDraft
  readonly pendingTreatmentUpdate: string
}

export type MarkerRuntimeState = {
  readonly activeMissionId: string | null
  readonly markers: readonly Marker[]
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly loadError: string | null
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
  loadError: null,
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

/** Compares every draft field by value against the opening snapshot, including coordinates. */
export function isMarkerDialogDirty(dialog: MarkerDialogState): boolean {
  if (dialog.pendingTreatmentUpdate !== '') return true

  const { draft, baselineDraft } = dialog
  return (Object.keys(draft) as (keyof MarkerDraft)[]).some((field) => {
    if (field === 'coordinates') {
      return (Object.keys(draft.coordinates) as (keyof MarkerDraft['coordinates'])[])
        .some((coordinate) => draft.coordinates[coordinate] !== baselineDraft.coordinates[coordinate])
    }
    return draft[field] !== baselineDraft[field]
  })
}
