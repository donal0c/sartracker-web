#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdir,rm,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { materializeLegacySchema,inspectMigratedHistoricalFixture } from './legacy-schema-fixtures.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath,evidencePath] = process.argv.slice(2)
  await runLegacySchemaProbe({appPath,evidencePath})
}

/** Launch each supported legacy schema through normal app startup and retain exact migrated databases. */
export async function runLegacySchemaProbe({appPath,evidencePath,developmentTestHarness = false}) {
  if (![appPath,evidencePath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Legacy schema matrix requires absolute app and owned evidence paths.')
  await mkdir(evidencePath,{recursive:true,mode:0o700})
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const report = {schemaVersion:1,contractId:'C19',variantId:'legacy-schema-matrix',developmentTestHarness,cases:[],failure:null}
  try {
    for (let version=1;version<=12;version++) {
      const directory = path.join(evidencePath,`schema-${version}`)
      const profile = path.join(directory,'.profile')
      await mkdir(profile,{recursive:true,mode:0o700})
      const filename = path.join(profile,'mission-store.sqlite')
      const fixture = await materializeLegacySchema(version,filename)
      const record = {version,sourceCommit:fixture.sourceCommit,fixtureKind:fixture.fixtureKind ?? 'historical-electron-store',missionId:fixture.missionId,cleanup:{}}
      report.cases.push(record)
      record.source = await copyStandaloneSqliteFixture(await hashCandidateFile(filename),path.join(directory,'source.sqlite'))
      let app
      try {
        const env = {...process.env,SARTRACKER_ELECTRON_USER_DATA_PATH:profile,SARTRACKER_ELECTRON_BLOCK_NETWORK:'1'}
        delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
        const args = process.platform === 'linux' ? ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader'] : []
        if (developmentTestHarness) args.unshift(path.join(root,'electron/main.cjs'))
        app = await electron.launch({executablePath:appPath,args,env})
        const runtime = await app.evaluate(({app}) => ({profile:app.getPath('userData'),appPath:app.getAppPath(),executablePath:process.execPath,pid:process.pid}))
        if (runtime.profile !== profile || !developmentTestHarness && !runtime.appPath.endsWith('.asar')) throw new Error('Historical schema default runtime identity differs.')
        record.runtime = {...runtime,executableSha256:(await hashCandidateFile(runtime.executablePath)).sha256,asarSha256:developmentTestHarness ? null : (await hashCandidateFile(runtime.appPath)).sha256}
        const page = await app.firstWindow()
        await page.getByTestId('app-shell').waitFor({timeout:60000})
        record.publicMission = await page.evaluate(id => window.sartrackerElectron.missionStore.getMission(id),fixture.missionId)
        if (record.publicMission.id !== fixture.missionId) throw new Error('Historical mission is absent from the default public store.')
        await page.screenshot({path:path.join(directory,'migrated-runtime.png'),fullPage:true})
        await app.close(); app = null; record.cleanup.applicationClosed = true
        record.migrated = await copyStandaloneSqliteFixture(await hashCandidateFile(filename),path.join(directory,'migrated.sqlite'))
        // Inspect the disposable profile copy, keeping retained evidence files standalone.
        const db = new Database(filename,{readonly:true,fileMustExist:true})
        try { record.observed = inspectMigratedHistoricalFixture(db,fixture) } finally { db.close() }
      } catch (error) { record.failure = String(error); throw error }
      finally {
        if (app) { await app.close(); record.cleanup.applicationClosed = true }
        if (record.failure) { record.cleanup.profileRemoved = false; record.cleanup.retainedFailureProfile = profile }
        else { await rm(profile,{recursive:true,force:true}); record.cleanup.profileRemoved = true }
      }
    }
    return report
  } catch (error) { report.failure = error instanceof Error ? error.message : String(error); throw error }
  finally { await writeFile(path.join(evidencePath,'legacy-schema-report.json'),JSON.stringify(report,null,2)) }
}
