import type { MissionRuntimePhase } from '../mission/mission-store'
import type { TrackingConnectionStatus } from './tracking-types'
import { isCriticalTrackingTrustWarning } from './tracking-trust-warning'

/** Describes connection trust without equating a reachable feed with fresh positions. */
export function describeTrackingHealth(status: TrackingConnectionStatus, phase: MissionRuntimePhase, staleCount: number, unverifiedCount = 0): { label: string; tone: 'success' | 'warning' | 'neutral' | 'alert' } {
  if (phase === 'paused') return { label: 'Mission paused · live refresh suspended', tone: 'warning' }
  if (phase === 'recovery') return { label: 'Mission recovery · tracking not live', tone: 'warning' }
  if (status.mode === 'offline') return { label: status.consecutiveFailures > 0 ? 'Disconnected · retrying' : 'Disconnected', tone: 'alert' }
  if (isCriticalTrackingTrustWarning(status.warning)) return { label: 'Tracking not live · cached positions', tone: 'alert' }
  if (status.mode !== 'online') return { label: 'Tracking not connected', tone: 'neutral' }
  const freshness = [staleCount > 0 ? `${staleCount} stale positions` : null, unverifiedCount > 0 ? `${unverifiedCount} fix times unverified` : null].filter(Boolean)
  if (freshness.length > 0) return { label: `Tracking connected · ${freshness.join(' · ')}`, tone: 'warning' }
  return { label: 'Tracking connected', tone: status.warning === null ? 'success' : 'warning' }
}
