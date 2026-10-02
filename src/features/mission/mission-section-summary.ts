import { participantRequestedEarlierHistory } from '../participants/participant-history-start'
import type { MissionParticipant } from '../../infrastructure/mission-store/tauri-mission-store'

/** One collapsible Mission Control section: its one-line summary and why it must stay open. */
export type MissionSectionSummary = {
  readonly summary: string
  /** Plain-words reasons; any reason keeps the section open [DON-300]. */
  readonly attention: readonly string[]
}

export type ParticipantSectionInput = {
  readonly participants: readonly MissionParticipant[]
  readonly membershipNotices: readonly string[]
  readonly envelopeWarning: string | null
  readonly rosterError: string | null
  readonly error: string | null
}

/**
 * Summarises the Participants section for a collapsed Mission Control during
 * a mission, and lists every condition an operator must see, which keeps the
 * section open (Donal, option C, 1 Oct 2026).
 */
export function describeParticipantSection(input: ParticipantSectionInput): MissionSectionSummary {
  const attention: string[] = []
  if (input.envelopeWarning !== null) attention.push('tracking scope warning')
  if (input.rosterError !== null) attention.push('roster error')
  if (input.membershipNotices.length > 0) attention.push('membership notices to acknowledge')
  if (input.error !== null) attention.push('participant error')

  const active = input.participants.filter((participant) => participant.removed_at === null)
  if (active.length === 0) attention.push('no participants selected')
  if (input.participants.some(hasUnresolvedLegacyRoster)) attention.push('legacy roster to resolve')
  if (input.participants.some((participant) => Boolean(participant.backfill_scope_error))) {
    attention.push('group history problem')
  }
  // Finish waits for every participant's history, including one removed
  // during the mission, so a removed participant's pending history counts.
  const requested = input.participants.filter(requestedHistory)
  if (requested.some(historyPending)) attention.push('history still loading')

  const groups = active.filter((participant) => participant.kind === 'group').length
  const devices = active.length - groups
  const counts = [
    groups > 0 ? `${groups} group${groups === 1 ? '' : 's'}` : null,
    devices > 0 ? `${devices} device${devices === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => part !== null).join(', ')
  const history = requested.length === 0
    ? 'no earlier history requested'
    : requested.some(historyPending) ? 'history loading' : 'history complete'
  return {
    summary: active.length === 0 ? 'No participants selected' : `${counts} · ${history}`,
    attention,
  }
}

/** Summarises the Outings section; only an outing error keeps it open. */
export function describeOutingSection(input: {
  readonly activeOutingLabel: string | null
  readonly error: string | null
  /** While loading, a missing outing is unknown, not absent. */
  readonly loading?: boolean
}): MissionSectionSummary {
  return {
    summary: input.loading === true && input.activeOutingLabel === null
      ? 'Loading outings…'
      : input.activeOutingLabel === null
      ? 'No outing · fixes Unassigned'
      : `Active: ${input.activeOutingLabel}`,
    attention: input.error === null ? [] : ['outing error'],
  }
}

function requestedHistory(participant: MissionParticipant): boolean {
  return participantRequestedEarlierHistory(participant)
    || participant.backfill_scope_unknown === true
    || Boolean(participant.backfill_scope_error)
}

function historyPending(participant: MissionParticipant): boolean {
  if (participant.kind === 'device') return participant.backfill_completed !== 1
  if (participant.backfill_scope_unknown === true || participant.backfill_scope_error) return true
  return (participant.backfill_completed_count ?? 0) < (participant.backfill_member_count ?? 0)
}

function hasUnresolvedLegacyRoster(participant: MissionParticipant): boolean {
  return participant.kind === 'group'
    && participant.starting_member_device_ids_json == null
    && participant.backfill_scope_unknown === true
    && !participant.backfill_scope_error
}
