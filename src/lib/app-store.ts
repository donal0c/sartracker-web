import { create } from 'zustand'

/**
 * AppStore keeps scaffold-level UI readiness state out of React component internals.
 * This proves the agreed state-management baseline without introducing mission state yet.
 */
export type AppStore = {
  readonly status: 'ready'
}

export const useAppStore = create<AppStore>(() => ({
  status: 'ready',
}))
