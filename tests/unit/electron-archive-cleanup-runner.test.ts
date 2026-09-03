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
})
