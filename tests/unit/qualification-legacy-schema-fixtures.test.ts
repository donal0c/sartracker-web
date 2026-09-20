// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect,it } from 'vitest'
import { materializeLegacySchema,inspectMigratedHistoricalFixture } from '../../scripts/qualification/legacy-schema-fixtures.mjs'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
const {createElectronMissionStore} = require('../../electron/mission-store.cjs') as {createElectronMissionStore:(options:{userDataPath:string}) => {prepareClose:()=>Promise<void>;close:()=>void}}

it.each(Array.from({length:12},(_,index) => index+1))('migrates retained schema %i without changing original marker fields',async version => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'historical-schema-'))
  try {
    const filename = path.join(directory,'mission-store.sqlite')
    const fixture = await materializeLegacySchema(version,filename)
    const store = createElectronMissionStore({userDataPath:directory})
    try { await store.prepareClose() } finally { store.close() }
    const db = new Database(filename,{readonly:true,fileMustExist:true})
    try { expect(inspectMigratedHistoricalFixture(db,fixture).markerId).toBe(fixture.markerId) } finally { db.close() }
  } finally { await rm(directory,{recursive:true,force:true}) }
})
