// @vitest-environment node
import { createRequire } from 'node:module'
import { expect,it } from 'vitest'
import { inspectLegacyMarkerCustody,inspectLegacyMarkerSource } from '../../scripts/qualification/legacy-recovery-oracle.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')

it('rejects missing, duplicated or mutated baseline evidence independently of row totals', () => {
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE markers(id TEXT,mission_id TEXT,name TEXT,created_at TEXT); CREATE TABLE mission_object_versions(mission_id TEXT,object_type TEXT,object_id TEXT,version_sequence INTEGER,operation TEXT,completeness TEXT,state_json TEXT); INSERT INTO markers VALUES ('legacy-marker-00000','m','Clue','2026-01-01T00:00:00Z')")
    const marker = db.prepare('SELECT * FROM markers').get() as Record<string,string>
    const source = inspectLegacyMarkerSource(db,'m')
    expect(() => inspectLegacyMarkerCustody(db,'m',1)).toThrow(/missing/)
    const state = JSON.stringify({...marker,legacy_history_known:false,legacy_source_effective_at:marker.created_at})
    db.prepare("INSERT INTO mission_object_versions VALUES ('m','marker','legacy-marker-00000',1,'legacy_baseline','legacy_baseline',?)").run(state)
    expect(inspectLegacyMarkerCustody(db,'m',1).markerSha256).toBe(source.markerSha256)
    db.prepare('UPDATE mission_object_versions SET state_json=?').run(JSON.stringify({...JSON.parse(state),name:'Changed'}))
    expect(() => inspectLegacyMarkerCustody(db,'m',1)).toThrow(/changed/)
    db.prepare('UPDATE mission_object_versions SET state_json=?').run(state)
    db.exec('INSERT INTO mission_object_versions SELECT * FROM mission_object_versions')
    expect(() => inspectLegacyMarkerCustody(db,'m',1)).toThrow(/duplicated/)
  } finally { db.close() }
})
