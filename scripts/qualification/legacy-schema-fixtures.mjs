import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_SCHEMA_HISTORY,LEGACY_RUST_SCHEMA_HISTORY } from './legacy-schema-history.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')

/** Materialize a reviewed historical schema and its retained synthetic mission/marker, without current schema construction. */
export async function materializeLegacySchema(version,databasePath) {
  const fixture = await readLegacySchema(version)
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const db = new Database(databasePath)
  try {
    if (db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count !== 0) throw new Error('Legacy fixture destination is not fresh.')
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      for (const entry of fixture.schema) db.exec(entry.sql)
      for (const [name,rows] of Object.entries(fixture.rows)) {
        if (!/^[a-z_][a-z0-9_]*$/u.test(name) || !Array.isArray(rows)) throw new Error('Legacy fixture table is invalid.')
        for (const row of rows) {
          const keys = Object.keys(row)
          if (keys.some(key => !/^[a-z_][a-z0-9_]*$/u.test(key))) throw new Error('Legacy fixture column is invalid.')
          db.prepare(`INSERT INTO "${name}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row))
        }
      }
    })()
    if (db.pragma('foreign_key_check').length !== 0) throw new Error('Legacy fixture referential integrity differs.')
    return fixture
  } finally { db.close() }
}

/** Read only the fixed version's reviewed historical fixture, never a producer-selected schema. */
export async function readLegacySchema(version) {
  if (!Number.isInteger(version) || version < 1 || version > 12) throw new Error('Legacy schema fixture version is not reviewed.')
  const filename = path.join(root,`tests/fixtures/qualification-legacy-schemas/schema-${version}.json`)
  const bytes = await readFile(filename)
  if (bytes.length > 1024**2) throw new Error('Legacy schema fixture exceeds its fixed bound.')
  const fixture = JSON.parse(bytes.toString('utf8'))
  const expectedCommit = LEGACY_SCHEMA_HISTORY[version] ?? LEGACY_RUST_SCHEMA_HISTORY[version] ?? LEGACY_SCHEMA_HISTORY[5]
  if (fixture.schemaVersion !== version || fixture.sourceCommit !== expectedCommit
      || version === 6 && (fixture.historicalProducerKnown !== false || fixture.fixtureKind !== 'synthetic-schema-6-compatibility-with-historical-v5-shape')) throw new Error('Legacy schema fixture provenance differs.')
  return fixture
}

/** Independently preserve every original marker column through migration, allowing only newly added columns. */
export function inspectMigratedHistoricalFixture(database,fixture) {
  if (database.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value !== '13') throw new Error('Historical fixture did not reach the current schema.')
  const mission = database.prepare('SELECT * FROM missions WHERE id=?').get(fixture.missionId)
  const originalMission = fixture.rows.missions.find(row => row.id === fixture.missionId)
  for (const key of ['id','name','start_time','notes']) if (mission?.[key] !== originalMission[key]) throw new Error(`Historical mission ${key} changed.`)
  const original = fixture.rows.markers?.find(row => row.id === fixture.markerId)
  const marker = original ? database.prepare('SELECT * FROM markers WHERE id=?').get(fixture.markerId) : null
  if (original) for (const [key,value] of Object.entries(original)) if (marker?.[key] !== value) throw new Error(`Historical marker ${key} changed.`)
  for (const row of fixture.rows.positions ?? []) {
    const migrated = database.prepare('SELECT * FROM positions WHERE id=?').get(row.id)
    for (const [key,value] of Object.entries(row)) if (migrated?.[key] !== value) throw new Error(`Historical position ${key} changed.`)
  }
  return {schemaVersion:13,missionId:mission.id,markerId:marker?.id ?? null,preservedMarkerColumns:original ? Object.keys(original).sort() : [],positionCount:fixture.rows.positions?.length ?? 0}
}
