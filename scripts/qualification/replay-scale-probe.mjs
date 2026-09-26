#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { selectPagingSource } from './paging-source.mjs'
import { createReplayScaleOracle } from './replay-scale-oracle.mjs'
import { createReplayPagingDiagnosticCollector } from './replay-paging-diagnostic.mjs'
import { waitForPackagedStderrDrain } from '../../build/packaged-page-diagnostics.js'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath,evidencePath,fixturePath,variantId] = process.argv.slice(2)
  await runReplayScaleProbe({appPath,evidencePath,fixturePath,variantId})
}

/** Exercise real replay IPC; the programmatic small development lane can never qualify a candidate. */
export async function runReplayScaleProbe({appPath,evidencePath,fixturePath,variantId,developmentTestHarness = false}) {
const minima = { 'replay-960k': 960000, 'replay-2m': 2000000 }
if (![appPath,evidencePath,fixturePath].every(value => typeof value === 'string' && path.isAbsolute(value)) || !minima[variantId]) throw new Error('Replay scale requires absolute app, owned evidence, fixture and fixed replay-960k/replay-2m variant.')
await mkdir(evidencePath, { recursive: true, mode: 0o700 })
const profile = path.join(evidencePath, '.profile-replay-scale')
await mkdir(profile, { mode: 0o700 })
const fixture = await hashCandidateFile(fixturePath)
let app
let database
let output
let sessionId
let diagnosticStream
const pagingDiagnostic = createReplayPagingDiagnosticCollector()
const report = { schemaVersion: 1, contractId: 'C10', variantId, developmentTestHarness, fixture, lanes: [], cleanup: {}, failure: null }
try {
  await copyStandaloneSqliteFixture(fixture, path.join(profile, 'mission-store.sqlite'))
  const copy = await copyStandaloneSqliteFixture(fixture, path.join(profile, 'oracle.sqlite'))
  const Database = createRequire(import.meta.url)('better-sqlite3')
  database = new Database(copy.path, { readonly: true, fileMustExist: true })
  const inventory = selectPagingSource(database, 'C07')
  const missionId = inventory.primary.id
  report.sourceInventory = inventory
  report.missionId = missionId
  const devices = database.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id=?').get(missionId).count
  if (!developmentTestHarness && (inventory.fixturePositionCount < minima[variantId] || devices !== 100)) throw new Error('Replay scale fixture misses fixed size/device envelope.')
  if (database.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get().count !== 0) throw new Error('Replay scale fixture unexpectedly includes GPX evidence.')
  const bounds = database.prepare("SELECT MIN(MAX(timestamp,received_at,COALESCE(timestamp_provenance_recorded_at,received_at))) AS first, MAX(MAX(timestamp,received_at,COALESCE(timestamp_provenance_recorded_at,received_at))) AS last FROM positions WHERE mission_id=? AND timestamp_source='fix'").get(missionId)
  const before = new Date(Date.parse(bounds.first) - 1).toISOString()
  const middle = new Date(Math.floor((Date.parse(bounds.first) + Date.parse(bounds.last)) / 2)).toISOString()
  const after = new Date(Date.parse(bounds.last) + 1).toISOString()
  report.times = { before, middle, after }
  output = await open(path.join(evidencePath, 'replay-pages.ndjson'), 'wx', 0o600)
  const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1', SARTRACKER_REPLAY_PAGING_DIAGNOSTICS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({ executablePath: appPath, args: [...(developmentTestHarness ? [path.resolve('electron/main.cjs')] : []),'--ozone-platform=x11','--no-sandbox','--use-gl=angle','--use-angle=swiftshader'], env })
  diagnosticStream = app.process().stderr
  diagnosticStream?.on('data', pagingDiagnostic.accept)
  const runtime = await app.evaluate(({app}) => ({executable:process.execPath,app:app.getAppPath(),profile:app.getPath('userData')}))
  if (runtime.profile !== profile || !developmentTestHarness && !runtime.app.endsWith('.asar')) throw new Error('Replay scale runtime identity differs.')
  report.runtime = {executableSha256:(await hashCandidateFile(runtime.executable)).sha256,asarSha256:developmentTestHarness ? null : (await hashCandidateFile(runtime.app)).sha256}
  const page = await app.firstWindow()
  await page.getByTestId('app-shell').waitFor({ timeout: 60000 })
  /** Traverse every page through public IPC and retain each raw response before independent comparison. */
  const traverse = async (lane, selectedTime, archiveSession = null) => {
    const oracle = createReplayScaleOracle(database, missionId, selectedTime)
    let cursor = null
    let pages = 0
    const seen = new Set()
    try {
      do {
        const query = { missionId, selectedTime, timezone: 'Europe/Dublin', trackLimit: 1000, ...(cursor ? { cursor } : {}) }
        const result = await page.evaluate(async ({query,archiveSession}) => archiveSession
          ? window.sartrackerElectron.archiveReview.read({sessionId:archiveSession,requestId:crypto.randomUUID(),method:'readMissionReplayTrackChunk',input:query})
          : window.sartrackerElectron.missionStore.readMissionReplayTrackChunk(query,crypto.randomUUID()), {query,archiveSession})
        await output.writeFile(JSON.stringify({lane,query,result}) + '\n')
        oracle.accept(result)
        pages++
        cursor = result.nextCursor
        if (pages > 10000 || cursor !== null && (typeof cursor !== 'string' || seen.has(cursor))) throw new Error('Replay scale continuation did not advance.')
        if (cursor !== null) seen.add(cursor)
      } while (cursor !== null)
      report.lanes.push({lane,selectedTime,pages,...oracle.finish()})
    } finally { oracle.close() }
  }
  for (const [name,time] of Object.entries(report.times)) await traverse(`live-${name}`,time)
  // This intentional guard rejection is not evidence of an unexpected paging failure.
  await app.evaluate(() => { process.env.SARTRACKER_REPLAY_PAGING_DIAGNOSTICS = '0' })
  let concurrent
  try {
    concurrent = await page.evaluate(async ({missionId,after}) => {
      const store = window.sartrackerElectron.missionStore
      const query = {missionId,selectedTime:after,timezone:'Europe/Dublin',trackLimit:1000}
      const first = await store.readMissionReplayTrackChunk(query,crypto.randomUUID())
      if (!first.nextCursor) throw new Error('Replay concurrency probe requires continuation.')
      await store.upsertDrawing({mission_id:missionId,type:'search_area',name:'Replay concurrent generation change',color:'#ff7700',display_order:1,geometry_json:JSON.stringify({type:'Polygon',coordinates:[[[-9.7,52],[-9.69,52],[-9.69,52.01],[-9.7,52]]]})})
      let error = null
      try { await store.readMissionReplayTrackChunk({...query,cursor:first.nextCursor},crypto.randomUUID()) } catch (failure) { error = String(failure) }
      return {cursor:first.nextCursor,error}
    }, {missionId,after})
  } finally {
    await app.evaluate(() => { process.env.SARTRACKER_REPLAY_PAGING_DIAGNOSTICS = '1' })
  }
  report.concurrent = concurrent
  if (!concurrent.error?.includes('changed while paging')) throw new Error('Replay stale generation was not rejected after concurrent write.')
  await traverse('live-after-concurrent',after)
  const archive = await page.evaluate(async missionId => {
    const store = window.sartrackerElectron.missionStore
    await store.finishMission(missionId)
    const issuance = await store.issueMissionArchiveRecoveryCode(missionId)
    const finalized = await store.finalizeMission(missionId,{operationId:issuance.operationId,recoveryCode:issuance.recoveryCode,passphrase:'Synthetic replay scale archive passphrase 2026!'})
    return finalized.archive
  },missionId)
  const opened = await page.evaluate(async archiveId => window.sartrackerElectron.archiveReview.open({operationId:crypto.randomUUID(),archiveId,containerVersion:2,slotType:'passphrase',secret:'Synthetic replay scale archive passphrase 2026!'}),archive.id)
  sessionId = opened.sessionId
  if (opened.immutable !== true || opened.verified !== true) throw new Error('Replay scale archive is not verified immutable custody.')
  report.archive = {id:archive.id,verified:opened.verified,immutable:opened.immutable}
  for (const [name,time] of Object.entries(report.times)) await traverse(`archive-${name}`,time,sessionId)
  await page.evaluate(id => window.sartrackerElectron.archiveReview.close({sessionId:id}),sessionId)
  sessionId = null
  report.cleanup.reviewClosed = true
  await page.screenshot({path:path.join(evidencePath,'replay-scale-runtime.png'),fullPage:true})
  return report
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); throw error }
finally {
  try {
    if (output) { await output.close(); report.rows = await hashCandidateFile(path.join(evidencePath,'replay-pages.ndjson')) }
    if (app) { await app.close(); report.cleanup.applicationClosed = true }
  } finally {
    // Only after a failed verdict: allow terminal stderr to arrive without retrying work.
    const diagnosticDrained = report.failure?.includes('Mission replay evidence changed while paging.')
      ? await waitForPackagedStderrDrain(diagnosticStream, 500) : false
    diagnosticStream?.off('data', pagingDiagnostic.accept)
    const diagnostic = diagnosticDrained ? pagingDiagnostic.forFailure(report.failure) : null
    if (diagnostic !== null) report.pagingDiagnostic = diagnostic
    if (database) database.close()
    await rm(profile,{recursive:true,force:true})
    report.cleanup.profileRemoved = true
    await writeFile(path.join(evidencePath,'replay-scale-report.json'),JSON.stringify(report,null,2))
  }
}
}
