import { describe, expect, it } from 'vitest'

import { resolveParticipantMissionId } from '../../src/features/participants/participant-mission-context'

describe('participant mission context [DON-271]', () => {
  it('prioritizes an operational recoverable mission over an unrelated review mission', () => {
    expect(resolveParticipantMissionId({
      currentMission: null,
      recoverableMission: { id: 'recoverable-mission' },
      governanceMission: { id: 'review-mission' },
    })).toBe('recoverable-mission')
  })

  it('uses the current mission before recovery and review contexts', () => {
    expect(resolveParticipantMissionId({
      currentMission: { id: 'current-mission' },
      recoverableMission: { id: 'recoverable-mission' },
      governanceMission: { id: 'review-mission' },
    })).toBe('current-mission')
  })
})
