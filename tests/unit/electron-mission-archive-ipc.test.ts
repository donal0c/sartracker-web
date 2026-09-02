import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
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
  const archiveReviewSessionManager = (overrides.archiveReviewSessionManager ?? {
    hasReviewActivity: vi.fn(() => false),
    acquireCleanupLease: vi.fn(() => cleanupLease),
  }) as {
    readonly hasReviewActivity: ReturnType<typeof vi.fn>
    readonly acquireCleanupLease: ReturnType<typeof vi.fn>
    readonly snapshotForCorrection?: ReturnType<typeof vi.fn>
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
    archiveReviewSessionManager,
    ...overrides,
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
    const snapshotForCorrection = vi.fn(async () => ({
      missionId: 'mission-1',
      archiveId: 'archive-1',
      snapshotPath,
    }))
    const { handlers, missionStore } = createMainHarness({
      archiveReviewSessionManager: {
        hasReviewActivity: vi.fn(() => true),
        acquireCleanupLease: vi.fn(),
        snapshotForCorrection,
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
    })).resolves.toEqual({ id: 'mission-1', status: 'finished' })
    expect(snapshotForCorrection).toHaveBeenCalledWith({
      senderId: 8,
      sessionId: '44444444-4444-4444-8444-444444444444',
      operationId: OPERATION_ID,
      archiveId: 'archive-1',
    })
    expect(missionStore.unlockFinalizedMission).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      archive_id: 'archive-1',
      snapshot_path: snapshotPath,
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })
    await expect(import('node:fs/promises').then(({ stat }) => stat(stagingDirectory)))
      .rejects.toMatchObject({ code: 'ENOENT' })
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
      detail: 'Moved live rows: positions',
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

    const failure = Object.assign(new Error(`must not reflect ${PASSPHRASE}`), {
      code: 'ARCHIVE_CLEANUP_FAILED',
    })
    const failed = createMainHarness({}, {
      getMission: vi.fn(async () => ({ ...missionResult(), name: 'Exact Mission Name' })),
      startMissionCleanup: vi.fn(async () => { throw failure }),
    })
    await expect(failed.handlers.get(CHANNELS.startMissionCleanup)?.(owner, {
      missionId: 'mission-1',
      archiveId: archiveResult().id,
      operationId: SECOND_OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: 'Exact Mission Name',
    })).rejects.toMatchObject({
      code: 'ARCHIVE_CLEANUP_FAILED',
      message: 'Mission archive operation failed safely (ARCHIVE_CLEANUP_FAILED).',
    })
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
          phase: 'cleanup', tableName: 'positions', deletedRows: 17,
          totalDeletedRows: 17, tableIndex: 49, tableCount: 49,
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
