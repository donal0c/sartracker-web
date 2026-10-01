import { describe, expect, it } from 'vitest'

import {
  describeOutingSection,
  describeParticipantSection,
} from '../../src/features/mission/mission-section-summary'
import type { MissionParticipant } from '../../src/infrastructure/mission-store/tauri-mission-store'

const START = '2026-10-01T08:00:00.000Z'
const ADDED = '2026-10-01T10:00:00.000Z'

function device(overrides: Partial<MissionParticipant> = {}): MissionParticipant {
  return {
    id: `p-${Math.random()}`, mission_id: 'm', kind: 'device', traccar_device_id: '7',
    mission_team_id: null, traccar_group_id: null, team_name: null, provenance: 'explicit',
    effective_from: START, added_at: ADDED, added_by: null, removed_at: null, removed_by: null,
    backfill_completed: 1, ...overrides,
  } as MissionParticipant
}

function group(overrides: Partial<MissionParticipant> = {}): MissionParticipant {
  return device({
    kind: 'group', traccar_device_id: null, mission_team_id: 't', traccar_group_id: 'g',
    team_name: 'KMRT', backfill_completed: undefined, backfill_member_count: 4,
    backfill_completed_count: 4, starting_member_device_ids_json: '["1","2","3","4"]', ...overrides,
  })
}

const calm = {
  participants: [group(), device()],
  membershipNotices: [] as readonly string[],
  envelopeWarning: null,
  rosterError: null,
  error: null,
}

/**
 * DON-300 item 5, option C (Donal, 1 Oct 2026): during a mission the
 * Participants and Outings sections collapse to one line, and any warning
 * keeps them open.
 */
describe('mission section summaries [DON-300]', () => {
  it('summarises calm participants in one line with nothing forcing it open', () => {
    expect(describeParticipantSection(calm)).toEqual({
      summary: '1 group, 1 device · history complete',
      attention: [],
    })
  })

  it.each([
    ['tracking envelope warning', { envelopeWarning: 'Tracking scope is stale.' }, 'tracking scope warning'],
    ['roster error', { rosterError: 'Roster could not be read.' }, 'roster error'],
    ['membership notice', { membershipNotices: ['2 joined KMRT'] }, 'membership notices to acknowledge'],
    ['participant error', { error: 'Could not save participant.' }, 'participant error'],
    ['nobody selected', { participants: [] }, 'no participants selected'],
    ['device history pending', { participants: [device({ backfill_completed: 0 })] }, 'history still loading'],
    ['group history pending', { participants: [group({ backfill_completed_count: 2 })] }, 'history still loading'],
    ['group scope error', { participants: [group({ backfill_scope_error: 'Stored roster is invalid.' })] }, 'group history problem'],
    ['unknown legacy roster', {
      participants: [group({ starting_member_device_ids_json: null, backfill_scope_unknown: true })],
    }, 'legacy roster to resolve'],
  ] as const)('keeps Participants open for a %s', (_name, change, reason) => {
    expect(describeParticipantSection({ ...calm, ...change }).attention).toContain(reason)
  })

  it('does not treat history a participant never asked for as pending', () => {
    const fromNow = device({ effective_from: ADDED, backfill_completed: 0 })
    expect(describeParticipantSection({ ...calm, participants: [fromNow] })).toEqual({
      summary: '1 device · no earlier history requested',
      attention: [],
    })
  })

  it('keeps Participants open while a removed participant still has history pending (Finish waits for it)', () => {
    const removedPending = group({ removed_at: ADDED, backfill_completed_count: 1 })
    const section = describeParticipantSection({ ...calm, participants: [device(), removedPending] })
    expect(section.attention).toContain('history still loading')
    expect(section.summary).toBe('1 device · history loading')
  })

  it('keeps Participants open for a removed group whose history failed', () => {
    const removedFailed = group({ removed_at: ADDED, backfill_scope_error: 'Stored roster is invalid.' })
    expect(describeParticipantSection({ ...calm, participants: [device(), removedFailed] }).attention)
      .toContain('group history problem')
  })

  it('ignores removed participants in the summary', () => {
    const removed = device({ removed_at: ADDED })
    expect(describeParticipantSection({ ...calm, participants: [group(), removed] }).summary)
      .toBe('1 group · history complete')
  })

  it('does not claim there is no outing while outings are still loading', () => {
    expect(describeOutingSection({ activeOutingLabel: null, error: null, loading: true }))
      .toEqual({ summary: 'Loading outings…', attention: [] })
  })

  it('summarises outings and stays open only on an outing error', () => {
    expect(describeOutingSection({ activeOutingLabel: 'Morning search', error: null }))
      .toEqual({ summary: 'Active: Morning search', attention: [] })
    expect(describeOutingSection({ activeOutingLabel: null, error: null }))
      .toEqual({ summary: 'No active outing · new fixes are Unassigned', attention: [] })
    expect(describeOutingSection({ activeOutingLabel: null, error: 'Outing store unavailable.' }).attention)
      .toEqual(['outing error'])
  })
})
