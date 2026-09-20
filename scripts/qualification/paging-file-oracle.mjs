import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyStandaloneSqliteFixture, assertStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { createPagingOracle, validateExactPageOrder, validateCoverageRowPeriod } from './paging-receipts.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { selectPagingSource } from './paging-source.mjs'

const require = createRequire(import.meta.url)
export const PAGING_PROFILES = Object.freeze({
  'paging-960k': Object.freeze({ rows: 960_000, bytes: 1 }),
  'paging-2m': Object.freeze({ rows: 2_000_000, bytes: 1 }),
  'paging-2m-1gib': Object.freeze({ rows: 2_000_000, bytes: 1024 ** 3 }),
  'paging-field-37gb': Object.freeze({ rows: 2_000_000, bytes: 3_700_000_000 }),
})

/** Re-open the byte-bound independent SQLite source and re-evaluate every retained page. */
export async function validatePagingFiles({ report, rowsPath, fixture, variantId, contractId }) {
  const profile = PAGING_PROFILES[variantId]
  if (!profile || !['C07', 'C08'].includes(contractId) || report?.schemaVersion !== 1 || report.contractId !== contractId) throw new Error('Paging binding/profile is not reviewed.')
  const before = await hashCandidateFile(fixture.path)
  if (before.sha256 !== fixture.sha256 || before.bytes !== fixture.bytes || before.bytes < profile.bytes
      || report.fixture?.sha256 !== before.sha256) throw new Error('Paging source fixture identity or field size differs.')
  const rows = await hashCandidateFile(rowsPath)
  if (rows.bytes > 4 * 1024 ** 3 || rows.sha256 !== report.rows?.sha256 || rows.bytes !== report.rows?.bytes) throw new Error('Paging raw rows changed or exceed the reviewed bound.')
  const Database = require('better-sqlite3')
  const oracleDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-paging-oracle-'))
  let database
  try {
    const copy = await copyStandaloneSqliteFixture(before, path.join(oracleDirectory, 'source.sqlite'))
    database = new Database(copy.path, { readonly: true, fileMustExist: true })
    const sourceInventory = selectPagingSource(database, contractId)
    if (sourceInventory.primary.id !== report.missionId) throw new Error('Paging mission differs from source.')
    const where = `mission_id = ? AND timestamp_source = 'fix'${contractId === 'C07' ? ' AND timestamp >= ?' : ''}`
    const params = contractId === 'C07' ? [report.missionId, sourceInventory.primary.start_time] : [report.missionId]
    const expectedCount = database.prepare(`SELECT COUNT(*) AS count FROM positions WHERE ${where}`).get(...params).count
    const devices = database.prepare('SELECT COUNT(DISTINCT device_id) AS count FROM positions WHERE mission_id = ?').get(report.missionId).count
    const outings = database.prepare('SELECT COUNT(*) AS count FROM outings WHERE mission_id = ?').get(report.missionId).count
    if (sourceInventory.fixturePositionCount < profile.rows || devices !== 100 || outings !== 12 || report.expectedCount !== expectedCount
        || report.devices !== devices || report.outings !== outings) throw new Error('Paging field envelope requires the bound row minimum, 100 devices and twelve outings.')
    if (JSON.stringify(report.sourceInventory) !== JSON.stringify(sourceInventory)) throw new Error('Paging primary/legacy source inventory differs.')
    const query = database.prepare(`SELECT * FROM positions WHERE ${where} AND id = ?`)
    const oracle = createPagingOracle({ expectedCount, lookup: id => query.get(...params, id) })
    const sourceOutings = database.prepare('SELECT id, started_at, ended_at FROM outings WHERE mission_id = ? ORDER BY started_at').all(report.missionId)
    const coverageCounts = new Map()
    const coverageManifest = new Map()
    if (contractId === 'C08') {
      if (report.manifest?.enumerated !== true || report.manifest.pendingInvalidation !== false
          || report.manifest.backfillIncomplete !== false || !Array.isArray(report.manifest.chunks)) throw new Error('Coverage manifest is incomplete.')
      for (const chunk of report.manifest.chunks) {
        const key = JSON.stringify(chunk.key)
        if (coverageManifest.has(key) || !Number.isSafeInteger(chunk.exactCount) || chunk.exactCount < 0) throw new Error('Coverage manifest repeats a chunk or has an invalid count.')
        coverageManifest.set(key, chunk)
      }
    }
    let previousRecord = null
    let pages = 0
    let carry = ''
    for await (const chunk of createReadStream(rows.path, { encoding: 'utf8', highWaterMark: 65536 })) {
      carry += chunk
      let newline
      while ((newline = carry.indexOf('\n')) >= 0) {
        if (newline > 8 * 1024 * 1024) throw new Error('Paging raw page is oversized.')
        const record = JSON.parse(carry.slice(0, newline)); carry = carry.slice(newline + 1)
        if (record.query?.missionId !== report.missionId || record.query.limit !== 2000) throw new Error('Paging raw request identity differs.')
        if (contractId === 'C07') {
          validateExactPageOrder(record.result.positions, previousRecord?.result.positions[0] ?? null)
          if (record.result.totalPositionCount !== expectedCount || record.result.pagePositionCount !== record.result.positions.length
              || record.query.direction !== (previousRecord === null ? 'latest' : 'earlier')
              || record.query.cursor !== (previousRecord?.result.earlierCursor ?? null)
              || (previousRecord !== null && previousRecord.result.hasEarlier !== true)) throw new Error('Exact paging chain or totals are inconsistent.')
        } else {
          const key = JSON.stringify(record.query.key)
          const chunk = coverageManifest.get(key)
          if (!chunk || record.query.expectedContentRev !== chunk.contentRev || record.result.contentRev !== chunk.contentRev) throw new Error('Coverage chunk/revision differs from manifest.')
          const previousKey = previousRecord === null ? null : JSON.stringify(previousRecord.query.key)
          if (previousKey === key) {
            if (previousRecord.result.nextCursor === null || JSON.stringify(record.query.cursor) !== JSON.stringify(previousRecord.result.nextCursor)) throw new Error('Coverage continuation chain is invalid.')
          } else if (record.query.cursor !== undefined || coverageCounts.has(key) || (previousRecord && previousRecord.result.nextCursor !== null)) throw new Error('Coverage chunk ordering or completion is invalid.')
          for (const row of record.result.positions) {
            validateCoverageRowPeriod(row, record.query.key, sourceOutings)
          }
          coverageCounts.set(key, (coverageCounts.get(key) ?? 0) + record.result.positions.length)
        }
        oracle.accept(record.result?.positions)
        previousRecord = record
        if (++pages > 100_000) throw new Error('Paging raw page count exceeds bound.')
      }
      if (carry.length > 8 * 1024 * 1024) throw new Error('Paging unterminated raw page is oversized.')
    }
    if (carry !== '' || pages !== report.pages) throw new Error('Paging raw evidence is incomplete.')
    if (contractId === 'C07' && (previousRecord?.result.hasEarlier !== false || previousRecord.result.earlierCursor !== null)) throw new Error('Exact paging did not reach its terminal boundary.')
    if (contractId === 'C08') {
      if (previousRecord?.result.nextCursor !== null || coverageCounts.size !== coverageManifest.size
          || [...coverageManifest].some(([key, chunk]) => coverageCounts.get(key) !== chunk.exactCount)) throw new Error('Coverage paging did not complete every manifest chunk.')
    }
    const observed = oracle.finish()
    if (observed.sequenceSha256 !== report.observed?.sequenceSha256) throw new Error('Paging observed sequence differs from retained raw rows.')
    const after = await hashCandidateFile(fixture.path)
    await assertStandaloneSqliteFixture(fixture.path)
    if (after.sha256 !== before.sha256) throw new Error('Paging source changed during revalidation.')
    return { passed: true, status: 'PASS', expectedCount, devices, outings, pages, fixtureSha256: before.sha256,
      sourceInventory, scope: 'complete primary-mission paging against independent source; twelve generator legacy rows and rendered coverage have separate obligations' }
  } finally { if (database) database.close(); await rm(oracleDirectory, { recursive: true, force: true }) }
}
