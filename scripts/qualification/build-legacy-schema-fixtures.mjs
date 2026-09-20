#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_SCHEMA_HISTORY,LEGACY_RUST_SCHEMA_HISTORY } from './legacy-schema-history.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const execFile = promisify(execFileCallback)
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const destination = path.join(root,'tests/fixtures/qualification-legacy-schemas')
await mkdir(destination,{recursive:true})
await mkdir(path.join(root,'tmp'),{recursive:true})
for (const [version,commit] of Object.entries(LEGACY_SCHEMA_HISTORY)) {
  const directory = await mkdtemp(path.join(root,'tmp/legacy-schema-source-'))
  let store
  try {
    const archive = await execFile('git',['archive',commit,'electron'],{cwd:root,encoding:'buffer',maxBuffer:32*1024**2})
    const archivePath = path.join(directory,'source.tar')
    await writeFile(archivePath,archive.stdout)
    await execFile('tar',['-xf',archivePath,'-C',directory],{cwd:root})
    const sourcePath = path.join(directory,'electron/mission-store.cjs')
    const source = await readFile(sourcePath)
    const historical = require(sourcePath)
    if (historical.CURRENT_SCHEMA_VERSION !== Number(version)) throw new Error('Historical schema constant differs from the fixed commit map.')
    const profile = path.join(directory,'profile')
    await mkdir(profile)
    store = historical.createElectronMissionStore({userDataPath:profile})
    const mission = await store.createMission({name:`Synthetic historical schema ${version}`,start_time:'2026-08-20T09:00:00.000Z'})
    const marker = await store.upsertMarker({mission_id:mission.id,type:'clue',name:'Historical retained clue',description:'Synthetic migration evidence',lat:52.1,lon:-9.5,irish_grid_e:480000,irish_grid_n:580000,display_order:0,updated_by:'Synthetic coordinator'})
    await store.upsertDevice({mission_id:mission.id,device_id:'historical-device',name:'Historical device',color:'#2563eb',status:'online'})
    await store.addPosition({mission_id:mission.id,device_id:'historical-device',source_position_id:'historical-position',lat:52.1,lon:-9.5,timestamp:'2026-08-20T10:00:00.000Z',received_at:'2026-08-20T10:01:00.000Z',timestamp_source:'fix'})
    if (store.prepareClose) await store.prepareClose()
    store.close(); store = null
    const db = new Database(path.join(profile,'mission-store.sqlite'),{readonly:true,fileMustExist:true})
    try {
      const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all()
      const rows = {}
      for (const table of schema.filter(row => row.type === 'table')) rows[table.name] = db.prepare(`SELECT * FROM "${table.name}"`).all()
      await writeFile(path.join(destination,`schema-${version}.json`),JSON.stringify({schemaVersion:Number(version),sourceCommit:commit,sourceModuleSha256:createHash('sha256').update(source).digest('hex'),missionId:mission.id,markerId:marker.id,schema,rows},null,2)+'\n')
      console.log(`Retained historical schema ${version} from ${commit}.`)
    } finally { db.close() }
  } finally { if (store) { if (store.prepareClose) await store.prepareClose(); store.close() } await rm(directory,{recursive:true,force:true}) }
}
for (const [version,commit] of Object.entries(LEGACY_RUST_SCHEMA_HISTORY)) {
  const {stdout:source} = await execFile('git',['show',`${commit}:src-tauri/src/persistence.rs`],{cwd:root,maxBuffer:8*1024**2})
  const migration = source.slice(source.indexOf('async fn run_migrations'))
  const ddl = /r#"([\s\S]*?)"#/u.exec(migration)?.[1]
  if (!ddl?.includes('CREATE TABLE IF NOT EXISTS metadata')) throw new Error('Historical Rust migration DDL was not found.')
  const seed = JSON.parse(await readFile(path.join(destination,'schema-3.json'),'utf8'))
  const db = new Database(':memory:')
  try {
    db.exec(ddl)
    db.pragma('foreign_keys = OFF')
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all()
    const rows = {}
    for (const table of schema.filter(row => row.type === 'table')) {
      const columns = db.prepare(`PRAGMA table_info("${table.name}")`).all().map(column => column.name)
      for (const original of seed.rows[table.name] ?? []) {
        const row = Object.fromEntries(columns.filter(key => Object.hasOwn(original,key)).map(key => [key,original[key]]))
        if (table.name === 'metadata' && row.key === 'schema_version') row.value = version
        if (table.name === 'missions') row.schema_version = Number(version)
        const keys = Object.keys(row)
        db.prepare(`INSERT INTO "${table.name}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row))
      }
      rows[table.name] = db.prepare(`SELECT * FROM "${table.name}"`).all()
    }
    if (db.pragma('foreign_key_check').length) throw new Error('Historical Rust synthetic rows violate referential custody.')
    await writeFile(path.join(destination,`schema-${version}.json`),JSON.stringify({schemaVersion:Number(version),sourceCommit:commit,sourceModuleSha256:createHash('sha256').update(source).digest('hex'),fixtureKind:'historical-rust-ddl-with-synthetic-evidence',missionId:seed.missionId,markerId:rows.markers ? seed.markerId : null,schema,rows},null,2)+'\n')
    console.log(`Retained historical Rust schema ${version} from ${commit}.`)
  } finally { db.close() }
}
const compatibility = JSON.parse(await readFile(path.join(destination,'schema-5.json'),'utf8'))
compatibility.schemaVersion = 6
compatibility.fixtureKind = 'synthetic-schema-6-compatibility-with-historical-v5-shape'
compatibility.historicalProducerKnown = false
compatibility.rows.metadata.find(row => row.key === 'schema_version').value = '6'
compatibility.rows.missions.forEach(row => { row.schema_version = 6 })
await writeFile(path.join(destination,'schema-6.json'),JSON.stringify(compatibility,null,2)+'\n')
