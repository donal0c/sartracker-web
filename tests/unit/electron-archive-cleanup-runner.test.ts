import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { startArchiveCleanupWorker } = require(
  '../../electron/archive-cleanup-runner.cjs',
) as {
  readonly startArchiveCleanupWorker: (input: {
    readonly databasePath: string
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
    readonly expectedFileIdentity: Readonly<Record<string, unknown>>
    readonly evidence: Readonly<Record<string, unknown>>
    readonly mode: 'start' | 'resume'
    readonly operationId: string
    readonly workerPath?: string
  }) => Promise<Readonly<Record<string, unknown>>>
}

const request = Object.freeze({
  databasePath: path.resolve('/tmp/sartracker-cleanup-runner.sqlite'),
  archiveDirectory: path.resolve('/tmp/sartracker-cleanup-runner-archives'),
  archiveRelativePath: 'archive.sararch',
  expectedFileIdentity: Object.freeze({
    device: '1',
    inode: '2',
    linkCount: 1,
    sizeBytes: 4096,
    changedTimeNanoseconds: '3',
    modifiedTimeNanoseconds: '4',
  }),
  evidence: Object.freeze({
    archiveId: 'archive-a',
    missionId: 'mission-a',
  }),
  mode: 'start' as const,
  operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
})

describe('off-main archive cleanup worker [DON-253]', () => {
  it('keeps the main heartbeat alive while one worker-owned transaction is busy', async () => {
    let heartbeatTicks = 0
    const heartbeat = setInterval(() => { heartbeatTicks += 1 }, 25)
    try {
      const result = await startArchiveCleanupWorker({
        ...request,
        workerPath: path.resolve(
          'tests/fixtures/archive-cleanup-heartbeat-worker.cjs',
        ),
      })

      expect(result).toEqual({
        state: 'completed',
        storageState: 'archived',
      })
      expect(heartbeatTicks).toBeGreaterThanOrEqual(8)
    } finally {
      clearInterval(heartbeat)
    }
  }, 15_000)

  it('retains only sanitized cleanup failure attribution from a worker error', async () => {
    const failure = await startArchiveCleanupWorker({
      ...request,
      workerPath: path.resolve(
        'tests/fixtures/archive-cleanup-failure-worker.cjs',
      ),
    }).catch((error: unknown) => error as Error & {
      readonly cleanupDiagnostic?: Readonly<Record<string, unknown>>
    })
    expect(failure).toMatchObject({
      code: 'ARCHIVE_CLEANUP_FAILED',
      cleanupDiagnostic: {
        substage: 'delete_page',
        causeClass: 'sqlite_busy',
        tableName: 'positions',
        cursor: {
          tableIndex: 1,
          tableCount: 4,
          tableBatch: 2,
          deletedRows: 6,
          totalDeletedRows: 6,
        },
        workerExit: {
          observed: true,
          event: 'message',
          code: 0,
        },
      },
    })
    expect(JSON.stringify(failure.cleanupDiagnostic)).not.toMatch(/private|secret|mission\.sqlite/iu)
  })
})
