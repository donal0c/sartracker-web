#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { createPagingOracle } from './paging-receipts.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { selectPagingSource } from './paging-source.mjs'
import { copyStandaloneSqliteFixture, assertStandaloneSqliteFixture } from './sqlite-fixture.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const [appPath, evidencePath, fixturePath, contractId] = process.argv.slice(2)
if (![appPath, evidencePath, fixturePath].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !['C07', 'C08'].includes(contractId)) throw new Error('Paging requires absolute app, owned evidence, immutable fixture, and C07/C08.')
await mkdir(evidencePath, { recursive: true, mode: 0o700 })
const profile = path.join(evidencePath, '.profile-paging')
await mkdir(profile, { recursive: false, mode: 0o700 })
const fixtureBefore = await hashCandidateFile(fixturePath)
let database
let app
let output
try {
  await copyStandaloneSqliteFixture(fixtureBefore, path.join(profile, 'mission-store.sqlite'))
  const oracleCopy = await copyStandaloneSqliteFixture(fixtureBefore, path.join(profile, 'independent-oracle.sqlite'))
  database = new Database(oracleCopy.path, { readonly: true, fileMustExist: true })
  const sourceInventory = selectPagingSource(database, contractId)
  const mission = sourceInventory.primary
  const where = `mission_id = ? AND timestamp_source = 'fix'${contractId === 'C07' ? ' AND timestamp >= ?' : ''}`
  const parameters = contractId === 'C07' ? [mission.id, mission.start_time] : [mission.id]
  const expectedCount = database.prepare(`SELECT COUNT(*) AS count FROM positions WHERE ${where}`).get(...parameters).count
  const statement = database.prepare(`SELECT * FROM positions WHERE ${where} AND id = ?`)
  const oracle = createPagingOracle({ expectedCount, lookup: id => statement.get(...parameters, id) })
  const devices = database.prepare('SELECT COUNT(DISTINCT device_id) AS count FROM positions WHERE mission_id = ?').get(mission.id).count
  const outings = database.prepare('SELECT COUNT(*) AS count FROM outings WHERE mission_id = ?').get(mission.id).count
  output = await open(path.join(evidencePath, 'pages.ndjson'), 'wx', 0o600)
  const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({ executablePath: appPath, args: ['--ozone-platform=x11', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'], env })
  const page = await app.firstWindow()
  await page.getByTestId('app-title').waitFor({ timeout: 60_000 })
  let pages = 0
  let manifest = null
  /** Retain every raw returned page before oracle evaluation, including a failing page. */
  const accept = async (record) => {
    await output.writeFile(JSON.stringify(record) + '\n')
    oracle.accept(record.result.positions)
    pages++
    if (pages > 100_000) throw new Error('Paging did not terminate within the fixed page bound.')
  }
  if (contractId === 'C07') {
    let cursor = null
    const cursors = new Set()
    do {
      const query = { missionId: mission.id, activeDeviceIds: [], limit: 2000,
        direction: cursor === null ? 'latest' : 'earlier', cursor }
      const result = await page.evaluate(query => window.sartrackerElectron.missionStore.listExactBreadcrumbDotPage(query, crypto.randomUUID()), query)
      await accept({ query, result })
      if (result.totalPositionCount !== expectedCount || result.pagePositionCount !== result.positions.length) throw new Error('Exact page totals disagree with immutable source.')
      cursor = result.hasEarlier ? result.earlierCursor : null
      if (result.hasEarlier && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Exact paging cursor did not advance.')
      if (cursor !== null) cursors.add(cursor)
    } while (cursor !== null)
  } else {
    manifest = await page.evaluate(id => window.sartrackerElectron.missionStore.readCoverageManifest(id, crypto.randomUUID()), mission.id)
    if (!manifest.enumerated || manifest.pendingInvalidation || manifest.backfillIncomplete
        || manifest.chunks.reduce((sum, chunk) => sum + chunk.exactCount, 0) !== expectedCount) throw new Error('Coverage manifest is incomplete against source.')
    for (const chunk of manifest.chunks) {
      let cursor
      const cursors = new Set()
      let count = 0
      do {
        const query = { missionId: mission.id, key: chunk.key, expectedContentRev: chunk.contentRev, limit: 2000, ...(cursor ? { cursor } : {}) }
        const result = await page.evaluate(query => window.sartrackerElectron.missionStore.readCoverageChunk(query, crypto.randomUUID()), query)
        await accept({ query, result })
        if (result.contentRev !== chunk.contentRev) throw new Error('Coverage revision changed during immutable paging.')
        count += result.positions.length
        cursor = result.nextCursor
        if (cursor !== null && (typeof cursor?.id !== 'string' || cursors.has(JSON.stringify(cursor)))) throw new Error('Coverage cursor did not advance.')
        if (cursor !== null) cursors.add(JSON.stringify(cursor))
      } while (cursor !== null)
      if (count !== chunk.exactCount) throw new Error('Coverage chunk count differs from its manifest.')
    }
  }
  const observed = oracle.finish()
  await output.close(); output = null
  await page.screenshot({ path: path.join(evidencePath, 'paging-runtime.png'), fullPage: true })
  const fixtureAfter = await hashCandidateFile(fixturePath)
  await assertStandaloneSqliteFixture(fixturePath)
  if (fixtureAfter.sha256 !== fixtureBefore.sha256) throw new Error('Immutable paging fixture changed.')
  await writeFile(path.join(evidencePath, 'paging-report.json'), JSON.stringify({ schemaVersion: 1, contractId,
    fixture: fixtureBefore, sourceInventory, missionId: mission.id, devices, outings, expectedCount, pages, manifest, observed,
    rows: await hashCandidateFile(path.join(evidencePath, 'pages.ndjson')) }, null, 2))
} finally {
  try {
    if (output) await output.close()
  } finally {
    try {
      if (app) await app.close()
    } finally {
      if (database) database.close()
      await rm(profile, { recursive: true, force: true })
    }
  }
}
