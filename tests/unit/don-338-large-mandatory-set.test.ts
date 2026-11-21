import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

// [DON-338] When every fix is mandatory (each one starts and ends a real
// silence), the retained set can be far larger than 5,000. Copying it with a
// function-call spread (`push(...big)`) exceeds the engine's argument limit and
// throws; the trail must still be built.

const require = createRequire(import.meta.url)
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs') as {
  readonly listBreadcrumbPositions: (
    db: unknown,
    missionId: string,
    perDeviceLimit: number,
  ) => { readonly positions: readonly unknown[] }
}

const COUNT = 200_000
const START_MS = Date.parse('2016-01-01T00:00:00.000Z')
const SILENCE_MS = 31 * 60 * 1000

/** One lone fix every 31 minutes: every fix is a separate trail piece. */
function fixAt(index: number) {
  return {
    timestamp: new Date(START_MS + index * SILENCE_MS).toISOString(),
    lat: 54 + (index % 400) * 1e-3,
    lon: -6 + Math.floor(index / 400) * 1e-3,
  }
}

describe('[DON-338] large mandatory sets', () => {
  it('keeps 200,000 mandatory live-line points without exceeding the argument limit', () => {
    const positions: NormalizedTrackingPosition[] = Array.from({ length: COUNT }, (_, index) => ({
      id: String(index + 1),
      device_id: 'device-a',
      ...fixAt(index),
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp_source: 'fix',
      fix_time_unverified: false,
      source: 'traccar',
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    }))
    const accumulator = createBreadcrumbAccumulator()
    accumulator.ingest(positions)
    expect(accumulator.compact().positions).toHaveLength(COUNT)
  }, 30_000)

  it('keeps 200,000 mandatory persisted points without exceeding the argument limit', () => {
    const rows = Array.from({ length: COUNT }, (_, index) => ({
      source_position_id: String(index + 1),
      ...fixAt(index),
    }))
    const db = {
      transaction: (run: () => unknown) => run,
      prepare: (sql: string) => sql.includes('COUNT(*)')
        ? { all: () => [{ device_id: 'device-a', total: COUNT }] }
        : { iterate: () => rows[Symbol.iterator]() },
    }
    expect(listBreadcrumbPositions(db, 'mission-1', 5_000).positions).toHaveLength(COUNT)
  }, 30_000)
})
