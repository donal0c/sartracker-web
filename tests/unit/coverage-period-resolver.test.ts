import { createRequire } from 'node:module'

import vectors from '../fixtures/outing-window-vectors.json'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { findContainingOutingIndex, resolveCoveragePeriod } = require(
  '../../electron/coverage-period-resolver.cjs',
) as {
  readonly findContainingOutingIndex: (
    outings: readonly {
      readonly id: string
      readonly started_at: string
      readonly ended_at: string | null
    }[],
    timestamp: string,
  ) => number
  readonly resolveCoveragePeriod: (
    outings: readonly {
      readonly id: string
      readonly started_at: string
      readonly ended_at: string | null
    }[],
    timestamp: string,
  ) =>
    | { readonly period_kind: 'outing'; readonly period_id: string }
    | { readonly period_kind: 'unassigned'; readonly period_id: '' }
}

describe('coverage period resolver', () => {
  it.each(vectors)('replays $name with half-open containment', ({ left }) => {
    const outings = [{ id: 'fixture-outing', ...left }]

    expect(findContainingOutingIndex(outings, left.started_at)).toBe(0)
    if (left.ended_at !== null) {
      expect(findContainingOutingIndex(outings, left.ended_at)).toBe(-1)
    }
  })

  it('assigns a shared-boundary fix to the later outing', () => {
    const outings = [
      {
        id: 'earlier',
        started_at: '2026-08-20T09:00:00.000Z',
        ended_at: '2026-08-20T11:00:00.000Z',
      },
      {
        id: 'later',
        started_at: '2026-08-20T11:00:00.000Z',
        ended_at: '2026-08-20T12:00:00.000Z',
      },
    ]

    expect(resolveCoveragePeriod(outings, '2026-08-20T11:00:00.000Z')).toEqual({
      period_kind: 'outing',
      period_id: 'later',
    })
  })

  it('assigns every fix at or after an open outing start to that outing', () => {
    const outings = [
      {
        id: 'active',
        started_at: '2026-08-20T09:00:00.000Z',
        ended_at: null,
      },
    ]

    expect(resolveCoveragePeriod(outings, '2026-08-20T09:00:00.000Z')).toEqual({
      period_kind: 'outing',
      period_id: 'active',
    })
    expect(resolveCoveragePeriod(outings, '2026-08-21T09:00:00.000Z')).toEqual({
      period_kind: 'outing',
      period_id: 'active',
    })
  })

  it('uses the tagged Unassigned key outside every outing', () => {
    const outings = [
      {
        id: 'outing-1',
        started_at: '2026-08-20T09:00:00.000Z',
        ended_at: '2026-08-20T11:00:00.000Z',
      },
    ]

    expect(resolveCoveragePeriod(outings, '2026-08-20T08:59:59.999Z')).toEqual({
      period_kind: 'unassigned',
      period_id: '',
    })
    expect(resolveCoveragePeriod(outings, '2026-08-20T11:00:00.000Z')).toEqual({
      period_kind: 'unassigned',
      period_id: '',
    })
  })
})
