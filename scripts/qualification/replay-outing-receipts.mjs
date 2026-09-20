import { createRequire } from 'node:module'
import { mkdtemp,realpath,rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'

/** Reconcile complete fixed 201-outing pages and the exact searched identity without trusting passed flags. */
export function validateReplayOutingFacts(report,expectedIds) {
  if (expectedIds.length !== 201 || new Set(expectedIds).size !== 201) throw new Error('Replay outing source is not the fixed 201-outing envelope.')
  const expected = [...expectedIds].sort()
  for (const lane of ['live','archive']) {
    const facts = report[lane]
    if (!facts || facts.first?.availableOutingTotalCount !== 201 || !Array.isArray(facts.pages) || facts.pages.length !== 2) throw new Error('Replay outing pagination is incomplete.')
    if (facts.first.missionId !== report.missionId || facts.first.selectedTime !== report.selectedTime) throw new Error('Replay outing temporal or mission identity differs.')
    const rows = [...facts.first.availableOutingIds]
    if (rows.length !== 100 || typeof facts.first.availableOutingNextCursor !== 'string') throw new Error('Replay outing first page differs.')
    let cursor = facts.first.availableOutingNextCursor
    for (const [index,page] of facts.pages.entries()) {
      if (page.query.filterCursor !== cursor || page.query.missionId !== report.missionId || page.query.selectedTime !== report.selectedTime
          || page.query.filterKind !== 'outing' || page.query.filterLimit !== 100 || page.query.replayGeneration !== facts.first.replayGeneration
          || page.result.totalCount !== 201 || page.result.entries.length !== (index === 0 ? 100 : 1)) throw new Error('Replay outing continuation differs.')
      rows.push(...page.result.entries)
      cursor = page.result.nextCursor
    }
    if (cursor !== null || JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('Replay outing identities were dropped, repeated or reordered.')
    if (facts.search?.totalCount !== 1 || facts.search.search !== expected.at(-1) || JSON.stringify(facts.search.entries) !== JSON.stringify([expected.at(-1)])) throw new Error('Replay outing search did not reach the final identity.')
  }
  if (report.archive?.verified !== true || report.archive?.immutable !== true) throw new Error('Replay outing archive was not verified immutable.')
  if (report.ui?.initialTotal !== '201' || report.ui?.searchedIdentity !== expected.at(-1) || report.ui?.searchFound !== true) throw new Error('Replay outing rendered filter evidence is incomplete.')
}

/** Bind actual runtime identity and independently recover the fixed GPX outing universe from retained SQLite. */
export async function validateReplayOutingReceipt(report,expected) {
  if (report?.schemaVersion !== 1 || report.contractId !== 'C10' || report.variantId !== 'replay-201-outings'
      || report.developmentTestHarness !== false || report.failure || report.runtime?.executableSha256 !== expected.appSha256
      || !expected.asarSha256 || report.runtime?.asarSha256 !== expected.asarSha256
      || report.cleanup?.applicationClosed !== true || report.cleanup?.reviewClosed !== true || report.cleanup?.profileRemoved !== true) throw new Error('Replay outing execution envelope differs.')
  const root = await realpath(expected.evidencePath)
  const filename = await realpath(report.fixture.path)
  const relative = path.relative(root,filename)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Replay outing fixture escapes evidence custody.')
  const actual = await hashCandidateFile(filename)
  if (actual.sha256 !== report.fixture.sha256 || actual.bytes !== report.fixture.bytes) throw new Error('Replay outing fixture identity differs.')
  const temporary = await mkdtemp(path.join(os.tmpdir(),'sartracker-outing-oracle-'))
  let db
  try {
    const copy = await copyStandaloneSqliteFixture(actual,path.join(temporary,'source.sqlite'))
    const Database = createRequire(import.meta.url)('better-sqlite3')
    db = new Database(copy.path,{readonly:true,fileMustExist:true})
    validateReplayOutingFacts(report,inspectReplayOutingSource(db,report.missionId,report.selectedTime))
    return {passed:true,status:'PASS',failureReasons:[],scope:'201 eligible GPX outing filter continuation/search through live and verified archive IPC plus rendered search'}
  } finally { db?.close(); await rm(temporary,{recursive:true,force:true}) }
}

/** Derive every expected outing from fixed source filenames, exact points and current complete revisions. */
export function inspectReplayOutingSource(db,missionId,selectedTime) {
    if (!Number.isFinite(Date.parse(selectedTime))) throw new Error('Replay outing selected time is invalid.')
    const imports = db.prepare('SELECT id,file_name FROM gpx_track_imports WHERE mission_id=? ORDER BY file_name').all(missionId)
    if (imports.length !== 201) throw new Error('Replay outing import universe differs.')
    const ids = []
    for (const [index,entry] of imports.entries()) {
      if (entry.file_name !== `replay-outing-${String(index).padStart(3,'0')}.gpx`) throw new Error('Replay outing fixed file identity differs.')
      const revision = db.prepare('SELECT * FROM gpx_import_revisions WHERE import_id=? ORDER BY revision_sequence DESC LIMIT 1').get(entry.id)
      const points = db.prepare('SELECT * FROM gpx_evidence_points WHERE import_id=? AND revision_sequence=? ORDER BY segment_index,point_index').all(entry.id,revision.source_revision_sequence)
      if (revision.import_state !== 'complete' || revision.mission_id !== missionId || typeof revision.outing_id !== 'string' || revision.recorded_at > selectedTime
          || points.length !== 2 || points.some((point,pointIndex) => point.lat !== 52+index*0.000001+pointIndex*0.0000001 || point.lon !== -9.7
          || point.source_time !== new Date(Date.parse('2026-01-01T00:00:00.000Z')+index*60000+(pointIndex+1)*1000).toISOString())) throw new Error('Replay outing source point or assignment differs.')
      ids.push(revision.outing_id)
    }
    return ids
}
