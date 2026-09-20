// @vitest-environment node
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { createReplayScaleOracle } from '../../scripts/qualification/replay-scale-oracle.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')

it('reconciles real replay query pages against the separately read small source fixture', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'replay-source-integration-'))
  let db: import('better-sqlite3').Database | undefined
  let reader: import('better-sqlite3').Database | undefined
  try {
    const filename = path.join(directory,'source.sqlite')
    await generateMissionStoreFixture({preset:'small',outputPath:filename,force:false})
    db = new Database(filename)
    // The small legacy fixture predates receipt provenance; explicitly seed this test's known-at-time inputs.
    db.exec("UPDATE positions SET received_at=timestamp,timestamp_source='fix'")
    reader = new Database(filename,{readonly:true})
    const mission = db.prepare('SELECT id FROM missions').get() as {id:string}
    const bound = db.prepare('SELECT MAX(received_at) AS time FROM positions').get() as {time:string}
    const {readMissionReplayTrackChunk} = createRequire(import.meta.url)('../../electron/mission-replay-query.cjs') as {readMissionReplayTrackChunk: (database:import('better-sqlite3').Database,input:Record<string,unknown>) => {nextCursor:string|null}}
    const oracle = createReplayScaleOracle(reader,mission.id,bound.time)
    let cursor: string | null = null
    try {
      do {
        const result = readMissionReplayTrackChunk(db,{missionId:mission.id,selectedTime:bound.time,trackLimit:1000,...(cursor ? {cursor}: {})})
        oracle.accept(result)
        cursor = result.nextCursor
      } while (cursor !== null)
      expect(oracle.finish().count).toBeGreaterThan(1000)
    } finally { oracle.close() }
  } finally { reader?.close(); db?.close(); await rm(directory,{recursive:true,force:true}) }
},30000)

it('rejects late knowledge, changed coordinates, omission and duplicate replay points', () => {
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE positions(id TEXT,mission_id TEXT,device_id TEXT,timestamp_source TEXT,timestamp TEXT,received_at TEXT,timestamp_provenance_recorded_at TEXT,lat REAL,lon REAL,altitude REAL,accuracy REAL); INSERT INTO positions VALUES ('early','m','d','fix','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',NULL,52,-9,1,2),('late','m','d','fix','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z',NULL,52,-9,1,2)")
    const time = '2026-01-01T00:30:00Z'
    const point = { evidence_id: 'early',track_id:'d',effective_at:'2026-01-01T00:00:00Z',recorded_at:'2026-01-01T00:01:00Z',lat:52,lon:-9,elevation:1,accuracy:2,source_type:'traccar_fix',time_authority:'fixTime',completeness:'complete' }
    const page = { missionId:'m',selectedTime:time,totalTrackCount:1,tracks:[point] }
    const valid = createReplayScaleOracle(db,'m',time)
    valid.accept(page)
    expect(valid.finish().count).toBe(1)
    for (const tracks of [[{...point,evidence_id:'late'}],[{...point,lat:53}],[point,point]]) {
      const oracle = createReplayScaleOracle(db,'m',time)
      expect(() => oracle.accept({...page,tracks})).toThrow(/source truth/)
      oracle.close()
    }
    const omitted = createReplayScaleOracle(db,'m',time)
    expect(() => omitted.finish()).toThrow(/omitted/)
    omitted.close()
  } finally { db.close() }
})
