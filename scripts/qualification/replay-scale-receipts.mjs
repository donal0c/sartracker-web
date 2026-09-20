import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { selectPagingSource } from './paging-source.mjs'
import { createReplayScaleOracle } from './replay-scale-oracle.mjs'
import { canonicalJson } from './control-plane.mjs'

const LANES = ['live-before','live-middle','live-after','live-after-concurrent','archive-before','archive-middle','archive-after']

/** Recompute all seven complete replay streams from the byte-bound immutable fixture. */
export async function validateReplayScaleFiles({report,fixture,rowsPath,variantId}) {
  const minimum = { 'replay-960k':960000, 'replay-2m':2000000 }[variantId]
  if (!minimum || report?.schemaVersion !== 1 || report.contractId !== 'C10' || report.variantId !== variantId || report.developmentTestHarness !== false
      || report.failure || report.cleanup?.applicationClosed !== true || report.cleanup?.profileRemoved !== true
      || report.cleanup?.reviewClosed !== true || report.archive?.verified !== true || report.archive?.immutable !== true
      || !report.concurrent?.error?.includes('changed while paging')) throw new Error('Replay scale execution envelope is incomplete.')
  const source = await hashCandidateFile(fixture.path)
  if (source.sha256 !== fixture.sha256 || source.bytes !== fixture.bytes || source.sha256 !== report.fixture?.sha256) throw new Error('Replay scale immutable fixture identity differs.')
  const rows = await hashCandidateFile(rowsPath)
  if (rows.sha256 !== report.rows?.sha256 || rows.bytes !== report.rows?.bytes || rows.bytes > 16 * 1024 ** 3) throw new Error('Replay scale raw rows differ or exceed the fixed bound.')
  const directory = await mkdtemp(path.join(os.tmpdir(),'sartracker-replay-oracle-'))
  let database
  let oracle
  try {
    const copied = await copyStandaloneSqliteFixture(source,path.join(directory,'source.sqlite'))
    const Database = createRequire(import.meta.url)('better-sqlite3')
    database = new Database(copied.path,{readonly:true,fileMustExist:true})
    const inventory = selectPagingSource(database,'C07')
    const missionId = inventory.primary.id
    if (inventory.fixturePositionCount < minimum || canonicalJson(inventory) !== canonicalJson(report.sourceInventory)
        || report.missionId !== missionId || database.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id=?').get(missionId).count !== 100
        || database.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get().count !== 0) throw new Error('Replay scale source envelope differs.')
    const bounds = database.prepare("SELECT MIN(MAX(timestamp,received_at,COALESCE(timestamp_provenance_recorded_at,received_at))) AS first,MAX(MAX(timestamp,received_at,COALESCE(timestamp_provenance_recorded_at,received_at))) AS last FROM positions WHERE mission_id=? AND timestamp_source='fix'").get(missionId)
    const times = {before:new Date(Date.parse(bounds.first)-1).toISOString(),middle:new Date(Math.floor((Date.parse(bounds.first)+Date.parse(bounds.last))/2)).toISOString(),after:new Date(Date.parse(bounds.last)+1).toISOString()}
    if (canonicalJson(times) !== canonicalJson(report.times)) throw new Error('Replay scale transaction-time boundaries differ.')
    let laneIndex = -1
    let pages = 0
    let previousCursor = null
    let carry = ''
    const observed = []
    /** Close one complete lane; no producer digest or count is trusted. */
    const finish = () => {
      if (oracle) {
        if (previousCursor !== null) throw new Error('Replay scale lane ends with unread continuation.')
        observed.push({lane:LANES[laneIndex],selectedTime:times[LANES[laneIndex].split('-')[1]],pages,...oracle.finish()})
        oracle = null
      }
    }
    for await (const chunk of createReadStream(rows.path,{encoding:'utf8',highWaterMark:65536})) {
      carry += chunk
      let newline
      while ((newline = carry.indexOf('\n')) >= 0) {
        if (newline > 8 * 1024 ** 2) throw new Error('Replay scale page exceeds the fixed memory bound.')
        const record = JSON.parse(carry.slice(0,newline)); carry = carry.slice(newline+1)
        if (record.lane !== LANES[laneIndex]) {
          finish()
          laneIndex++
          if (record.lane !== LANES[laneIndex]) throw new Error('Replay scale lanes are missing or repeated.')
          oracle = createReplayScaleOracle(database,missionId,times[record.lane.split('-')[1]])
          pages = 0; previousCursor = null
        }
        if (record.query?.missionId !== missionId || record.query.selectedTime !== times[record.lane.split('-')[1]]
            || record.query.trackLimit !== 1000 || (record.query.cursor ?? null) !== previousCursor
            || pages > 0 && previousCursor === null) throw new Error('Replay scale continuation identity differs.')
        oracle.accept(record.result)
        pages++
        previousCursor = record.result.nextCursor
        if (previousCursor !== null && typeof previousCursor !== 'string' || pages > 10000) throw new Error('Replay scale continuation is invalid.')
      }
      if (carry.length > 8 * 1024 ** 2) throw new Error('Replay scale page exceeds the fixed memory bound.')
    }
    if (carry) throw new Error('Replay scale final record is unterminated.')
    finish()
    if (laneIndex !== LANES.length-1 || canonicalJson(observed) !== canonicalJson(report.lanes)
        || observed[0].count !== 0 || observed[1].count <= 0 || observed[1].count >= observed[2].count) throw new Error('Replay scale full stream or transaction-time boundary coverage differs.')
    return {passed:true,status:'PASS',failureReasons:[],observed,scope:'fixed scale transaction-time track streams, concurrent generation rejection and verified archive parity'}
  } finally { oracle?.close(); database?.close(); await rm(directory,{recursive:true,force:true}) }
}
