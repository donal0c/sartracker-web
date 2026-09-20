#!/usr/bin/env node
import { mkdir,rm,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron,expect } from '@playwright/test'
import { createReplayOutingFixture } from './replay-outing-fixture.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { validateReplayOutingFacts } from './replay-outing-receipts.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath,evidencePath] = process.argv.slice(2)
  await runReplayOutingProbe({appPath,evidencePath})
}

/** Exercise every outing filter page and the final searchable identity in the real package and archive. */
export async function runReplayOutingProbe({appPath,evidencePath,developmentTestHarness = false}) {
  if (![appPath,evidencePath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Replay outing probe requires absolute app and evidence paths.')
  await mkdir(evidencePath,{recursive:true,mode:0o700})
  const profile = path.join(evidencePath,'.profile-replay-outings')
  const report = {schemaVersion:1,contractId:'C10',variantId:'replay-201-outings',developmentTestHarness,cleanup:{},failure:null}
  let app
  try {
    const fixture = await createReplayOutingFixture(profile)
    report.missionId = fixture.missionId
    report.selectedTime = fixture.selectedTime
    report.fixture = await copyStandaloneSqliteFixture(await hashCandidateFile(path.join(profile,'mission-store.sqlite')),path.join(evidencePath,'source.sqlite'))
    const env = {...process.env,SARTRACKER_ELECTRON_USER_DATA_PATH:profile,SARTRACKER_ELECTRON_BLOCK_NETWORK:'1'}
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
    const args = process.platform === 'linux' ? ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader'] : []
    if (developmentTestHarness) args.unshift(path.join(root,'electron/main.cjs'))
    app = await electron.launch({executablePath:appPath,args,env})
    const runtime = await app.evaluate(({app}) => ({profile:app.getPath('userData'),appPath:app.getAppPath(),executablePath:process.execPath}))
    if (runtime.profile !== profile || !developmentTestHarness && !runtime.appPath.endsWith('.asar')) throw new Error('Replay outing runtime identity differs.')
    report.runtime = {...runtime,executableSha256:(await hashCandidateFile(runtime.executablePath)).sha256,asarSha256:developmentTestHarness ? null : (await hashCandidateFile(runtime.appPath)).sha256}
    const page = await app.firstWindow()
    page.setDefaultTimeout(30000)
    await page.setViewportSize({width:1440,height:900})
    await page.getByTestId('app-shell').waitFor({timeout:60000})
    /** Retain all actual public filter pages for a live or immutable archive reader. */
    const read = async sessionId => page.evaluate(async ({missionId,selectedTime,lastId,sessionId}) => {
      const bridge = window.sartrackerElectron
      const invoke = (method,input) => sessionId ? bridge.archiveReview.read({sessionId,requestId:crypto.randomUUID(),method,input}) : bridge.missionStore[method](input,crypto.randomUUID())
      const query = {missionId,selectedTime,timezone:'Europe/Dublin',trackLimit:1000,objectLimit:100}
      const first = await invoke('readMissionReplay',query)
      const pages = []
      let cursor = first.availableOutingNextCursor
      while (cursor !== null) {
        if (pages.length >= 3) throw new Error('Replay outing filter did not terminate.')
        const next = {...query,filterKind:'outing',filterLimit:100,filterCursor:cursor,replayGeneration:first.replayGeneration}
        const result = await invoke('readMissionReplayFilterPage',next)
        pages.push({query:next,result}); cursor = result.nextCursor
      }
      const search = await invoke('readMissionReplayFilterPage',{...query,filterKind:'outing',filterSearch:lastId,filterLimit:100})
      return {first,pages,search}
    },{missionId:fixture.missionId,selectedTime:fixture.selectedTime,lastId:fixture.outings.at(-1),sessionId})
    report.live = await read(null)
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button',{name:'Replay',exact:true}).click()
    await page.getByTestId('mission-replay-seek').click()
    const status = page.getByTestId('mission-replay-outing-filter-page-status')
    await expect(status).toContainText('of 201 eligible outings')
    await page.getByTestId('mission-replay-outing-filter-search').fill(fixture.outings.at(-1))
    await page.getByTestId('mission-replay-outing-filter-search-apply').click()
    await expect(status).toContainText('Showing 1 of 1 eligible outings')
    const found = page.getByTestId(`mission-replay-outing-filter-${fixture.outings.at(-1)}`)
    await expect(found).toBeVisible()
    report.ui = {initialTotal:'201',searchedIdentity:fixture.outings.at(-1),searchFound:true,statusText:await status.innerText()}
    await page.screenshot({path:path.join(evidencePath,'replay-final-outing-search.png'),fullPage:true})
    const archive = await page.evaluate(async missionId => {
      const store = window.sartrackerElectron.missionStore
      const issued = await store.issueMissionArchiveRecoveryCode(missionId)
      return (await store.finalizeMission(missionId,{operationId:issued.operationId,recoveryCode:issued.recoveryCode,passphrase:'Synthetic 201 outing archive passphrase 2026!'})).archive
    },fixture.missionId)
    const opened = await page.evaluate(id => window.sartrackerElectron.archiveReview.open({operationId:crypto.randomUUID(),archiveId:id,containerVersion:2,slotType:'passphrase',secret:'Synthetic 201 outing archive passphrase 2026!'}),archive.id)
    try {
      if (opened.immutable !== true || opened.verified !== true) throw new Error('Replay outing archive is not verified immutable evidence.')
      report.archive = {...await read(opened.sessionId),verified:opened.verified,immutable:opened.immutable}
    } finally { await page.evaluate(sessionId => window.sartrackerElectron.archiveReview.close({sessionId}),opened.sessionId); report.cleanup.reviewClosed = true }
    validateReplayOutingFacts(report,fixture.outings)
    return report
  } catch (error) { report.failure = String(error); throw error }
  finally {
    try { if (app) await app.close(); report.cleanup.applicationClosed = true }
    finally {
      if (report.failure) { report.cleanup.profileRemoved = false; report.cleanup.retainedFailureProfile = profile }
      else { await rm(profile,{recursive:true,force:true}); report.cleanup.profileRemoved = true }
      await writeFile(path.join(evidencePath,'replay-outing-report.json'),JSON.stringify(report,null,2))
    }
  }
}
