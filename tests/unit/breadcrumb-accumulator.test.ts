import { describe, expect, it } from 'vitest'

import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import {
  appendBreadcrumbPositions,
  createBreadcrumbSegments,
} from '../../src/features/tracking/breadcrumb-accumulator'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'

describe('breadcrumb accumulator', () => {
  it('deduplicates by device and timestamp while keeping chronological order', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    const accumulated = appendBreadcrumbPositions([], positions)

    expect(accumulated).toHaveLength(3)
    expect(accumulated[0].timestamp).toBe('2026-04-06T10:00:00.000Z')
    expect(accumulated[2].timestamp).toBe('2026-04-06T10:30:00.000Z')

    const deduplicated = appendBreadcrumbPositions(accumulated, positions)
    expect(deduplicated).toHaveLength(3)
  })

  it('segments trails when time gaps exceed the configured threshold', () => {
    const positions = [
      normalizeTraccarPosition(
        {
          id: 1,
          deviceId: 1,
          latitude: 52.0,
          longitude: -9.7,
          fixTime: '2026-04-06T10:00:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 2,
          deviceId: 1,
          latitude: 52.0001,
          longitude: -9.7001,
          fixTime: '2026-04-06T10:03:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 3,
          deviceId: 1,
          latitude: 52.0002,
          longitude: -9.7002,
          fixTime: '2026-04-06T10:12:00.000Z',
        },
        'live',
      ),
    ]

    const segments = createBreadcrumbSegments(positions, 5 * 60 * 1000)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(1)
  })
})
