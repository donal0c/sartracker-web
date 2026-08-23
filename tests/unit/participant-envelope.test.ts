import { describe, expect, it } from 'vitest'

import { assessParticipantEnvelope } from '../../src/features/participants/participant-envelope'

describe('participant supported envelope [DON-271]', () => {
  it('warns and proceeds at 101 without truncating any device', () => {
    const deviceIds = Array.from({ length: 101 }, (_, index) => String(index + 1))
    const assessment = assessParticipantEnvelope(deviceIds)

    expect(assessment.activeDeviceIds).toEqual(deviceIds)
    expect(assessment.activeDeviceCount).toBe(101)
    expect(assessment.warning).toContain('supported and qualified envelope of 100')
  })

  it('deduplicates direct and group-derived identity without an enforcement cap', () => {
    expect(assessParticipantEnvelope(['11', '11', '12'])).toMatchObject({
      activeDeviceIds: ['11', '12'],
      activeDeviceCount: 2,
      warning: null,
    })
  })
})
