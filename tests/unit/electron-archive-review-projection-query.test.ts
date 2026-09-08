import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { normalizeArchiveReviewProjectionRequest, normalizeArchiveReviewProjectionResult,
  readArchiveReviewProjection } = require('../../electron/archive-review-projection-query.cjs')

it('returns only the selected mission and its non-retired markers in display order', () => {
  const db = new Database(':memory:')
  try {
    db.exec(`CREATE TABLE missions (id TEXT, start_time TEXT);
      CREATE TABLE markers (id TEXT, mission_id TEXT, retired_at TEXT, display_order INTEGER, name TEXT);
      INSERT INTO missions VALUES ('selected','2026'),('other','2027');
      INSERT INTO markers VALUES ('b','selected',NULL,2,'B'),('a','selected',NULL,1,'A'),
        ('retired','selected','2026',0,'Retired'),('foreign','other',NULL,0,'Foreign');
      PRAGMA query_only = ON;`)
    const request = { databasePath: '/review/mission.sqlite', missionId: 'selected', method: 'listMarkers' }
    expect(readArchiveReviewProjection(db, request).map((row: { id: string }) => row.id)).toEqual(['a', 'b'])
    expect(readArchiveReviewProjection(db, { ...request, method: 'listMissions' })).toEqual([
      { id: 'selected', start_time: '2026' },
    ])
    expect(db.pragma('query_only', { simple: true })).toBe(1)
  } finally { db.close() }
})

it('rejects undeclared methods, cross-shape fields and unsafe paging inputs', () => {
  const request = { databasePath: '/review/mission.sqlite', method: 'listGpxImportPage',
    query: { missionId: 'selected', limit: 2 } }
  expect(normalizeArchiveReviewProjectionRequest(request)).toEqual(request)
  for (const invalid of [{ ...request, method: 'deleteMission' }, { ...request, missionId: 'other' },
    { ...request, databasePath: '../private' }, { ...request, query: { missionId: 'selected', limit: 101 } },
    { ...request, query: { missionId: 'selected', limit: 2, cursor: 'x'.repeat(2049) } }]) {
    expect(() => normalizeArchiveReviewProjectionRequest(invalid)).toThrow()
  }
})

it('bounds result pages independently of request normalization', () => {
  const request = { databasePath: '/review/mission.sqlite', method: 'listGpxImportPage',
    query: { missionId: 'selected', limit: 2 } }
  expect(normalizeArchiveReviewProjectionResult(request, { entries: [], nextCursor: null }))
    .toEqual({ entries: [], nextCursor: null })
  for (const invalid of [{ entries: [{}, {}, {}], nextCursor: null },
    { entries: [], nextCursor: null, privatePath: '/private' },
    { entries: [{ payload: 'x'.repeat(8 * 1024 * 1024) }], nextCursor: null }]) {
    expect(() => normalizeArchiveReviewProjectionResult(request, invalid)).toThrow()
  }
})
