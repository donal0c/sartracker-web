import { create } from 'zustand'

import type {
  ExactBreadcrumbDotController,
  ExactBreadcrumbDotState,
} from './exact-breadcrumb-dot-controller'

type ExactBreadcrumbDotStore = {
  readonly state: ExactBreadcrumbDotState
  readonly controller: ExactBreadcrumbDotController | null
  readonly applyState: (state: ExactBreadcrumbDotState) => void
  readonly applyController: (controller: ExactBreadcrumbDotController | null) => void
}

/** Stores exact-dot query state separately from the bounded line snapshot. */
export const useExactBreadcrumbDotStore = create<ExactBreadcrumbDotStore>((set) => ({
  state: { status: 'inactive' },
  controller: null,
  applyState: (state) => set({ state }),
  applyController: (controller) => set({ controller }),
}))

/** Publishes exact-dot state outside React render code. */
export function applyExactBreadcrumbDotState(state: ExactBreadcrumbDotState): void {
  useExactBreadcrumbDotStore.setState({ state })
}

/** Publishes the active exact-dot controller outside React render code. */
export function applyExactBreadcrumbDotController(
  controller: ExactBreadcrumbDotController | null,
): void {
  useExactBreadcrumbDotStore.setState({ controller })
}
