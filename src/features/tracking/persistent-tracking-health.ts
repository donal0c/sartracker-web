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

export type TrackingFeedTone = 'success' | 'warning' | 'alert' | 'neutral'

/**
 * Names positions that are not current and positions whose time is unverified,
 * or null when there are none. "Not current" covers every reason a position is
 * flagged stale: older than 5 minutes, a fix time ahead of this laptop's clock,
 * or an expired cache [DON-358], so it never claims one reason for all.
 *
 * @param staleCount positions flagged stale, for any reason
 * @param unverifiedCount positions whose fix time could not be verified
 * @returns for example '2 positions not current · 1 position time not verified'
 */
export function describeTrackingFreshness(staleCount: number, unverifiedCount: number): string | null {
  const parts = [
    staleCount > 0 ? `${staleCount} ${staleCount === 1 ? 'position' : 'positions'} not current` : null,
    unverifiedCount > 0 ? `${unverifiedCount} position ${unverifiedCount === 1 ? 'time' : 'times'} not verified` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * The one rule for calling the tracking feed healthy, shared by the Tracking
 * status panel and the Devices header [M-20]: online, no published warning,
 * and every position fresh and verified. A reachable feed delivering old
 * positions is never shown in green.
 *
 * @param status the runtime's connection status
 * @param staleCount positions flagged stale, for any reason
 * @param unverifiedCount positions whose fix time could not be verified
 * @param healthyText the surface's own words for a healthy feed
 * @returns the sentence to show and its tone
 */
export function describeTrackingFeed(
  status: Pick<TrackingConnectionStatus, 'mode' | 'warning'>,
  staleCount: number,
  unverifiedCount: number,
  healthyText: string,
): { readonly headline: string; readonly tone: TrackingFeedTone } {
  if (status.warning !== null) {
    return { headline: status.warning, tone: status.mode === 'offline' || isCriticalTrackingTrustWarning(status.warning) ? 'alert' : 'warning' }
  }
  const freshness = describeTrackingFreshness(staleCount, unverifiedCount)
  if (status.mode === 'offline') return { headline: freshness === null ? 'Tracking offline.' : `Tracking offline · ${freshness}`, tone: 'alert' }
  if (status.mode !== 'online') {
    return freshness === null
      ? { headline: 'Tracking not connected.', tone: 'neutral' }
      : { headline: `Tracking not connected · ${freshness}`, tone: 'warning' }
  }
  if (freshness !== null) return { headline: `Feed connected · ${freshness}`, tone: 'warning' }
  return { headline: healthyText, tone: 'success' }
}
