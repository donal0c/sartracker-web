import { useMissionStore } from '../mission/mission-store'
import type { TrackingConnectionStatus, TrackingSnapshot } from './tracking-types'

const EMPTY_TRACKING_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
}

type MissionTrackingStatusBridgeOptions = {
  readonly applySnapshot: (snapshot: TrackingSnapshot) => void
  readonly applyStatus: (status: TrackingConnectionStatus) => void
}

/**
 * Keeps the tracking trust signal aligned with mission lifecycle transitions
 * that happen between polling ticks.
 */
export function startMissionTrackingStatusBridge(
  options: MissionTrackingStatusBridgeOptions,
): () => void {
  synchronizeInactiveMissionTracking(options)

  return useMissionStore.subscribe((state, previousState) => {
    if (state.phase === previousState.phase) {
      return
    }

    if (state.phase === 'active') {
      return
    }

    synchronizeInactiveMissionTracking(options)
  })
}

function synchronizeInactiveMissionTracking(
  options: MissionTrackingStatusBridgeOptions,
): void {
  const phase = useMissionStore.getState().phase
  if (phase === 'active') {
    return
  }

  if (phase !== 'paused') {
    options.applySnapshot(EMPTY_TRACKING_SNAPSHOT)
  }

  options.applyStatus({
    mode: 'idle',
    consecutiveFailures: 0,
    recovered: false,
    lastSuccessAt: null,
    warning: getInactiveMissionTrackingWarning(phase),
  })
}

function getInactiveMissionTrackingWarning(
  phase: ReturnType<typeof useMissionStore.getState>['phase'],
): string {
  if (phase === 'paused') {
    return 'Live refresh suspended while mission is paused.'
  }

  if (phase === 'recovery') {
    return 'Resume the mission before reconnecting live tracking.'
  }

  return 'Waiting for an active mission.'
}
