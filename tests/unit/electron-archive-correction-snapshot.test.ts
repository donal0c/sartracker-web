import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { startArchiveCorrectionSnapshot } = require(
  '../../electron/archive-correction-snapshot-runner.cjs',
) as {
  readonly startArchiveCorrectionSnapshot: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive correction snapshot worker', () => {
  it('copies and re-authenticates the database and every attachment off the main isolate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-'))
    roots.push(root)
    const sourcePath = path.join(root, 'review', 'mission-store.sqlite')
    const sourceAttachment = path.join(root, 'review', 'attachments', 'field.jpg')
    const stagingDirectory = path.join(root, 'staging')
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a)
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(path.dirname(sourceAttachment), { recursive: true })
    await writeFile(sourcePath, bytes)
    await writeFile(sourceAttachment, 'archived attachment')
    const sourceIdentity = await stat(sourcePath)
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')

    const result = await startArchiveCorrectionSnapshot({
      sourcePath,
      sourceIdentity: {
        dev: sourceIdentity.dev,
        ino: sourceIdentity.ino,
        sizeBytes: sourceIdentity.size,
      },
      expectedSha256,
      stagingDirectory,
      snapshotPath: path.join(stagingDirectory, 'mission-store.sqlite'),
      attachmentDirectory: path.join(stagingDirectory, 'attachments'),
      attachmentMappings: [{
        entryName: 'attachments/field.jpg',
        sourceRelativePath: 'field.jpg',
        sizeBytes: Buffer.byteLength('archived attachment'),
        sha256: createHash('sha256').update('archived attachment').digest('hex'),
        references: [],
      }],
    })

    expect(result).toMatchObject({
      snapshotPath: path.join(stagingDirectory, 'mission-store.sqlite'),
      databaseSha256: expectedSha256,
    })
    await expect(readFile(path.join(stagingDirectory, 'mission-store.sqlite'))).resolves.toEqual(bytes)
    await expect(readFile(path.join(stagingDirectory, 'attachments', 'field.jpg'), 'utf8'))
      .resolves.toBe('archived attachment')
  })

  it('fails closed when the authenticated source digest is wrong', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-invalid-'))
    roots.push(root)
    const sourcePath = path.join(root, 'mission-store.sqlite')
    await writeFile(sourcePath, 'mission bytes')
    const sourceIdentity = await stat(sourcePath)

    await expect(startArchiveCorrectionSnapshot({
      sourcePath,
      sourceIdentity: {
        dev: sourceIdentity.dev,
        ino: sourceIdentity.ino,
        sizeBytes: sourceIdentity.size,
      },
      expectedSha256: 'a'.repeat(64),
      stagingDirectory: path.join(root, 'staging'),
      snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
      attachmentDirectory: path.join(root, 'staging', 'attachments'),
      attachmentMappings: [],
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED' })
  })
})
