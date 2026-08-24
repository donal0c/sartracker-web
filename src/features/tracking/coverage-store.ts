import { create } from 'zustand'

import type { CoverageController, CoverageState } from './coverage-controller'

type CoverageStore = {
  readonly state: CoverageState
  readonly controller: CoverageController | null
}

const INACTIVE_STATE: CoverageState = { status: 'inactive' }

/** Stores mission-keyed complete-coverage state outside the live tracking store. */
export const useCoverageStore = create<CoverageStore>(() => ({
  state: INACTIVE_STATE,
  controller: null,
}))

/** Publishes coverage state outside React render code. */
export function applyCoverageState(state: CoverageState): void {
  useCoverageStore.setState({ state })
}

/** Publishes the active coverage controller outside React render code. */
export function applyCoverageController(controller: CoverageController | null): void {
  useCoverageStore.setState({ controller })
}

/** Clears all renderer-generation delivery attestation fail-closed. */
export function resetCoverageStore(): void {
  useCoverageStore.setState({ state: INACTIVE_STATE, controller: null })
}
