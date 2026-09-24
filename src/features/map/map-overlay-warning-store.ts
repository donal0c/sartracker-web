import { create } from 'zustand'

import type {
  MapOverlaySyncRegistrationId,
  MapOverlaySyncWarning,
} from '../../lib/map-health'

type MapOverlayWarningStore = {
  readonly warnings: readonly MapOverlaySyncWarning[]
  /** Adds one warning and reports whether it created a new warning transition. */
  readonly raiseWarning: (warning: MapOverlaySyncWarning) => boolean
  /** Clears only the warning belonging to a successfully synchronized registration. */
  readonly clearWarning: (registrationId: MapOverlaySyncRegistrationId) => boolean
}

/** Holds active map overlay warnings until the same synchronization registration succeeds. */
export const useMapOverlayWarningStore = create<MapOverlayWarningStore>((set) => ({
  warnings: [],
  raiseWarning: (warning) => {
    let raised = false
    set((state) => {
      if (state.warnings.some((candidate) => candidate.registrationId === warning.registrationId)) {
        return state
      }
      raised = true
      return { warnings: [...state.warnings, warning] }
    })
    return raised
  },
  clearWarning: (registrationId) => {
    let cleared = false
    set((state) => {
      const warnings = state.warnings.filter((warning) => warning.registrationId !== registrationId)
      if (warnings.length === state.warnings.length) {
        return state
      }
      cleared = true
      return { warnings }
    })
    return cleared
  },
}))
