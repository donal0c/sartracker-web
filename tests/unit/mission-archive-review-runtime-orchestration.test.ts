import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  Mission,
  MissionArchiveInfo,
  MissionStore,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import type {
  ArchiveReviewBridge,
  ArchiveReviewProgress as MissionArchiveReviewProgress,
  ArchiveReviewPublicSession as MissionArchiveReviewSession,
} from '../../src/infrastructure/archive-review/archive-review-types'
import {
  createElectronArchiveReviewSource,
  type ElectronArchiveReviewSource,
} from '../../src/infrastructure/archive-review/electron-archive-review-source'
import {
  startMissionArchiveReviewRuntime,
  type MissionArchiveReviewRuntimeState,
  type StartMissionArchiveReviewRuntimeDependencies,
} from '../../src/features/mission-review/start-mission-archive-review-runtime'

const OPERATION_ID = '44c0b79d-f4ad-45db-ac2d-1360c9adf8fd'
const FOREIGN_OPERATION_ID = 'ce8ffed1-02ee-41d2-8610-f6c566f74d3a'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const VERIFIED_V2_ID = 'archive-v2-verified'
const SUPERSEDED_V2_ID = 'archive-v2-superseded-verified'
const LEGACY_V1_ID = 'archive-v1-legacy'
const UNVERIFIED_V2_ID = 'archive-v2-unverified'
const MISSING_V2_ID = 'archive-v2-missing'
const NEWER_V3_ID = 'archive-v3-newer'
const SECRET = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const PASSPHRASE = 'Verify-Archive-Passphrase-2026!'

const MISSION: Mission = {
  id: 'mission-archive-fixed',
  name: 'Archive Review Mission',
  status: 'finalized',
  start_time: '2026-08-29T08:00:00.000Z',
  pause_time: null,
  finish_time: '2026-08-29T16:00:00.000Z',
  paused_seconds: 0,
  notes: null,
  schema_version: 13,
}

const SECOND_MISSION: Mission = {
  ...MISSION,
  id: 'mission-archive-second',
  name: 'Earlier Retained Mission',
  start_time: '2024-01-01T08:00:00.000Z',
  finish_time: '2024-01-01T16:00:00.000Z',
}

const VERIFIED_V2 = archive({ id: VERIFIED_V2_ID })
const SUPERSEDED_VERIFIED_V2 = archive({
  id: SUPERSEDED_V2_ID,
  status: 'superseded',
})
const LEGACY_V1 = archive({
  id: LEGACY_V1_ID,
  mission_id: SECOND_MISSION.id,
  container_version: 1,
  archive_path: '/archive-custody/legacy-v1.zip',
  ciphertext_sha256: null,
  verified_at: null,
  status: 'sealed',
  slots: [],
})
const UNVERIFIED_V2 = archive({
  id: UNVERIFIED_V2_ID,
  status: 'sealed',
  verified_at: null,
})
const MISSING_V2 = archive({
  id: MISSING_V2_ID,
  availability: 'missing',
  availability_reason: 'Archive bytes are missing.',
})
const NEWER_V3 = archive({
  id: NEWER_V3_ID,
  container_version: 3 as never,
})

const V2_SESSION: MissionArchiveReviewSession = Object.freeze({
  sessionId: SESSION_ID,
  archiveId: VERIFIED_V2_ID,
  missionId: MISSION.id,
  containerVersion: 2,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: 'a'.repeat(64),
  previousArchiveId: null,
  openedAt: '2026-08-30T09:00:00.000Z',
  plaintextResidual: 'permission_restricted_session_open',
})

const V1_SESSION: MissionArchiveReviewSession = Object.freeze({
  ...V2_SESSION,
  archiveId: LEGACY_V1_ID,
  missionId: SECOND_MISSION.id,
  containerVersion: 1,
  encrypted: false,
  verified: false,
  ciphertextSha256: null,
})

describe('mission archive review runtime orchestration [DON-253 / BCP-16]', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes retained archive reads so opening Review cannot fan out main-process IPC', async () => {
    let inFlight = 0
    let maximumInFlight = 0
    const listMissionArchives = vi.fn(async (missionId: string) => {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight -= 1
      return missionId === MISSION.id ? [VERIFIED_V2] : [LEGACY_V1]
    })
    const harness = createHarness({ listMissionArchives })

    await startMissionArchiveReviewRuntime(harness.dependencies)

    expect(maximumInFlight).toBe(1)
    expect(listMissionArchives).toHaveBeenCalledTimes(2)
  })

  it('loads every saved mission and every indefinitely retained archive without a UI-side cap', async () => {
    const retainedLegacyArchives = Array.from({ length: 64 }, (_, index) => archive({
      id: `retained-legacy-${index + 1}`,
      mission_id: SECOND_MISSION.id,
      container_version: 1,
      archive_path: `/archive-custody/retained-legacy-${index + 1}.zip`,
      ciphertext_sha256: null,
      verified_at: null,
      status: 'sealed',
      slots: [],
    }))
    const harness = createHarness({
      archivesByMission: new Map([
        [MISSION.id, [VERIFIED_V2, SUPERSEDED_VERIFIED_V2]],
        [SECOND_MISSION.id, retainedLegacyArchives],
      ]),
    })

    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    const state = harness.latestState()

    expect(harness.listMissions).toHaveBeenCalledOnce()
    expect(harness.listMissionArchives.mock.calls.map(([missionId]) => missionId))
      .toEqual([MISSION.id, SECOND_MISSION.id])
    expect(state.timeline).toHaveLength(2)
    expect(state.timeline.find((entry) => entry.mission.id === MISSION.id)?.archives)
      .toHaveLength(2)
    expect(state.timeline.find((entry) => entry.mission.id === SECOND_MISSION.id)?.archives)
      .toHaveLength(64)
    expect(Object.keys(controller).sort()).toEqual([
      'cancelArchiveVerification',
      'closeArchiveReview',
      'dispose',
      'openArchive',
      'refreshTimeline',
      'restoreForCorrection',
      'verifyArchive',
    ])
  })

  it('retries one sealed v2 archive with both original credentials and publishes only the verified result', async () => {
    const verification = deferred<MissionArchiveInfo>()
    const harness = createHarness({
      verifyMissionArchive: vi.fn(() => verification.promise),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    const pending = controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })
    await vi.waitFor(() => expect(harness.verifyMissionArchive).toHaveBeenCalledOnce())
    expect(harness.verifyMissionArchive).toHaveBeenCalledWith({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })
    expect(harness.latestState().timeline[0]?.archives.find(
      (archive) => archive.id === UNVERIFIED_V2_ID,
    )).toMatchObject({ status: 'sealed', verified_at: null })

    verification.resolve({
      ...UNVERIFIED_V2,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
      last_non_machine_unwrap_at: '2026-08-30T17:00:00.000Z',
    })
    await expect(pending).resolves.toMatchObject({
      id: UNVERIFIED_V2_ID,
      status: 'verified',
    })

    expect(harness.latestState().timeline[0]?.archives.find(
      (archive) => archive.id === UNVERIFIED_V2_ID,
    )).toMatchObject({
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
    })
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(PASSPHRASE)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(SECRET)
  })

  it('rejects ineligible or malformed verification retries before IPC and never reflects backend secrets', async () => {
    const reflectedFailure = new Error(`verification failed for ${PASSPHRASE} ${SECRET}`)
    const harness = createHarness({
      verifyMissionArchive: vi.fn().mockRejectedValue(reflectedFailure),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    for (const archiveId of [VERIFIED_V2_ID, MISSING_V2_ID, NEWER_V3_ID]) {
      await expect(controller.verifyArchive({
        archiveId,
        operationId: OPERATION_ID,
        passphrase: PASSPHRASE,
        recoveryCode: SECRET,
      })).rejects.toThrow(/sealed.*supported.*available|available.*sealed.*supported/iu)
    }
    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: 'not-an-operation-id',
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toThrow(/operation.*invalid|invalid.*operation/iu)
    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: '',
      recoveryCode: SECRET,
    })).rejects.toThrow(/passphrase.*invalid|credential.*invalid/iu)
    expect(harness.verifyMissionArchive).not.toHaveBeenCalled()

    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toThrow(/verification.*failed safely|failed safely.*verification/iu)
    expect(harness.verifyMissionArchive).toHaveBeenCalledOnce()
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(PASSPHRASE)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(reflectedFailure.message)
  })

  it('reconciles an untrusted verification response to authoritative sealed status', async () => {
    const harness = createHarness({
      verifyMissionArchive: vi.fn().mockResolvedValue({
        ...UNVERIFIED_V2,
        id: 'foreign-archive',
        status: 'verified',
        verified_at: '2026-08-30T17:00:00.000Z',
      }),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toMatchObject({
      code: 'ARCHIVE_VERIFICATION_RETRYABLE',
      message: expect.stringMatching(/failed safely.*status remains sealed/iu),
    })
    expect(harness.latestState().timeline[0]?.archives.find(
      (archive) => archive.id === UNVERIFIED_V2_ID,
    )).toMatchObject({ status: 'sealed', verified_at: null })
  })

  it('accepts authoritative verified status after the invocation rejects post-commit', async () => {
    let currentArchive: MissionArchiveInfo = UNVERIFIED_V2
    const listMissionArchives = vi.fn(async (missionId: string) =>
      missionId === MISSION.id ? [currentArchive] : [LEGACY_V1])
    const harness = createHarness({
      listMissionArchives,
      verifyMissionArchive: vi.fn(async () => {
        currentArchive = {
          ...UNVERIFIED_V2,
          status: 'verified',
          verified_at: '2026-08-30T17:00:00.000Z',
          last_non_machine_unwrap_at: '2026-08-30T17:00:00.000Z',
        }
        throw new Error('projection failed after registry commit')
      }),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).resolves.toMatchObject({
      id: UNVERIFIED_V2_ID,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
    })
    expect(harness.latestState().timeline[0]?.archives[0]).toMatchObject({
      id: UNVERIFIED_V2_ID,
      status: 'verified',
    })
  })

  it('withholds retry when rejection cannot reconcile sealed-versus-verified status', async () => {
    let missionArchiveReads = 0
    const harness = createHarness({
      listMissionArchives: vi.fn(async (missionId: string) => {
        if (missionId !== MISSION.id) return [LEGACY_V1]
        missionArchiveReads += 1
        if (missionArchiveReads > 1) throw new Error('timeline unavailable')
        return [UNVERIFIED_V2]
      }),
      verifyMissionArchive: vi.fn().mockRejectedValue(
        new Error('transport failed after unknown commit point'),
      ),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toMatchObject({
      code: 'ARCHIVE_VERIFICATION_STATUS_UNKNOWN',
      message: expect.stringMatching(/status could not be established.*refresh/iu),
    })
  })

  it('does not treat a superseded reconciliation refresh as authoritative sealed status', async () => {
    const reconciliationMissions = deferred<readonly Mission[]>()
    const laterMissions = deferred<readonly Mission[]>()
    let missionReads = 0
    const harness = createHarness({
      listMissions: vi.fn(() => {
        missionReads += 1
        if (missionReads === 1) return Promise.resolve([MISSION, SECOND_MISSION])
        return missionReads === 2 ? reconciliationMissions.promise : laterMissions.promise
      }),
      verifyMissionArchive: vi.fn().mockRejectedValue(
        new Error('transport failed after unknown commit point'),
      ),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    const verification = controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })
    await vi.waitFor(() => expect(harness.listMissions).toHaveBeenCalledTimes(2))
    const laterRefresh = controller.refreshTimeline()
    await vi.waitFor(() => expect(harness.listMissions).toHaveBeenCalledTimes(3))
    reconciliationMissions.resolve([MISSION, SECOND_MISSION])

    await expect(verification).rejects.toMatchObject({
      code: 'ARCHIVE_VERIFICATION_STATUS_UNKNOWN',
    })

    laterMissions.reject(new Error('newer timeline refresh failed'))
    await expect(laterRefresh).rejects.toThrow(/newer timeline refresh failed/iu)
  })

  it('never publishes altered correction-chain metadata from a verification result', async () => {
    const harness = createHarness({
      verifyMissionArchive: vi.fn().mockResolvedValue({
        ...UNVERIFIED_V2,
        status: 'verified',
        verified_at: '2026-08-30T17:00:00.000Z',
        previous_archive_id: 'forged-predecessor',
        revision_count: 99,
      }),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFICATION_RETRYABLE' })
    expect(JSON.stringify(harness.latestState().timeline)).not.toContain('forged-predecessor')
    expect(harness.latestState().timeline[0]?.archives.find(
      (archive) => archive.id === UNVERIFIED_V2_ID,
    )?.revision_count).toBe(1)
  })

  it('releases verification ownership after a synchronous bridge rejection', async () => {
    const verifyMissionArchive = vi.fn(() => {
      throw new Error(`synchronous bridge reflection ${PASSPHRASE} ${SECRET}`)
    })
    const harness = createHarness({ verifyMissionArchive })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    const request = {
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    }

    await expect(controller.verifyArchive(request)).rejects.toThrow(/failed safely/iu)
    verifyMissionArchive.mockResolvedValueOnce({
      ...UNVERIFIED_V2,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
    })
    await expect(controller.verifyArchive(request)).resolves.toMatchObject({
      id: UNVERIFIED_V2_ID,
      status: 'verified',
    })
    expect(verifyMissionArchive).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(PASSPHRASE)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(SECRET)
  })

  it('forwards physical verification cancellation only through the mission archive lane', async () => {
    const terminal = deferred<MissionArchiveInfo>()
    const harness = createHarness({
      verifyMissionArchive: vi.fn(() => terminal.promise),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    const pending = controller.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })
    await vi.waitFor(() => expect(harness.verifyMissionArchive).toHaveBeenCalledOnce())

    await expect(controller.cancelArchiveVerification(OPERATION_ID)).resolves.toBe(true)
    expect(harness.cancelMissionArchiveOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(harness.cancel).not.toHaveBeenCalled()
    terminal.reject(new Error('cancelled'))
    await expect(pending).rejects.toThrow(/failed safely/iu)
  })

  it('never overlaps verification retry with archive restore or an open plaintext session', async () => {
    const opening = deferred<MissionArchiveReviewSession & { readonly operationId: string }>()
    const openingHarness = createHarness({ open: vi.fn(() => opening.promise) })
    const openingController = await startMissionArchiveReviewRuntime(openingHarness.dependencies)
    const pendingOpen = openingController.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })
    await vi.waitFor(() => expect(openingHarness.open).toHaveBeenCalledOnce())
    await expect(openingController.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: FOREIGN_OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toThrow(/active work|archive review/iu)
    expect(openingHarness.verifyMissionArchive).not.toHaveBeenCalled()
    opening.resolve({ operationId: OPERATION_ID, ...V2_SESSION })
    await pendingOpen
    await expect(openingController.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: FOREIGN_OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })).rejects.toThrow(/active work|archive review/iu)
    await openingController.closeArchiveReview()

    const verification = deferred<MissionArchiveInfo>()
    const verificationHarness = createHarness({
      verifyMissionArchive: vi.fn(() => verification.promise),
    })
    const verificationController = await startMissionArchiveReviewRuntime(
      verificationHarness.dependencies,
    )
    const pendingVerification = verificationController.verifyArchive({
      archiveId: UNVERIFIED_V2_ID,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: SECRET,
    })
    await vi.waitFor(() => expect(verificationHarness.verifyMissionArchive).toHaveBeenCalledOnce())
    await expect(verificationController.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })).rejects.toThrow(/active work|archive verification/iu)
    expect(verificationHarness.open).not.toHaveBeenCalled()
    verification.reject(new Error('cancelled'))
    await expect(pendingVerification).rejects.toThrow(/failed safely/iu)
  })

  it('never lets a stalled older timeline refresh overwrite a newer archived projection', async () => {
    const stalledMissions = deferred<readonly Mission[]>()
    const listMissions = vi.fn()
      .mockResolvedValueOnce([MISSION])
      .mockImplementationOnce(() => stalledMissions.promise)
      .mockResolvedValueOnce([{
        ...MISSION,
        name: 'Current archived projection',
        storage_state: 'archived' as const,
      }])
    const harness = createHarness({ listMissions })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    const stalledRefresh = controller.refreshTimeline()
    await vi.waitFor(() => expect(listMissions).toHaveBeenCalledTimes(2))
    await expect(controller.refreshTimeline()).resolves.toBe(true)
    expect(harness.latestState().timeline[0]?.mission.name)
      .toBe('Current archived projection')

    stalledMissions.resolve([{
      ...MISSION,
      name: 'Stale live projection',
      storage_state: 'live',
    }])
    await expect(stalledRefresh).resolves.toBe(false)

    expect(harness.latestState().timeline[0]?.mission.name)
      .toBe('Current archived projection')
    expect(harness.latestState().timeline[0]?.mission.storage_state).toBe('archived')
  })

  it('opens only one selected v2 passphrase/recovery slot and switches Review to the fixed archive mission', async () => {
    const opened = deferred<
      MissionArchiveReviewSession & { readonly operationId: string }
    >()
    const harness = createHarness({
      open: vi.fn(() => opened.promise),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    const opening = controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'recovery',
      secret: SECRET,
    })
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledOnce())
    expect(harness.open).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'recovery',
      secret: SECRET,
    })

    harness.progress(fixtureProgress({ operationId: FOREIGN_OPERATION_ID }))
    expect(harness.latestState().progress).toBeNull()
    harness.progress(fixtureProgress({ archiveId: SUPERSEDED_V2_ID }))
    expect(harness.latestState().progress).toBeNull()
    harness.progress(fixtureProgress({ sequence: 2, completed: 2 }))
    expect(harness.latestState().progress).toMatchObject({
      operationId: OPERATION_ID,
      archiveId: VERIFIED_V2_ID,
      sequence: 2,
      completed: 2,
    })
    harness.progress(fixtureProgress({ sequence: 1, completed: 1 }))
    expect(harness.latestState().progress?.sequence).toBe(2)

    opened.resolve({ operationId: OPERATION_ID, ...V2_SESSION })
    await opening

    expect(harness.switchMissionReviewSource).toHaveBeenLastCalledWith({
      source: 'archive',
      archiveSession: V2_SESSION,
    })
    expect(harness.latestState()).toMatchObject({
      phase: 'open',
      activeOperationId: null,
      activeSession: V2_SESSION,
      progress: null,
      error: null,
    })
    expect(harness.latestState().activeSession?.missionId).toBe(MISSION.id)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(SECRET)
  })

  it('restores an open verified session for correction and returns Review to the live source', async () => {
    const restoreMissionForCorrection = vi.fn(async () => ({
      ...MISSION,
      status: 'finished' as const,
      storage_state: 'live' as const,
    }))
    const harness = createHarness({ restoreMissionForCorrection })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    harness.switchMissionReviewSource.mockClear()
    await expect(controller.restoreForCorrection({
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })).resolves.toBeUndefined()
    expect(restoreMissionForCorrection).toHaveBeenCalledWith({
      mission_id: MISSION.id,
      archiveId: VERIFIED_V2_ID,
      operationId: OPERATION_ID,
      sessionId: SESSION_ID,
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })
    expect(harness.close).toHaveBeenCalledOnce()
    expect(harness.switchMissionReviewSource).toHaveBeenCalledWith({ source: 'live' })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      recoveryRequired: 'none',
    })
  })

  it('keeps committed custody recovery visible when correction bytes need operator recovery', async () => {
    const restoreMissionForCorrection = vi.fn(async () => ({
      ...MISSION,
      status: 'finished' as const,
      storage_state: 'recovery_required' as const,
      correction: {
        committed: true,
        cleanupComplete: true,
        failureCode: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      },
    }))
    const harness = createHarness({ restoreMissionForCorrection })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })

    await expect(controller.restoreForCorrection({
      admin_name: 'Duty Admin',
      reason: 'Keep the attachment custody fence visible.',
    })).rejects.toThrow(/custody|recovery|failed safely/iu)
    expect(harness.close).toHaveBeenCalled()
    expect(harness.switchMissionReviewSource).toHaveBeenCalledWith({ source: 'live' })
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeSession: null,
      recoveryRequired: 'live_source_resume',
    })
    expect(harness.latestState().error).toMatch(/custody|recovery/iu)
  })

  it('keeps a committed correction in live-source recovery when the post-commit switch fails', async () => {
    const harness = createHarness()
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    harness.switchMissionReviewSource.mockRejectedValueOnce(new Error('live source unavailable'))

    await expect(controller.restoreForCorrection({
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })).rejects.toThrow(/failed safely/iu)
    expect(harness.close).toHaveBeenCalledTimes(2)
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeSession: null,
      recoveryRequired: 'live_source_resume',
    })
  })

  it('retains the open plaintext session when correction fails before cleanup can be confirmed', async () => {
    const harness = createHarness({
      restoreMissionForCorrection: vi.fn(async () => {
        throw new Error('restore failed')
      }),
      close: vi.fn(async () => { throw new Error('cleanup failed') }),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })

    await expect(controller.restoreForCorrection({
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })).rejects.toThrow(/failed safely/iu)
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeSession: V2_SESSION,
      recoveryRequired: 'plaintext_cleanup',
    })
    expect(harness.switchMissionReviewSource).not.toHaveBeenLastCalledWith({ source: 'live' })
  })

  it('accepts verified superseded v2, but rejects unverified, missing, newer, and malformed credential requests before IPC', async () => {
    const harness = createHarness()
    harness.open.mockResolvedValue({
      operationId: OPERATION_ID,
      ...V2_SESSION,
      archiveId: SUPERSEDED_V2_ID,
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: SUPERSEDED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).resolves.toBeUndefined()
    expect(harness.open).toHaveBeenCalledOnce()
    await controller.closeArchiveReview()
    harness.open.mockClear()

    for (const archiveId of [UNVERIFIED_V2_ID, MISSING_V2_ID, NEWER_V3_ID]) {
      await expect(controller.openArchive({
        archiveId,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: SECRET,
      })).rejects.toThrow(/available.*verified.*supported|verified.*available.*supported/iu)
    }
    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'machine',
      secret: SECRET,
    } as never)).rejects.toThrow(/passphrase.*recovery|recovery.*passphrase/iu)
    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: '',
    })).rejects.toThrow(/credential|secret/iu)
    await expect(controller.openArchive({
      archiveId: LEGACY_V1_ID,
      containerVersion: 1,
      secret: SECRET,
    } as never)).rejects.toThrow(/legacy.*credential|credential.*legacy/iu)
    expect(harness.open).not.toHaveBeenCalled()
  })

  it('opens supported v1 credential-free and preserves its honest legacy session identity', async () => {
    const harness = createHarness({
      open: vi.fn().mockResolvedValue({ operationId: OPERATION_ID, ...V1_SESSION }),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await controller.openArchive({ archiveId: LEGACY_V1_ID, containerVersion: 1 })

    expect(harness.open).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      archiveId: LEGACY_V1_ID,
      containerVersion: 1,
    })
    expect(harness.switchMissionReviewSource).toHaveBeenLastCalledWith({
      source: 'archive',
      archiveSession: V1_SESSION,
    })
    expect(harness.latestState().activeSession).toMatchObject({
      containerVersion: 1,
      encrypted: false,
      verified: false,
      ciphertextSha256: null,
    })
  })

  it('cancels a failed open, publishes no reflected secret, and stays on the live source', async () => {
    const harness = createHarness({
      open: vi.fn().mockRejectedValue(
        new Error(`backend reflected archive secret ${SECRET}`),
      ),
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toThrow(/archive review.*failed safely|failed safely.*archive review/iu)

    expect(harness.cancel).toHaveBeenCalledWith({ operationId: OPERATION_ID })
    expect(harness.switchMissionReviewSource).not.toHaveBeenCalled()
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeSession: null,
      progress: null,
    })
    expect(harness.latestState().error).toMatch(/failed safely/iu)
    expect(JSON.stringify(harness.applyRuntime.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(harness.applyRuntime.mock.calls))
      .not.toContain('backend reflected archive secret')
  })

  it('retains failed opening-cleanup ownership visibly and retries the exact operation', async () => {
    const cancel = vi.fn()
      .mockRejectedValueOnce(new Error('plaintext sweep unavailable'))
      .mockResolvedValueOnce(true)
    const harness = createHarness({
      open: vi.fn().mockRejectedValue(new Error('restore failed after plaintext extraction')),
      cancel,
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toThrow(/cleanup|failed safely/iu)

    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: OPERATION_ID,
      activeArchiveId: VERIFIED_V2_ID,
      activeSession: null,
      recoveryRequired: 'plaintext_cleanup',
    })
    expect(harness.latestState().error).toMatch(/plaintext|cleanup/iu)

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenNthCalledWith(1, { operationId: OPERATION_ID })
    expect(cancel).toHaveBeenNthCalledWith(2, { operationId: OPERATION_ID })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeOperationId: null,
      activeArchiveId: null,
      activeSession: null,
      recoveryRequired: 'none',
      error: null,
    })
  })

  it('retains opening-cleanup ownership when main reports that no cleanup target was found', async () => {
    const cancel = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const harness = createHarness({
      open: vi.fn().mockRejectedValue(Object.assign(
        new Error('Archive review operation failed safely (ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED).'),
        { code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' },
      )),
      cancel,
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toThrow(/cleanup|failed safely/iu)

    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: OPERATION_ID,
      activeArchiveId: VERIFIED_V2_ID,
      activeSession: null,
      recoveryRequired: 'plaintext_cleanup',
    })
    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('closes a manager-established session when renderer timeline validation rejects it', async () => {
    const staleSession = {
      operationId: OPERATION_ID,
      ...V2_SESSION,
      ciphertextSha256: 'f'.repeat(64),
    }
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('plaintext sweep unavailable'))
      .mockResolvedValueOnce(true)
    const harness = createHarness({
      open: vi.fn().mockResolvedValue(staleSession),
      close,
    })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toThrow(/cleanup|failed safely/iu)

    expect(close).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(harness.cancel).not.toHaveBeenCalled()
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeArchiveId: VERIFIED_V2_ID,
      activeSession: {
        sessionId: SESSION_ID,
        ciphertextSha256: 'f'.repeat(64),
      },
      recoveryRequired: 'plaintext_cleanup',
    })

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(2)
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      recoveryRequired: 'none',
    })
  })

  it('joins a cancelled restore and rejects a late successful session before it can publish or open', async () => {
    const restored = deferred<MissionArchiveReviewSession & { readonly operationId: string }>()
    const harness = createHarness({ open: vi.fn(() => restored.promise) })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    const publishedPhases: string[] = []
    harness.applyRuntime.mockImplementation((runtime: MissionArchiveReviewRuntimeState) => {
      publishedPhases.push(runtime.phase)
    })

    const opening = controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledOnce())

    let closeSettled = false
    const closing = controller.closeArchiveReview().finally(() => {
      closeSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    const settledBeforeRestoreExited = closeSettled

    restored.resolve({ operationId: OPERATION_ID, ...V2_SESSION })
    const [openingResult, closingResult] = await Promise.allSettled([opening, closing])

    expect(settledBeforeRestoreExited).toBe(false)
    expect(openingResult.status).toBe('rejected')
    expect(closingResult.status).toBe('fulfilled')
    expect(harness.cancel).toHaveBeenCalledWith({ operationId: OPERATION_ID })
    expect(harness.close).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(harness.switchMissionReviewSource).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: 'archive' }),
    )
    expect(publishedPhases).not.toContain('open')
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeOperationId: null,
      activeSession: null,
      progress: null,
      error: null,
    })
  })

  it('joins a pending archive source switch and cannot republish the closed session after close', async () => {
    const archiveSourceSwitch = deferred<void>()
    const switchMissionReviewSource = vi.fn((input: { readonly source: 'live' | 'archive' }) =>
      input.source === 'archive' ? archiveSourceSwitch.promise : Promise.resolve())
    const harness = createHarness({ switchMissionReviewSource })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    const publishedPhases: string[] = []
    harness.applyRuntime.mockImplementation((runtime: MissionArchiveReviewRuntimeState) => {
      publishedPhases.push(runtime.phase)
    })

    const opening = controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    await vi.waitFor(() => expect(switchMissionReviewSource).toHaveBeenCalledWith({
      source: 'archive',
      archiveSession: V2_SESSION,
    }))

    let closeSettled = false
    const closing = controller.closeArchiveReview().finally(() => {
      closeSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(closeSettled).toBe(false)

    archiveSourceSwitch.resolve(undefined)
    const [openingResult, closingResult] = await Promise.allSettled([opening, closing])

    expect(openingResult.status).toBe('rejected')
    expect(closingResult.status).toBe('fulfilled')
    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(harness.close).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(switchMissionReviewSource).toHaveBeenLastCalledWith({ source: 'live' })
    expect(publishedPhases).not.toContain('open')
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeOperationId: null,
      activeArchiveId: null,
      activeSession: null,
      progress: null,
      error: null,
    })
  })

  it('retains a late cancelled session when mandatory close fails and permits a cleanup retry', async () => {
    const restored = deferred<MissionArchiveReviewSession & { readonly operationId: string }>()
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('plaintext sweep unavailable'))
      .mockResolvedValueOnce(true)
    const harness = createHarness({ open: vi.fn(() => restored.promise), close })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    const opening = controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledOnce())
    const closing = controller.closeArchiveReview()

    restored.resolve({ operationId: OPERATION_ID, ...V2_SESSION })
    const [openingResult, closingResult] = await Promise.allSettled([opening, closing])

    expect(openingResult.status).toBe('rejected')
    expect(closingResult.status).toBe('rejected')
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeArchiveId: VERIFIED_V2_ID,
      activeSession: V2_SESSION,
      progress: null,
    })
    expect(harness.latestState().error).toMatch(/cleanup|plaintext/iu)

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(2)
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      error: null,
    })
  })

  it('retains a cleanup-blocked session when source switch and close both fail, then retries cleanup', async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('plaintext sweep unavailable'))
      .mockResolvedValueOnce(true)
    const switchMissionReviewSource = vi.fn()
      .mockRejectedValueOnce(new Error('archive source switch unavailable'))
      .mockResolvedValue(undefined)
    const harness = createHarness({ close, switchMissionReviewSource })
    harness.open.mockResolvedValue({ operationId: OPERATION_ID, ...V2_SESSION })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)

    await expect(controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })).rejects.toThrow(/cleanup|failed safely/iu)

    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeSession: V2_SESSION,
    })
    expect(harness.latestState().error).toMatch(/cleanup|plaintext/iu)

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenNthCalledWith(1, { sessionId: SESSION_ID })
    expect(close).toHaveBeenNthCalledWith(2, { sessionId: SESSION_ID })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      error: null,
    })
  })

  it('throws locally for undeclared facade mutations, invokes a bounded denial callback, and sends no IPC', () => {
    const read = vi.fn()
    vi.stubGlobal('window', {
      sartrackerElectron: {
        archiveReview: {
          read,
          open: vi.fn(),
          close: vi.fn(),
          cancel: vi.fn(),
          onProgress: vi.fn(),
        },
      },
    })
    const onMutationDenied = vi.fn()
    const createWithDenialAudit = createElectronArchiveReviewSource as unknown as (
      session: MissionArchiveReviewSession,
      options: { readonly onMutationDenied: (attemptedMethod: string) => void },
    ) => ElectronArchiveReviewSource
    const source = createWithDenialAudit(V2_SESSION, { onMutationDenied })
    const mutation = source as unknown as {
      readonly updateMission: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
    }

    expect(() => mutation.updateMission({
      missionId: MISSION.id,
      secret: SECRET,
      replacement: 'must-never-reach-ipc',
    })).toThrow(/archive review.*read-only|read-only.*archive review/iu)
    expect(read).not.toHaveBeenCalled()
    expect(onMutationDenied).toHaveBeenCalledOnce()
    expect(onMutationDenied).toHaveBeenCalledWith('updateMission')
    expect(JSON.stringify(onMutationDenied.mock.calls)).not.toContain(SECRET)
    expect(Buffer.byteLength(JSON.stringify(onMutationDenied.mock.calls), 'utf8')).toBeLessThan(256)
  })

  it('durably reports a facade mutation denial without forwarding attempted arguments', async () => {
    const read = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', {
      sartrackerElectron: {
        archiveReview: {
          read,
          open: vi.fn(),
          close: vi.fn(),
          cancel: vi.fn(),
          onProgress: vi.fn(),
        },
      },
    })
    const source = createElectronArchiveReviewSource(V2_SESSION)
    const mutation = source as unknown as {
      readonly updateMission: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
    }

    expect(() => mutation.updateMission({ secret: SECRET })).toThrow(/read-only/iu)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    expect(read).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      requestId: expect.any(String),
      method: 'recordMutationDenied',
      input: { attemptedMethod: 'updateMission' },
    })
    expect(JSON.stringify(read.mock.calls)).not.toContain(SECRET)
  })

  it('closes and sweeps the IPC session before switching Mission Review back to live', async () => {
    const order: string[] = []
    const harness = createHarness({
      close: vi.fn().mockImplementation(async () => {
        order.push('ipc-close-and-sweep')
        return true
      }),
      switchMissionReviewSource: vi.fn().mockImplementation(async (input) => {
        order.push(input.source)
      }),
    })
    harness.open.mockResolvedValue({ operationId: OPERATION_ID, ...V2_SESSION })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    order.length = 0

    await controller.closeArchiveReview()

    expect(harness.close).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(order).toEqual(['ipc-close-and-sweep', 'live'])
    expect(harness.switchMissionReviewSource).toHaveBeenLastCalledWith({ source: 'live' })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      activeOperationId: null,
      progress: null,
      error: null,
    })
  })

  it('retries only the live-source resume after plaintext cleanup already succeeded', async () => {
    const switchMissionReviewSource = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('live source temporarily unavailable'))
      .mockResolvedValueOnce(undefined)
    const harness = createHarness({ switchMissionReviewSource })
    harness.open.mockResolvedValue({ operationId: OPERATION_ID, ...V2_SESSION })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })

    await expect(controller.closeArchiveReview()).rejects.toThrow(/close|resume|failed safely/iu)
    expect(harness.close).toHaveBeenCalledOnce()
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeArchiveId: null,
      activeSession: null,
      recoveryRequired: 'live_source_resume',
    })
    expect(harness.latestState().error).toMatch(/live mission review.*resume/iu)

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(harness.close).toHaveBeenCalledOnce()
    expect(switchMissionReviewSource).toHaveBeenNthCalledWith(1, {
      source: 'archive',
      archiveSession: V2_SESSION,
    })
    expect(switchMissionReviewSource).toHaveBeenNthCalledWith(2, { source: 'live' })
    expect(switchMissionReviewSource).toHaveBeenNthCalledWith(3, { source: 'live' })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      recoveryRequired: 'none',
      error: null,
    })
  })

  it('retries only the durable mutation audit after manager-confirmed plaintext cleanup', async () => {
    const mutationAuditFailure = Object.assign(
      new Error('Archive review operation failed safely (ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED).'),
      { code: 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED' },
    )
    const close = vi.fn()
      .mockRejectedValueOnce(mutationAuditFailure)
      .mockResolvedValueOnce(true)
    const harness = createHarness({ close })
    harness.open.mockResolvedValue({ operationId: OPERATION_ID, ...V2_SESSION })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })

    await expect(controller.closeArchiveReview()).rejects.toThrow(/audit|failed safely/iu)
    expect(close).toHaveBeenCalledOnce()
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeOperationId: null,
      activeArchiveId: VERIFIED_V2_ID,
      activeSession: null,
      recoveryRequired: 'audit_retry',
    })
    expect(harness.latestState().error).toMatch(/audit.*pending|audit.*retry/iu)
    expect(harness.switchMissionReviewSource).toHaveBeenCalledTimes(1)

    await expect(controller.closeArchiveReview()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenNthCalledWith(1, { sessionId: SESSION_ID })
    expect(close).toHaveBeenNthCalledWith(2, { sessionId: SESSION_ID })
    expect(harness.switchMissionReviewSource).toHaveBeenLastCalledWith({ source: 'live' })
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      recoveryRequired: 'none',
      error: null,
    })
  })

  it('retains the archive banner/source if plaintext close fails, then closes it during unmount disposal', async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('plaintext sweep did not complete'))
      .mockResolvedValueOnce(true)
    const harness = createHarness({ close })
    harness.open.mockResolvedValue({ operationId: OPERATION_ID, ...V2_SESSION })
    const controller = await startMissionArchiveReviewRuntime(harness.dependencies)
    await controller.openArchive({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: SECRET,
    })
    harness.switchMissionReviewSource.mockClear()

    await expect(controller.closeArchiveReview()).rejects.toThrow(
      /plaintext.*cleanup|close.*failed safely|failed safely.*close/iu,
    )
    expect(harness.switchMissionReviewSource).not.toHaveBeenCalled()
    expect(harness.latestState()).toMatchObject({
      phase: 'error',
      activeSession: V2_SESSION,
    })

    await controller.dispose()
    expect(close).toHaveBeenCalledTimes(2)
    expect(harness.switchMissionReviewSource).toHaveBeenLastCalledWith({ source: 'live' })
    expect(harness.unsubscribeProgress).toHaveBeenCalledOnce()
    expect(harness.latestState()).toMatchObject({
      phase: 'idle',
      activeSession: null,
      progress: null,
    })
  })
})

/** Creates the closed runtime doubles shared by the orchestration tests. */
function createHarness(overrides: {
  readonly archivesByMission?: ReadonlyMap<string, readonly MissionArchiveInfo[]>
  readonly listMissions?: () => Promise<readonly Mission[]>
  readonly listMissionArchives?: (missionId: string) => Promise<readonly MissionArchiveInfo[]>
  readonly open?: ArchiveReviewBridge['open']
  readonly close?: ArchiveReviewBridge['close']
  readonly cancel?: ArchiveReviewBridge['cancel']
  readonly verifyMissionArchive?: MissionStore['verifyMissionArchive']
  readonly cancelMissionArchiveOperation?: MissionStore['cancelMissionArchiveOperation']
  readonly restoreMissionForCorrection?: MissionStore['restoreMissionForCorrection']
  readonly switchMissionReviewSource?: StartMissionArchiveReviewRuntimeDependencies['switchMissionReviewSource']
} = {}) {
  const archivesByMission = overrides.archivesByMission ?? new Map([
    [MISSION.id, [
      VERIFIED_V2,
      SUPERSEDED_VERIFIED_V2,
      UNVERIFIED_V2,
      MISSING_V2,
      NEWER_V3,
    ]],
    [SECOND_MISSION.id, [LEGACY_V1]],
  ])
  const listMissions = vi.fn(overrides.listMissions ?? (async () => [MISSION, SECOND_MISSION]))
  const listMissionArchives = vi.fn(overrides.listMissionArchives
    ?? (async (missionId: string) => archivesByMission.get(missionId) ?? []))
  const open = vi.fn(overrides.open ?? (async () => ({
    operationId: OPERATION_ID,
    ...V2_SESSION,
  })))
  const close = vi.fn(overrides.close ?? (async () => true))
  const cancel = vi.fn(overrides.cancel ?? (async () => true))
  const verifyMissionArchive = vi.fn(overrides.verifyMissionArchive ?? (async () => ({
    ...UNVERIFIED_V2,
    status: 'verified' as const,
    verified_at: '2026-08-30T17:00:00.000Z',
  })))
  const cancelMissionArchiveOperation = vi.fn(
    overrides.cancelMissionArchiveOperation ?? (async () => true),
  )
  const restoreMissionForCorrection = vi.fn(
    overrides.restoreMissionForCorrection ?? (async () => ({
      ...MISSION,
      status: 'finished' as const,
      storage_state: 'live' as const,
    })),
  )
  const unsubscribeProgress = vi.fn()
  let progressListener: ((progress: MissionArchiveReviewProgress) => void) | null = null
  const onProgress = vi.fn((listener: (progress: MissionArchiveReviewProgress) => void) => {
    progressListener = listener
    return unsubscribeProgress
  })
  const applyRuntime = vi.fn()
  const switchMissionReviewSource = vi.fn(
    overrides.switchMissionReviewSource ?? (async () => undefined),
  )
  const dependencies: StartMissionArchiveReviewRuntimeDependencies = {
    missionStore: {
      listMissions,
      listMissionArchives,
      verifyMissionArchive,
      cancelMissionArchiveOperation,
      restoreMissionForCorrection,
    },
    archiveReview: { open, close, cancel, onProgress },
    switchMissionReviewSource,
    applyRuntime,
    randomUUID: () => OPERATION_ID,
  }

  return {
    dependencies,
    listMissions,
    listMissionArchives,
    open,
    close,
    cancel,
    verifyMissionArchive,
    cancelMissionArchiveOperation,
    restoreMissionForCorrection,
    applyRuntime,
    switchMissionReviewSource,
    unsubscribeProgress,
    progress(progress: MissionArchiveReviewProgress): void {
      if (progressListener === null) {
        throw new Error('Archive review progress listener was not registered.')
      }
      progressListener(progress)
    },
    latestState(): MissionArchiveReviewRuntimeState {
      const call = applyRuntime.mock.calls.at(-1)
      if (call === undefined) {
        throw new Error('Archive review runtime state was not published.')
      }
      return call[0] as MissionArchiveReviewRuntimeState
    },
  }
}

/** Creates one valid registry-facing archive row. */
function archive(overrides: Partial<MissionArchiveInfo> = {}): MissionArchiveInfo {
  return {
    id: 'archive-default',
    mission_id: MISSION.id,
    protected_finalization_epoch: 1,
    archive_kind: 'finalized',
    container_version: 2,
    archive_path: `/archive-custody/${overrides.id ?? 'archive-default'}.sararch`,
    ciphertext_sha256: 'a'.repeat(64),
    size_bytes: 4096,
    created_at: '2026-08-29T16:10:00.000Z',
    verified_at: '2026-08-29T16:15:00.000Z',
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
      { slotId: 'passphrase-slot', slotType: 'passphrase' },
      { slotId: 'recovery-slot', slotType: 'recovery' },
    ],
    last_non_machine_unwrap_at: null,
    ...overrides,
  }
}

/** Creates one operation-scoped restore update. */
function fixtureProgress(
  overrides: Partial<MissionArchiveReviewProgress> = {},
): MissionArchiveReviewProgress {
  return {
    operationId: OPERATION_ID,
    archiveId: VERIFIED_V2_ID,
    containerVersion: 2,
    sequence: 1,
    phase: 'decrypt',
    unit: 'phases',
    completed: 1,
    total: 4,
    detail: 'Decrypting verified archive.',
    ...overrides,
  }
}

/** Small deterministic deferred used to inspect progress before open settles. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
