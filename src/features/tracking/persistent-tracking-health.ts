import type { MissionRuntimePhase } from '../mission/mission-store'
import type { TrackingConnectionStatus } from './tracking-types'

/** Describes connection trust without equating a reachable feed with fresh positions. */
export function describeTrackingHealth(status: TrackingConnectionStatus, phase: MissionRuntimePhase, staleCount: number): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (phase === 'paused') return { label: 'Mission paused · live refresh suspended', tone: 'warning' }
  if (phase === 'recovery') return { label: 'Mission recovery · tracking not live', tone: 'warning' }
  if (status.mode === 'offline') return { label: status.consecutiveFailures > 0 ? 'Disconnected · retrying' : 'Disconnected', tone: 'warning' }
  if (status.mode !== 'online') return { label: 'Tracking not connected', tone: 'neutral' }
  if (staleCount > 0) return { label: `Tracking connected · ${staleCount} stale positions`, tone: 'warning' }
  return { label: 'Tracking connected', tone: status.warning === null ? 'success' : 'warning' }
}
