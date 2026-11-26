import { useMemo } from 'react'

import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { useMissionStore, type MissionRuntimePhase } from '../mission/mission-store'
import type { NormalizedTrackingPosition, TrackingConnectionStatus } from '../tracking/tracking-types'
import type { TrackingWarningCode } from '../tracking/tracking-warnings'
import { useCoverageStore } from '../tracking/coverage-store'
import { useIngestHealthStore } from '../tracking/ingest-health-store'
import { selectCoverageStateForMission } from '../tracking/mission-coverage-scope'
import { describeTrackingHealth } from '../tracking/persistent-tracking-health'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { useTrackingMapUpdateStore } from '../tracking/tracking-map-update-store'
import { isCriticalTrackingTrustWarning } from '../tracking/tracking-trust-warning'
import { CONNECT_WORD, CREDENTIAL_REENTRY_WORD, PROBLEM_RANK, rankTrackingWarning, SETTINGS_REENTRY_WORD, type RankedProblem } from './tracking-problem-labels'

const MAP_NOT_UPDATING_ISSUE = 'Map is not showing the latest positions'
const MAP_NOT_UPDATING_WORD = 'Map not updating'

/** The routine notice the poller and mission bridge publish while a mission is paused. */
const PAUSE_NOTICE = 'Live refresh suspended while mission is paused.'

/**
 * Takes the routine pause notice out of a paused status, keeping every other
 * warning sent with it. The pause already leads the headline, but a history,
 * storage or roster warning joined to the notice must still be seen.
 *
 * @param status the published tracking status
 * @param paused whether the mission is paused
 * @returns the warning text without the pause notice (null when nothing is left) and its codes
 */
export function withoutPauseNotice(
  status: Pick<TrackingConnectionStatus, 'warning' | 'warningCodes'>,
  paused: boolean,
): { readonly warning: string | null; readonly warningCodes: readonly TrackingWarningCode[] | undefined } {
  if (!paused || status.warning === null || !status.warning.includes(PAUSE_NOTICE)) {
    return { warning: status.warning, warningCodes: status.warningCodes }
  }
  const rest = status.warning.replace(PAUSE_NOTICE, '').replace(/\s+/gu, ' ').trim()
  return {
    warning: rest === '' ? null : rest,
    warningCodes: status.warningCodes?.filter((code) => code !== 'mission_paused'),
  }
}

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

export type TrackingCondition = 'ok' | 'lost' | 'map' | 'paused' | 'record' | 'recovery' | 'credentials' | 'settings' | 'notConnected' | 'reconnecting' | 'disconnected' | 'attention'

/** Where a mission whose tracking is not connected is connected [DON-375]. */
const CONNECT_ADVICE = 'connect in Settings → Tracking sources'

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
  /**
   * The one word that says what the operator must do (DON-353). The bar shows
   * it when it fits after the person-safety words ranked before it; otherwise
   * it is counted in "+N more", and the label and Tracking panel still name it.
   */
  readonly remedy?: string
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
  /**
   * Set on a map or record alarm while the feed itself is not online (for
   * example reconnecting), so neither may say positions are live [DON-375].
   */
  readonly feedNotLive?: true
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
  /** The map rejected a tracking update and still draws older positions [DON-357]. */
  readonly mapUpdateFailed: boolean
}): TrackingHeadline {
  const { status, phase, positions, stationaryCount, notedCount, hiddenLocationCount, allLocationsHidden } = input
  const staleCount = positions.filter((position) => position.device_cache_stale).length
  const unverifiedCount = positions.filter((position) => position.fix_time_unverified === true).length
  const health = describeTrackingHealth(status, phase, staleCount, unverifiedCount)

  const paused = phase === 'paused'
  // The pause leads the headline, so its own notice is dropped; anything sent with it stays.
  const shown = withoutPauseNotice(status, paused)
  const issues: string[] = []
  if (input.mapUpdateFailed) issues.push(MAP_NOT_UPDATING_ISSUE)
  const evidenceFailed = input.evidenceState !== 'healthy' && !input.evidenceLossAcknowledged
  if (evidenceFailed) issues.push('Mission record not fully saved')
  if (input.evidenceState !== 'healthy' && input.evidenceLossAcknowledged) issues.push('Some mission record was lost (acknowledged)')
  if (shown.warning !== null) issues.push(shown.warning)
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
  if (input.mapUpdateFailed) name(MAP_NOT_UPDATING_WORD, PROBLEM_RANK.mapNotUpdating)
  if (evidenceFailed) name('Record not saved', PROBLEM_RANK.record)
  for (const entry of rankTrackingWarning(shown.warning, shown.warningCodes)) {
    // The TRACKING LOST lead already says it is offline.
    if (!(lost && entry.word.startsWith('Offline'))) name(entry.word, entry.rank)
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
  // Tracking that was never connected, in a mission: the fix is named with the
  // connection problems, after any person who needs a radio check [DON-375].
  // Only the runtime's "not configured" status counts: a configured source
  // waiting for its first poll is idle too, and must not be sent to Settings.
  const notConfigured = (phase === 'active' || phase === 'paused') && status.mode !== 'online' &&
    status.warningCodes?.includes('tracking_not_configured') === true
  if (notConfigured) name(CONNECT_WORD, PROBLEM_RANK.connection)
  // One order for runtime and derived problems; ties keep the order found.
  const problems = ranked.map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.word)

  // The server's own sentence goes in Tracking; the bar keeps the short conditions.
  const conditions = issues.filter((issue) => issue !== shown.warning).join(' · ')
  const prefixed = (lead: string) => (conditions === '' ? lead : `${lead} · ${conditions}`)
  const summary = issues.join(' · ')
  // A saved password that cannot be used is named, with where to fix it; a
  // neutral "not connected" hid both until the Tracking panel was opened. In a
  // running or paused mission tracking has stopped completely, so it is also
  // the alarm; it comes before pause and record so their advice cannot hide
  // the fix (DON-353).
  // Damaged saved settings (M-47) are handled the same way, with their own fix.
  const reentry = status.mode === 'online'
    ? null
    : status.warningCodes?.includes('tracking_settings_unreadable') === true
      ? { condition: 'settings' as const, remedy: SETTINGS_REENTRY_WORD, advice: 're-enter the Traccar settings in Settings', cause: 'the saved settings were damaged and set aside' }
      : status.warningCodes?.includes('tracking_credentials_unreadable') === true
        ? { condition: 'credentials' as const, remedy: CREDENTIAL_REENTRY_WORD, advice: 're-enter the tracking password or token in Settings', cause: 'the saved tracking password or token cannot be used' }
        : null
  const lastReceivedShown = positions.length > 0
  if (reentry !== null && (phase === 'active' || paused)) {
    const lead = paused ? 'MISSION PAUSED' : 'TRACKING LOST'
    const advice = `${lead}: ${reentry.advice}`
    return {
      condition: reentry.condition, tone: 'alert', text: prefixed(advice), problems: [lead, ...problems], leadInAlarm: true, remedy: reentry.remedy,
      detail: conditions === '' ? advice : `${advice} · ${conditions}`,
      alarm: `${lead}: ${reentry.cause}; positions on the map may not be current`,
      issues, lastReceivedShown,
    }
  }
  // Tracking that was never connected stays not connected after Resume, so the
  // pause also says where to connect [DON-375].
  if (paused) {
    return {
      condition: 'paused', tone: 'alert', text: prefixed('MISSION PAUSED'), problems: ['MISSION PAUSED', ...problems], detail: conditions,
      alarm: notConfigured ? `MISSION PAUSED: positions are not updating; tracking is not connected: ${CONNECT_ADVICE}` : 'MISSION PAUSED: positions are not updating',
      issues, ...(notConfigured ? { remedy: CONNECT_WORD } : {}),
    }
  }
  if (lost) return { condition: 'lost', tone: 'alert', text: prefixed('TRACKING LOST'), problems: ['TRACKING LOST', ...problems], detail: conditions, alarm: 'TRACKING LOST: positions on the map may not be current', issues }
  // A running mission whose tracking was never connected: any position drawn is
  // old, so it must never read as a quiet grey "not connected" (rule 10, DON-375).
  if (notConfigured) {
    const lead = 'TRACKING NOT CONNECTED'
    const map = lastReceivedShown ? 'positions on the map are not updating' : 'no positions are coming in'
    return {
      condition: 'notConnected', tone: 'alert', text: prefixed(`${lead}: ${CONNECT_ADVICE}`), problems: [lead, ...problems], leadInAlarm: true, remedy: CONNECT_WORD,
      // The remedy word already says where; the detail keeps the other conditions.
      detail: conditions,
      alarm: `${lead}: ${map}; ${CONNECT_ADVICE}`, issues, lastReceivedShown,
    }
  }
  // A map or record alarm must not call positions live while the feed is not online [DON-375].
  const feedNotLive = status.mode === 'online' ? {} : { feedNotLive: true as const }
  // The feed is fine but the map still draws older positions: that must never
  // read as live, so it is the alarm, ahead of the record warning [DON-357].
  if (input.mapUpdateFailed) {
    const others = issues.filter((issue) => issue !== status.warning && issue !== MAP_NOT_UPDATING_ISSUE).join(' · ')
    return {
      condition: 'map', tone: 'alert', text: others === '' ? 'MAP NOT UPDATING' : `MAP NOT UPDATING · ${others}`,
      problems: ['MAP NOT UPDATING', ...problems.filter((word) => word !== MAP_NOT_UPDATING_WORD)], detail: others,
      alarm: 'MAP NOT UPDATING: positions drawn on the map may be out of date', issues, ...feedNotLive,
    }
  }
  if (evidenceFailed) {
    const alarm = status.mode === 'online'
      ? 'MISSION RECORD NOT FULLY SAVED: positions are live, but open this before finishing'
      : 'MISSION RECORD NOT FULLY SAVED: open this before finishing; positions are not updating yet'
    return { condition: 'record', tone: 'alert', text: summary, problems, detail: summary, alarm, issues, ...feedNotLive }
  }
  if (phase === 'recovery') return { condition: 'recovery', tone: 'warning', text: 'Mission needs resuming: tracking not live', problems: ['Mission needs resuming'], detail: 'tracking not live', issues }
  // Before a mission starts amber is enough: nobody relies on the map yet.
  if (reentry !== null) {
    const advice = `Tracking not connected: ${reentry.advice}`
    return { condition: reentry.condition, tone: 'warning', text: prefixed(advice), problems, remedy: reentry.remedy, detail: conditions === '' ? advice : `${advice} · ${conditions}`, issues, lastReceivedShown }
  }
  // A reconnect in a running mission is amber, never grey: the dots are last
  // known until it answers. It clears within one poll, or turns lost. It comes
  // after the map and record alarms so it cannot clear them [DON-375].
  if (phase === 'active' && status.mode !== 'online' && status.warningCodes?.includes('tracking_reconnecting') === true) {
    return { condition: 'reconnecting', tone: 'warning', text: prefixed('Reconnecting tracking'), problems, detail: conditions, issues, lastReceivedShown }
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
  const mapUpdateFailed = useTrackingMapUpdateStore((state) => state.failure !== null)

  return useMemo(() => describeTrackingHeadline({
    status, phase, positions, ingestRejected: ingest.totalRejected, evidenceState: evidence.state,
    evidenceLossAcknowledged: evidence.acknowledgedLoss !== undefined, conflictCount: evidence.conflictCount,
    stationaryCount, notedCount, coverageStatus: coverage.status, hiddenLocationCount, allLocationsHidden, mapUpdateFailed,
  }),
  [allLocationsHidden, mapUpdateFailed, coverage.status, evidence.acknowledgedLoss, evidence.conflictCount, evidence.state, hiddenLocationCount, ingest.totalRejected, notedCount, phase, positions, stationaryCount, status])
}
