import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startArchiveCorrectionWorker } from '../../electron/archive-correction-runner.cjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (databasePath: string) => { close: () => void }
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive correction worker runner', () => {
  it('does not turn cancellation after durable completion into a false failure', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: () => Promise<number>
    }
    worker.postMessage = () => undefined
    worker.terminate = async () => 0
    const controller = new AbortController()
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      expectedSha256: 'a'.repeat(64),
      expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    controller.abort()
    worker.emit('exit', 0)
    await expect(operation).resolves.toEqual({
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
  })

  it('rejects a completion followed by a worker error or nonzero exit', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: () => Promise<number>
    }
    worker.postMessage = () => undefined
    worker.terminate = async () => 1
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      expectedSha256: 'a'.repeat(64),
      expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    worker.emit('error', new Error('late worker error'))
    worker.emit('exit', 1)
    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
  })

  it('terminates a worker after completion when shutdown cancellation arrives before exit', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: ReturnType<typeof vi.fn>
    }
    worker.postMessage = vi.fn()
    worker.terminate = vi.fn(async () => 0)
    const controller = new AbortController()
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      expectedSha256: 'a'.repeat(64),
      expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    worker.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
    })
    controller.abort()
    expect(worker.terminate).toHaveBeenCalledOnce()
    worker.emit('exit', 1)
    await expect(operation).resolves.toMatchObject({ archiveId: '11111111-1111-4111-8111-111111111111' })
  })

  it('gives a cooperative correction worker time to sweep staged custody before termination', async () => {
    vi.useFakeTimers()
    try {
      const worker = new EventEmitter() as EventEmitter & {
        postMessage: (message: unknown) => void
        terminate: ReturnType<typeof vi.fn>
      }
      worker.postMessage = vi.fn()
      worker.terminate = vi.fn(async () => 1)
      const controller = new AbortController()
      const operation = startArchiveCorrectionWorker({
        databasePath: '/tmp/mission-store.sqlite',
        snapshotPath: '/tmp/correction.sqlite',
        missionId: 'mission-1',
        archiveId: '11111111-1111-4111-8111-111111111111',
        expectedSha256: 'a'.repeat(64),
        expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
        finalizedEpoch: 1,
        adminName: 'Duty Admin',
        reason: 'Correction',
        attachmentDirectory: '/tmp/attachments',
        attachmentMappings: [],
        signal: controller.signal,
        createWorker: () => worker,
      })
      const rejection = expect(operation).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })
      controller.abort()
      expect(worker.terminate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(worker.terminate).toHaveBeenCalledOnce()
      worker.emit('exit', 1)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mask a late custody cleanup failure behind cancellation', async () => {
    const worker = new EventEmitter() as EventEmitter & {
      postMessage: (message: unknown) => void
      terminate: () => Promise<number>
    }
    worker.postMessage = () => undefined
    worker.terminate = async () => 1
    const controller = new AbortController()
    const operation = startArchiveCorrectionWorker({
      databasePath: '/tmp/mission-store.sqlite',
      snapshotPath: '/tmp/correction.sqlite',
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      expectedSha256: 'a'.repeat(64),
      expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Correction',
      attachmentDirectory: '/tmp/attachments',
      attachmentMappings: [],
      signal: controller.signal,
      createWorker: () => worker,
    })
    controller.abort()
    worker.emit('message', { type: 'error', code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED' })
    worker.emit('exit', 1)
    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
    })
  })

  it('retains its custody journal when attachment cleanup cannot be proven', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-cleanup-failure-'))
    roots.push(root)
    const databasePath = path.join(root, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.close()
    const attachmentDirectory = path.join(root, 'staged-attachments')
    await mkdir(attachmentDirectory)

    const operation = startArchiveCorrectionWorker({
      databasePath,
      snapshotPath: path.join(root, 'missing-snapshot.sqlite'),
      missionId: 'mission-1',
      archiveId: '11111111-1111-4111-8111-111111111111',
      expectedSha256: 'a'.repeat(64),
      expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      finalizedEpoch: 1,
      adminName: 'Duty Admin',
      reason: 'Cleanup proof test',
      attachmentDirectory,
      attachmentMappings: [{
        entryName: 'attachments/missing.bin',
        sourceRelativePath: 'field.bin',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        references: [],
      }],
      faultInjection: { failAttachmentCleanup: true },
    })

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED' })
    await expect(readdir(path.join(root, 'correction-attachment-journals')))
      .resolves.toHaveLength(1)
  }, 20_000)
})
