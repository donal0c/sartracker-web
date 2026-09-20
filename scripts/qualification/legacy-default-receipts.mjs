import { createRequire } from 'node:module'
import { mkdtemp,realpath,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { canonicalJson } from './control-plane.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { inspectLegacyMarkerCustody,inspectLegacyMarkerSource,inspectLegacyPositionSource } from './legacy-recovery-oracle.mjs'

/** Re-read retained source, migrated and restarted databases for the fixed default-profile recovery lane. */
export async function validateLegacyDefaultReceipt(report,expected) {
  if (report?.schemaVersion !== 1 || report.contractId !== 'C19' || report.developmentTestHarness !== false
      || !['legacy-v11-50k','legacy-v11-50k-kill','legacy-v11-local-1gib','legacy-v11-field-37gb'].includes(report.variantId) || report.variantId !== expected.variantId
      || report.failure || report.cleanup?.applicationClosed !== true || report.cleanup?.profileRemoved !== true
      || !Array.isArray(report.launches) || report.launches.length !== (report.variantId.endsWith('-kill') ? 3 : 2)) throw new Error('Legacy default recovery execution envelope differs.')
  for (const launch of report.launches) {
    if (launch.executableSha256 !== expected.appSha256 || !expected.asarSha256 || launch.asarSha256 !== expected.asarSha256
        || launch.profile !== report.profile || !Number.isSafeInteger(launch.pid) || launch.pid < 1) throw new Error('Legacy default recovery runtime identity differs.')
  }
  if (new Set(report.launches.map(row => row.pid)).size !== report.launches.length) throw new Error('Legacy recovery did not use distinct process lifetimes.')
  if (report.variantId.endsWith('-kill') && (report.interruption?.exit?.signal !== 'SIGKILL'
      || report.interruption.pid !== report.launches[0].pid || !Number.isSafeInteger(report.interruption.observedRows)
      || report.interruption.observedRows <= 0 || report.interruption.observedRows >= 50000)) throw new Error('Legacy recovery intermediate durable interruption was not observed.')
  const root = await realpath(expected.evidencePath)
  const temporary = await mkdtemp(path.join(os.tmpdir(),'sartracker-legacy-oracle-'))
  const Database = createRequire(import.meta.url)('better-sqlite3')
  try {
    const observations = []
    const positionObservations = []
    for (const key of ['fixture','migrated','restartedFile']) {
      const identity = report[key]
      if (typeof identity?.path !== 'string') throw new Error('Legacy recovery retained database is missing.')
      const actualPath = await realpath(identity.path)
      const relative = path.relative(root,actualPath)
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Legacy recovery database escapes evidence custody.')
      const actual = await hashCandidateFile(actualPath)
      if (actual.sha256 !== identity.sha256 || actual.bytes !== identity.bytes) throw new Error('Legacy recovery database identity differs.')
      const minimumBytes = report.variantId === 'legacy-v11-local-1gib' ? 1024**3 : report.variantId === 'legacy-v11-field-37gb' ? 3700000000 : 1
      if (key === 'fixture' && actual.bytes < minimumBytes) throw new Error('Legacy recovery source misses the fixed storage envelope.')
      const copied = await copyStandaloneSqliteFixture(actual,path.join(temporary,key+'.sqlite'))
      const db = new Database(copied.path,{readonly:true,fileMustExist:true})
      try {
        if (db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value !== (key === 'fixture' ? '11' : '13')) throw new Error('Legacy recovery schema boundary differs.')
        observations.push(key === 'fixture' ? inspectLegacyMarkerSource(db,report.source?.missionId) : inspectLegacyMarkerCustody(db,report.source?.missionId))
        positionObservations.push(inspectLegacyPositionSource(db,report.source?.missionId))
      } finally { db.close() }
    }
    if (observations[0].count !== 50000 || observations.some(row => row.markerSha256 !== observations[0].markerSha256)
        || observations[1].baselineSha256 !== observations[2].baselineSha256
        || canonicalJson(observations[0]) !== canonicalJson({count:report.source?.count,markerSha256:report.source?.markerSha256})
        || canonicalJson(observations[1]) !== canonicalJson(report.settled) || canonicalJson(observations[2]) !== canonicalJson(report.restarted)) throw new Error('Legacy recovery retained rows disagree with raw report or original custody.')
    if (positionObservations.some(row => canonicalJson(row) !== canonicalJson(positionObservations[0]))
        || canonicalJson(positionObservations) !== canonicalJson([report.sourcePositions,report.settledPositions,report.restartedPositions])) throw new Error('Legacy recovery original GPS payload differs.')
    if (['legacy-v11-local-1gib','legacy-v11-field-37gb'].includes(report.variantId) && positionObservations[0].count < 1000) throw new Error('Large legacy fixture lacks real tracking evidence.')
    return {passed:true,status:'PASS',failureReasons:[],scope:'default app schema-v11 50000-marker recovery and restart custody',observations,positionObservations}
  } finally { await rm(temporary,{recursive:true,force:true}) }
}
