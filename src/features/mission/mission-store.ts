import { create } from 'zustand'

import type { MissionRuntimeController } from './start-mission-runtime'
import type {
  MissionGovernanceController,
  MissionGovernanceRuntimeState,
} from './start-mission-governance-runtime'
import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'

export type MissionRuntimePhase = 'idle' | 'active' | 'paused' | 'recovery'

export type MissionRuntimeState = {
  readonly phase: MissionRuntimePhase
  readonly currentMission: Mission | null
  readonly recoverableMission: Mission | null
}

const DEFAULT_GOVERNANCE_RUNTIME: MissionGovernanceRuntimeState = {
  governanceMission: null,
}

export type MissionStoreState = MissionRuntimeState & MissionGovernanceRuntimeState & {
  readonly controller: MissionRuntimeController | null
  readonly governanceController: MissionGovernanceController | null
  readonly applyRuntime: (runtime: MissionRuntimeState) => void
  readonly applyGovernanceRuntime: (runtime: MissionGovernanceRuntimeState) => void
  readonly applyController: (controller: MissionRuntimeController) => void
  readonly applyGovernanceController: (controller: MissionGovernanceController) => void
}

const IDLE_RUNTIME: MissionRuntimeState = {
  phase: 'idle',
  currentMission: null,
  recoverableMission: null,
}

export const useMissionStore = create<MissionStoreState>((set) => ({
  ...IDLE_RUNTIME,
  ...DEFAULT_GOVERNANCE_RUNTIME,
  controller: null,
  governanceController: null,
  applyRuntime: (runtime) => set(runtime),
  applyGovernanceRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
  applyGovernanceController: (controller) => set({ governanceController: controller }),
}))

/**
 * Applies mission runtime state outside React render code.
 */
export function applyMissionRuntime(runtime: MissionRuntimeState): void {
  useMissionStore.setState(runtime)
}

/**
 * Applies governance runtime state outside React render code.
 */
export function applyMissionGovernanceRuntime(runtime: MissionGovernanceRuntimeState): void {
  useMissionStore.setState(runtime)
}

/**
 * Registers the mission runtime controller for UI consumers.
 */
export function applyMissionRuntimeController(controller: MissionRuntimeController): void {
  useMissionStore.setState({ controller })
}

/**
 * Registers the mission governance controller for UI consumers.
 */
export function applyMissionGovernanceController(
  controller: MissionGovernanceController,
): void {
  useMissionStore.setState({ governanceController: controller })
}
