import { useMissionStore } from '../mission/mission-store'
import type { TrackingConnectionStatus, TrackingSnapshot } from './tracking-types'

const EMPTY_TRACKING_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
}

export const RECOVERY_TRACKING_WARNING = 'Resume mission to reconnect.'

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

  // Recovery retains the last known current positions until the operator
  // explicitly resumes or dismisses recovery. Mission wake-up/finalization
  // handles clear cross-mission state; recovery must not erase it.
  if (phase !== 'paused' && phase !== 'recovery') {
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
    return RECOVERY_TRACKING_WARNING
  }

  return 'Waiting for an active mission.'
}
