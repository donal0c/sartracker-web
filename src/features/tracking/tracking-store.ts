import { create } from 'zustand'

import type {
  TrackingConnectionStatus,
  TrackingSnapshot,
} from './tracking-types'

const EMPTY_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
}

const IDLE_STATUS: TrackingConnectionStatus = {
  mode: 'idle',
  consecutiveFailures: 0,
  recovered: false,
  lastSuccessAt: null,
  warning: 'Tracking is not configured.',
}

export type TrackingStore = {
  readonly snapshot: TrackingSnapshot
  readonly status: TrackingConnectionStatus
  readonly applySnapshot: (snapshot: TrackingSnapshot) => void
  readonly applyStatus: (status: TrackingConnectionStatus) => void
}

export const useTrackingStore = create<TrackingStore>((set) => ({
  snapshot: EMPTY_SNAPSHOT,
  status: IDLE_STATUS,
  applySnapshot: (snapshot) => set({ snapshot }),
  applyStatus: (status) => set({ status }),
}))

/**
 * Applies a tracking snapshot outside React render code.
 */
export function applyTrackingSnapshot(snapshot: TrackingSnapshot): void {
  useTrackingStore.setState({ snapshot })
}

/**
 * Applies tracking connection state outside React render code.
 */
export function applyTrackingStatus(status: TrackingConnectionStatus): void {
  useTrackingStore.setState({ status })
}
