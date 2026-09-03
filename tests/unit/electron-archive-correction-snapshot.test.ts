import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  it('does not accept a completion message when the worker exits non-zero', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-exit-'))
    roots.push(root)
    const sourcePath = path.join(root, 'mission-store.sqlite')
    await writeFile(sourcePath, 'mission bytes')
    const sourceIdentity = await stat(sourcePath)
    const expectedSha256 = createHash('sha256').update('mission bytes').digest('hex')
    const worker = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      terminate: vi.fn(() => Promise.resolve(0)),
    })

    const operation = startArchiveCorrectionSnapshot({
      sourcePath,
      sourceIdentity: {
        dev: sourceIdentity.dev,
        ino: sourceIdentity.ino,
        sizeBytes: sourceIdentity.size,
      },
      expectedSha256,
      stagingDirectory: path.join(root, 'staging'),
      snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
      attachmentDirectory: path.join(root, 'staging', 'attachments'),
      attachmentMappings: [],
      createWorker: () => worker,
    })
    queueMicrotask(() => {
      worker.emit('message', {
        type: 'complete',
        snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
        attachmentDirectory: path.join(root, 'staging', 'attachments'),
        attachmentMappings: [],
        databaseIdentity: {
          dev: sourceIdentity.dev,
          ino: sourceIdentity.ino,
          sizeBytes: sourceIdentity.size,
        },
        databaseSha256: expectedSha256,
      })
      worker.emit('exit', 1)
    })

    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
    })
  })

  it('does not accept completion after an abort in the completion-to-exit window', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-abort-window-'))
    roots.push(root)
    const sourcePath = path.join(root, 'mission-store.sqlite')
    await writeFile(sourcePath, 'mission bytes')
    const sourceIdentity = await stat(sourcePath)
    const expectedSha256 = createHash('sha256').update('mission bytes').digest('hex')
    const controller = new AbortController()
    const worker = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      terminate: vi.fn(() => {
        queueMicrotask(() => worker.emit('exit', 0))
        return Promise.resolve(0)
      }),
    })

    const operation = startArchiveCorrectionSnapshot({
      sourcePath,
      sourceIdentity: {
        dev: sourceIdentity.dev,
        ino: sourceIdentity.ino,
        sizeBytes: sourceIdentity.size,
      },
      expectedSha256,
      stagingDirectory: path.join(root, 'staging'),
      snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
      attachmentDirectory: path.join(root, 'staging', 'attachments'),
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    queueMicrotask(() => {
      worker.emit('message', {
        type: 'complete',
        snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
        attachmentDirectory: path.join(root, 'staging', 'attachments'),
        attachmentMappings: [],
        databaseIdentity: {
          dev: sourceIdentity.dev,
          ino: sourceIdentity.ino,
          sizeBytes: sourceIdentity.size,
        },
        databaseSha256: expectedSha256,
      })
      controller.abort()
    })

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels the snapshot worker when its operation signal aborts after startup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-cancel-'))
    roots.push(root)
    const sourcePath = path.join(root, 'mission-store.sqlite')
    await writeFile(sourcePath, 'mission bytes')
    const sourceIdentity = await stat(sourcePath)
    const controller = new AbortController()
    const postMessage = vi.fn()
    const terminate = vi.fn(() => {
      queueMicrotask(() => worker.emit('exit', 0))
      return Promise.resolve(0)
    })
    const worker = Object.assign(new EventEmitter(), { postMessage, terminate })

    const operation = startArchiveCorrectionSnapshot({
      sourcePath,
      sourceIdentity: {
        dev: sourceIdentity.dev,
        ino: sourceIdentity.ino,
        sizeBytes: sourceIdentity.size,
      },
      expectedSha256: createHash('sha256').update('mission bytes').digest('hex'),
      stagingDirectory: path.join(root, 'staging'),
      snapshotPath: path.join(root, 'staging', 'mission-store.sqlite'),
      attachmentDirectory: path.join(root, 'staging', 'attachments'),
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    controller.abort()

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    expect(postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(terminate).toHaveBeenCalled()
    await expect((operation as { readonly workerExited: Promise<void> }).workerExited)
      .resolves.toBeUndefined()
  })

  it('copies and re-authenticates the database and every attachment off the main isolate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-snapshot-'))
    roots.push(root)
    const sourcePath = path.join(root, 'review', 'mission-store.sqlite')
    const sourceAttachment = path.join(root, 'review', 'attachments', '00000001-field.jpg')
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
        entryName: 'attachments/00000001-field.jpg',
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
    await expect(readFile(path.join(stagingDirectory, 'attachments', '00000001-field.jpg'), 'utf8'))
      .resolves.toBe('archived attachment')
  }, 20_000)

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
