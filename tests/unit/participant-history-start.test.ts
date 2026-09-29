import { describe, expect, it } from 'vitest'

import {
  participantRequestedEarlierHistory,
  resolveParticipantEffectiveFrom,
} from '../../src/features/participants/participant-history-start'

const MISSION_START = '2026-09-27T06:10:39.479Z'

describe('participant history start choice [DON-291]', () => {
  it('refuses to add a participant until the coordinator chooses where history starts', () => {
    const result = resolveParticipantEffectiveFrom({
      choice: null,
      missionStartTime: MISSION_START,
      customLocalDateTime: '',
    })
    expect(result).toEqual({
      ok: false,
      message: 'Choose where this participant’s history starts: from mission start, from now, or a custom time.',
    })
  })

  it('uses the exact stored mission start so a backdated lookback is fetched', () => {
    expect(resolveParticipantEffectiveFrom({
      choice: 'mission-start',
      missionStartTime: MISSION_START,
      customLocalDateTime: '',
    })).toEqual({ ok: true, effectiveFrom: MISSION_START })
  })

  it('fails visibly when mission start is unavailable instead of silently using now', () => {
    for (const missionStartTime of [null, '', 'not a time']) {
      const result = resolveParticipantEffectiveFrom({
        choice: 'mission-start',
        missionStartTime,
        customLocalDateTime: '',
      })
      expect(result.ok).toBe(false)
    }
  })

  it('leaves From now to the store clock so added_at and effective_from stay identical', () => {
    expect(resolveParticipantEffectiveFrom({
      choice: 'now',
      missionStartTime: MISSION_START,
      customLocalDateTime: '2026-09-28T10:00',
    })).toEqual({ ok: true, effectiveFrom: undefined })
  })

  it('converts a custom local time and rejects an empty or invalid custom time', () => {
    const local = '2026-09-28T10:00'
    expect(resolveParticipantEffectiveFrom({
      choice: 'custom',
      missionStartTime: MISSION_START,
      customLocalDateTime: local,
    })).toEqual({ ok: true, effectiveFrom: new Date(local).toISOString() })
    for (const customLocalDateTime of ['', '   ', 'garbage']) {
      expect(resolveParticipantEffectiveFrom({
        choice: 'custom',
        missionStartTime: MISSION_START,
        customLocalDateTime,
      }).ok).toBe(false)
    }
  })

  it('distinguishes participants whose history window starts before they were added', () => {
    expect(participantRequestedEarlierHistory({
      effective_from: MISSION_START,
      added_at: '2026-09-29T06:10:39.530Z',
    })).toBe(true)
    expect(participantRequestedEarlierHistory({
      effective_from: '2026-09-29T06:13:04.050Z',
      added_at: '2026-09-29T06:13:04.050Z',
    })).toBe(false)
  })
})
