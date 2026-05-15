import { describe, expect, it } from 'vitest'

import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'
import {
  HOSTED_TRACCAR_PROXY_BASE_URL,
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

  it('blocks direct HTTP Traccar URLs in hosted HTTPS browser mode', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'http://kmrtsar.ddns.net:8082'
    draft.dataSource.email = 'ops@example.com'
    draft.dataSource.secretInput = 'secret'

    expect(
      validateSettingsDraft(draft, {
        hostedBrowserMode: true,
        hostedProxyBaseUrl: HOSTED_TRACCAR_PROXY_BASE_URL,
      }),
    ).toMatchObject({
      baseUrl:
        'Hosted browser mode cannot call direct HTTP Traccar URLs from the HTTPS app. Use https://sartracker-web.vercel.app as the provider base URL for hosted testing.',
    })
  })

  it('allows direct HTTP Traccar URLs outside hosted browser mode', () => {
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'http://kmrtsar.ddns.net:8082'
    draft.dataSource.email = 'ops@example.com'
    draft.dataSource.secretInput = 'secret'

    expect(validateSettingsDraft(draft)).not.toHaveProperty('baseUrl')
  })

  it('normalizes roster input into unique trimmed names', () => {
    expect(normalizeRosterInput(' Alice \nBob\nAlice\n\nCharlie  ')).toEqual([
      'Alice',
      'Bob',
      'Charlie',
    ])
  })
})
