import type { DeviceWorkspaceRow } from '../tracking/device-workspace-model'

export type PersonTone = 'ok' | 'attention' | 'muted'

export type PersonRow = {
  readonly deviceId: string
  readonly name: string
  readonly statusText: string
  readonly tone: PersonTone
  readonly canZoom: boolean
  readonly latitude: number | null
  readonly longitude: number | null
  readonly positionHidden: boolean
  readonly canAcknowledge: boolean
  readonly attentionAcknowledged: boolean
  /** Lower is more urgent. Below SHARED_OUTAGE_URGENCY means a problem of their own. */
  readonly urgency: number
}

/** Urgency of a person whose only problem is the outage or pause everyone shares. */
export const SHARED_OUTAGE_URGENCY = 3
const NO_PROBLEM_URGENCY = 9

/** Words a volunteer can act on for how long ago a device last reported. */
export function formatLastHeard(lastSeen: string | null, nowMs: number): string | null {
  if (lastSeen === null) return null
  const seenMs = Date.parse(lastSeen)
  if (!Number.isFinite(seenMs)) return null
  const minutes = Math.max(0, Math.floor((nowMs - seenMs) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ${minutes % 60} min ago`
}

function describePerson(row: DeviceWorkspaceRow, nowMs: number, live: boolean): { readonly statusText: string; readonly tone: PersonTone; readonly urgency: number } {
  if (!row.hasFix) return { statusText: 'No position yet', tone: 'attention', urgency: 1 }
  // The age of the position being drawn, never of the last contact with the device.
  const age = formatLastHeard(row.fixTime, nowMs) ?? 'time unknown'
  const notes: string[] = []
  // SAR-QA-016: a stationary warning stays visible until movement clears it.
  if (row.stationaryAttention) {
    const elapsed = row.attentionElapsedDisplay.replace(' without meaningful movement', '')
    notes.push(`${row.attentionAcknowledged ? 'Not moving (noted)' : 'Not moving'} ${elapsed}`)
    if (row.stationaryAttentionUnreliable) notes.push('last position unconfirmed')
  }
  if (!live || row.sourceDisplay === 'Last known') notes.push(`Last known position ${age}`)
  else if (row.status === 'offline') notes.push(`Offline, position ${age}`)
  else if (row.status === 'unknown') notes.push(`Not confirmed, position ${age}`)
  else if (row.stale || row.sourceDisplay === 'Stale') notes.push(`Out of date, position ${age}`)
  if (row.fixTimeUnverified) notes.push('position time not verified')
  if (row.ingestWarning !== null) notes.push('bad position report rejected')
  if (notes.length > 0) {
    const ownProblem = row.fixTimeUnverified || row.ingestWarning !== null || (live && row.sourceDisplay !== 'Last known')
    const urgency = row.stationaryAttention ? (row.attentionAcknowledged ? 1 : 0) : ownProblem ? 2 : SHARED_OUTAGE_URGENCY
    return { statusText: notes.join(' · '), tone: 'attention', urgency }
  }
  return { statusText: `Position ${age}`, tone: row.stationaryAttentionUnavailable ? 'muted' : 'ok', urgency: NO_PROBLEM_URGENCY }
}

/**
 * Builds the People list: anyone needing a look comes first, then everyone by
 * name. Pass live=false while positions are not updating (for example paused),
 * so nothing below the alarm reads as current.
 */
export function buildPeopleRows(rows: readonly DeviceWorkspaceRow[], nowMs: number, live = true): readonly PersonRow[] {
  const people = rows.map((row) => {
    const { statusText, tone, urgency } = describePerson(row, nowMs, live)
    return {
      deviceId: row.deviceId,
      name: row.name,
      statusText,
      tone,
      canZoom: row.hasFix,
      latitude: row.latitude,
      longitude: row.longitude,
      positionHidden: row.hidden,
      canAcknowledge: row.stationaryAttention && !row.attentionAcknowledged,
      attentionAcknowledged: row.attentionAcknowledged,
      urgency,
    } satisfies PersonRow
  })
  return people.sort((left, right) => left.urgency - right.urgency || left.name.localeCompare(right.name))
}

/**
 * Who to name on the map: the most urgent first, and never someone whose only
 * problem is the outage the red alarm is already shouting about.
 */
export function selectExceptionsForMap(people: readonly PersonRow[]): readonly PersonRow[] {
  return people.filter((person) => person.tone === 'attention' && person.urgency < SHARED_OUTAGE_URGENCY)
}

/** Counts the people the top of the screen should point the operator towards. */
export function countPeopleNeedingAttention(people: readonly PersonRow[]): number {
  return people.filter((person) => person.tone === 'attention').length
}
