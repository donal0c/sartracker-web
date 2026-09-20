#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdir,rm,statfs,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { inspectLegacyMarkerCustody,inspectLegacyMarkerSource,inspectLegacyPositionSource } from './legacy-recovery-oracle.mjs'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const COUNT = 50000
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath,evidencePath,variantId] = process.argv.slice(2)
  await runLegacyDefaultProbe({appPath,evidencePath,variantId})
}

/** Run legacy recovery through the default application profile and public preload, never a second injected store. */
export async function runLegacyDefaultProbe({appPath,evidencePath,variantId,developmentTestHarness = false}) {
  if (![appPath,evidencePath].every(value => typeof value === 'string' && path.isAbsolute(value))
      || !['legacy-v11-50k','legacy-v11-50k-kill','legacy-v11-local-1gib','legacy-v11-field-37gb'].includes(variantId)) throw new Error('Legacy default probe requires absolute paths and a fixed variant.')
  await mkdir(evidencePath,{recursive:true,mode:0o700})
  const profile = path.join(evidencePath,'.profile-legacy-default')
  await mkdir(profile,{mode:0o700})
  const databasePath = path.join(profile,'mission-store.sqlite')
  const report = {schemaVersion:1,contractId:'C19',variantId,developmentTestHarness,profile,launches:[],cleanup:{},failure:null}
  let app
  let observer
  try {
    const preset = variantId === 'legacy-v11-local-1gib' ? 'local' : variantId === 'legacy-v11-field-37gb' ? 'field' : null
    if (preset) {
      const space = await statfs(evidencePath)
      if (space.bavail*space.bsize < 64*1024**3) throw new Error('Large legacy recovery requires 64GiB free owned evidence storage.')
      await generateMissionStoreFixture({preset,outputPath:databasePath,force:false})
    }
    const {createElectronMissionStore} = require('../../electron/mission-store.cjs')
    const fixtureStore = createElectronMissionStore({userDataPath:profile})
    let mission
    try {
      mission = preset ? await fixtureStore.getActiveMission() : await fixtureStore.createMission({name:'Synthetic default legacy recovery',start_time:'2026-08-20T09:00:00.000Z'})
      if (!mission) throw new Error('Large legacy fixture has no active mission.')
      await fixtureStore.prepareClose()
    } finally { fixtureStore.close() }
    const seed = new Database(databasePath)
    try {
      seed.prepare(`WITH RECURSIVE numbers(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM numbers WHERE n<49999)
        INSERT INTO markers(id,mission_id,type,name,description,lat,lon,irish_grid_e,irish_grid_n,created_at,updated_at,display_order,updated_by)
        SELECT printf('legacy-marker-%05d',n),?,'clue',printf('Legacy marker %05d',n),'Retained synthetic legacy evidence',52.1,-9.5,480000,580000,
        '2026-08-20T10:00:00.000Z','2026-08-20T10:00:00.000Z',n,'Synthetic legacy coordinator' FROM numbers`).run(mission.id)
      seed.exec("UPDATE metadata SET value='11' WHERE key='schema_version'; DROP TABLE mission_object_versions; DROP TABLE legacy_mission_object_backfill_state;")
      report.source = {missionId:mission.id,...inspectLegacyMarkerSource(seed,mission.id)}
      report.sourcePositions = inspectLegacyPositionSource(seed,mission.id)
    } finally { seed.close() }
    report.fixture = await copyStandaloneSqliteFixture(await hashCandidateFile(databasePath),path.join(evidencePath,'legacy-source.sqlite'))
    if (preset && report.fixture.bytes < (preset === 'local' ? 1024**3 : 3700000000)) throw new Error('Large legacy source misses its fixed byte envelope.')
    /** Launch the exact selected executable on the sole seeded userData profile. */
    const launch = async () => {
      const env = {...process.env,SARTRACKER_ELECTRON_USER_DATA_PATH:profile,SARTRACKER_ELECTRON_BLOCK_NETWORK:'1'}
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const args = process.platform === 'linux' ? ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader'] : []
      if (developmentTestHarness) args.unshift(path.join(projectRoot,'electron/main.cjs'))
      app = await electron.launch({executablePath:appPath,args,env})
      const runtime = await app.evaluate(({app}) => ({profile:app.getPath('userData'),appPath:app.getAppPath(),executablePath:process.execPath,pid:process.pid}))
      if (runtime.profile !== profile || !developmentTestHarness && !runtime.appPath.endsWith('.asar')) throw new Error('Legacy default runtime identity differs.')
      const identity = {...runtime,executableSha256:(await hashCandidateFile(runtime.executablePath)).sha256,asarSha256:developmentTestHarness ? null : (await hashCandidateFile(runtime.appPath)).sha256}
      report.launches.push(identity)
      return app.firstWindow()
    }
    let page = await launch()
    observer = new Database(databasePath,{readonly:true,fileMustExist:true,timeout:1000})
    const started = Date.now()
    const samples = []
    let killed = false
    while (Date.now()-started < 120000) {
      const exists = observer.prepare("SELECT 1 FROM sqlite_master WHERE name='mission_object_versions'").get()
      const count = exists ? observer.prepare("SELECT COUNT(*) AS count FROM mission_object_versions WHERE mission_id=? AND object_type='marker'").get(mission.id).count : 0
      samples.push({elapsedMs:Date.now()-started,count})
      if (variantId === 'legacy-v11-50k-kill' && !killed && count > 0 && count < COUNT) {
        const processHandle = app.process()
        const exited = new Promise(resolve => processHandle.once('exit',(code,signal) => resolve({code,signal})))
        if (!processHandle.kill('SIGKILL')) throw new Error('Legacy owned process did not accept SIGKILL.')
        const exit = await exited
        report.interruption = {observedRows:count,pid:processHandle.pid,exit}
        killed = true
        await app.close().catch(() => undefined)
        app = null
        observer.close(); observer = null
        page = await launch()
        observer = new Database(databasePath,{readonly:true,fileMustExist:true,timeout:1000})
      }
      if (count === COUNT) break
      await new Promise(resolve => setTimeout(resolve,20))
    }
    report.samples = samples
    if (variantId.endsWith('-kill') && !killed) throw new Error('Legacy recovery completed before an intermediate durable checkpoint was observed; forced-kill evidence was not obtained.')
    report.settled = inspectLegacyMarkerCustody(observer,mission.id)
    report.settledPositions = inspectLegacyPositionSource(observer,mission.id)
    if (JSON.stringify(report.sourcePositions) !== JSON.stringify(report.settledPositions)) throw new Error('Legacy migration changed original GPS evidence.')
    if (report.settled.markerSha256 !== report.source.markerSha256) throw new Error('Legacy default migration changed original markers.')
    observer.close(); observer = null
    await page.getByTestId('app-shell').waitFor({timeout:60000})
    report.publicMission = await page.evaluate(id => window.sartrackerElectron.missionStore.getMission(id),mission.id)
    if (report.publicMission.id !== mission.id) throw new Error('Legacy default public profile does not contain the source mission.')
    await page.screenshot({path:path.join(evidencePath,'legacy-default-settled.png'),fullPage:true})
    await app.close(); app = null
    report.migrated = await copyStandaloneSqliteFixture(await hashCandidateFile(databasePath),path.join(evidencePath,'legacy-migrated.sqlite'))
    page = await launch()
    await page.getByTestId('app-shell').waitFor({timeout:60000})
    await app.close(); app = null
    report.restartedFile = await copyStandaloneSqliteFixture(await hashCandidateFile(databasePath),path.join(evidencePath,'legacy-restarted.sqlite'))
    const reopened = new Database(databasePath,{readonly:true,fileMustExist:true})
    try { report.restarted = inspectLegacyMarkerCustody(reopened,mission.id); report.restartedPositions = inspectLegacyPositionSource(reopened,mission.id) } finally { reopened.close() }
    if (JSON.stringify(report.sourcePositions) !== JSON.stringify(report.restartedPositions)) throw new Error('Legacy restart changed original GPS evidence.')
    if (report.restarted.baselineSha256 !== report.settled.baselineSha256 || report.restarted.markerSha256 !== report.source.markerSha256) throw new Error('Legacy default restart changed settled custody.')
    return report
  } catch (error) { report.failure = error instanceof Error ? error.message : String(error); throw error }
  finally {
    try { observer?.close(); if (app) await app.close(); report.cleanup.applicationClosed = true }
    catch (error) { report.cleanup.failure = String(error); report.failure ??= String(error); throw error }
    finally {
      if (report.failure) { report.cleanup.profileRemoved = false; report.cleanup.retainedFailureProfile = profile }
      else { await rm(profile,{recursive:true,force:true}); report.cleanup.profileRemoved = true }
      await writeFile(path.join(evidencePath,'legacy-default-report.json'),JSON.stringify(report,null,2))
    }
  }
}
