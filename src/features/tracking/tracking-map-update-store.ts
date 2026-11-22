import { create } from 'zustand'

type TrackingMapUpdateStore = {
  /**
   * Why the map could not draw the latest tracking positions, or null while it
   * is drawing them (DON-357). Set when MapLibre rejects a tracking source
   * update; cleared only when a full resend of the positions is drawn.
   */
  readonly failure: string | null
  readonly reportFailure: (message: string) => void
  readonly clearFailure: () => void
}

/** Whether the map is drawing the latest tracking positions. */
export const useTrackingMapUpdateStore = create<TrackingMapUpdateStore>((set) => ({
  failure: null,
  reportFailure: (message) => set((state) => (state.failure === message ? state : { failure: message })),
  clearFailure: () => set((state) => (state.failure === null ? state : { failure: null })),
}))
