// @vitest-environment node
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { expect,it } from 'vitest'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { validateReplayScaleFiles } from '../../scripts/qualification/replay-scale-receipts.mjs'

it('never upgrades development or a small real source into scale qualification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'replay-scale-admission-'))
  try {
    const filename = path.join(directory,'source.sqlite')
    await generateMissionStoreFixture({preset:'small',outputPath:filename,force:false})
    const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(filename)
    db.exec("UPDATE positions SET received_at=timestamp,timestamp_source='fix'")
    db.close()
    const fixture = await hashCandidateFile(filename)
    const rowsPath = path.join(directory,'pages.ndjson')
    await writeFile(rowsPath,'')
    const report = {schemaVersion:1,contractId:'C10',variantId:'replay-960k',developmentTestHarness:true,fixture,rows:await hashCandidateFile(rowsPath),cleanup:{applicationClosed:true,profileRemoved:true,reviewClosed:true},archive:{verified:true,immutable:true},concurrent:{error:'changed while paging'},passed:true}
    await expect(validateReplayScaleFiles({report,fixture,rowsPath,variantId:'replay-960k'})).rejects.toThrow(/envelope/)
    await expect(validateReplayScaleFiles({report:{...report,developmentTestHarness:false},fixture,rowsPath,variantId:'replay-960k'})).rejects.toThrow(/source envelope/)
    await writeFile(rowsPath,'forged rows\n')
    await expect(validateReplayScaleFiles({report:{...report,developmentTestHarness:false},fixture,rowsPath,variantId:'replay-960k'})).rejects.toThrow(/raw rows/)
  } finally { await rm(directory,{recursive:true,force:true}) }
})
