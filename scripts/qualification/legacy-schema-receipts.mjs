import { createRequire } from 'node:module'
import { mkdtemp,realpath,rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readLegacySchema,inspectMigratedHistoricalFixture } from './legacy-schema-fixtures.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { canonicalJson } from './control-plane.mjs'

/** Independently require all twelve schemas, exact retained historical inputs and unchanged migrated evidence. */
export async function validateLegacySchemaReceipt(report,expected) {
  if (report?.schemaVersion !== 1 || report.contractId !== 'C19' || report.variantId !== 'legacy-schema-matrix'
      || report.developmentTestHarness !== false || report.failure || !Array.isArray(report.cases) || report.cases.length !== 12) throw new Error('Legacy schema matrix execution envelope differs.')
  const root = await realpath(expected.evidencePath)
  const temporary = await mkdtemp(path.join(os.tmpdir(),'sartracker-schema-oracle-'))
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const observations = []
  try {
    for (let version=1;version<=12;version++) {
      const record = report.cases[version-1]
      const fixture = await readLegacySchema(version)
      if (record.version !== version || record.sourceCommit !== fixture.sourceCommit || record.missionId !== fixture.missionId
          || record.runtime?.executableSha256 !== expected.appSha256 || !expected.asarSha256 || record.runtime?.asarSha256 !== expected.asarSha256
          || record.cleanup?.applicationClosed !== true || record.cleanup?.profileRemoved !== true
          || record.publicMission?.id !== fixture.missionId) throw new Error('Legacy schema matrix case identity or cleanup differs.')
      for (const key of ['source','migrated']) {
        const identity = record[key]
        if (typeof identity?.path !== 'string') throw new Error('Legacy schema retained database is missing.')
        const actualPath = await realpath(identity.path)
        const relative = path.relative(root,actualPath)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Legacy schema database escapes evidence custody.')
        const actual = await hashCandidateFile(actualPath)
        if (actual.sha256 !== identity.sha256 || actual.bytes !== identity.bytes) throw new Error('Legacy schema retained database identity differs.')
        const copy = await copyStandaloneSqliteFixture(actual,path.join(temporary,`${version}-${key}.sqlite`))
        const db = new Database(copy.path,{readonly:true,fileMustExist:true})
        try {
          if (key === 'source') {
            for (const [table,rows] of Object.entries(fixture.rows)) {
              const actualRows = db.prepare(`SELECT * FROM "${table}"`).all().map(canonicalJson).sort()
              if (canonicalJson(actualRows) !== canonicalJson(rows.map(canonicalJson).sort())) throw new Error('Legacy schema original fixture rows differ.')
            }
          } else {
            const observed = inspectMigratedHistoricalFixture(db,fixture)
            if (canonicalJson(observed) !== canonicalJson(record.observed)) throw new Error('Legacy schema migrated observation differs.')
            observations.push(observed)
          }
        } finally { db.close() }
      }
    }
    return {passed:true,status:'PASS',failureReasons:[],observations,scope:'default application migration of schemas1-12; schema6 explicitly synthetic compatibility, remaining historical versions source-backed'}
  } finally { await rm(temporary,{recursive:true,force:true}) }
}
