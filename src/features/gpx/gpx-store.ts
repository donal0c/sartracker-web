import { create } from 'zustand'

import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'
import type { GpxRuntimeController, GpxRuntimeState } from './start-gpx-runtime'

type GpxStoreState = GpxRuntimeState & {
  readonly controller: GpxRuntimeController | null
  readonly applyRuntime: (runtime: GpxRuntimeState) => void
  readonly applyController: (controller: GpxRuntimeController) => void
}

const EMPTY_GPX_RUNTIME: GpxRuntimeState = {
  activeMissionId: null,
  imports: [],
  watchedDirectories: [],
  loading: false,
  importing: false,
  error: null,
}

export const useGpxStore = create<GpxStoreState>((set) => ({
  ...EMPTY_GPX_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyGpxRuntime(runtime: GpxRuntimeState): void {
  useGpxStore.setState(runtime)
}

export function applyGpxController(controller: GpxRuntimeController): void {
  useGpxStore.setState({ controller })
}

export function getVisibleGpxImports(
  imports: readonly GpxTrackImport[],
  hiddenImportIds: readonly string[],
): readonly GpxTrackImport[] {
  return imports.filter((entry) => !hiddenImportIds.includes(entry.id))
}
