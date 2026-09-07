import { EventEmitter } from 'node:events'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { linkSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serialize } from 'node:v8'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startArchiveCorrectionAttachmentRecovery } from '../../electron/archive-correction-custody-recovery-runner.cjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  createCorrectionAttachmentCustodyPlan,
  readCorrectionAttachmentCustody,
  writeCorrectionAttachmentCustody,
} = require('../../electron/archive-correction-custody.cjs')
const { deriveArchiveLifecycleEventId } = require(
  '../../electron/mission-finalization-boundary.cjs',
)

type RecoveryOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

type FakeUtility = EventEmitter & {
  readonly postMessage: ReturnType<typeof vi.fn>
  readonly kill: ReturnType<typeof vi.fn>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive correction custody recovery runner', () => {
  it('waits for an identity-bound utility result and physical exit', async () => {
    const utility = fakeUtility()
    const databasePath = testDatabasePath()
    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath,
      createUtilityProcess: () => utility,
    }) as RecoveryOperation

    expect(utility.postMessage).not.toHaveBeenCalled()
    emitReady(utility, databasePath)
    expect(utility.postMessage.mock.calls[0][0]).toMatchObject({
      type: 'start',
      request: { databaseName: 'mission-store.sqlite' },
    })
    expect(utility.postMessage.mock.calls[0][0]).not.toHaveProperty('cancellationBuffer')
    expect(() => serialize(utility.postMessage.mock.calls[0][0])).not.toThrow()
    utility.emit('message', { type: 'complete', recovered: 2 })
    let settled = false
    void operation.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    utility.emit('exit', 0)

    await expect(operation).resolves.toEqual({ recovered: 2 })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('terminates a post-terminal utility without discarding its valid completion', async () => {
    const utility = fakeUtility()
    const databasePath = testDatabasePath()
    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath,
      createUtilityProcess: () => utility,
    }) as RecoveryOperation
    emitReady(utility, databasePath)
    utility.emit('message', { type: 'complete', recovered: 1 })

    operation.cancel()
    const completion = expect(operation).resolves.toEqual({ recovered: 1 })
    utility.emit('exit', 1)

    await completion
    expect(utility.kill).toHaveBeenCalledOnce()
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('terminates a utility that reported an error without changing the rejection', async () => {
    const utility = fakeUtility()
    const databasePath = testDatabasePath()
    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath,
      createUtilityProcess: () => utility,
    }) as RecoveryOperation
    emitReady(utility, databasePath)
    utility.emit('message', {
      type: 'error',
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })

    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    operation.cancel()
    expect(utility.kill).toHaveBeenCalledOnce()
    utility.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('cancels an in-progress recovery cooperatively before termination', async () => {
    vi.useFakeTimers()
    try {
      const utility = fakeUtility()
      const databasePath = testDatabasePath()
      const operation = startArchiveCorrectionAttachmentRecovery({
        databasePath,
        createUtilityProcess: () => utility,
      }) as RecoveryOperation
      emitReady(utility, databasePath)

      operation.cancel()
      expect(utility.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
      await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
      expect(utility.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(utility.kill).toHaveBeenCalledOnce()
      utility.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a READY identity mismatch before sending the database name', async () => {
    const utility = fakeUtility()
    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath: testDatabasePath(),
      createUtilityProcess: () => utility,
    }) as RecoveryOperation

    utility.emit('message', { type: 'ready', directoryIdentity: { dev: '0', ino: '1' } })
    expect(utility.postMessage).not.toHaveBeenCalled()
    expect(utility.kill).toHaveBeenCalledOnce()
    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    utility.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('reconciles SQLite custody without deleting an uncommitted exact pair', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sartracker-correction-recovery-utility-'))
    roots.push(root)
    const missionId = '11111111-1111-4111-8111-111111111111'
    const archiveId = '22222222-2222-4222-8222-222222222222'
    const operationId = '33333333-3333-4333-8333-333333333333'
    const databasePath = path.join(root, 'mission-store.sqlite')
    const attachmentRoot = path.join(root, 'missions', missionId, 'attachments')
    mkdirSync(attachmentRoot, { recursive: true })
    const bytes = Buffer.from('retained recovery evidence')
    const database = new Database(databasePath)
    database.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE mission_events (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL, details_json TEXT NOT NULL
      );
      CREATE TABLE mission_archives (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
        protected_finalization_epoch INTEGER, archive_kind TEXT NOT NULL,
        container_version INTEGER NOT NULL, status TEXT NOT NULL,
        request_event_rowid INTEGER NOT NULL
      );`)
    database.prepare('INSERT INTO missions (id, status) VALUES (?, ?)')
      .run(missionId, 'finalized')
    const finalization = database.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json
    ) VALUES (?, ?, 'mission_finalized', ?, ?)`).run(
      deriveArchiveLifecycleEventId(archiveId, 'mission-finalized'),
      missionId,
      '2026-09-07T10:00:00.000Z',
      JSON.stringify({
        archive_id: archiveId,
        archive_relative_path: `${archiveId}.sararch`,
        cleanup_membership_generation: 0,
        container_version: 2,
        resulting_status: 'finalized',
      }),
    )
    database.prepare(`INSERT INTO mission_archives (
      id, mission_id, protected_finalization_epoch, archive_kind,
      container_version, status, request_event_rowid
    ) VALUES (?, ?, NULL, 'finalized', 2, 'verified', ?)`).run(
      archiveId,
      missionId,
      Number(finalization.lastInsertRowid),
    )
    const targetIdentity = lstatSync(attachmentRoot, { bigint: true })
    const plan = createCorrectionAttachmentCustodyPlan({
      missionId,
      archiveId,
      operationId,
      finalizedEpoch: Number(finalization.lastInsertRowid),
      targetIdentity: {
        dev: targetIdentity.dev.toString(),
        ino: targetIdentity.ino.toString(),
      },
      mappings: [{
        entryName: 'attachments/field.jpg',
        sourceRelativePath: 'Field Photo.jpg',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
        references: [{ referenceId: 'marker-1', referenceKind: 'marker' }],
      }],
    })
    const [entry] = plan.entries
    const peerPath = path.join(attachmentRoot, entry.peerName)
    const targetPath = path.join(attachmentRoot, entry.targetName)
    writeFileSync(peerPath, bytes, { mode: 0o600 })
    linkSync(peerPath, targetPath)
    writeCorrectionAttachmentCustody(database, plan)
    database.close()

    const operation = startArchiveCorrectionAttachmentRecovery({
      databasePath,
      createUtilityProcess: createNodeUtilityProcess,
    }) as RecoveryOperation

    await expect(operation).resolves.toEqual({ recovered: 1 })
    await expect(operation.workerExited).resolves.toBeUndefined()
    const reopened = new Database(databasePath)
    expect(readCorrectionAttachmentCustody(reopened)).toBeNull()
    reopened.close()
    expect(lstatSync(targetPath).nlink).toBe(2)
    expect(lstatSync(peerPath).ino).toBe(lstatSync(targetPath).ino)
  })
})

function fakeUtility(): FakeUtility {
  const utility = new EventEmitter() as FakeUtility
  Object.defineProperties(utility, {
    postMessage: { value: vi.fn() },
    kill: { value: vi.fn(() => true) },
  })
  return utility
}

function testDatabasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sartracker-correction-recovery-runner-'))
  roots.push(root)
  return path.join(root, 'mission-store.sqlite')
}

function emitReady(utility: FakeUtility, databasePath: string): void {
  const stat = lstatSync(path.dirname(databasePath), { bigint: true })
  utility.emit('message', {
    type: 'ready',
    directoryIdentity: { dev: stat.dev.toString(), ino: stat.ino.toString() },
  })
}

function createNodeUtilityProcess(input: {
  readonly modulePath: string
  readonly cwd: string
}) {
  const fixturePath = path.join(
    process.cwd(),
    'tests/fixtures/electron-utility-process-child.cjs',
  )
  const child = fork(fixturePath, [input.modulePath], {
    cwd: input.cwd,
    serialization: 'advanced',
    silent: true,
  }) as ReturnType<typeof fork> & { postMessage: (message: unknown) => void }
  child.postMessage = (message: unknown) => {
    child.send(message)
  }
  return child
}
