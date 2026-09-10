import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type QueryDatabase = { prepare: (sql: string) => { get: (missionId: string) => unknown; all: (missionId: string) => readonly unknown[] } }
const { hasUnreconciledCoverageHistory } = require('../../electron/coverage-history-completeness.cjs') as {
  hasUnreconciledCoverageHistory: (database: QueryDatabase, missionId: string, devices: readonly string[]) => boolean
}

it.each(['pause_time', 'finish_time'])('retains the warning until the persisted frontier reaches %s', (boundary) => {
  const start = '2026-09-09T08:00:00Z'
  const cutoff = '2026-09-09T10:00:00Z'
  let frontier = '2026-09-09T09:00:00Z'
  const database: QueryDatabase = {
    prepare: (sql) => ({
      get: () => ({ start_time: start, pause_time: null, finish_time: null, [boundary]: cutoff }),
      all: () => sql.includes('tracking_history_checkpoints')
        ? [{ device_id: 'alpha', history_from: start, reconciled_until: frontier, requested_from: start, requested_until: cutoff }]
        : [{ device_id: 'alpha', min_ts: start, max_ts: '2026-09-09T08:30:00Z' }],
    }),
  }
  expect(hasUnreconciledCoverageHistory(database, 'mission', [])).toBe(true)
  frontier = cutoff
  expect(hasUnreconciledCoverageHistory(database, 'mission', [])).toBe(false)
})

it('honors a late authorized origin and blocks a newly requested earlier window', () => {
  let requestedFrom = '2026-09-09T09:00:00Z'
  const database: QueryDatabase = { prepare: (sql) => ({
    get: () => ({ start_time: '2026-09-09T08:00:00Z', pause_time: null, finish_time: null }),
    all: () => sql.includes('tracking_history_checkpoints') ? [{ device_id: 'late',
      history_from: '2026-09-09T09:00:00Z', reconciled_until: '2026-09-09T10:00:00Z',
      requested_from: requestedFrom, requested_until: '2026-09-09T10:00:00Z' }] : [],
  }) }
  expect(hasUnreconciledCoverageHistory(database, 'mission', ['late'])).toBe(false)
  requestedFrom = '2026-09-09T08:00:00Z'
  expect(hasUnreconciledCoverageHistory(database, 'mission', ['late'])).toBe(true)
})
