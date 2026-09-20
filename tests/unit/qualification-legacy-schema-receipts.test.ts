// @vitest-environment node
import { createRequire } from 'node:module'
import { copyFile,mkdir,mkdtemp,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect,it } from 'vitest'
import { materializeLegacySchema,inspectMigratedHistoricalFixture } from '../../scripts/qualification/legacy-schema-fixtures.mjs'
import { validateLegacySchemaReceipt } from '../../scripts/qualification/legacy-schema-receipts.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
const {createElectronMissionStore} = require('../../electron/mission-store.cjs') as {createElectronMissionStore:(options:{userDataPath:string}) => {prepareClose:()=>Promise<void>;close:()=>void}}

it('rechecks all fixed historical rows even when a mutated database has a freshly forged hash',async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'schema-receipt-unit-'))
  const expected = {evidencePath:directory,appSha256:'a'.repeat(64),asarSha256:'b'.repeat(64)}
  const cases: Array<Record<string,unknown>> = []
  try {
    for (let version=1;version<=12;version++) {
      const profile = path.join(directory,String(version))
      await mkdir(profile)
      const filename = path.join(profile,'mission-store.sqlite')
      const fixture = await materializeLegacySchema(version,filename)
      const sourcePath = path.join(profile,'source.sqlite')
      await copyFile(filename,sourcePath)
      const store = createElectronMissionStore({userDataPath:profile})
      try { await store.prepareClose() } finally { store.close() }
      const db = new Database(filename,{readonly:true,fileMustExist:true})
      let observed
      try { observed = inspectMigratedHistoricalFixture(db,fixture) } finally { db.close() }
      // Materialize a standalone snapshot after the read-only inspection's sidecars close.
      const reader = new Database(filename,{readonly:true,fileMustExist:true})
      const migratedPath = path.join(profile,'migrated.sqlite')
      try { await reader.backup(migratedPath) } finally { reader.close() }
      cases.push({version,sourceCommit:fixture.sourceCommit,missionId:fixture.missionId,runtime:{executableSha256:expected.appSha256,asarSha256:expected.asarSha256},cleanup:{applicationClosed:true,profileRemoved:true},publicMission:{id:fixture.missionId},source:await hashCandidateFile(sourcePath),migrated:await hashCandidateFile(migratedPath),observed})
    }
    // Synthetic unit receipt identities; no executable or candidate was run by this test.
    const report = {schemaVersion:1,contractId:'C19',variantId:'legacy-schema-matrix',developmentTestHarness:false,cases}
    expect((await validateLegacySchemaReceipt(report,expected)).passed).toBe(true)
    await expect(validateLegacySchemaReceipt({...report,cases:cases.slice(1)},expected)).rejects.toThrow(/envelope/)
    const identity = cases[1]!.migrated as {path:string}
    const altered = new Database(identity.path)
    altered.exec("UPDATE markers SET name='changed historical evidence'")
    altered.close()
    cases[1]!.migrated = await hashCandidateFile(identity.path)
    await expect(validateLegacySchemaReceipt(report,expected)).rejects.toThrow(/marker name changed/)
  } finally { await rm(directory,{recursive:true,force:true}) }
},30000)
