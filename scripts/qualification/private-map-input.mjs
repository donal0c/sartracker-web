import { createRequire } from 'node:module'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { assertStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { privateMapFacts } from './private-map-receipt.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

/** Rebind the controlled private-map role and independently read its source inventory. */
export async function bindPrivateMapInput(fixtures) {
  const declared = fixtures?.['private-map']
  if (!declared) throw new Error('Private-map qualification requires the bound private-map input.')
  const actual = await hashCandidateFile(declared.path)
  if (actual.sha256 !== declared.sha256 || actual.bytes !== declared.bytes) throw new Error('Private-map input identity changed.')
  await assertStandaloneSqliteFixture(actual.path)
  const database = new Database(actual.path, { readonly: true, fileMustExist: true })
  let facts
  try {
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Private-map input integrity failed.')
    facts = privateMapFacts(database)
  } finally { database.close() }
  const after = await hashCandidateFile(actual.path)
  if (after.sha256 !== actual.sha256 || after.bytes !== actual.bytes) throw new Error('Private-map input changed during admission.')
  return { ...actual, ...facts }
}
