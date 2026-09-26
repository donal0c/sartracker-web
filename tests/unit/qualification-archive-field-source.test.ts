import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { selectArchiveFieldSource } from '../../scripts/qualification/archive-field-source.mjs'
import { selectPagingSource } from '../../scripts/qualification/paging-source.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const missionId = 'fixture-mission-000000000001'
const source = { bytes: 3_700_000_000, sha256: 'a'.repeat(64) }

/** Small rows exercise the manifest contract without generating a multi-gigabyte file. */
function fixture() {
  const database = new Database(':memory:')
  database.exec(`CREATE TABLE missions(id TEXT,status TEXT,start_time TEXT,schema_version INTEGER);
    CREATE TABLE devices(id TEXT,mission_id TEXT);
    CREATE TABLE positions(id TEXT,mission_id TEXT,device_id TEXT,timestamp TEXT,timestamp_source TEXT);
    CREATE TABLE mission_events(id TEXT,mission_id TEXT);
    INSERT INTO missions VALUES('${missionId}','active','2026-01-01T00:00:00.000Z',13);
    INSERT INTO mission_events VALUES('event','${missionId}');`)
  for (let index = 0; index < 32; index++) database.prepare('INSERT INTO devices VALUES(?,?)').run(`device-${index}`, missionId)
  for (let index = 0; index < 8; index++) database.prepare('INSERT INTO positions VALUES(?,?,?,?,NULL)').run(`position-${index}`, missionId, `device-${index}`, '2026-01-01T01:00:00.000Z')
  const manifest = { preset: 'field', generatorVersion: 2, schemaVersion: 13, syntheticDataOnly: true,
    workload: { mode: 'target-size', deviceCount: 32, activePositionDeviceCount: 8, realPositionRows: 8 },
    database: { ...source }, rows: { totalMissionEvents: 1, byTable: { missions: 1, devices: 32, positions: 8, mission_events: 1 } } }
  return { database, manifest }
}

describe('legacy field archive source contract', () => {
  it('admits all null-provenance archive positions while unchanged C07 still rejects them', () => {
    const { database, manifest } = fixture()
    try {
      expect(() => selectPagingSource(database, 'C07')).toThrow('primary mission is missing')
      expect(selectArchiveFieldSource(database, manifest, source)).toMatchObject({
        primary: { id: missionId, positionCount: 8 }, fixturePositionCount: 8,
        rowCounts: manifest.rows.byTable, provenance: { null: 8, fix: 0, other: 0 },
      })
    } finally { database.close() }
  })

  it.each([
    "UPDATE missions SET status='paused'", "UPDATE missions SET id='wrong'",
    'DELETE FROM missions', "INSERT INTO missions SELECT 'other',status,start_time,schema_version FROM missions",
    'UPDATE missions SET schema_version=14', "UPDATE positions SET mission_id='other' WHERE id='position-0'",
    "DELETE FROM positions WHERE id='position-0'", "UPDATE devices SET mission_id='other' WHERE id='device-0'",
    "DELETE FROM mission_events",
  ])('rejects an ambiguous or mismatched database: %s', sql => {
    const { database, manifest } = fixture()
    try { database.exec(sql); expect(() => selectArchiveFieldSource(database, manifest, source)).toThrow() }
    finally { database.close() }
  })

  it.each([
    { preset: 'bcp-field-37gb' }, { generatorVersion: 6 }, { schemaVersion: 14 }, { syntheticDataOnly: false },
    { database: { ...source, sha256: 'b'.repeat(64) } }, { database: { ...source, bytes: source.bytes + 1 } },
    { workload: { mode: 'breadcrumb-programme', deviceCount: 100, activePositionDeviceCount: 100, realPositionRows: 8 } },
  ])('rejects wrong manifest role, version, or identity: %j', delta => {
    const { database, manifest } = fixture()
    try { expect(() => selectArchiveFieldSource(database, { ...manifest, ...delta }, source)).toThrow() }
    finally { database.close() }
  })

  it('rejects a below-floor source even when its manifest agrees', () => {
    const { database, manifest } = fixture()
    const undersized = { ...source, bytes: source.bytes - 1 }
    try { expect(() => selectArchiveFieldSource(database, { ...manifest, database: undersized }, undersized)).toThrow() }
    finally { database.close() }
  })
})
