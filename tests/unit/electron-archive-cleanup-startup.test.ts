import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { startInterruptedMissionCleanupRecovery } = require(
  '../../electron/archive-cleanup-startup.cjs',
) as {
  readonly startInterruptedMissionCleanupRecovery: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<{
    readonly started: boolean
    readonly count: number
    readonly completion: Promise<void>
  }>
}

const FIRST_OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_OPERATION_ID = '22222222-2222-4222-8222-222222222222'

describe('archive cleanup startup recovery [DON-253]', () => {
  it('does not reserve the review lane when no operator-started cleanup is interrupted', async () => {
    const missionStore = {
      listInterruptedMissionCleanups: vi.fn(async () => []),
      resumeMissionCleanup: vi.fn(),
    }
    const sessionManager = { acquireCleanupLease: vi.fn() }

    const recovery = await startInterruptedMissionCleanupRecovery({
      missionStore,
      sessionManager,
      randomUUID: vi.fn(),
      onFailure: vi.fn(),
    })

    expect(recovery).toMatchObject({ started: false, count: 0 })
    await expect(recovery.completion).resolves.toBeUndefined()
    expect(sessionManager.acquireCleanupLease).not.toHaveBeenCalled()
    expect(missionStore.resumeMissionCleanup).not.toHaveBeenCalled()
  })

  it('acquires one lease before returning and resumes journals sequentially off startup', async () => {
    let releaseFirst: (() => void) | undefined
    const firstCompletion = new Promise<void>((resolve) => { releaseFirst = resolve })
    const operationIds = [FIRST_OPERATION_ID, SECOND_OPERATION_ID]
    const releaseLease = vi.fn()
    const missionStore = {
      listInterruptedMissionCleanups: vi.fn(async () => [
        { missionId: 'mission-1', archiveId: 'archive-1' },
        { missionId: 'mission-2', archiveId: 'archive-2' },
      ]),
      resumeMissionCleanup: vi.fn(async (identity, context) => {
        expect(context).toEqual({
          operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          reviewActivity: false,
          onProgress: expect.any(Function),
        })
        if (identity.missionId === 'mission-1') await firstCompletion
        return { state: 'completed' }
      }),
    }
    const sessionManager = {
      acquireCleanupLease: vi.fn(() => ({ missionId: 'mission-1', release: releaseLease })),
    }

    const recovery = await startInterruptedMissionCleanupRecovery({
      missionStore,
      sessionManager,
      randomUUID: () => String(operationIds.shift()),
      onFailure: vi.fn(),
    })

    expect(recovery).toMatchObject({ started: true, count: 2 })
    expect(sessionManager.acquireCleanupLease).toHaveBeenCalledWith('mission-1')
    expect(missionStore.resumeMissionCleanup).toHaveBeenCalledTimes(1)
    expect(releaseLease).not.toHaveBeenCalled()
    releaseFirst?.()
    await recovery.completion
    expect(missionStore.resumeMissionCleanup).toHaveBeenNthCalledWith(1, {
      missionId: 'mission-1', archiveId: 'archive-1',
    }, expect.objectContaining({ operationId: FIRST_OPERATION_ID }))
    expect(missionStore.resumeMissionCleanup).toHaveBeenNthCalledWith(2, {
      missionId: 'mission-2', archiveId: 'archive-2',
    }, expect.objectContaining({ operationId: SECOND_OPERATION_ID }))
    expect(releaseLease).toHaveBeenCalledOnce()
  })

  it('records only a stable code, continues later journals and always releases the lease', async () => {
    const onFailure = vi.fn()
    const release = vi.fn()
    const missionStore = {
      listInterruptedMissionCleanups: vi.fn(async () => [
        { missionId: 'mission-1', archiveId: 'archive-1' },
        { missionId: 'mission-2', archiveId: 'archive-2' },
      ]),
      resumeMissionCleanup: vi.fn(async ({ missionId }) => {
        if (missionId === 'mission-1') {
          throw Object.assign(new Error('/private/path and secret'), {
            code: 'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
          })
        }
        return { state: 'completed' }
      }),
    }

    const recovery = await startInterruptedMissionCleanupRecovery({
      missionStore,
      sessionManager: {
        acquireCleanupLease: vi.fn(() => ({ missionId: 'mission-1', release })),
      },
      randomUUID: vi.fn()
        .mockReturnValueOnce(FIRST_OPERATION_ID)
        .mockReturnValueOnce(SECOND_OPERATION_ID),
      onFailure,
    })
    await recovery.completion

    expect(missionStore.resumeMissionCleanup).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledWith({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      code: 'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
    })
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('/private/path')
    expect(release).toHaveBeenCalledOnce()
  })
})
