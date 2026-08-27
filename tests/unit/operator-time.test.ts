import { describe, expect, it, vi } from 'vitest'

import {
  formatOperatorLocalTimestamp,
  resolveOperatorTimeZone,
} from '../../src/features/tracking/operator-time'

describe('operator time', () => {
  it('renders the reported Irish summer instant with its local offset and zone [DON-267]', () => {
    expect(formatOperatorLocalTimestamp(
      '2026-08-22T15:10:17.000Z',
      { timeZone: 'Europe/Dublin' },
    )).toBe('22/08/2026, 16:10:17 GMT+01:00 (Europe/Dublin)')
  })

  it('renders Irish winter time with an explicit zero UTC offset [DON-267]', () => {
    expect(formatOperatorLocalTimestamp(
      '2026-01-22T15:10:17.000Z',
      { timeZone: 'Europe/Dublin' },
    )).toBe('22/01/2026, 15:10:17 GMT+00:00 (Europe/Dublin)')
  })

  it('returns N/A for absent or invalid instants', () => {
    expect(formatOperatorLocalTimestamp(null, { timeZone: 'UTC' })).toBe('N/A')
    expect(formatOperatorLocalTimestamp('not-an-instant', { timeZone: 'UTC' })).toBe('N/A')
  })

  it('falls back to UTC when the runtime does not expose an IANA timezone', () => {
    const resolvedOptions = vi.spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions',
    ).mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions)

    expect(resolveOperatorTimeZone()).toBe('UTC')

    resolvedOptions.mockRestore()
  })
})
