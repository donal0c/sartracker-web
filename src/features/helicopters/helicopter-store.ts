import { create } from 'zustand'

import type { Helicopter } from '../../infrastructure/mission-store/tauri-mission-store'
import type { HelicopterRuntimeController } from './start-helicopter-runtime'

export type HelicopterRuntimeState = {
  readonly activeMissionId: string | null
  readonly helicopters: readonly Helicopter[]
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
}

type HelicopterStoreState = HelicopterRuntimeState & {
  readonly controller: HelicopterRuntimeController | null
  readonly applyRuntime: (runtime: HelicopterRuntimeState) => void
  readonly applyController: (controller: HelicopterRuntimeController) => void
}

const EMPTY_RUNTIME: HelicopterRuntimeState = {
  activeMissionId: null,
  helicopters: [],
  loading: false,
  saving: false,
  error: null,
}

export const useHelicopterStore = create<HelicopterStoreState>((set) => ({
  ...EMPTY_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyHelicopterRuntime(runtime: HelicopterRuntimeState): void {
  useHelicopterStore.setState(runtime)
}

export function applyHelicopterController(controller: HelicopterRuntimeController): void {
  useHelicopterStore.setState({ controller })
}
