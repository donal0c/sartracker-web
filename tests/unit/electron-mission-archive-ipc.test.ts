import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  MISSION_ARCHIVE_PROGRESS_CHANNEL,
  registerMissionArchiveIpcHandlers,
} = require('../../electron/mission-archive-ipc.cjs') as {
  readonly MISSION_ARCHIVE_PROGRESS_CHANNEL: string
  readonly registerMissionArchiveIpcHandlers: (input: Readonly<Record<string, unknown>>) => void
}
const { readCleanupFailureDiagnosticFromMessage } = require(
  '../../electron/archive-cleanup-failure.cjs',
) as {
  readonly readCleanupFailureDiagnosticFromMessage: (message: unknown) => unknown
}
const { startArchiveCleanupWorker } = require(
  '../../electron/archive-cleanup-runner.cjs',
) as {
  readonly startArchiveCleanupWorker: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
}

const CHANNELS = Object.freeze({
  issueMissionArchiveRecoveryCode: 'sartracker:mission-store:issue-archive-recovery-code',
  finalizeMission: 'sartracker:mission-store:finalize-mission',
  unlockFinalizedMission: 'sartracker:mission-store:unlock-finalized-mission',
  restoreMissionForCorrection: 'sartracker:mission-store:restore-mission-for-correction',
  listMissionArchives: 'sartracker:mission-store:list-mission-archives',
  verifyMissionArchive: 'sartracker:mission-store:verify-mission-archive',
  getMissionCleanupEligibility: 'sartracker:mission-store:get-mission-cleanup-eligibility',
  startMissionCleanup: 'sartracker:mission-store:start-mission-cleanup',
  resumeMissionCleanup: 'sartracker:mission-store:resume-mission-cleanup',
  cancelMissionArchiveOperation: 'sartracker:mission-store:cancel-mission-archive-operation',
})

const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const PASSPHRASE = 'Four calm words 2026!'
const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_OPERATION_ID = '22222222-2222-4222-8222-222222222222'

/** Creates one sender-shaped EventEmitter for sender-scoping assertions. */
function createSender(id: number) {
  return Object.assign(new EventEmitter(), { id, send: vi.fn() })
}

/** Wraps one staged snapshot in the synchronous consumer-lease handoff shape. */
function correctionSnapshotUse(snapshot: Readonly<Record<string, unknown>>) {
  return Object.freeze({
    snapshotPromise: Promise.resolve(snapshot),
    lease: Object.freeze({ release: vi.fn() }),
  })
}

/** Creates one complete mission-shaped terminal result. */
function missionResult(missionId = 'mission-1') {
  return {
    id: missionId,
    name: 'Mission result',
    status: 'finalized',
    start_time: '2026-08-29T18:00:00.000Z',
    pause_time: null,
    finish_time: '2026-08-29T19:00:00.000Z',
    paused_seconds: 0,
    notes: null,
    schema_version: 13,
  }
}

/** Creates one complete archive-shaped terminal result. */
function archiveResult(missionId = 'mission-1') {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    mission_id: missionId,
    protected_finalization_epoch: null,
    archive_kind: 'finalized',
    container_version: 2,
    archive_path: '/safe/mission.sararch',
    ciphertext_sha256: 'a'.repeat(64),
    size_bytes: 1_024,
    created_at: '2026-08-29T20:00:00.000Z',
    verified_at: '2026-08-29T20:01:00.000Z',
    previous_archive_id: null,
    previous_archive_sha256: null,
    revision_sequence: 1,
    revision_count: 1,
    supplement_authority: null,
    supplement_reason: null,
    supplement_created_at: null,
    status: 'verified',
    availability: 'present',
    availability_reason: null,
    slots: [
      { slotId: 'passphrase-v1', slotType: 'passphrase' },
      { slotId: 'recovery-v1', slotType: 'recovery' },
    ],
    last_non_machine_unwrap_at: '2026-08-29T20:01:00.000Z',
  }
}

/** Registers the main-process boundary and returns its captured handlers. */
function createMainHarness(
  overrides: Readonly<Record<string, unknown>> = {},
  missionStoreOverrides: Readonly<Record<string, unknown>> = {},
) {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  const progressObservers: ((progress: Readonly<Record<string, unknown>>) => void)[] = []
  const missionStore = {
    finalizeMission: vi.fn(async (
      missionId: string,
      custody: Readonly<Record<string, unknown>>,
      context: { readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void },
    ) => {
      progressObservers.push(context.onProgress)
      return { mission: missionResult(missionId), archive: archiveResult(missionId), custody }
    }),
    unlockFinalizedMission: vi.fn(async (request: Readonly<Record<string, unknown>>) => ({
      id: request.mission_id,
      status: 'finished',
    })),
    restoreMissionForCorrection: vi.fn(async (request: Readonly<Record<string, unknown>>) => ({
      id: request.mission_id,
      status: 'finished',
    })),
    getCommittedArchiveCorrection: vi.fn(async () => null),
    listMissionArchives: vi.fn(async () => []),
    verifyMissionArchive: vi.fn(async () => archiveResult()),
    getMission: vi.fn(async (missionId: string) => missionResult(missionId)),
      getMissionCleanupEligibility: vi.fn(async () => ({
        eligible: false,
        startableWithCredential: true,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      })),
    startMissionCleanup: vi.fn(async () => ({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      state: 'completed',
      storageState: 'archived',
      deletedRows: 17,
    })),
    resumeMissionCleanup: vi.fn(async () => ({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      state: 'completed',
      storageState: 'archived',
      deletedRows: 17,
    })),
    cancelMissionArchiveOperation: vi.fn(async () => true),
    ...missionStoreOverrides,
  }
  const cleanupLease = { missionId: 'mission-1', release: vi.fn() }
  const archiveReviewSessionManager = ({
    hasReviewActivity: vi.fn(() => false),
    acquireCleanupLease: vi.fn(() => cleanupLease),
    beginCorrectionSnapshotUse: vi.fn(),
    completeCorrectionSnapshot: vi.fn(async () => undefined),
    ...((overrides.archiveReviewSessionManager ?? {}) as Readonly<Record<string, unknown>>),
  }) as {
    readonly hasReviewActivity: ReturnType<typeof vi.fn>
    readonly acquireCleanupLease: ReturnType<typeof vi.fn>
    readonly beginCorrectionSnapshotUse: ReturnType<typeof vi.fn>
    readonly completeCorrectionSnapshot: ReturnType<typeof vi.fn>
  }
  const issuanceLedger = new Map()
  registerMissionArchiveIpcHandlers({
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => {
        handlers.set(channel, handler)
      },
    },
    channels: CHANNELS,
    missionStore,
    validateIpcSender: vi.fn(),
    generateRecoveryCode: () => RECOVERY_CODE,
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    nowMs: () => Date.parse('2026-08-29T20:00:00.000Z'),
    issuanceLedger,
    ...overrides,
    archiveReviewSessionManager,
  })
  return {
    handlers,
    issuanceLedger,
    missionStore,
    progressObservers,
    archiveReviewSessionManager,
    cleanupLease,
  }
}

describe('mission archive IPC containment [DON-248]', () => {
  it('registers only the ten explicit archive handlers', () => {
    const { handlers } = createMainHarness()

    expect([...handlers.keys()].sort()).toEqual(Object.values(CHANNELS).sort())
    expect(handlers.size).toBe(10)
  })

  it('restores only the exact sender-owned verified session and removes its correction snapshot staging', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'sartracker-correction-ipc-'))
    const stagingDirectory = join(stagingRoot, '.sweep-11111111-1111-4111-8111-111111111111')
    await mkdir(stagingDirectory)
    const snapshotPath = join(stagingDirectory, 'mission-store.sqlite')
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    const beginCorrectionSnapshotUse = vi.fn(() => correctionUse)
    const completeCorrectionSnapshot = vi.fn(async () => {
      await rm(stagingDirectory, { recursive: true, force: true })
    })
    const { handlers, missionStore } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
        beginCorrectionSnapshotUse,
        completeCorrectionSnapshot,
      },
    })
    const event = { sender: createSender(8) }

    await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.(event, {
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444',
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })).resolves.toEqual({
      id: 'mission-1',
      status: 'finished',
      correction: {
        committed: true,
        cleanupComplete: true,
      },
    })
    expect(beginCorrectionSnapshotUse).toHaveBeenCalledWith({
      senderId: 8,
      sessionId: '44444444-4444-4444-8444-444444444444',
      operationId: OPERATION_ID,
      archiveId: 'archive-1',
      signal: expect.any(AbortSignal),
      cancel: expect.any(Function),
    })
    expect(missionStore.unlockFinalizedMission).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      archive_id: 'archive-1',
      operation_id: OPERATION_ID,
      snapshot_path: snapshotPath,
      snapshot_database_identity: { dev: 1, ino: 1, sizeBytes: 1 },
      snapshot_database_sha256: 'a'.repeat(64),
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
      signal: expect.any(AbortSignal),
    })
    await expect(import('node:fs/promises').then(({ stat }) => stat(stagingDirectory)))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels a sender-owned correction restore while the mission store is still running', async () => {
    let releaseUnlock: ((value: unknown) => void) | undefined
    const unlock = new Promise((resolve) => { releaseUnlock = resolve })
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath: '/safe/correction/mission-store.sqlite',
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    const beginCorrectionSnapshotUse = vi.fn(() => correctionUse)
    const { handlers, missionStore } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
        beginCorrectionSnapshotUse,
      },
    }, {
      unlockFinalizedMission: vi.fn(() => unlock),
    })
    const sender = createSender(8)
    const event = { sender }
    const pending = handlers.get(CHANNELS.restoreMissionForCorrection)?.(event, {
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444',
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })

    await vi.waitFor(() => expect(missionStore.unlockFinalizedMission).toHaveBeenCalledOnce())
    expect(beginCorrectionSnapshotUse).toHaveBeenCalledWith({
      senderId: 8,
      sessionId: '44444444-4444-4444-8444-444444444444',
      operationId: OPERATION_ID,
      archiveId: 'archive-1',
      signal: expect.any(AbortSignal),
      cancel: expect.any(Function),
    })
    expect(beginCorrectionSnapshotUse.mock.invocationCallOrder[0])
      .toBeLessThan(missionStore.unlockFinalizedMission.mock.invocationCallOrder[0] as number)
    await expect(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(event, OPERATION_ID))
      .resolves.toBe(true)
    expect(missionStore.cancelMissionArchiveOperation).toHaveBeenCalledWith(OPERATION_ID)
    releaseUnlock?.({ id: 'mission-1', status: 'finished' })
    await expect(pending).resolves.toMatchObject({ id: 'mission-1', status: 'finished' })
    expect(correctionUse.lease.release).toHaveBeenCalledOnce()
  })

  it('releases correction staging after a destroyed sender cancels a rejected unlock', async () => {
    let rejectUnlock: ((error: Error) => void) | undefined
    const unlock = new Promise((_, reject) => { rejectUnlock = reject })
    let observedSignal: AbortSignal | undefined
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath: '/safe/correction/mission-store.sqlite',
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    const beginCorrectionSnapshotUse = vi.fn(() => correctionUse)
    const completeCorrectionSnapshot = vi.fn(async () => undefined)
    const unlockFinalizedMission = vi.fn((request: Readonly<Record<string, unknown>>) => {
      observedSignal = request.signal as AbortSignal
      return unlock
    })
    const { handlers, missionStore } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
        beginCorrectionSnapshotUse,
        completeCorrectionSnapshot,
      },
    }, { unlockFinalizedMission })
    const sender = createSender(8)
    const pending = handlers.get(CHANNELS.restoreMissionForCorrection)?.({ sender }, {
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444',
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })

    await vi.waitFor(() => expect(unlockFinalizedMission).toHaveBeenCalledOnce())
    expect(observedSignal?.aborted).toBe(false)
    sender.emit('destroyed')
    expect(observedSignal?.aborted).toBe(true)
    await vi.waitFor(() => {
      expect(missionStore.cancelMissionArchiveOperation).toHaveBeenCalledWith(OPERATION_ID)
    })
    const failure = Object.assign(new Error('Correction worker cancelled.'), {
      code: 'ARCHIVE_CANCELLED',
    })
    rejectUnlock?.(failure)

    await expect(pending).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    expect(completeCorrectionSnapshot).not.toHaveBeenCalled()
    expect(correctionUse.lease.release).toHaveBeenCalledOnce()
  })

  it('closes correction snapshot failures before returning them to the renderer', async () => {
    const { handlers } = createMainHarness({
      archiveReviewSessionManager: {
        beginCorrectionSnapshotUse: () => { throw new Error('/private/operator-secret/mission-store.sqlite failed') },
      },
    })
    const result = handlers.get(CHANNELS.restoreMissionForCorrection)?.({ sender: createSender(8) }, {
      mission_id: 'mission-1', archiveId: 'archive-1', operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444', admin_name: 'Duty Admin', reason: 'Correct clue.',
    })
    await expect(result).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
    await expect(result).rejects.not.toThrow('/private/operator-secret')
  })

  it('returns committed correction status when snapshot cleanup remains unresolved', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'sartracker-correction-cleanup-'))
    const stagingDirectory = join(stagingRoot, '.sweep-11111111-1111-4111-8111-111111111111')
    await mkdir(stagingDirectory)
    const snapshotPath = join(stagingDirectory, 'mission-store.sqlite')
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    try {
      const { handlers } = createMainHarness({
        archiveReviewSessionManager: {
          hasReviewActivity: vi.fn(() => true),
          acquireCleanupLease: vi.fn(),
          beginCorrectionSnapshotUse: vi.fn(() => correctionUse),
          completeCorrectionSnapshot: vi.fn(async () => { throw new Error('disk full') }),
        },
      })
      await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.({ sender: createSender(8) }, {
        mission_id: 'mission-1',
        archiveId: 'archive-1',
        operationId: OPERATION_ID,
        sessionId: '44444444-4444-4444-8444-444444444444',
        admin_name: 'Duty Admin',
        reason: 'Correct a recorded clue.',
      })).resolves.toEqual({
        id: 'mission-1',
        status: 'finished',
        correction: {
          committed: true,
          cleanupComplete: false,
          failureCode: 'ARCHIVE_REHYDRATE_CLEANUP_FAILED',
        },
      })
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
  })

  it('returns committed correction status when mission-store custody cleanup fails after commit', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'sartracker-correction-custody-failure-'))
    const stagingDirectory = join(stagingRoot, '.sweep-11111111-1111-4111-8111-111111111111')
    await mkdir(stagingDirectory)
    const snapshotPath = join(stagingDirectory, 'mission-store.sqlite')
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    const custodyFailure = Object.assign(new Error('custody cleanup requires recovery'), {
      code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
    })
    try {
      const { handlers } = createMainHarness({
        archiveReviewSessionManager: {
          hasReviewActivity: vi.fn(() => true),
          acquireCleanupLease: vi.fn(),
          beginCorrectionSnapshotUse: vi.fn(() => correctionUse),
          completeCorrectionSnapshot: vi.fn(async () => true),
        },
      }, {
        unlockFinalizedMission: vi.fn(async () => { throw custodyFailure }),
        getMission: vi.fn(async () => ({
          id: 'mission-1',
          status: 'finished',
          storage_state: 'recovery_required',
        })),
        getCommittedArchiveCorrection: vi.fn(async () => ({
          id: 'mission-1',
          status: 'finished',
          storage_state: 'recovery_required',
        })),
      })
      await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.({ sender: createSender(8) }, {
        mission_id: 'mission-1',
        archiveId: 'archive-1',
        operationId: OPERATION_ID,
        sessionId: '44444444-4444-4444-8444-444444444444',
        admin_name: 'Duty Admin',
        reason: 'Keep the operator on the durable custody fence.',
      })).resolves.toEqual({
        id: 'mission-1',
        status: 'finished',
        correction: {
          committed: true,
          cleanupComplete: true,
          failureCode: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
        },
      })
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
  })

  it('returns committed correction success when a post-commit worker exit has no custody residue', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'sartracker-correction-post-commit-exit-'))
    const stagingDirectory = join(stagingRoot, '.sweep-11111111-1111-4111-8111-111111111111')
    await mkdir(stagingDirectory)
    const snapshotPath = join(stagingDirectory, 'mission-store.sqlite')
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    try {
      const { handlers } = createMainHarness({
        archiveReviewSessionManager: {
          hasReviewActivity: vi.fn(() => true),
          acquireCleanupLease: vi.fn(),
          beginCorrectionSnapshotUse: vi.fn(() => correctionUse),
          completeCorrectionSnapshot: vi.fn(async () => true),
        },
      }, {
        unlockFinalizedMission: vi.fn(async () => {
          throw Object.assign(new Error('worker exited after durable correction commit'), {
            code: 'ARCHIVE_REHYDRATE_FAILED',
          })
        }),
        getMission: vi.fn(async () => ({
          id: 'mission-1',
          status: 'finished',
          storage_state: 'live',
        })),
        getCommittedArchiveCorrection: vi.fn(async () => ({
          id: 'mission-1',
          status: 'finished',
          storage_state: 'live',
        })),
      })
      await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.({ sender: createSender(8) }, {
        mission_id: 'mission-1',
        archiveId: 'archive-1',
        operationId: OPERATION_ID,
        sessionId: '44444444-4444-4444-8444-444444444444',
        admin_name: 'Duty Admin',
        reason: 'Treat a committed worker exit without residue as complete.',
      })).resolves.toEqual({
        id: 'mission-1',
        status: 'finished',
        correction: {
          committed: true,
          cleanupComplete: true,
        },
      })
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
  })

  it('does not infer an exact correction commit from finished live status alone', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'sartracker-correction-wrong-operation-'))
    const stagingDirectory = join(stagingRoot, '.sweep-11111111-1111-4111-8111-111111111111')
    await mkdir(stagingDirectory)
    const snapshotPath = join(stagingDirectory, 'mission-store.sqlite')
    const correctionUse = correctionSnapshotUse({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
      databaseIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
      databaseSha256: 'a'.repeat(64),
    })
    const workerFailure = Object.assign(new Error('wrong correction operation committed'), {
      code: 'ARCHIVE_REHYDRATE_COMMIT_UNVERIFIED',
    })
    try {
      const { handlers, missionStore } = createMainHarness({
        archiveReviewSessionManager: {
          hasReviewActivity: vi.fn(() => true),
          acquireCleanupLease: vi.fn(),
          beginCorrectionSnapshotUse: vi.fn(() => correctionUse),
          completeCorrectionSnapshot: vi.fn(async () => true),
        },
      }, {
        unlockFinalizedMission: vi.fn(async () => { throw workerFailure }),
        getMission: vi.fn(async () => ({
          id: 'mission-1',
          status: 'finished',
          storage_state: 'live',
        })),
        getCommittedArchiveCorrection: vi.fn(async () => null),
      })

      await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.({
        sender: createSender(8),
      }, {
        mission_id: 'mission-1',
        archiveId: 'archive-1',
        operationId: OPERATION_ID,
        sessionId: '44444444-4444-4444-8444-444444444444',
        admin_name: 'Duty Admin',
        reason: 'Reject a different correction operation.',
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_COMMIT_UNVERIFIED' })
      expect(missionStore.getCommittedArchiveCorrection).toHaveBeenCalledWith({
        missionId: 'mission-1',
        archiveId: 'archive-1',
        operationId: OPERATION_ID,
      })
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
  })

  it('rejects an oversized correction reason before reaching the mission store', async () => {
    const { handlers, missionStore } = createMainHarness()
    const event = { sender: createSender(8) }

    await expect(handlers.get(CHANNELS.unlockFinalizedMission)?.(event, {
      mission_id: 'mission-1',
      admin_name: 'Duty Admin',
      reason: 'x'.repeat(4_001),
    })).rejects.toThrow(/reason/iu)
    expect(missionStore.unlockFinalizedMission).not.toHaveBeenCalled()
  })

  it('rejects hostile correction input before invoking IPC collaborators', async () => {
    const beginCorrectionSnapshotUse = vi.fn()
    const { handlers, missionStore } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
        beginCorrectionSnapshotUse,
      },
    })
    const event = { sender: createSender(8) }
    await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.(event, {
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444',
      admin_name: 'Duty Admin',
      reason: 'x'.repeat(64 * 1024 * 1024),
    })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_INPUT' })
    await expect(handlers.get(CHANNELS.restoreMissionForCorrection)?.(event, {
      mission_id: 'mission-1',
      archiveId: 'archive-1',
      operationId: OPERATION_ID,
      sessionId: '44444444-4444-4444-8444-444444444444',
      admin_name: 'Duty Admin',
      reason: 'Correct a clue.',
      unknown: true,
    })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_INPUT' })
    expect(beginCorrectionSnapshotUse).not.toHaveBeenCalled()
    expect(missionStore.restoreMissionForCorrection).not.toHaveBeenCalled()
  })

  it('closed-projects current cleanup eligibility with the main-owned review state', async () => {
    const { handlers, missionStore, archiveReviewSessionManager } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
      },
    }, {
      getMissionCleanupEligibility: vi.fn(async () => ({
        eligible: false,
        startableWithCredential: true,
        blockers: ['fresh_non_machine_unlock_required', 'archive_review_active'],
        storageState: 'live',
        hostile: 'must not cross IPC',
      })),
    })
    const event = { sender: createSender(7) }

    await expect(handlers.get(CHANNELS.getMissionCleanupEligibility)?.(event, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
    })).resolves.toEqual({
      eligible: false,
      startableWithCredential: false,
      blockers: ['fresh_non_machine_unlock_required', 'archive_review_active'],
      storageState: 'live',
    })
    expect(archiveReviewSessionManager.hasReviewActivity).toHaveBeenCalledOnce()
    expect(missionStore.getMissionCleanupEligibility).toHaveBeenCalledWith(
      { missionId: 'mission-1', archiveId: archiveResult().id },
      { reviewActivity: true },
    )
  })

  it('explicitly distinguishes credential-pending eligibility from hard blockers', async () => {
    const { handlers } = createMainHarness({}, {
      getMissionCleanupEligibility: vi.fn(async () => ({
        eligible: false,
        startableWithCredential: false,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      })),
    })

    await expect(handlers.get(CHANNELS.getMissionCleanupEligibility)?.(
      { sender: createSender(7) },
      { missionId: 'mission-1', archiveId: archiveResult().id },
    )).resolves.toEqual({
      eligible: false,
      startableWithCredential: true,
      blockers: ['fresh_non_machine_unlock_required'],
      storageState: 'live',
    })
  })

  it('preserves cleanup-in-progress as an explicit non-startable storage state', async () => {
    const { handlers } = createMainHarness({}, {
      getMissionCleanupEligibility: vi.fn(async () => ({
        eligible: false,
        startableWithCredential: false,
        blockers: ['cleanup_in_progress'],
        storageState: 'cleanup_in_progress',
      })),
    })

    await expect(handlers.get(CHANNELS.getMissionCleanupEligibility)?.(
      { sender: createSender(7) },
      { missionId: 'mission-1', archiveId: archiveResult().id },
    )).resolves.toEqual({
      eligible: false,
      startableWithCredential: false,
      blockers: ['cleanup_in_progress'],
      storageState: 'cleanup_in_progress',
    })
  })

  it.each([
    ['start', CHANNELS.startMissionCleanup],
    ['resume', CHANNELS.resumeMissionCleanup],
  ] as const)('reserves %s cleanup identity before asynchronous mission lookup', async (mode, channel) => {
    let resolveMission: (mission: ReturnType<typeof missionResult>) => void = () => undefined
    const lookup = new Promise<ReturnType<typeof missionResult>>((resolve) => { resolveMission = resolve })
    const { handlers, missionStore } = createMainHarness({}, { getMission: vi.fn(() => lookup) })
    const sender = createSender(7)
    const request = {
      missionId: 'mission-1', archiveId: archiveResult().id, operationId: OPERATION_ID,
      ...(mode === 'start' ? { slotType: 'passphrase', secret: PASSPHRASE, confirmation: 'Mission result' } : {}),
    }
    const first = handlers.get(channel)?.({ sender }, { ...request }) as Promise<unknown>
    const duplicate = handlers.get(channel)?.({ sender }, { ...request }) as Promise<unknown>
    const outcomes = Promise.allSettled([first, duplicate])
    resolveMission(missionResult())
    const settled = await outcomes
    expect(missionStore.getMission).toHaveBeenCalledOnce()
    expect(settled[0]?.status).toBe('fulfilled')
    expect(settled[1]?.status).toBe('rejected')
  })

  it.each([
    ['cleanup_journal_invalid', 'cleanup_in_progress'],
    ['cleanup_membership_changed', 'live'],
  ] as const)('preserves %s as a non-resumable cleanup blocker', async (
    blocker,
    storageState,
  ) => {
    const { handlers } = createMainHarness({}, {
      getMissionCleanupEligibility: vi.fn(async () => ({
        eligible: false,
        startableWithCredential: false,
        blockers: [blocker],
        storageState,
      })),
    })

    await expect(handlers.get(CHANNELS.getMissionCleanupEligibility)?.(
      { sender: createSender(7) },
      { missionId: 'mission-1', archiveId: archiveResult().id },
    )).resolves.toEqual({
      eligible: false,
      startableWithCredential: false,
      blockers: [blocker],
      storageState,
    })
  })

  it('resumes an interrupted cleanup with a fresh bounded operation identity', async () => {
    const { handlers, missionStore, archiveReviewSessionManager, cleanupLease } = createMainHarness()
    const sender = createSender(7)
    await expect(handlers.get(CHANNELS.resumeMissionCleanup)?.({ sender }, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      hostile: 'must not cross IPC',
    })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_INPUT' })
    expect(missionStore.resumeMissionCleanup).not.toHaveBeenCalled()

    await expect(handlers.get(CHANNELS.resumeMissionCleanup)?.({ sender }, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
    })).resolves.toEqual({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      state: 'completed',
      storageState: 'archived',
      movedRows: 17,
    })
    expect(missionStore.resumeMissionCleanup).toHaveBeenCalledWith({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
    }, expect.objectContaining({
      operationId: SECOND_OPERATION_ID,
      reviewActivity: false,
      onProgress: expect.any(Function),
    }))
    expect(archiveReviewSessionManager.acquireCleanupLease).toHaveBeenCalledWith('mission-1')
    expect(cleanupLease.release).toHaveBeenCalledOnce()
  })

  it('requires exact mission-name confirmation and holds the review lease through cleanup exit', async () => {
    let completeCleanup: ((value: unknown) => void) | undefined
    const completion = new Promise((resolve) => { completeCleanup = resolve })
    const progressObservers: ((progress: Readonly<Record<string, unknown>>) => void)[] = []
    const { handlers, missionStore, archiveReviewSessionManager, cleanupLease } = createMainHarness(
      {},
      {
        getMission: vi.fn(async () => ({ ...missionResult(), name: 'Glen Rescue 42' })),
        startMissionCleanup: vi.fn(async (
          _input: unknown,
          context: { readonly onProgress: (value: Readonly<Record<string, unknown>>) => void },
        ) => {
          progressObservers.push(context.onProgress)
          return completion
        }),
      },
    )
    const sender = createSender(7)
    const event = { sender }
    const request = {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Glen Rescue 42',
    }

    const pending = handlers.get(CHANNELS.startMissionCleanup)?.(event, request) as Promise<unknown>
    await vi.waitFor(() => expect(progressObservers).toHaveLength(1))
    expect(request.secret).toBe('')
    expect(archiveReviewSessionManager.acquireCleanupLease).toHaveBeenCalledWith('mission-1')
    expect(cleanupLease.release).not.toHaveBeenCalled()
    progressObservers[0]?.({
      kind: 'cleanup',
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      phase: 'cleanup',
      tableName: 'positions',
      deletedRows: 10,
      totalDeletedRows: 10,
      tableBatch: 1,
      tableIndex: 4,
      tableCount: 49,
    })
    expect(sender.send).toHaveBeenCalledWith(MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 1,
      phase: 'cleanup',
      unit: 'rows',
      completed: 10,
      total: null,
      detail: 'Removed archived rows from live store: positions',
    })
    completeCleanup?.({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      state: 'completed',
      storageState: 'archived',
      deletedRows: 17,
      secret: PASSPHRASE,
    })
    await expect(pending).resolves.toEqual({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      state: 'completed',
      storageState: 'archived',
      movedRows: 17,
    })
    expect(missionStore.startMissionCleanup).toHaveBeenCalledWith({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    }, expect.objectContaining({
      operationId: SECOND_OPERATION_ID,
      reviewActivity: false,
      onProgress: expect.any(Function),
    }))
    expect(cleanupLease.release).toHaveBeenCalledOnce()
  })

  it('delivers zero-delete durable cleanup cursor advances with contiguous sequences', async () => {
    const sender = createSender(7)
    const { handlers } = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Glen Rescue 42' })),
      startMissionCleanup: vi.fn(async (
        _input: unknown,
        context: { readonly onProgress: (value: Readonly<Record<string, unknown>>) => void },
      ) => {
        context.onProgress({
          kind: 'cleanup',
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          phase: 'cleanup',
          tableName: 'mission_events',
          deletedRows: 0,
          totalDeletedRows: 10,
          tableBatch: 9,
          tableIndex: 4,
          tableCount: 49,
        })
        context.onProgress({
          kind: 'cleanup',
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          phase: 'cleanup',
          tableName: 'mission_events',
          deletedRows: 0,
          totalDeletedRows: 10,
          tableBatch: -1,
          tableIndex: 4,
          tableCount: 49,
        })
        context.onProgress({
          kind: 'cleanup',
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          phase: 'cleanup',
          tableName: 'mission_events',
          deletedRows: 5,
          totalDeletedRows: 15,
          tableBatch: 10,
          tableIndex: 4,
          tableCount: 49,
        })
        return {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          state: 'completed',
          storageState: 'archived',
          deletedRows: 15,
        }
      }),
    })

    await expect(handlers.get(CHANNELS.startMissionCleanup)?.({ sender }, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Glen Rescue 42',
    })).resolves.toMatchObject({ state: 'completed', movedRows: 15 })

    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(sender.send).toHaveBeenNthCalledWith(1, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 1,
      phase: 'cleanup',
      unit: 'rows',
      completed: 10,
      total: null,
      detail: 'Advanced live-store cleanup cursor: mission_events',
    })
    expect(sender.send).toHaveBeenNthCalledWith(2, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 2,
      phase: 'cleanup',
      unit: 'rows',
      completed: 15,
      total: null,
      detail: 'Removed archived rows from live store: mission_events',
    })
  })

  it.each([
    ['start', CHANNELS.startMissionCleanup],
    ['resume', CHANNELS.resumeMissionCleanup],
  ] as const)('keeps %s cleanup cumulative totals exact across rejected durable events', async (
    mode,
    channel,
  ) => {
    const sender = createSender(7)
    const cleanupOperation = vi.fn(async (
      _input: unknown,
      context: { readonly onProgress: (value: Readonly<Record<string, unknown>>) => void },
    ) => {
      const progress = {
        kind: 'cleanup',
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        phase: 'cleanup',
        tableName: 'mission_events',
        tableCount: 5,
      }
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 10,
        tableBatch: 9,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 999,
        tableBatch: 10,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 9,
        tableBatch: 10,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 1,
        totalDeletedRows: 11,
        tableBatch: 0,
        tableIndex: 5,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 10,
        tableBatch: 1,
        tableIndex: 5,
      })
      context.onProgress({
        ...progress,
        deletedRows: 1,
        totalDeletedRows: 11,
        tableBatch: 10,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 11,
        tableBatch: 0,
        tableIndex: 5,
      })
      return {
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        state: 'completed',
        storageState: 'archived',
        deletedRows: 11,
      }
    })
    const { handlers } = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Glen Rescue 42' })),
      [mode === 'start' ? 'startMissionCleanup' : 'resumeMissionCleanup']: cleanupOperation,
    })
    const request = mode === 'start'
      ? {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          operationId: SECOND_OPERATION_ID,
          slotType: 'passphrase',
          secret: PASSPHRASE,
          confirmation: 'Glen Rescue 42',
        }
      : {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          operationId: SECOND_OPERATION_ID,
        }

    await expect(handlers.get(channel)?.({ sender }, request))
      .resolves.toMatchObject({ state: 'completed', movedRows: 11 })

    expect(sender.send).toHaveBeenCalledTimes(3)
    expect(sender.send).toHaveBeenNthCalledWith(1, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 1,
      phase: 'cleanup',
      unit: 'rows',
      completed: 10,
      total: null,
      detail: 'Advanced live-store cleanup cursor: mission_events',
    })
    expect(sender.send).toHaveBeenNthCalledWith(2, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 2,
      phase: 'cleanup',
      unit: 'rows',
      completed: 11,
      total: null,
      detail: 'Removed archived rows from live store: mission_events',
    })
    expect(sender.send).toHaveBeenNthCalledWith(3, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 3,
      phase: 'cleanup',
      unit: 'rows',
      completed: 11,
      total: null,
      detail: 'Advanced live-store cleanup cursor: mission_events',
    })
  })

  it.each([
    ['start', CHANNELS.startMissionCleanup],
    ['resume', CHANNELS.resumeMissionCleanup],
  ] as const)('rejects non-consecutive %s cleanup cursors without poisoning progress', async (
    mode,
    channel,
  ) => {
    const sender = createSender(7)
    const cleanupOperation = vi.fn(async (
      _input: unknown,
      context: { readonly onProgress: (value: Readonly<Record<string, unknown>>) => void },
    ) => {
      const progress = {
        kind: 'cleanup',
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        phase: 'cleanup',
        tableName: 'mission_events',
        tableCount: 49,
      }
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 10,
        tableBatch: 9,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 10,
        tableBatch: 11,
        tableIndex: 4,
      })
      context.onProgress({
        ...progress,
        deletedRows: 0,
        totalDeletedRows: 10,
        tableBatch: 99,
        tableIndex: 48,
      })
      context.onProgress({
        ...progress,
        deletedRows: 1,
        totalDeletedRows: 11,
        tableBatch: 10,
        tableIndex: 4,
      })
      return {
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        state: 'completed',
        storageState: 'archived',
        deletedRows: 11,
      }
    })
    const { handlers } = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Glen Rescue 42' })),
      [mode === 'start' ? 'startMissionCleanup' : 'resumeMissionCleanup']: cleanupOperation,
    })
    const request = mode === 'start'
      ? {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          operationId: SECOND_OPERATION_ID,
          slotType: 'passphrase',
          secret: PASSPHRASE,
          confirmation: 'Glen Rescue 42',
        }
      : {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          operationId: SECOND_OPERATION_ID,
        }

    await expect(handlers.get(channel)?.({ sender }, request))
      .resolves.toMatchObject({ state: 'completed', movedRows: 11 })

    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(sender.send).toHaveBeenNthCalledWith(1, MISSION_ARCHIVE_PROGRESS_CHANNEL,
      expect.objectContaining({ sequence: 1, completed: 10 }))
    expect(sender.send).toHaveBeenNthCalledWith(2, MISSION_ARCHIVE_PROGRESS_CHANNEL,
      expect.objectContaining({ sequence: 2, completed: 11 }))
  })

  it('keeps durable cleanup validation state when one renderer send fails', async () => {
    const sender = createSender(7)
    const delivered: unknown[] = []
    sender.send
      .mockImplementationOnce(() => {
        throw new Error('simulated renderer send failure')
      })
      .mockImplementation((channel, progress) => {
        delivered.push([channel, progress])
      })
    const { handlers } = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Glen Rescue 42' })),
      startMissionCleanup: vi.fn(async (
        _input: unknown,
        context: { readonly onProgress: (value: Readonly<Record<string, unknown>>) => void },
      ) => {
        const progress = {
          kind: 'cleanup',
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          phase: 'cleanup',
          tableName: 'positions',
          tableIndex: 4,
          tableCount: 49,
        }
        context.onProgress({
          ...progress,
          deletedRows: 0,
          totalDeletedRows: 10,
          tableBatch: 9,
        })
        context.onProgress({
          ...progress,
          deletedRows: 0,
          totalDeletedRows: 999,
          tableBatch: 10,
        })
        context.onProgress({
          ...progress,
          deletedRows: 1,
          totalDeletedRows: 11,
          tableBatch: 10,
        })
        return {
          missionId: 'mission-1',
          archiveId: archiveResult().id,
          state: 'completed',
          storageState: 'archived',
          deletedRows: 11,
        }
      }),
    })

    await expect(handlers.get(CHANNELS.startMissionCleanup)?.({ sender }, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Glen Rescue 42',
    })).resolves.toMatchObject({ state: 'completed', movedRows: 11 })

    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(delivered).toEqual([[MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: SECOND_OPERATION_ID,
      missionId: 'mission-1',
      kind: 'cleanup',
      sequence: 1,
      phase: 'cleanup',
      unit: 'rows',
      completed: 11,
      total: null,
      detail: 'Removed archived rows from live store: positions',
    }]])
  })

  it('denies wrong cleanup confirmation and releases the review lease on store failure', async () => {
    const denied = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Exact Mission Name' })),
    })
    const owner = { sender: createSender(7) }
    await expect(denied.handlers.get(CHANNELS.startMissionCleanup)?.(owner, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'recovery',
      secret: RECOVERY_CODE,
      confirmation: 'exact mission name',
    })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_CONFIRMATION_MISMATCH' })
    expect(denied.missionStore.startMissionCleanup).not.toHaveBeenCalled()
    expect(denied.archiveReviewSessionManager.acquireCleanupLease).not.toHaveBeenCalled()

    const failure = Object.assign(new Error(
      `must not reflect ${PASSPHRASE} or /Users/private/mission.sqlite`,
    ), {
      code: 'ARCHIVE_CLEANUP_FAILED',
    })
    Object.defineProperty(failure, 'cleanupDiagnostic', {
      value: Object.freeze({
        substage: 'worker_open',
        causeClass: 'sqlite_busy',
        tableName: null,
        cursor: null,
        workerExit: Object.freeze({ observed: true, event: 'message', code: 0 }),
      }),
    })
    const failed = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Exact Mission Name' })),
      startMissionCleanup: vi.fn(async () => { throw failure }),
    })
    const closedFailure = await failed.handlers.get(CHANNELS.startMissionCleanup)?.(owner, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Exact Mission Name',
    }).catch((error: unknown) => error as Error & { readonly code?: string })
    expect(closedFailure).toMatchObject({
      code: 'ARCHIVE_CLEANUP_FAILED',
    })
    expect(closedFailure?.message).toMatch(/\[SARCD1\.[A-Za-z0-9_-]+\] \(ARCHIVE_CLEANUP_FAILED\)\.$/u)
    expect(readCleanupFailureDiagnosticFromMessage(closedFailure?.message)).toEqual({
      substage: 'worker_open',
      causeClass: 'sqlite_busy',
      tableName: null,
      cursor: null,
      workerExit: { observed: true, event: 'message', code: 0 },
    })
    expect(closedFailure?.message).not.toMatch(/Four calm|private|mission\.sqlite/iu)
    expect(failed.cleanupLease.release).toHaveBeenCalledOnce()
  })

  it('preserves a real worker failure diagnostic through the closed IPC boundary', async () => {
    const failed = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Exact Mission Name' })),
      startMissionCleanup: vi.fn(() => startArchiveCleanupWorker({
        databasePath: join(tmpdir(), 'sartracker-cleanup-diagnostic.sqlite'),
        archiveDirectory: join(tmpdir(), 'sartracker-cleanup-diagnostic-archives'),
        archiveRelativePath: 'archive.sararch',
        expectedFileIdentity: Object.freeze({
          device: '1',
          inode: '2',
          linkCount: 1,
          sizeBytes: 4096,
          changedTimeNanoseconds: '3',
          modifiedTimeNanoseconds: '4',
        }),
        evidence: Object.freeze({ archiveId: 'archive-a', missionId: 'mission-a' }),
        mode: 'start',
        operationId: SECOND_OPERATION_ID,
        workerPath: join(process.cwd(), 'tests/fixtures/archive-cleanup-failure-worker.cjs'),
      })),
    })
    const owner = { sender: createSender(7) }

    const closedFailure = await failed.handlers.get(CHANNELS.startMissionCleanup)?.(owner, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Exact Mission Name',
    }).catch((error: unknown) => error as Error)

    expect(readCleanupFailureDiagnosticFromMessage(closedFailure?.message)).toEqual({
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
      workerExit: { observed: true, event: 'message', code: 0 },
    })
    expect(closedFailure?.message).not.toMatch(/private|secret|mission\.sqlite/iu)
    expect(failed.cleanupLease.release).toHaveBeenCalledOnce()
  })

  it('issues one sender-scoped recovery code and consumes it exactly once for finalization', async () => {
    const { handlers, missionStore } = createMainHarness()
    const sender = createSender(7)
    const event = { sender }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)
    const finalize = handlers.get(CHANNELS.finalizeMission)

    await expect(Promise.resolve(issue?.(event, 'mission-1'))).resolves.toEqual({
      operationId: '11111111-1111-4111-8111-111111111111',
      recoveryCode: RECOVERY_CODE,
      expiresAt: '2026-08-29T20:10:00.000Z',
    })
    const input = {
      missionId: 'mission-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    }
    await expect(finalize?.(event, input)).resolves.toMatchObject({
      mission: { id: 'mission-1', status: 'finalized' },
    })
    expect(missionStore.finalizeMission).toHaveBeenCalledWith(
      'mission-1',
      { passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE },
      expect.objectContaining({
        operationId: input.operationId,
        onProgress: expect.any(Function),
      }),
    )
    await expect(finalize?.(event, input)).rejects.toMatchObject({
      code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
    })
    expect(missionStore.finalizeMission).toHaveBeenCalledTimes(1)
  })

  it('keeps only a digest in the issuance ledger and a foreign sender cannot consume it', async () => {
    const { handlers, issuanceLedger, missionStore } = createMainHarness()
    const owner = { sender: createSender(7) }
    const stranger = { sender: createSender(8) }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)
    const finalize = handlers.get(CHANNELS.finalizeMission)
    await issue?.(owner, 'mission-1')
    const input = {
      missionId: 'mission-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    }

    const serializedLedger = JSON.stringify([...issuanceLedger.entries()])
    expect(serializedLedger).not.toContain(RECOVERY_CODE)
    expect(serializedLedger).toContain('11111111-1111-4111-8111-111111111111')
    await expect(finalize?.(stranger, input)).rejects.toMatchObject({
      code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
    })
    await expect(finalize?.(owner, input)).resolves.toMatchObject({
      mission: { id: 'mission-1', status: 'finalized' },
    })
    expect(missionStore.finalizeMission).toHaveBeenCalledOnce()
  })

  it('consumes an owner issuance after a wrong mission or wrong code attempt', async () => {
    for (const invalidFields of [
      { missionId: 'mission-2' },
      { recoveryCode: RECOVERY_CODE.replace('0', '1') },
    ]) {
      const { handlers, missionStore } = createMainHarness()
      const owner = { sender: createSender(7) }
      const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)
      const finalize = handlers.get(CHANNELS.finalizeMission)
      await issue?.(owner, 'mission-1')
      const input = {
        missionId: 'mission-1',
        operationId: '11111111-1111-4111-8111-111111111111',
        passphrase: PASSPHRASE,
        recoveryCode: RECOVERY_CODE,
      }
      await expect(finalize?.(owner, { ...input, ...invalidFields })).rejects.toMatchObject({
        code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
      })
      await expect(finalize?.(owner, input)).rejects.toMatchObject({
        code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
      })
      expect(missionStore.finalizeMission).not.toHaveBeenCalled()
    }
  })

  it('consumes an owned issuance after a weak credential payload and accepts only UUID v4 operation identities', async () => {
    const { handlers, missionStore } = createMainHarness()
    const owner = { sender: createSender(7) }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)
    const finalize = handlers.get(CHANNELS.finalizeMission)
    await issue?.(owner, 'mission-1')

    await expect(finalize?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: 'weak',
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_INPUT' })
    await expect(finalize?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({ code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID' })
    await expect(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(
      owner,
      'client-op-1',
    )).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_INPUT' })
    expect(missionStore.finalizeMission).not.toHaveBeenCalled()
  })

  it('never overwrites an existing issuance when UUID generation collides', async () => {
    const generated = [OPERATION_ID, OPERATION_ID, SECOND_OPERATION_ID]
    const { handlers, issuanceLedger } = createMainHarness({
      randomUUID: () => generated.shift(),
    })
    const owner = { sender: createSender(7) }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)

    await expect(Promise.resolve(issue?.(owner, 'mission-1'))).resolves.toMatchObject({
      operationId: OPERATION_ID,
    })
    await expect(Promise.resolve(issue?.(owner, 'mission-2'))).resolves.toMatchObject({
      operationId: SECOND_OPERATION_ID,
    })
    expect([...issuanceLedger.keys()]).toEqual([OPERATION_ID, SECOND_OPERATION_ID])
  })

  it('keeps only one current recovery-code issuance per sender and mission', async () => {
    const generated = [OPERATION_ID, SECOND_OPERATION_ID]
    const { handlers, issuanceLedger } = createMainHarness({
      randomUUID: () => generated.shift(),
    })
    const owner = { sender: createSender(7) }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)

    await issue?.(owner, 'mission-1')
    await issue?.(owner, 'mission-1')
    expect([...issuanceLedger.keys()]).toEqual([SECOND_OPERATION_ID])
    await expect(handlers.get(CHANNELS.finalizeMission)?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({ code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID' })
  })

  it('invalidates an unused issuance when its owner cancels the custody flow', async () => {
    const { handlers, issuanceLedger, missionStore } = createMainHarness()
    const owner = { sender: createSender(7) }
    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(owner, 'mission-1')

    await expect(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(
      owner,
      OPERATION_ID,
    )).resolves.toBe(true)
    expect(issuanceLedger).toHaveLength(0)
    expect(missionStore.cancelMissionArchiveOperation).not.toHaveBeenCalled()
    await expect(handlers.get(CHANNELS.finalizeMission)?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({ code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID' })
  })

  it('keeps recovery issuances and active verification operations in disjoint identity space', async () => {
    let releaseVerification: ((value: unknown) => void) | undefined
    const verification = new Promise((resolve) => { releaseVerification = resolve })
    const { handlers, missionStore } = createMainHarness({}, {
      verifyMissionArchive: vi.fn(async () => verification),
    })
    const owner = { sender: createSender(7) }
    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(owner, 'mission-1')

    await expect(handlers.get(CHANNELS.verifyMissionArchive)?.(owner, {
      archiveId: archiveResult().id,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({ code: 'ARCHIVE_OPERATION_ID_CONFLICT' })
    expect(missionStore.verifyMissionArchive).not.toHaveBeenCalled()

    const active = handlers.get(CHANNELS.verifyMissionArchive)?.(owner, {
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    await vi.waitFor(() => expect(missionStore.verifyMissionArchive).toHaveBeenCalledOnce())
    await expect(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(
      owner,
      SECOND_OPERATION_ID,
    )).resolves.toBe(true)
    expect(missionStore.cancelMissionArchiveOperation)
      .toHaveBeenCalledWith(SECOND_OPERATION_ID)
    releaseVerification?.(archiveResult())
    await expect(active).resolves.toMatchObject({ id: archiveResult().id })
  })

  it('invalidates unused issuance and cancels active work when the owning renderer is destroyed', async () => {
    const unused = createMainHarness()
    const unusedSender = createSender(7)
    await unused.handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(
      { sender: unusedSender },
      'mission-1',
    )
    unusedSender.emit('destroyed')
    expect(unused.issuanceLedger).toHaveLength(0)

    let resolveFinalize: ((value: unknown) => void) | undefined
    const completion = new Promise((resolve) => { resolveFinalize = resolve })
    const active = createMainHarness({}, {
      finalizeMission: vi.fn(async () => completion),
    })
    const activeSender = createSender(8)
    const event = { sender: activeSender }
    await active.handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(event, 'mission-1')
    const pending = active.handlers.get(CHANNELS.finalizeMission)?.(event, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    activeSender.emit('destroyed')
    await vi.waitFor(() => {
      expect(active.missionStore.cancelMissionArchiveOperation).toHaveBeenCalledWith(OPERATION_ID)
    })
    resolveFinalize?.({ mission: missionResult(), archive: archiveResult() })
    await expect(pending).resolves.toMatchObject({ archive: { status: 'verified' } })
  })

  it('closed-projects archive results and never reflects custody secrets in terminal failures', async () => {
    const secretPassphrase = 'Never return this 2026!'
    const secretRecoveryCode = RECOVERY_CODE
    const mission = {
      id: 'mission-1',
      name: 'Safe result',
      status: 'finalized',
      start_time: '2026-08-29T18:00:00.000Z',
      pause_time: null,
      finish_time: '2026-08-29T19:00:00.000Z',
      paused_seconds: 0,
      notes: 'First line\nSecond line',
      schema_version: 13,
      hostile: secretPassphrase,
    }
    const archive = {
      id: '33333333-3333-4333-8333-333333333333',
      mission_id: 'mission-1',
      protected_finalization_epoch: null,
      archive_kind: 'finalized',
      container_version: 2,
      archive_path: '/safe/mission.sararch',
      ciphertext_sha256: 'a'.repeat(64),
      size_bytes: 1_024,
      created_at: '2026-08-29T20:00:00.000Z',
      verified_at: '2026-08-29T20:01:00.000Z',
      previous_archive_id: '22222222-2222-4222-8222-222222222222',
      previous_archive_sha256: 'b'.repeat(64),
      revision_sequence: 2,
      revision_count: 2,
      supplement_authority: 'Incident Controller',
      supplement_reason: 'Corrected marker classification.',
      supplement_created_at: '2026-08-29T19:59:00.000Z',
      status: 'verified',
      availability: 'present',
      availability_reason: null,
      slots: [
        { slotId: 'passphrase-v1', slotType: 'passphrase' },
        { slotId: 'recovery-v1', slotType: 'recovery' },
      ],
      last_non_machine_unwrap_at: '2026-08-29T20:01:00.000Z',
      passphrase: secretPassphrase,
      recoveryCode: secretRecoveryCode,
      slots_json: secretRecoveryCode,
      verification_proof_json: secretPassphrase,
    }
    const successful = createMainHarness({}, {
      finalizeMission: vi.fn(async () => ({ mission, archive })),
      listMissionArchives: vi.fn(async () => [archive]),
      verifyMissionArchive: vi.fn(async () => archive),
    })
    const event = { sender: createSender(7) }
    await successful.handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(event, 'mission-1')
    const finalized = await successful.handlers.get(CHANNELS.finalizeMission)?.(event, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    const listed = await successful.handlers.get(CHANNELS.listMissionArchives)?.(event, 'mission-1')
    const verified = await successful.handlers.get(CHANNELS.verifyMissionArchive)?.(event, {
      archiveId: archive.id,
      operationId: SECOND_OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    for (const result of [finalized, listed, verified]) {
      expect(JSON.stringify(result)).not.toContain(secretPassphrase)
      expect(JSON.stringify(result)).not.toContain(secretRecoveryCode)
      expect(JSON.stringify(result)).not.toContain('verification_proof_json')
      expect(JSON.stringify(result)).not.toContain('slots_json')
    }
    expect(finalized).toEqual({
      mission: {
        id: mission.id,
        status: mission.status,
      },
      archive: expect.objectContaining({
        id: archive.id,
        mission_id: archive.mission_id,
        status: 'verified',
      }),
    })
    expect(listed).toEqual([expect.objectContaining({
      previous_archive_id: archive.previous_archive_id,
      previous_archive_sha256: archive.previous_archive_sha256,
      revision_sequence: 2,
      revision_count: 2,
      supplement_authority: 'Incident Controller',
      supplement_reason: 'Corrected marker classification.',
      supplement_created_at: '2026-08-29T19:59:00.000Z',
    })])

    const reflectedError = Object.assign(
      new Error(`failed with ${secretPassphrase} and ${secretRecoveryCode}`),
      { code: 'ARCHIVE_CREATE_FAILED' },
    )
    const failing = createMainHarness({}, {
      finalizeMission: vi.fn(async () => { throw reflectedError }),
    })
    const failingEvent = { sender: createSender(8) }
    await failing.handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(
      failingEvent,
      'mission-1',
    )
    let received: unknown
    try {
      await failing.handlers.get(CHANNELS.finalizeMission)?.(failingEvent, {
        missionId: 'mission-1',
        operationId: OPERATION_ID,
        passphrase: PASSPHRASE,
        recoveryCode: RECOVERY_CODE,
      })
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'ARCHIVE_CREATE_FAILED' })
    expect(String((received as Error).message)).not.toContain(secretPassphrase)
    expect(String((received as Error).message)).not.toContain(secretRecoveryCode)
  })

  it('returns a minimal terminal mission projection after archiving valid legacy long text', async () => {
    const mission = {
      ...missionResult(),
      name: 'M'.repeat(10_000),
      notes: 'N'.repeat(100_000),
    }
    const { handlers } = createMainHarness({}, {
      finalizeMission: vi.fn(async () => ({ mission, archive: archiveResult() })),
    })
    const owner = { sender: createSender(7) }
    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(owner, 'mission-1')

    await expect(handlers.get(CHANNELS.finalizeMission)?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).resolves.toMatchObject({
      mission: { id: 'mission-1', status: 'finalized' },
      archive: { mission_id: 'mission-1', status: 'verified' },
    })
  })

  it('rejects terminal and list results that are not bound to the exact request', async () => {
    const owner = { sender: createSender(7) }

    for (const invalidFinalization of [
      { mission: missionResult('mission-other'), archive: archiveResult('mission-1') },
      { mission: missionResult('mission-1'), archive: archiveResult('mission-other') },
      {
        mission: missionResult('mission-1'),
        archive: { ...archiveResult('mission-1'), status: 'sealed', verified_at: null },
      },
      {
        mission: missionResult('mission-1'),
        archive: {
          ...archiveResult('mission-1'),
          archive_kind: 'direct',
          container_version: 1,
          archive_path: '/safe/legacy.zip',
          ciphertext_sha256: null,
          size_bytes: null,
          slots: [],
        },
      },
      {
        mission: missionResult('mission-1'),
        archive: {
          ...archiveResult('mission-1'),
          slots: [{ slotId: 'passphrase-v1', slotType: 'passphrase' }],
        },
      },
    ]) {
      const harness = createMainHarness({}, {
        finalizeMission: vi.fn(async () => invalidFinalization),
      })
      await harness.handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(owner, 'mission-1')
      await expect(harness.handlers.get(CHANNELS.finalizeMission)?.(owner, {
        missionId: 'mission-1', operationId: OPERATION_ID,
        passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE,
      })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_RESULT' })
    }

    const listed = createMainHarness({}, {
      listMissionArchives: vi.fn(async () => [archiveResult('mission-other')]),
    })
    await expect(listed.handlers.get(CHANNELS.listMissionArchives)?.(
      owner,
      'mission-1',
    )).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_RESULT' })

    for (const invalidVerification of [
      { ...archiveResult(), id: '44444444-4444-4444-8444-444444444444' },
      { ...archiveResult(), status: 'sealed', verified_at: null },
    ]) {
      const harness = createMainHarness({}, {
        verifyMissionArchive: vi.fn(async () => invalidVerification),
      })
      await expect(harness.handlers.get(CHANNELS.verifyMissionArchive)?.(owner, {
        archiveId: archiveResult().id,
        operationId: SECOND_OPERATION_ID,
        passphrase: PASSPHRASE,
        recoveryCode: RECOVERY_CODE,
      })).rejects.toMatchObject({ code: 'ARCHIVE_IPC_INVALID_RESULT' })
    }
  })

  it('carries the evidence-health finalization block as one closed stable code', async () => {
    const blocked = Object.assign(new Error('sensitive evidence failure detail'), {
      code: 'EVIDENCE_HEALTH_BLOCKED',
    })
    const { handlers } = createMainHarness({}, {
      finalizeMission: vi.fn(async () => { throw blocked }),
    })
    const owner = { sender: createSender(7) }
    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(owner, 'mission-1')

    await expect(handlers.get(CHANNELS.finalizeMission)?.(owner, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })).rejects.toMatchObject({
      code: 'ARCHIVE_EVIDENCE_HEALTH_BLOCKED',
      message: 'Mission archive operation failed safely (ARCHIVE_EVIDENCE_HEALTH_BLOCKED).',
    })
  })

  it('rejects an expired recovery issuance before store work', async () => {
    let nowMs = Date.parse('2026-08-29T20:00:00.000Z')
    const { handlers, missionStore } = createMainHarness({ nowMs: () => nowMs })
    const owner = { sender: createSender(7) }
    const issue = handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)
    const finalize = handlers.get(CHANNELS.finalizeMission)
    await issue?.(owner, 'mission-1')
    const input = {
      missionId: 'mission-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    }
    nowMs += 10 * 60_000
    await expect(finalize?.(owner, input)).rejects.toMatchObject({
      code: 'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
    })
    expect(missionStore.finalizeMission).not.toHaveBeenCalled()
  })

  it('routes progress and cancellation only to the renderer that owns the active operation', async () => {
    let resolveFinalize: ((value: unknown) => void) | undefined
    const finalizeCompletion = new Promise((resolve) => { resolveFinalize = resolve })
    const { handlers, missionStore, progressObservers } = createMainHarness()
    missionStore.finalizeMission.mockImplementation(async (
      _missionId,
      _custody,
      context: { readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void },
    ) => {
      progressObservers.push(context.onProgress)
      return finalizeCompletion
    })
    const sender = createSender(7)
    const stranger = createSender(8)
    const event = { sender }
    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(event, 'mission-1')
    const pending = handlers.get(CHANNELS.finalizeMission)?.(event, {
      missionId: 'mission-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    }) as Promise<unknown>
    await vi.waitFor(() => expect(progressObservers).toHaveLength(1))
    progressObservers[0]?.({
      kind: 'create',
      sequence: 1,
      phase: 'snapshot',
      unit: 'tables',
      completed: 1,
      total: 49,
      detail: 'Pinned mission snapshot',
    })
    expect(sender.send).toHaveBeenCalledWith(MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: '11111111-1111-4111-8111-111111111111',
      missionId: 'mission-1',
      kind: 'create',
      sequence: 1,
      phase: 'snapshot',
      unit: 'tables',
      completed: 1,
      total: 49,
      detail: 'Pinned mission snapshot',
    })
    expect(stranger.send).not.toHaveBeenCalled()

    progressObservers[0]?.({
      kind: 'create',
      sequence: 2,
      phase: 'publish',
      unit: 'files',
      completed: 1,
      total: 1,
      detail: 'Published encrypted archive',
    })
    progressObservers[0]?.({
      kind: 'verify',
      sequence: 1,
      phase: 'replay',
      unit: 'rows',
      completed: 3,
      total: 3,
      detail: 'Compared replay semantics',
    })
    expect(sender.send).toHaveBeenNthCalledWith(2, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: OPERATION_ID,
      missionId: 'mission-1',
      kind: 'create',
      sequence: 2,
      phase: 'publish',
      unit: 'files',
      completed: 1,
      total: 1,
      detail: 'Published encrypted archive',
    })
    expect(sender.send).toHaveBeenNthCalledWith(3, MISSION_ARCHIVE_PROGRESS_CHANNEL, {
      operationId: OPERATION_ID,
      missionId: 'mission-1',
      kind: 'verify',
      sequence: 1,
      phase: 'replay',
      unit: 'rows',
      completed: 3,
      total: 3,
      detail: 'Compared replay semantics',
    })

    await expect(Promise.resolve(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(
      { sender: stranger },
      '11111111-1111-4111-8111-111111111111',
    ))).resolves.toBe(false)
    await expect(Promise.resolve(handlers.get(CHANNELS.cancelMissionArchiveOperation)?.(
      event,
      '11111111-1111-4111-8111-111111111111',
    ))).resolves.toBe(true)
    expect(missionStore.cancelMissionArchiveOperation).toHaveBeenCalledOnce()
    resolveFinalize?.({ mission: missionResult(), archive: archiveResult() })
    await pending
  })

  it('keeps progress transport failures non-authoritative for every archive operation', async () => {
    const { handlers } = createMainHarness({}, {
      finalizeMission: vi.fn(async (
        missionId: string,
        _custody: unknown,
        context: { readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void },
      ) => {
        context.onProgress({
          kind: 'verify', sequence: 1, phase: 'verified', unit: 'phases',
          completed: 1, total: 1, detail: 'Verification committed',
        })
        return { mission: missionResult(missionId), archive: archiveResult(missionId) }
      }),
      verifyMissionArchive: vi.fn(async (
        _request: unknown,
        context: { readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void },
      ) => {
        context.onProgress({
          kind: 'verify', sequence: 1, phase: 'verified', unit: 'phases',
          completed: 1, total: 1, detail: 'Verification committed',
        })
        return archiveResult()
      }),
      startMissionCleanup: vi.fn(async (
        _request: unknown,
        context: { readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void },
      ) => {
        context.onProgress({
          kind: 'cleanup', missionId: 'mission-1', archiveId: archiveResult().id,
          phase: 'cleanup', tableName: 'positions', deletedRows: 0,
          totalDeletedRows: 17, tableBatch: 0, tableIndex: 49, tableCount: 49,
        })
        return {
          missionId: 'mission-1', archiveId: archiveResult().id,
          state: 'completed', storageState: 'archived', deletedRows: 17,
        }
      }),
    })
    const sender = createSender(7)
    sender.send.mockImplementation(() => {
      throw new Error('simulated renderer destruction between liveness check and send')
    })
    const event = { sender }

    await handlers.get(CHANNELS.issueMissionArchiveRecoveryCode)?.(event, 'mission-1')
    await expect(handlers.get(CHANNELS.finalizeMission)?.(event, {
      missionId: 'mission-1', operationId: OPERATION_ID,
      passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE,
    })).resolves.toMatchObject({ archive: { status: 'verified' } })
    await expect(handlers.get(CHANNELS.verifyMissionArchive)?.(event, {
      archiveId: archiveResult().id, operationId: SECOND_OPERATION_ID,
      passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE,
    })).resolves.toMatchObject({ status: 'verified' })
    await expect(handlers.get(CHANNELS.startMissionCleanup)?.(event, {
      missionId: 'mission-1', archiveId: archiveResult().id,
      operationId: OPERATION_ID, slotType: 'passphrase', secret: PASSPHRASE,
      confirmation: 'Mission result',
    })).resolves.toMatchObject({ state: 'completed', storageState: 'archived' })
    expect(sender.send).toHaveBeenCalledTimes(3)
  })

  it('loads in the sandbox and rejects hostile archive inputs before any invoke', async () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    const invoke = vi.fn().mockResolvedValue({})
    let exposedBridge: Record<string, unknown> | undefined
    const listeners = new Map<string, (_event: unknown, input: unknown) => void>()
    expect(() => runInNewContext(preload, {
      process: { platform: 'linux' },
      TextEncoder,
      require: (specifier: string) => {
        if (specifier !== 'electron') throw new Error(`Unexpected preload require: ${specifier}`)
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, bridge: Record<string, unknown>) => {
              exposedBridge = bridge
            },
          },
          ipcRenderer: {
            invoke,
            on: vi.fn((channel, listener) => listeners.set(channel, listener)),
            removeListener: vi.fn(),
            send: vi.fn(),
          },
        }
      },
      window: { addEventListener: vi.fn() },
    })).not.toThrow()
    const missionStore = exposedBridge?.missionStore as {
      readonly createMission: (input: unknown) => Promise<unknown>
      readonly createMissionArchive?: unknown
      readonly issueMissionArchiveRecoveryCode: (missionId: unknown) => Promise<unknown>
      readonly finalizeMission: (missionId: unknown, custody: unknown) => Promise<unknown>
      readonly listMissionArchives: (missionId: unknown) => Promise<unknown>
      readonly verifyMissionArchive: (input: unknown) => Promise<unknown>
      readonly getMissionCleanupEligibility: (input: unknown) => Promise<unknown>
      readonly startMissionCleanup: (input: unknown) => Promise<unknown>
      readonly resumeMissionCleanup: (input: unknown) => Promise<unknown>
      readonly cancelMissionArchiveOperation: (operationId: unknown) => Promise<unknown>
    }
    expect(missionStore).not.toHaveProperty('createMissionArchive')
    const huge = 'x'.repeat(64 * 1024 * 1024)
    const invalidCalls = [
      () => missionStore.createMission({ name: 'é'.repeat(513) }),
      () => missionStore.issueMissionArchiveRecoveryCode(huge),
      () => missionStore.finalizeMission('mission-1', { passphrase: huge, recoveryCode: RECOVERY_CODE, operationId: OPERATION_ID }),
      () => missionStore.finalizeMission('mission-1', { passphrase: PASSPHRASE, recoveryCode: huge, operationId: OPERATION_ID }),
      () => missionStore.finalizeMission(42, { passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE, operationId: OPERATION_ID }),
      () => missionStore.verifyMissionArchive({
        archiveId: huge,
        operationId: OPERATION_ID,
        passphrase: PASSPHRASE,
        recoveryCode: RECOVERY_CODE,
      }),
      () => missionStore.getMissionCleanupEligibility({
        missionId: huge,
        archiveId: archiveResult().id,
      }),
      () => missionStore.startMissionCleanup({
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        operationId: SECOND_OPERATION_ID,
        slotType: 'passphrase',
        secret: huge,
        confirmation: 'Mission result',
      }),
      () => missionStore.startMissionCleanup({
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        operationId: SECOND_OPERATION_ID,
        slotType: 'machine',
        secret: PASSPHRASE,
        confirmation: 'Mission result',
      }),
      () => missionStore.startMissionCleanup({
        missionId: 'mission-1',
        archiveId: archiveResult().id,
        operationId: SECOND_OPERATION_ID,
        slotType: 'recovery',
        secret: RECOVERY_CODE,
        confirmation: huge,
      }),
      () => missionStore.resumeMissionCleanup({
        missionId: huge,
        archiveId: archiveResult().id,
        operationId: SECOND_OPERATION_ID,
      }),
      () => missionStore.cancelMissionArchiveOperation(huge),
      () => missionStore.cancelMissionArchiveOperation('client-op-1'),
    ]
    for (const call of invalidCalls) expect(call).toThrow(/archive|mission/iu)
    expect(invoke).not.toHaveBeenCalled()

    await missionStore.getMissionCleanupEligibility({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      hostileBlob: huge,
    })
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.getMissionCleanupEligibility, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
    })
    await missionStore.startMissionCleanup({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'recovery',
      secret: RECOVERY_CODE,
      confirmation: 'Mission result',
      hostileBlob: huge,
    })
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.startMissionCleanup, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'recovery',
      secret: RECOVERY_CODE,
      confirmation: 'Mission result',
    })
    await missionStore.resumeMissionCleanup({
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      hostileBlob: huge,
    })
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.resumeMissionCleanup, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
    })

    await missionStore.finalizeMission('mission-1', {
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
      hostileBlob: huge,
    })
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.finalizeMission, {
      missionId: 'mission-1',
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
  })

  it('projects progress pushes before renderer listeners see them', () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    let exposedBridge: Record<string, unknown> | undefined
    const listeners = new Map<string, (_event: unknown, input: unknown) => void>()
    const removeListener = vi.fn()
    runInNewContext(preload, {
      process: { platform: 'linux' },
      TextEncoder,
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name: string, bridge: Record<string, unknown>) => { exposedBridge = bridge } },
        ipcRenderer: {
          invoke: vi.fn(),
          on: vi.fn((channel, listener) => listeners.set(channel, listener)),
          removeListener,
          send: vi.fn(),
        },
      }),
      window: { addEventListener: vi.fn() },
    })
    const listener = vi.fn()
    const bridge = exposedBridge as {
      readonly onMissionArchiveProgress: (listener: (value: unknown) => void) => () => void
    }
    const unsubscribe = bridge.onMissionArchiveProgress(listener)
    const push = listeners.get(MISSION_ARCHIVE_PROGRESS_CHANNEL)
    push?.({}, {
      operationId: OPERATION_ID, missionId: 'mission-1', kind: 'create',
      sequence: 1, phase: 'encrypt', unit: 'bytes', completed: 2, total: 10,
      detail: 'Encrypting archive', hostileBlob: 'x'.repeat(64 * 1024 * 1024),
    })
    expect(listener).toHaveBeenCalledWith({
      operationId: OPERATION_ID, missionId: 'mission-1', kind: 'create',
      sequence: 1, phase: 'encrypt', unit: 'bytes', completed: 2, total: 10,
      detail: 'Encrypting archive',
    })
    push?.({}, {
      operationId: SECOND_OPERATION_ID, missionId: 'mission-1', kind: 'cleanup',
      sequence: 1, phase: 'cleanup', unit: 'rows', completed: 50, total: null,
      detail: 'Moved live rows: positions', hostileBlob: 'x'.repeat(64 * 1024 * 1024),
    })
    expect(listener).toHaveBeenLastCalledWith({
      operationId: SECOND_OPERATION_ID, missionId: 'mission-1', kind: 'cleanup',
      sequence: 1, phase: 'cleanup', unit: 'rows', completed: 50, total: null,
      detail: 'Moved live rows: positions',
    })
    expect(() => push?.({}, {
      operationId: OPERATION_ID, missionId: 'mission-1', kind: 'create',
      sequence: 2, phase: 'encrypt', unit: 'bytes', completed: 3, total: 10,
      detail: 'x'.repeat(64 * 1024 * 1024),
    })).toThrow(/archive progress/iu)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(MISSION_ARCHIVE_PROGRESS_CHANNEL, push)
  })
})
