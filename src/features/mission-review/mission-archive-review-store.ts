import { create } from 'zustand'

import type {
  MissionArchiveReviewController,
  MissionArchiveReviewRuntimeState,
} from './start-mission-archive-review-runtime'

const INITIAL_STATE: MissionArchiveReviewRuntimeState = {
  timeline: [],
  phase: 'idle',
  activeOperationId: null,
  activeArchiveId: null,
  activeSession: null,
  progress: null,
  recoveryRequired: 'none',
  error: null,
}

type MissionArchiveReviewStoreState = MissionArchiveReviewRuntimeState & {
  readonly controller: MissionArchiveReviewController | null
}

export const useMissionArchiveReviewStore = create<MissionArchiveReviewStoreState>(() => ({
  ...INITIAL_STATE,
  controller: null,
}))

/** Replaces only archive-review orchestration state. */
export function applyMissionArchiveReviewRuntime(
  runtime: MissionArchiveReviewRuntimeState,
): void {
  useMissionArchiveReviewStore.setState(runtime)
}

/** Publishes the immutable archive-review controller after startup. */
export function applyMissionArchiveReviewController(
  controller: MissionArchiveReviewController | null,
): void {
  useMissionArchiveReviewStore.setState({ controller })
}

/** Restores the archive-review store after its owning runtime is disposed. */
export function resetMissionArchiveReviewStore(): void {
  useMissionArchiveReviewStore.setState({ ...INITIAL_STATE, controller: null })
}
