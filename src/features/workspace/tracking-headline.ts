import { useMemo } from 'react'

import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { useMissionStore, type MissionRuntimePhase } from '../mission/mission-store'
import type { NormalizedTrackingPosition, TrackingConnectionStatus } from '../tracking/tracking-types'
import { useCoverageStore } from '../tracking/coverage-store'
import { useIngestHealthStore } from '../tracking/ingest-health-store'
import { selectCoverageStateForMission } from '../tracking/mission-coverage-scope'
import { describeTrackingHealth } from '../tracking/persistent-tracking-health'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { isCriticalTrackingTrustWarning } from '../tracking/tracking-trust-warning'
import { PROBLEM_RANK, rankTrackingWarning, type RankedProblem } from './tracking-problem-labels'

let remembered: { readonly missionId: string | null; readonly at: string } | null = null

/**
 * Keeps the last confirmed update time for this mission. The runtime publishes a
 * null time when pausing, and "none yet" would be false, and would also stop us
 * spotting anyone who was already out of date before the pause.
 */
export function rememberLastConfirmedAt(missionId: string | null, reported: string | null): string | null {
  if (reported !== null) remembered = { missionId, at: reported }
  return remembered !== null && remembered.missionId === missionId ? remembered.at : null
}

/** Last confirmed update for the current mission, surviving the null published on pause. */
export function useLastConfirmedAt(): string | null {
  const reported = useTrackingStore((state) => state.status.lastSuccessAt)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  return rememberLastConfirmedAt(missionId, reported)
}

export type TrackingCondition = 'ok' | 'lost' | 'paused' | 'record' | 'recovery' | 'credentials' | 'disconnected' | 'attention'

export type TrackingHeadline = {
  /** The condition that decides the advice, so a pause is not told to check the internet. */
  readonly condition: TrackingCondition
  readonly tone: 'ok' | 'warning' | 'alert' | 'neutral'
  readonly text: string
  /** Short problem words, most urgent first, shown before anything else in the bar and never cut mid-word (DON-261). */
  readonly problems: readonly string[]
  /**
   * The first problem word is the alarm strip's own lead, so the bar may drop
   * it to keep the fix after it visible (DON-353). Only set while the strip,
   * which cannot be closed, is on screen.
   */
  readonly leadInAlarm?: true
  /** The rest of the words, which may be cut short in the bar; the full text is in the label and Tracking. */
  readonly detail: string
  /** Text for the alarm across the map, when it should say more than the headline. */
  readonly alarm?: string
  /** Everything the old Tracking tab would have warned about, in plain words. */
  readonly issues: readonly string[]
  /**
   * For a credential failure: whether the map still shows positions received
   * before tracking stopped, so the panel says they may be out of date.
   */
  readonly lastReceivedShown?: boolean
}

/**
 * Decides the headline. Pause is checked first: while paused the runtime reports
 * "Live refresh suspended", which must not read as a lost connection.
 */
export function describeTrackingHeadline(input: {
  readonly status: TrackingConnectionStatus
  readonly phase: MissionRuntimePhase
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly ingestRejected: number
  readonly evidenceState: string
  readonly evidenceLossAcknowledged: boolean
  readonly conflictCount: number
  readonly stationaryCount: number
  readonly notedCount: number
  readonly coverageStatus: string
  readonly hiddenLocationCount: number
  readonly allLocationsHidden: boolean
}): TrackingHeadline {
  const { status, phase, positions, stationaryCount, notedCount, hiddenLocationCount, allLocationsHidden } = input
  const staleCount = positions.filter((position) => position.device_cache_stale).length
  const unverifiedCount = positions.filter((position) => position.fix_time_unverified === true).length
  const health = describeTrackingHealth(status, phase, staleCount, unverifiedCount)

  const paused = phase === 'paused'
  const isPauseNotice = (warning: string | null) => paused && warning !== null && /live refresh suspended/i.test(warning)
  const issues: string[] = []
  const evidenceFailed = input.evidenceState !== 'healthy' && !input.evidenceLossAcknowledged
  if (evidenceFailed) issues.push('Mission record not fully saved')
  if (input.evidenceState !== 'healthy' && input.evidenceLossAcknowledged) issues.push('Some mission record was lost (acknowledged)')
  if (status.warning !== null && !isPauseNotice(status.warning)) issues.push(status.warning)
  if (stationaryCount > 0) issues.push(`${stationaryCount} ${stationaryCount === 1 ? 'person' : 'people'} not moving`)
  if (notedCount > 0) issues.push(`${notedCount} ${notedCount === 1 ? 'person' : 'people'} not moving (noted)`)
  if (staleCount > 0) issues.push(`${staleCount} ${staleCount === 1 ? 'position' : 'positions'} out of date`)
  if (unverifiedCount > 0) issues.push(`${unverifiedCount} position ${unverifiedCount === 1 ? 'time' : 'times'} not verified`)
  if (input.ingestRejected > 0) issues.push(`${input.ingestRejected} position ${input.ingestRejected === 1 ? 'report' : 'reports'} rejected`)
  if (input.conflictCount > 0) issues.push(`${input.conflictCount} conflicting position ${input.conflictCount === 1 ? 'report' : 'reports'}`)
  if (input.coverageStatus === 'error') issues.push('Mission history could not be fully loaded')
  if (input.coverageStatus === 'loading' || input.coverageStatus === 'partial') issues.push('Mission history not complete yet')
  // A filtered map must never be mistaken for everyone's whereabouts.
  if (allLocationsHidden) issues.push('All locations hidden on the map')
  else if (hiddenLocationCount > 0) issues.push(`${hiddenLocationCount} ${hiddenLocationCount === 1 ? "person's location" : "people's locations"} hidden on the map`)

  // Short problem words go first and are never cut short; a reassuring sentence
  // before a failure must not push the failure behind the ellipsis (DON-261).
  const lost = status.mode === 'offline' || isCriticalTrackingTrustWarning(status.warning)
  const ranked: RankedProblem[] = []
  const name = (word: string, rank: number) => { if (!ranked.some((entry) => entry.word === word)) ranked.push({ word, rank }) }
  if (evidenceFailed) name('Record not saved', PROBLEM_RANK.record)
  if (!isPauseNotice(status.warning)) {
    for (const entry of rankTrackingWarning(status.warning, status.warningCodes)) {
      // The TRACKING LOST lead already says it is offline.
      if (!(lost && entry.word.startsWith('Offline'))) name(entry.word, entry.rank)
    }
  }
  if (staleCount > 0) name(`${staleCount} stale`, PROBLEM_RANK.stale)
  if (stationaryCount > 0) name(`${stationaryCount} not moving`, PROBLEM_RANK.notMoving)
  if (input.ingestRejected > 0) name(`${input.ingestRejected} rejected`, PROBLEM_RANK.rejected)
  if (input.conflictCount > 0) name(`${input.conflictCount} conflicting`, PROBLEM_RANK.conflicting)
  if (unverifiedCount > 0) name(`${unverifiedCount} ${unverifiedCount === 1 ? 'time' : 'times'} unverified`, PROBLEM_RANK.unverified)
  if (allLocationsHidden) name('All hidden', PROBLEM_RANK.hidden)
  else if (hiddenLocationCount > 0) name(`${hiddenLocationCount} hidden`, PROBLEM_RANK.hidden)
  if (notedCount > 0) name(`${notedCount} not moving (noted)`, PROBLEM_RANK.notMovingNoted)
  if (input.coverageStatus === 'error') name('History not loaded', PROBLEM_RANK.history)
  if (input.coverageStatus === 'partial') name('History incomplete', PROBLEM_RANK.history + 2)
  if (input.evidenceState !== 'healthy' && input.evidenceLossAcknowledged) name('Record loss noted', PROBLEM_RANK.recordNoted)
  // One order for runtime and derived problems; ties keep the order found.
  const problems = ranked.map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.word)

  // The server's own sentence goes in Tracking; the bar keeps the short conditions.
  const conditions = issues.filter((issue) => issue !== status.warning).join(' · ')
  const prefixed = (lead: string) => (conditions === '' ? lead : `${lead} · ${conditions}`)
  const summary = issues.join(' · ')
  // A saved password that cannot be used is named, with where to fix it; a
  // neutral "not connected" hid both until the Tracking panel was opened. In a
  // running or paused mission tracking has stopped completely, so it is also
  // the alarm; it comes before pause and record so their advice cannot hide
  // the fix (DON-353).
  const credentialsUnusable = status.mode !== 'online' && status.warningCodes?.includes('tracking_credentials_unreadable') === true
  const credentialAdvice = 're-enter the tracking password or token in Settings'
  const lastReceivedShown = positions.length > 0
  if (credentialsUnusable && (phase === 'active' || paused)) {
    const lead = paused ? 'MISSION PAUSED' : 'TRACKING LOST'
    const advice = `${lead}: ${credentialAdvice}`
    return {
      condition: 'credentials', tone: 'alert', text: prefixed(advice), problems: [lead, ...problems], leadInAlarm: true,
      detail: conditions === '' ? advice : `${advice} · ${conditions}`,
      alarm: `${lead}: the saved tracking password or token cannot be used; positions on the map may not be current`,
      issues, lastReceivedShown,
    }
  }
  if (paused) return { condition: 'paused', tone: 'alert', text: prefixed('MISSION PAUSED'), problems: ['MISSION PAUSED', ...problems], detail: conditions, alarm: 'MISSION PAUSED: positions are not updating', issues }
  if (lost) return { condition: 'lost', tone: 'alert', text: prefixed('TRACKING LOST'), problems: ['TRACKING LOST', ...problems], detail: conditions, alarm: 'TRACKING LOST: positions on the map may not be current', issues }
  if (evidenceFailed) return { condition: 'record', tone: 'alert', text: summary, problems, detail: summary, alarm: 'MISSION RECORD NOT FULLY SAVED: positions are live, but open this before finishing', issues }
  if (phase === 'recovery') return { condition: 'recovery', tone: 'warning', text: 'Mission needs resuming: tracking not live', problems: ['Mission needs resuming'], detail: 'tracking not live', issues }
  // Before a mission starts amber is enough: nobody relies on the map yet.
  if (credentialsUnusable) {
    const advice = `Tracking not connected: ${credentialAdvice}`
    return { condition: 'credentials', tone: 'warning', text: prefixed(advice), problems, detail: conditions === '' ? advice : `${advice} · ${conditions}`, issues, lastReceivedShown }
  }
  if (status.mode !== 'online') return { condition: 'disconnected', tone: 'neutral', text: 'Tracking not connected', problems: ['Tracking not connected'], detail: '', issues }
  if (issues.length > 0) return { condition: 'attention', tone: 'warning', text: summary, problems, detail: summary, issues }
  return { condition: 'ok', tone: health.tone === 'success' ? 'ok' : 'warning', text: 'Tracking OK', problems: ['Tracking OK'], detail: '', issues }
}

/**
 * Keeps every warning from the retired Tracking tab reachable in one line. With
 * the tab gone these must surface here, or a safety warning would go quiet.
 */
export function useTrackingHeadline(): TrackingHeadline {
  const status = useTrackingStore((state) => state.status)
  const positions = useTrackingStore((state) => state.snapshot.positions)
  const phase = useMissionStore((state) => state.phase)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const ingest = useIngestHealthStore((state) => state.summary)
  const evidence = useIngestHealthStore((state) => state.evidenceHealth)
  const stationaryCount = useStationaryAttentionStore((state) =>
    Object.values(state.byDevice).filter((attention) => attention.state === 'attention' && !attention.acknowledged).length,
  )
  // Noted is not cleared: SAR-QA-016 keeps the warning up until movement resumes.
  const notedCount = useStationaryAttentionStore((state) =>
    Object.values(state.byDevice).filter((attention) => attention.state === 'attention' && attention.acknowledged).length,
  )
  const hiddenLocationCount = useLayerVisibilityStore((state) => state.hiddenDeviceIds.length)
  const allLocationsHidden = useLayerVisibilityStore((state) => !state.groupVisibility.tracking)
  const coverage = selectCoverageStateForMission(useCoverageStore((state) => state.state), missionId)

  return useMemo(() => describeTrackingHeadline({
    status, phase, positions, ingestRejected: ingest.totalRejected, evidenceState: evidence.state,
    evidenceLossAcknowledged: evidence.acknowledgedLoss !== undefined, conflictCount: evidence.conflictCount,
    stationaryCount, notedCount, coverageStatus: coverage.status, hiddenLocationCount, allLocationsHidden,
  }),
  [allLocationsHidden, coverage.status, evidence.acknowledgedLoss, evidence.conflictCount, evidence.state, hiddenLocationCount, ingest.totalRejected, notedCount, phase, positions, stationaryCount, status])
}
