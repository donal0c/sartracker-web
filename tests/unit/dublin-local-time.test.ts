import { describe, expect, it } from 'vitest'

import {
  formatDublinDateTimeLocal,
  parseDublinDateTimeLocal,
} from '../../src/features/mission-review/dublin-local-time'

describe('Dublin replay and evidence time boundary [DON-278, DON-279]', () => {
  it('parses summer and winter wall times independently of the host timezone', () => {
    expect(parseDublinDateTimeLocal('2026-08-27T12:30:15.250')).toBe(
      '2026-08-27T11:30:15.250Z',
    )
    expect(parseDublinDateTimeLocal('2026-01-27T12:30:15.250')).toBe(
      '2026-01-27T12:30:15.250Z',
    )
  })

  it('fails closed for a duplicated autumn wall time', () => {
    expect(() => parseDublinDateTimeLocal('2026-10-25T01:30')).toThrow(
      /occurs twice/u,
    )
  })

  it('fails closed for a nonexistent spring wall time', () => {
    expect(() => parseDublinDateTimeLocal('2026-03-29T01:30')).toThrow(
      /does not exist/u,
    )
  })

  it('formats UTC instants into an explicit Dublin datetime-local value', () => {
    expect(formatDublinDateTimeLocal('2026-08-27T11:30:15.250Z')).toBe(
      '2026-08-27T12:30:15.25',
    )
  })

  it('emits Chromium-canonical fractional seconds for datetime-local controls', () => {
    expect(formatDublinDateTimeLocal('2026-01-27T12:30:15.040Z')).toBe(
      '2026-01-27T12:30:15.04',
    )
    expect(formatDublinDateTimeLocal('2026-01-27T12:30:15.400Z')).toBe(
      '2026-01-27T12:30:15.4',
    )
    expect(formatDublinDateTimeLocal('2026-01-27T12:30:15.000Z')).toBe(
      '2026-01-27T12:30:15',
    )
    expect(formatDublinDateTimeLocal('2026-01-27T12:30:15.401Z')).toBe(
      '2026-01-27T12:30:15.401',
    )
  })
})
