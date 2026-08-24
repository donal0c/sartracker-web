import vectors from '../fixtures/outing-window-vectors.json'
import { describe, expect, it } from 'vitest'

import {
  classifyOutingAt,
  outingWindowsOverlap,
} from '../../src/features/outings/outing-schedule'

describe('outing schedule', () => {
  it.each(vectors)('$name', ({ left, right, overlaps }) => {
    expect(outingWindowsOverlap(left, right)).toBe(overlaps)
  })

  it('uses half-open windows so a shared-boundary fix belongs to the later outing', () => {
    const outings = [
      { id: 'earlier', started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T11:00:00.000Z' },
      { id: 'later', started_at: '2026-08-20T11:00:00.000Z', ended_at: '2026-08-20T12:00:00.000Z' },
    ]

    expect(classifyOutingAt(outings, '2026-08-20T11:00:00.000Z')).toBe('later')
    expect(classifyOutingAt(outings, '2026-08-20T12:30:00.000Z')).toBeNull()
  })
})
