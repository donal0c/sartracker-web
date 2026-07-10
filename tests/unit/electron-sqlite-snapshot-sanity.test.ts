import { mkdtemp, open, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  SQLITE_HEADER_BYTES,
  validateSqliteSnapshotSanity,
} = require('../../electron/sqlite-snapshot-sanity.cjs') as {
  readonly SQLITE_HEADER_BYTES: number
  readonly validateSqliteSnapshotSanity: (filePath: string, label: string) => Promise<void>
}

const FIELD_FIXTURE_BYTES = 3_704_676_352
const PAGE_SIZE = 4_096

describe('bounded SQLite snapshot sanity validation [DON-240]', () => {
  let tempDirectory: string | undefined

  afterEach(async () => {
    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('accepts a field-scale sparse snapshot after reading only its fixed header contract', async () => {
    const snapshotPath = await createSparseSnapshot(FIELD_FIXTURE_BYTES)

    expect(SQLITE_HEADER_BYTES).toBe(100)
    await expect(
      validateSqliteSnapshotSanity(snapshotPath, 'Rolling mission backup'),
    ).resolves.toBeUndefined()
  })

  it('rejects a corrupt SQLite signature and a truncated page set', async () => {
    const snapshotPath = await createSparseSnapshot(PAGE_SIZE * 2)
    const handle = await open(snapshotPath, 'r+')
    await handle.write(Buffer.from('Not SQLite data!'), 0, 16, 0)
    await handle.close()

    await expect(
      validateSqliteSnapshotSanity(snapshotPath, 'Rolling mission backup'),
    ).rejects.toThrow(/SQLite header signature/)

    await writeSqliteHeader(snapshotPath, PAGE_SIZE * 2)
    await truncate(snapshotPath, PAGE_SIZE * 2 - 1)
    await expect(
      validateSqliteSnapshotSanity(snapshotPath, 'Rolling mission backup'),
    ).rejects.toThrow(/page count does not match file size/)
  })

  async function createSparseSnapshot(size: number): Promise<string> {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-snapshot-sanity-'))
    const snapshotPath = path.join(tempDirectory, 'mission-store.backup.sqlite')
    await writeFile(snapshotPath, Buffer.alloc(0))
    await truncate(snapshotPath, size)
    await writeSqliteHeader(snapshotPath, size)
    return snapshotPath
  }
})

async function writeSqliteHeader(filePath: string, fileSize: number): Promise<void> {
  const header = Buffer.alloc(100)
  header.write('SQLite format 3\0', 0, 'binary')
  header.writeUInt16BE(PAGE_SIZE, 16)
  header.writeUInt8(1, 18)
  header.writeUInt8(1, 19)
  header.writeUInt32BE(fileSize / PAGE_SIZE, 28)
  const handle = await open(filePath, 'r+')
  await handle.write(header, 0, header.length, 0)
  await handle.close()
}
