import { describe, expect, it } from 'vitest'

import {
  countPeopleStillFetchingHistory,
  countPeopleStillFetchingHistoryIfKnown,
  describeHistoryIncompleteFinishRefusal,
  describeHistoryRetryStarted,
  isHistoryIncompleteFinishRefusal,
} from '../../src/features/mission/finish-refusal'
import type { ParticipantBackfillCheckpoint } from '../../src/infrastructure/mission-store/tauri-mission-store'

const STORE_REFUSAL =
  'Mission cannot be finished while 6 participant history backfill checkpoint(s) are incomplete. Keep the mission active and retry history backfill before finishing.'

describe('finish refusal wording [DON-376]', () => {
  it('recognises the store refusal for incomplete history, and nothing else', () => {
    expect(isHistoryIncompleteFinishRefusal(STORE_REFUSAL)).toBe(true)
    expect(isHistoryIncompleteFinishRefusal('Mission is already finished.')).toBe(false)
    expect(isHistoryIncompleteFinishRefusal('')).toBe(false)
  })

  it('says what is happening and what to do in plain words', () => {
    expect(describeHistoryIncompleteFinishRefusal(6)).toBe(
      "Can't finish yet. SAR Tracker is still fetching earlier tracks for 6 people. Check the internet connection, then press Try again.",
    )
    expect(describeHistoryIncompleteFinishRefusal(1)).toBe(
      "Can't finish yet. SAR Tracker is still fetching earlier tracks for 1 person. Check the internet connection, then press Try again.",
    )
  })

  it('never invents a count it does not know', () => {
    expect(describeHistoryIncompleteFinishRefusal(null)).toBe(
      "Can't finish yet. SAR Tracker is still fetching earlier tracks for some people. Check the internet connection, then press Try again.",
    )
  })

  it('counts people, not history windows, for the mission being finished', () => {
    const checkpoints: ParticipantBackfillCheckpoint[] = [
      checkpoint({ traccar_device_id: '1', window_from: '2026-05-17T08:00:00.000Z' }),
      checkpoint({ traccar_device_id: '1', window_from: '2026-05-17T09:00:00.000Z' }),
      checkpoint({ traccar_device_id: '2' }),
      checkpoint({ traccar_device_id: '3', completed: 1 }),
      checkpoint({ traccar_device_id: '4', mission_id: 'other-mission' }),
    ]
    expect(countPeopleStillFetchingHistory(checkpoints, 'mission-1')).toBe(2)
    expect(countPeopleStillFetchingHistory([], 'mission-1')).toBe(0)
  })

  it('only counts when the participant store holds this mission, without an error, with its checkpoints', () => {
    const checkpoints = [checkpoint({ traccar_device_id: '1' }), checkpoint({ traccar_device_id: '2', completed: 1 })]
    const scope = { activeMissionId: 'mission-1', error: null, checkpoints }
    expect(countPeopleStillFetchingHistoryIfKnown(scope, 'mission-1')).toBe(1)
    expect(countPeopleStillFetchingHistoryIfKnown({ ...scope, activeMissionId: 'other' }, 'mission-1')).toBeNull()
    expect(countPeopleStillFetchingHistoryIfKnown({ ...scope, error: 'Refresh failed.' }, 'mission-1')).toBeNull()
    expect(countPeopleStillFetchingHistoryIfKnown({ ...scope, checkpoints: [] }, 'mission-1')).toBeNull()
    expect(countPeopleStillFetchingHistoryIfKnown(
      { ...scope, checkpoints: [checkpoint({ completed: 1 })] },
      'mission-1',
    )).toBe(0)
  })

  it('names devices that cannot be fetched after Try again starts', () => {
    expect(describeHistoryRetryStarted(0)).toBe('Fetching earlier tracks again. Press Confirm Finish once they have loaded.')
    expect(describeHistoryRetryStarted(2)).toBe(
      'Fetching earlier tracks again. Press Confirm Finish once they have loaded. Earlier tracks for 2 devices cannot be fetched; see the PARTICIPANT HISTORY UNAVAILABLE warning.',
    )
  })
})

function checkpoint(overrides: Partial<ParticipantBackfillCheckpoint>): ParticipantBackfillCheckpoint {
  return {
    mission_id: 'mission-1',
    traccar_device_id: '1',
    window_from: '2026-05-17T08:00:00.000Z',
    window_to: '2026-05-17T10:00:00.000Z',
    reconciled_until: '2026-05-17T08:00:00.000Z',
    completed: 0,
    updated_at: '2026-05-17T10:00:00.000Z',
    ...overrides,
  }
}
