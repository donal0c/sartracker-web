import { describe, expect, it } from 'vitest'

import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'
import {
  normalizeRosterInput,
  validateSettingsDraft,
} from '../../src/features/settings/settings-validation'

describe('settings validation', () => {
  it('requires provider details for Traccar basic auth', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'https://traccar.example.com'

    expect(validateSettingsDraft(draft)).toMatchObject({
      email: 'Email is required for basic authentication.',
      secretInput: 'Password is required for basic authentication.',
    })
  })

  it('validates replay defaults when replay is enabled', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'https://traccar.example.com'
    draft.dataSource.email = 'ops@example.com'
    draft.dataSource.secretInput = 'secret'
    draft.dataSource.replayEnabled = true
    draft.dataSource.replayDurationHours = 25

    expect(validateSettingsDraft(draft)).toMatchObject({
      replayStart: 'Replay start time is required when replay defaults are enabled.',
      replayDurationHours: 'Replay duration must be between 1 and 24 hours.',
    })
  })

  it('gates replay defaults to the Traccar provider', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.replayEnabled = true

    expect(validateSettingsDraft(draft)).toMatchObject({
      replayEnabled: 'Replay defaults are only available for the Traccar HTTP provider.',
    })
  })

  it('normalizes roster input into unique trimmed names', () => {
    expect(normalizeRosterInput(' Alice \nBob\nAlice\n\nCharlie  ')).toEqual([
      'Alice',
      'Bob',
      'Charlie',
    ])
  })
})
