import { create } from 'zustand'

import type {
  MissionReviewController,
  MissionReviewRuntimeState,
} from './start-mission-review-runtime'
import { createMissionReviewRuntimeState } from './start-mission-review-runtime'

type MissionReviewStoreState = MissionReviewRuntimeState & {
  readonly controller: MissionReviewController | null
  readonly applyRuntime: (runtime: MissionReviewRuntimeState) => void
  readonly applyController: (controller: MissionReviewController) => void
}

export const useMissionReviewStore = create<MissionReviewStoreState>((set) => ({
  ...createMissionReviewRuntimeState(),
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyMissionReviewRuntime(runtime: MissionReviewRuntimeState): void {
  useMissionReviewStore.setState(runtime)
}

export function applyMissionReviewController(controller: MissionReviewController): void {
  useMissionReviewStore.setState({ controller })
}
