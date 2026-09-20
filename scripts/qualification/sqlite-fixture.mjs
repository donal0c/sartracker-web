import { constants } from 'node:fs'
import { copyFile, lstat, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { hashCandidateFile } from './candidate-artifacts.mjs'

/** Standalone paging fixtures must include all committed data in the bound main file. */
export async function assertStandaloneSqliteFixture(filename) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(filename + suffix) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`Standalone SQLite fixture has an unbound ${suffix} sidecar.`)
  }
}

/** Copy into an exclusively owned location before SQLite can observe adjacent files. */
export async function copyStandaloneSqliteFixture(identity, destination) {
  await assertStandaloneSqliteFixture(identity.path)
  const before = await hashCandidateFile(identity.path)
  if (before.sha256 !== identity.sha256 || before.bytes !== identity.bytes) throw new Error('SQLite fixture identity changed before copying.')
  await copyFile(before.path, destination, constants.COPYFILE_EXCL)
  const copied = await hashCandidateFile(destination)
  const after = await hashCandidateFile(before.path)
  await assertStandaloneSqliteFixture(before.path)
  if (copied.sha256 !== before.sha256 || copied.bytes !== before.bytes || after.sha256 !== before.sha256 || after.bytes !== before.bytes) throw new Error('SQLite fixture identity changed during copying.')
  return copied
}

/** Inspect an exclusive disposable copy because read-only SQLite can still create WAL sidecars. */
export async function inspectStandaloneSqliteFixture(identity, inspect) {
  const directory = await mkdtemp(path.join(path.dirname(identity.path), '.sqlite-inspection-'))
  try {
    const copied = await copyStandaloneSqliteFixture(identity, path.join(directory, 'inspection.sqlite'))
    const result = await inspect(copied.path)
    await assertStandaloneSqliteFixture(identity.path)
    const after = await hashCandidateFile(identity.path)
    if (after.sha256 !== identity.sha256 || after.bytes !== identity.bytes) throw new Error('Retained SQLite fixture changed during inspection.')
    return result
  } finally { await rm(directory, { recursive: true, force: true }) }
}
