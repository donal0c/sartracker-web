import { create } from 'zustand'

import type { DiagnosticsSnapshot } from './diagnostics-model'

export type DiagnosticsRuntimeState = {
  readonly snapshot: DiagnosticsSnapshot | null
  readonly selectedMissionId: string | null
  readonly loading: boolean
  readonly repairing: boolean
  readonly exporting: boolean
  readonly error: string | null
  readonly feedback: string | null
  readonly exportPath: string | null
}

export type DiagnosticsController = {
  readonly load: (preferredMissionId?: string | null) => Promise<void>
  readonly selectMission: (missionId: string) => Promise<void>
  readonly repairLayerCatalog: () => Promise<void>
  readonly exportSupportReport: () => Promise<string | null>
  readonly clearFeedback: () => void
}

type DiagnosticsStoreState = DiagnosticsRuntimeState & {
  readonly controller: DiagnosticsController | null
  readonly applyRuntime: (runtime: DiagnosticsRuntimeState) => void
  readonly applyController: (controller: DiagnosticsController) => void
}

const EMPTY_RUNTIME: DiagnosticsRuntimeState = {
  snapshot: null,
  selectedMissionId: null,
  loading: false,
  repairing: false,
  exporting: false,
  error: null,
  feedback: null,
  exportPath: null,
}

export const useDiagnosticsStore = create<DiagnosticsStoreState>((set) => ({
  ...EMPTY_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyDiagnosticsRuntime(runtime: DiagnosticsRuntimeState): void {
  useDiagnosticsStore.setState(runtime)
}

export function applyDiagnosticsController(controller: DiagnosticsController): void {
  useDiagnosticsStore.setState({ controller })
}
