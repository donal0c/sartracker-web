import { create } from 'zustand'

import type { MissionRuntimeController } from './start-mission-runtime'
import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'

export type MissionRuntimePhase = 'idle' | 'active' | 'paused' | 'recovery'

export type MissionRuntimeState = {
  readonly phase: MissionRuntimePhase
  readonly currentMission: Mission | null
  readonly recoverableMission: Mission | null
}

export type MissionStoreState = MissionRuntimeState & {
  readonly controller: MissionRuntimeController | null
  readonly applyRuntime: (runtime: MissionRuntimeState) => void
  readonly applyController: (controller: MissionRuntimeController) => void
}

const IDLE_RUNTIME: MissionRuntimeState = {
  phase: 'idle',
  currentMission: null,
  recoverableMission: null,
}

export const useMissionStore = create<MissionStoreState>((set) => ({
  ...IDLE_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

/**
 * Applies mission runtime state outside React render code.
 */
export function applyMissionRuntime(runtime: MissionRuntimeState): void {
  useMissionStore.setState(runtime)
}

/**
 * Registers the mission runtime controller for UI consumers.
 */
export function applyMissionRuntimeController(controller: MissionRuntimeController): void {
  useMissionStore.setState({ controller })
}
