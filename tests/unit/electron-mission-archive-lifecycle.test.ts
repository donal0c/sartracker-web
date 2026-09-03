import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { archiveVerificationRetryAvailability } from '../../src/features/mission-review/start-mission-archive-review-runtime'
import type { MissionArchiveInfo } from '../../src/infrastructure/mission-store/tauri-mission-store'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { startArchiveVerifyWorker } = require('../../electron/archive-verify-runner.cjs') as {
  readonly startArchiveVerifyWorker: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
}
const {
  startArchiveCustodyReconciliation,
} = require('../../electron/archive-custody-reconcile-runner.cjs') as {
  readonly startArchiveCustodyReconciliation: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly archiveLifecycleFaultInjection?: {
      readonly afterRequestBeforeWorker?: boolean
      readonly afterPublishBeforeSeal?: boolean
      readonly failVerificationFailureAudit?: boolean
    }
    readonly startArchiveVerifyWorker?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly startArchivePlaintextSweep?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly startArchiveCustodyReconciliation?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly startArchiveCleanupCredentialCheck?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly startArchiveCleanupWorker?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly runMissionReviewReadQueryInWorker?: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly archiveCleanupFaultInjection?: Readonly<Record<string, unknown>>
    readonly archiveCleanupBatchLimits?: Readonly<Record<string, number>>
    readonly yieldArchiveCleanupToMain?: () => Promise<void>
    readonly readAdminRoster?: () => Promise<readonly string[]>
  }) => {
    readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<{
      readonly id: string
    }>
    readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly finalizeMission: (
      missionId: string,
      custody: { readonly passphrase: string; readonly recoveryCode: string },
      context?: {
        readonly operationId: string
        readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
      },
    ) => Promise<{
      readonly mission: Readonly<Record<string, unknown>>
      readonly archive: Readonly<Record<string, unknown>>
    }>
    readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly listMissions: () => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly readMissionReview: (
      input: Readonly<Record<string, unknown>>,
      requestId?: string,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly listDevices: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly listMarkers: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly listDrawings: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly listHelicopters: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly listGpxImportPage: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly listSearchOperationPage: (
      input: Readonly<Record<string, unknown>>,
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly listLayerCatalogMetadata: (
      missionId: string,
    ) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly runMarkerAttachmentIngest: (
      missionId: string,
      writeAttachment: () => Promise<string>,
      cleanupAttachment?: (attachmentPath: string) => Promise<void>,
    ) => Promise<string>
    readonly unlockFinalizedMission: (input: {
      readonly mission_id: string
      readonly admin_name: string
      readonly reason: string
    }) => Promise<Readonly<Record<string, unknown>>>
    readonly upsertMarker: (input: {
      readonly id?: string
      readonly mission_id: string
      readonly type: string
      readonly name: string
      readonly lat: number
      readonly lon: number
      readonly irish_grid_e: number
      readonly irish_grid_n: number
      readonly display_order: number
      readonly label_size: number
    }) => Promise<{ readonly id: string }>
    readonly listMissionArchives: (
      missionId: string,
    ) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly issueMissionArchiveReviewTicket: (
      archiveId: string,
    ) => Readonly<Record<string, unknown>>
    readonly getMissionCleanupEligibility: (
      input: { readonly missionId: string; readonly archiveId: string },
      context: { readonly reviewActivity: boolean },
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly startMissionCleanup: (
      input: {
        readonly missionId: string
        readonly archiveId: string
        readonly slotType: 'passphrase' | 'recovery'
        readonly secret: string
      },
      context: {
        readonly operationId: string
        readonly reviewActivity: boolean
        readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
      },
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly listInterruptedMissionCleanups: () => Promise<readonly {
      readonly missionId: string
      readonly archiveId: string
    }[]>
    readonly resumeMissionCleanup: (
      input: { readonly missionId: string; readonly archiveId: string },
      context: {
        readonly operationId: string
        readonly reviewActivity: boolean
        readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
      },
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly upsertDevice: (input: {
      readonly mission_id: string
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: string
    }) => Promise<Readonly<Record<string, unknown>>>
    readonly addPosition: (input: {
      readonly mission_id: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp: string
      readonly timestamp_source: 'fix'
    }) => Promise<Readonly<Record<string, unknown>>>
    readonly verifyMissionArchive: (
      input: {
        readonly archiveId: string
        readonly passphrase: string
        readonly recoveryCode: string
      },
      context?: {
        readonly operationId: string
        readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
      },
    ) => Promise<Readonly<Record<string, unknown>>>
    readonly cancelMissionArchiveOperation: (operationId: string) => Promise<boolean>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}

const temporaryDirectories = new Set<string>()
const custody = Object.freeze({
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})

/** Hashes one retained archive without mutating its custody bytes. */
function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** Reads only the canonical plaintext SARARCH2 header from a test-owned archive copy. */
function readArchiveHeader(filePath: string): Readonly<Record<string, unknown>> {
  const bytes = readFileSync(filePath)
  expect(bytes.subarray(0, 8).toString('ascii')).toBe('SARARCH2')
  const headerLength = bytes.readUInt32BE(8)
  return JSON.parse(bytes.subarray(12, 12 + headerLength).toString('utf8')) as Readonly<
    Record<string, unknown>
  >
}

/** Returns one already-failed worker operation with an independently settled physical exit. */
function failedWorkerOperation(code: string, message: string) {
  const error = Object.assign(new Error(message), { code })
  const operation = Promise.reject(error) as Promise<Readonly<Record<string, unknown>>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
  }
  Object.defineProperties(operation, {
    workerExited: { value: Promise.resolve() },
    cancel: { value: () => undefined },
  })
  return operation
}

/** Returns one unclassified failed worker operation for terminal normalization attacks. */
function unclassifiedFailedWorkerOperation(message: string) {
  const operation = Promise.reject(new Error(message)) as Promise<Readonly<Record<string, unknown>>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
  }
  Object.defineProperties(operation, {
    workerExited: { value: Promise.resolve() },
    cancel: { value: () => undefined },
  })
  return operation
}

/** Returns one already-complete secret-free cleanup credential worker result. */
function completedCleanupCredentialOperation(
  input: Readonly<Record<string, unknown>>,
  afterIdentity?: (archivePath: string) => void,
) {
  const request = input.request as Readonly<Record<string, unknown>>
  const archivePath = path.join(
    String(request.archiveDirectory),
    String(request.archiveRelativePath),
  )
  const stat = lstatSync(archivePath, { bigint: true })
  const fileIdentity = {
    changedTimeNanoseconds: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    linkCount: Number(stat.nlink),
    modifiedTimeNanoseconds: stat.mtimeNs.toString(),
    sizeBytes: Number(stat.size),
  }
  afterIdentity?.(archivePath)
  const completion = Promise.resolve({
    operationId: request.operationId,
    archiveId: request.archiveId,
    missionId: request.missionId,
    slotType: request.slotType,
    ciphertextSha256: request.ciphertextSha256,
    sizeBytes: request.sizeBytes,
    fileIdentity,
    custodyReconciled: true,
  }) as Promise<Readonly<Record<string, unknown>>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
  }
  Object.defineProperties(completion, {
    workerExited: { value: Promise.resolve() },
    cancel: { value: () => undefined },
  })
  return completion
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

describe('encrypted mission archive lifecycle integration', () => {
  it('blocks correction unlock when a verified v2 predecessor is unavailable', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-unavailable-predecessor-'))
    temporaryDirectories.add(userDataPath)
    const first = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await first.createMission({ name: 'Unavailable predecessor mission' })
    await first.finishMission(mission.id)
    const finalized = await first.finalizeMission(mission.id, custody, {
      operationId: '10101010-1010-4010-8010-101010101010',
      onProgress: () => undefined,
    })
    const archivePath = String(finalized.archive.archive_path)
    const archiveId = String(finalized.archive.id)
    await first.prepareClose()
    first.close()
    rmSync(archivePath, { force: true })

    const reopened = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    try {
      await vi.waitFor(async () => {
        await expect(reopened.listMissionArchives(mission.id)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: archiveId,
              status: 'verified',
              availability: 'missing',
            }),
          ]),
        )
      })
      await expect(reopened.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Do not create a correction epoch without its predecessor bytes.',
      })).rejects.toThrow(/archive|available|missing|restore/iu)
    } finally {
      await reopened.prepareClose()
      reopened.close()
    }
  }, 60_000)

  it('reconciles a v2 predecessor again before an in-process correction unlock', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-stale-predecessor-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    try {
      const mission = await store.createMission({ name: 'Stale predecessor mission' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '11111111-1111-4111-8111-111111111111',
        onProgress: () => undefined,
      })
      rmSync(String(finalized.archive.archive_path), { force: true })

      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Do not open a correction epoch after custody bytes disappear.',
      })).rejects.toThrow(/archive|available|missing|restore/iu)
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('blocks a legacy correction unlock when the retained ZIP predecessor is unavailable', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-unavailable-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    try {
      const mission = await store.createMission({ name: 'Legacy unavailable predecessor mission' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, undefined as never)
      rmSync(String(finalized.archive.archive_path), { force: true })

      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Do not open a correction epoch after legacy custody bytes disappear.',
      })).rejects.toThrow(/archive|available|missing|restore/iu)
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('blocks a correction finalization when its v2 predecessor disappears after unlock', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-v2-predecessor-after-unlock-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    try {
      const mission = await store.createMission({ name: 'Post-unlock predecessor mission' })
      await store.finishMission(mission.id)
      const first = await store.finalizeMission(mission.id, custody, {
        operationId: '12121212-1212-4121-8121-121212121212',
        onProgress: () => undefined,
      })
      const predecessorPath = String(first.archive.archive_path)
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correct the mission while retaining the first archive as custody.',
      })
      rmSync(predecessorPath, { force: true })

      await expect(store.finalizeMission(mission.id, custody, {
        operationId: '13131313-1313-4131-8131-131313131313',
        onProgress: () => undefined,
      })).rejects.toThrow(/archive|available|missing|predecessor/iu)
      await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('reconciles the archive bound to the latest finalization event, not a newer registry row', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-finalization-archive-binding-'))
    temporaryDirectories.add(userDataPath)
    const initial = createElectronMissionStore({ userDataPath })
    const mission = await initial.createMission({ name: 'Finalization archive binding mission' })
    await initial.finishMission(mission.id)
    const finalized = await initial.finalizeMission(mission.id, custody, {
      operationId: '15151515-1515-4151-8151-151515151515',
      onProgress: () => undefined,
    })
    const predecessorPath = String(finalized.archive.archive_path)
    const predecessorId = String(finalized.archive.id)
    await initial.prepareClose()
    initial.close()

    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const database = new Database(databasePath)
    try {
      const successorId = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6'
      const successorRelativePath = `${successorId}.sararch`
      const successorPath = path.join(userDataPath, 'archives', successorRelativePath)
      writeFileSync(successorPath, readFileSync(predecessorPath), { mode: 0o600 })
      const successorStat = lstatSync(successorPath, { bigint: true })
      const successorIdentity = JSON.stringify({
        changedTimeNanoseconds: successorStat.ctimeNs.toString(),
        device: successorStat.dev.toString(),
        inode: successorStat.ino.toString(),
        linkCount: Number(successorStat.nlink),
        modifiedTimeNanoseconds: successorStat.mtimeNs.toString(),
        sizeBytes: Number(successorStat.size),
      })
      database.prepare(`INSERT INTO mission_archives (
        id, mission_id, request_event_rowid, request_event_id,
        creation_operation_id, protected_finalization_epoch, archive_kind,
        container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
        sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
        table_count, verified_at, verification_proof_json, previous_archive_id,
        status, availability, availability_reason, last_reconciled_at,
        last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
        legacy_event_rowid
      ) SELECT ?, mission_id, request_event_rowid, request_event_id,
        creation_operation_id, protected_finalization_epoch, 'direct',
        container_version, ?, ciphertext_sha256, size_bytes, '2099-01-01T00:00:00.000Z',
        sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
        table_count, verified_at, verification_proof_json, NULL,
        'verified', 'present', NULL, last_reconciled_at,
        ?, slots_json, NULL, NULL
      FROM mission_archives WHERE id = ?`).run(
        successorId,
        successorRelativePath,
        successorIdentity,
        predecessorId,
      )
      rmSync(predecessorPath, { force: true })
    } finally {
      database.close()
    }

    const reopened = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    try {
      await expect(reopened.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Do not reconcile a different registry row than the finalization event.',
      })).rejects.toThrow(/archive|available|missing|predecessor/iu)
      await expect(reopened.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
    } finally {
      await reopened.prepareClose()
      reopened.close()
    }
  }, 60_000)

  it('joins an in-flight unlock reconciliation before closing the mission store', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-unlock-reconciliation-shutdown-'))
    temporaryDirectories.add(userDataPath)
    let blockNextReconciliation = false
    let reconciliationStarted = false
    let cancellationCount = 0
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCustodyReconciliation: (input) => {
        if (!blockNextReconciliation) return startArchiveCustodyReconciliation(input)
        blockNextReconciliation = false
        reconciliationStarted = true
        let releaseWorker
        const workerExited = new Promise((resolve) => {
          releaseWorker = resolve
        })
        let rejectOperation
        const completion = new Promise((_, reject) => {
          rejectOperation = reject
        })
        input.signal?.addEventListener('abort', () => {
          cancellationCount += 1
          const error = new Error('Archive custody reconciliation was cancelled.')
          error.name = 'AbortError'
          error.code = 'ARCHIVE_CANCELLED'
          rejectOperation(error)
          releaseWorker()
        }, { once: true })
        Object.defineProperties(completion, {
          workerExited: { value: workerExited },
          cancel: { value: () => input.signal?.dispatchEvent(new Event('abort')) },
        })
        return completion
      },
    })
    try {
      const mission = await store.createMission({ name: 'Unlock shutdown race mission' })
      await store.finishMission(mission.id)
      await store.finalizeMission(mission.id, custody, {
        operationId: '14141414-1414-4141-8141-141414141414',
        onProgress: () => undefined,
      })
      blockNextReconciliation = true
      const unlock = store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Validate clean shutdown joins correction custody reconciliation.',
      })
      await vi.waitFor(() => expect(reconciliationStarted).toBe(true))
      await expect(store.prepareClose()).resolves.toBeUndefined()
      expect(cancellationCount).toBe(1)
      expect(() => store.close()).not.toThrow()
      await expect(unlock).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    } finally {
      if (!reconciliationStarted) {
        await store.prepareClose()
        store.close()
      }
    }
  }, 60_000)

  it('does not reschedule startup archive reconciliation after prepareClose begins', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-reconciliation-close-race-'))
    temporaryDirectories.add(userDataPath)
    const seeded = createElectronMissionStore({ userDataPath })
    const mission = await seeded.createMission({ name: 'Reconciliation close race mission' })
    await seeded.finishMission(mission.id)
    await seeded.finalizeMission(mission.id, custody, {
      operationId: '15151515-1515-4515-8515-151515151515',
      onProgress: () => undefined,
    })
    await seeded.prepareClose()
    seeded.close()

    let starts = 0
    let cancellations = 0
    const reopened = createElectronMissionStore({
      userDataPath,
      startArchiveCustodyReconciliation: (input) => {
        starts += 1
        let rejectOperation
        const completion = new Promise((_, reject) => { rejectOperation = reject })
        const workerExited = new Promise((resolve) => {
          input.signal?.addEventListener('abort', () => {
            cancellations += 1
            const error = new Error('Archive custody reconciliation was cancelled.')
            error.name = 'AbortError'
            error.code = 'ARCHIVE_CANCELLED'
            rejectOperation(error)
            resolve()
          }, { once: true })
        })
        Object.defineProperties(completion, {
          workerExited: { value: workerExited },
          cancel: { value: () => input.signal?.dispatchEvent(new Event('abort')) },
        })
        return completion
      },
    })
    try {
      await vi.waitFor(() => expect(starts).toBe(1))
      await reopened.prepareClose()
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(starts).toBe(1)
      expect(cancellations).toBe(1)
      expect(() => reopened.close()).not.toThrow()
    } finally {
      try { reopened.close() } catch { void 0 }
    }
  }, 60_000)

  it('rejects cleanup before any delete when custody is replaced after credential proof', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-custody-race-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveCleanupCredentialCheck: (input) =>
        completedCleanupCredentialOperation(input, (archivePath) => {
          const replacementPath = `${archivePath}.replacement`
          writeFileSync(replacementPath, readFileSync(archivePath), { mode: 0o600 })
          renameSync(replacementPath, archivePath)
        }),
    })
    try {
      const mission = await store.createMission({ name: 'Cleanup custody race mission' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'custody-race-device',
        name: 'Custody Race Device',
        color: '#336699',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'custody-race-device',
        lat: 52.1,
        lon: -9.2,
        timestamp: '2026-08-30T08:01:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '80808080-8080-4080-8080-808080808080',
        onProgress: () => undefined,
      })

      await expect(store.startMissionCleanup({
        missionId: mission.id,
        archiveId: String(finalized.archive.id),
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '81818181-8181-4181-8181-818181818180',
        reviewActivity: false,
        onProgress: () => undefined,
      })).rejects.toMatchObject({
        code: expect.stringMatching(/CUSTODY|IDENTITY/u),
      })

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: false,
      })
      try {
        expect(db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?')
          .get(mission.id)).toEqual({ count: 1 })
        expect(db.prepare('SELECT 1 FROM mission_cleanup_journal WHERE mission_id = ?')
          .get(mission.id)).toBeUndefined()
      } finally {
        db.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('moves only verified mission rows out of the live store and retains an archive-reviewable stub', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-cleanup-store-'))
    temporaryDirectories.add(userDataPath)
    const credentialInputs: Readonly<Record<string, unknown>>[] = []
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCleanupCredentialCheck: (input) => {
        credentialInputs.push(input)
        return completedCleanupCredentialOperation(input)
      },
    })
    try {
      const mission = await store.createMission({
        name: 'Archive cleanup mission',
        start_time: '2026-08-29T08:00:00.000Z',
      })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'device-1',
        name: 'Team Alpha',
        color: '#ff0000',
        status: 'online',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'device-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-08-29T08:05:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '81818181-8181-4181-8181-818181818181',
        onProgress: () => undefined,
      })
      const archiveId = String(finalized.archive.id)
      const archivePath = String(finalized.archive.archive_path)
      const archiveDigest = sha256File(archivePath)

      await expect(store.getMissionCleanupEligibility(
        { missionId: mission.id, archiveId },
        { reviewActivity: false },
      )).resolves.toEqual({
        eligible: false,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      })

      await expect(store.getMissionCleanupEligibility(
        { missionId: mission.id, archiveId },
        { reviewActivity: true },
      )).resolves.toMatchObject({
        eligible: false,
        blockers: expect.arrayContaining(['archive_review_active']),
      })

      const progress: Readonly<Record<string, unknown>>[] = []
      await expect(store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '82828282-8282-4282-8282-828282828282',
        reviewActivity: false,
        onProgress: (update) => {
          progress.push(update)
          throw new Error('simulated cleanup progress observer failure')
        },
      })).resolves.toMatchObject({
        missionId: mission.id,
        archiveId,
        state: 'completed',
        storageState: 'archived',
        deletedRows: expect.any(Number),
      })

      expect(credentialInputs).toHaveLength(1)
      expect(JSON.stringify(credentialInputs[0]?.request ?? {})).not.toContain(custody.passphrase)
      expect(credentialInputs[0]?.secret).toBe(custody.passphrase)
      expect(progress.length).toBeGreaterThan(0)
      expect(progress.every((entry) => entry.kind === 'cleanup')).toBe(true)
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'archived',
      })
      await expect(store.listMissions()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: mission.id, storage_state: 'archived' }),
      ]))
      expect(store.issueMissionArchiveReviewTicket(archiveId)).toMatchObject({
        archiveId,
        missionId: mission.id,
        status: 'verified',
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Must not reopen an incomplete live namespace.',
      })).rejects.toThrow(/archived|restore/iu)
      expect(sha256File(archivePath)).toBe(archiveDigest)

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        expect(db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?')
          .get(mission.id)).toEqual({ count: 0 })
        expect(db.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?')
          .get(mission.id)).toEqual({ count: 0 })
        expect(db.prepare('SELECT state FROM mission_cleanup_journal WHERE mission_id = ?')
          .get(mission.id)).toEqual({ state: 'completed' })
        expect(db.prepare(`SELECT COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
          .get(mission.id)).toEqual({ count: 1 })
        db.prepare("UPDATE mission_archives SET status = 'sealed' WHERE id = ?")
          .run(archiveId)
      } finally {
        db.close()
      }
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        storage_state: 'archived',
      })
      await expect(store.readMissionReview({
        missionId: mission.id,
        includeTelemetry: false,
        auditLimit: 10,
      }, 'corrupt-completed-cleanup-review')).rejects.toThrow(/archive|cleanup/iu)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('resumes an operator-started cleanup from its durable cursor after restart without another secret', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-cleanup-resume-'))
    temporaryDirectories.add(userDataPath)
    const first = createElectronMissionStore({
      userDataPath,
      archiveCleanupFaultInjection: { simulateKillAfterCommittedBatch: 1 },
      startArchiveCleanupCredentialCheck: completedCleanupCredentialOperation,
    })
    const mission = await first.createMission({
      name: 'Interrupted cleanup mission',
      start_time: '2026-08-29T08:30:00.000Z',
    })
    await first.upsertDevice({
      mission_id: mission.id,
      device_id: 'resume-device',
      name: 'Resume Device',
      color: '#0088ff',
      status: 'offline',
    })
    await first.addPosition({
      mission_id: mission.id,
      device_id: 'resume-device',
      lat: 52.1,
      lon: -9.1,
      timestamp: '2026-08-29T08:31:00.000Z',
      timestamp_source: 'fix',
    })
    await first.finishMission(mission.id)
    const finalized = await first.finalizeMission(mission.id, custody, {
      operationId: '83838383-8383-4383-8383-838383838383',
      onProgress: () => undefined,
    })
    const archiveId = String(finalized.archive.id)
    await expect(first.startMissionCleanup({
      missionId: mission.id,
      archiveId,
      slotType: 'recovery',
      secret: custody.recoveryCode,
    }, {
      operationId: '84848484-8484-4484-8484-848484848484',
      reviewActivity: false,
      onProgress: () => undefined,
    })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
    await expect(first.listInterruptedMissionCleanups()).resolves.toEqual([
      { missionId: mission.id, archiveId },
    ])
    await first.prepareClose()
    first.close()

    const recovered = createElectronMissionStore({ userDataPath })
    try {
      await expect(recovered.resumeMissionCleanup({
        missionId: mission.id,
        archiveId,
      }, {
        operationId: '85858585-8585-4585-8585-858585858585',
        reviewActivity: false,
        onProgress: () => undefined,
      })).resolves.toMatchObject({ state: 'completed', storageState: 'archived' })
      await expect(recovered.listInterruptedMissionCleanups()).resolves.toEqual([])
      await expect(recovered.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'archived',
      })
      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(db.prepare(`SELECT event_type, COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type IN (
            'mission_cleanup_started', 'mission_cleanup_completed'
          ) GROUP BY event_type ORDER BY event_type`).all(mission.id)).toEqual([
          { event_type: 'mission_cleanup_completed', count: 1 },
          { event_type: 'mission_cleanup_started', count: 1 },
        ])
      } finally {
        db.close()
      }
    } finally {
      await recovered.prepareClose()
      recovered.close()
    }
  }, 60_000)

  it('projects completed finalized-recovery cleanup as archived and permanently blocks live unlock', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-recovery-state-'))
    temporaryDirectories.add(userDataPath)
    const readAdminRoster = vi.fn().mockResolvedValue(['Duty Admin'])
    const store = createElectronMissionStore({ userDataPath, readAdminRoster })
    try {
      const mission = await store.createMission({ name: 'Recovery archive cleanup mission' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '89898989-8989-4989-8989-898989898989',
        onProgress: () => undefined,
      })
      const originalArchiveId = String(finalized.archive.id)
      const recoveryArchiveId = '97979797-9797-4797-9797-979797979797'
      const databasePath = path.join(userDataPath, 'mission-store.sqlite')
      const db = new Database(databasePath)
      try {
        const finalizedEpoch = Number(db.prepare(`SELECT rowid FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_finalized'
          ORDER BY rowid DESC LIMIT 1`).get(mission.id).rowid)
        db.prepare(`INSERT INTO mission_archives (
          id, mission_id, request_event_rowid, request_event_id,
          creation_operation_id, protected_finalization_epoch, archive_kind,
          container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
          sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
          table_count, verified_at, verification_proof_json, previous_archive_id,
          status, availability, availability_reason, last_reconciled_at,
          last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
          legacy_event_rowid
        ) SELECT ?, mission_id, request_event_rowid, request_event_id,
          ?, ?, 'finalized_recovery', container_version, ?, ciphertext_sha256,
          size_bytes, created_at, sealed_event_id, frame_count, header_sha256,
          manifest_sha256, entry_count, table_count, verified_at,
          verification_proof_json, NULL, 'verified', 'present', NULL,
          last_reconciled_at, last_observed_file_identity, slots_json, NULL, NULL
        FROM mission_archives WHERE id = ?`).run(
          recoveryArchiveId,
          '96969696-9696-4696-9696-969696969696',
          finalizedEpoch,
          `${recoveryArchiveId}.sararch`,
          originalArchiveId,
        )
        db.prepare(`INSERT INTO mission_cleanup_journal (
          mission_id, archive_id, state, progress_json, started_at, updated_at,
          completed_at, last_error
        ) VALUES (?, ?, 'completed', ?, ?, ?, ?, NULL)`).run(
          mission.id,
          recoveryArchiveId,
          JSON.stringify({
            version: 1,
            archiveId: recoveryArchiveId,
            ciphertextSha256: String(finalized.archive.ciphertext_sha256),
            sizeBytes: Number(finalized.archive.size_bytes),
            finalizationEpoch: finalizedEpoch,
            verificationProofSha256: 'a'.repeat(64),
            tables: ['positions'],
            tableIndex: 1,
            tableBatch: 0,
            deletedRows: 1,
          }),
          '2026-08-30T10:00:00.000Z',
          '2026-08-30T10:01:00.000Z',
          '2026-08-30T10:01:00.000Z',
        )
      } finally {
        db.close()
      }

      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'archived',
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Archived recovery bytes must not reopen a deleted live namespace.',
      })).rejects.toThrow(/archived|restore/iu)
      expect(readAdminRoster).not.toHaveBeenCalled()
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('rechecks cleanup storage state after asynchronous admin authorization and blocks live Review', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-unlock-race-'))
    temporaryDirectories.add(userDataPath)
    let rosterRequested!: () => void
    let releaseRoster!: () => void
    const requested = new Promise<void>((resolve) => { rosterRequested = resolve })
    const roster = new Promise<readonly string[]>((resolve) => {
      releaseRoster = () => resolve(['Duty Admin'])
    })
    let releaseReview!: (result: Readonly<Record<string, unknown>>) => void
    const heldReview = new Promise<Readonly<Record<string, unknown>>>((resolve) => {
      releaseReview = resolve
    })
    const runMissionReviewReadQueryInWorker = vi.fn(() => heldReview)
    const store = createElectronMissionStore({
      userDataPath,
      runMissionReviewReadQueryInWorker,
      readAdminRoster: async () => {
        rosterRequested()
        return roster
      },
    })
    let unlock: Promise<Readonly<Record<string, unknown>>> | null = null
    try {
      const mission = await store.createMission({ name: 'Cleanup authorization race mission' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '91919191-9191-4191-9191-919191919191',
        onProgress: () => undefined,
      })
      const archiveId = String(finalized.archive.id)
      const liveReview = store.readMissionReview({
        missionId: mission.id,
        includeTelemetry: false,
        auditLimit: 10,
      }, 'cleanup-race-review')
      await vi.waitFor(() => expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledOnce())
      unlock = store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Must lose if cleanup starts while the roster is being checked.',
      })
      await requested

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        const finalizedEpoch = Number(db.prepare(`SELECT rowid FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_finalized'
          ORDER BY rowid DESC LIMIT 1`).get(mission.id).rowid)
        db.prepare(`INSERT INTO mission_cleanup_journal (
          mission_id, archive_id, state, progress_json, started_at, updated_at,
          completed_at, last_error
        ) VALUES (?, ?, 'in_progress', ?, ?, ?, NULL, NULL)`).run(
          mission.id,
          archiveId,
          JSON.stringify({
            version: 1,
            archiveId,
            ciphertextSha256: String(finalized.archive.ciphertext_sha256),
            sizeBytes: Number(finalized.archive.size_bytes),
            finalizationEpoch: finalizedEpoch,
            verificationProofSha256: 'b'.repeat(64),
            tables: ['positions'],
            tableIndex: 0,
            tableBatch: 1,
            deletedRows: 1,
          }),
          '2026-08-30T11:00:00.000Z',
          '2026-08-30T11:00:00.000Z',
        )
      } finally {
        db.close()
      }

      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        storage_state: 'cleanup_in_progress',
      })
      const blockedFacets = [
        () => store.listDevices(mission.id),
        () => store.listMarkers(mission.id),
        () => store.listDrawings(mission.id),
        () => store.listHelicopters(mission.id),
        () => store.listGpxImportPage({ missionId: mission.id, limit: 25 }),
        () => store.listSearchOperationPage({ missionId: mission.id, kind: 'areas', limit: 25 }),
        () => store.listLayerCatalogMetadata(mission.id),
      ]
      for (const blockedFacet of blockedFacets) {
        await expect(blockedFacet()).rejects.toThrow(/cleanup|archive/iu)
      }
      releaseReview({ auditEvents: [], breadcrumbCount: 1 })
      await expect(liveReview).rejects.toThrow(/cleanup|archive/iu)
      releaseRoster()
      await expect(unlock).rejects.toThrow(/cleanup|archived|storage/iu)
      unlock = null
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'cleanup_in_progress',
      })
    } finally {
      releaseRoster?.()
      await unlock?.catch(() => undefined)
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('does not retain the cleanup credential in the long-running normalized input closure', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'electron', 'mission-store.cjs'),
      'utf8',
    )
    const start = source.indexOf('const enqueueMissionCleanup =')
    const end = source.indexOf('\n  const enqueueArchive =', start)
    const cleanupSource = source.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(cleanupSource).not.toContain('secret: normalizedInput.secret')
    expect(cleanupSource).toMatch(/let cleanupSecret/u)
    expect(cleanupSource.indexOf('cleanupSecret = null'))
      .toBeLessThan(cleanupSource.indexOf('buildArchiveCleanupEvidence'))
  })

  it('does not let cleanup delete until a cancelled Review worker physically exits', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-review-exit-'))
    temporaryDirectories.add(userDataPath)
    let releaseWorkerExit: (() => void) | undefined
    const workerExited = new Promise<void>((resolve) => { releaseWorkerExit = resolve })
    const runMissionReviewReadQueryInWorker = vi.fn((input: { readonly signal: AbortSignal }) => {
      const operation = new Promise<Readonly<Record<string, unknown>>>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        }, { once: true })
      })
      Object.defineProperty(operation, 'workerExited', { value: workerExited })
      return operation
    })
    const store = createElectronMissionStore({
      userDataPath,
      runMissionReviewReadQueryInWorker,
      startArchiveCleanupCredentialCheck: completedCleanupCredentialOperation,
    })
    let cleanup: Promise<Readonly<Record<string, unknown>>> | null = null
    try {
      const mission = await store.createMission({ name: 'Review exit cleanup barrier mission' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'review-exit-device',
        name: 'Review Exit Device',
        color: '#334455',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'review-exit-device',
        lat: 52.1,
        lon: -9.2,
        timestamp: '2026-08-30T12:00:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '92929292-9292-4292-9292-929292929292',
        onProgress: () => undefined,
      })
      const review = store.readMissionReview({
        missionId: mission.id,
        includeTelemetry: false,
        auditLimit: 10,
      }, 'cleanup-review-worker-exit')
      await vi.waitFor(() => expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledOnce())

      await expect(store.cancelMissionReviewRead('cleanup-review-worker-exit')).resolves.toBe(true)
      await expect(review).rejects.toMatchObject({ name: 'AbortError' })
      let observeCleanupProgress: (() => void) | undefined
      const cleanupProgress = new Promise<void>((resolve) => {
        observeCleanupProgress = resolve
      })
      cleanup = store.startMissionCleanup({
        missionId: mission.id,
        archiveId: String(finalized.archive.id),
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '93939393-9393-4393-9393-939393939393',
        reviewActivity: false,
        onProgress: () => observeCleanupProgress?.(),
      })
      let cleanupSettled = false
      void cleanup.catch(() => undefined).finally(() => { cleanupSettled = true })
      const beforeWorkerExit = await Promise.race([
        cleanupProgress.then(() => 'cleanup-progress'),
        cleanup.then(() => 'cleanup-complete', () => 'cleanup-failed'),
        new Promise<'worker-still-owned'>((resolve) => setTimeout(
          () => resolve('worker-still-owned'),
          1_000,
        )),
      ])

      expect(beforeWorkerExit).toBe('worker-still-owned')
      expect(cleanupSettled).toBe(false)
      const beforeExit = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(beforeExit.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?')
          .get(mission.id)).toEqual({ count: 1 })
      } finally {
        beforeExit.close()
      }

      releaseWorkerExit?.()
      releaseWorkerExit = undefined
      await expect(cleanup).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
      cleanup = null
    } finally {
      releaseWorkerExit?.()
      await cleanup?.catch(() => undefined)
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('holds cleanup fences until the cancelled cleanup worker physically exits', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-worker-exit-'))
    temporaryDirectories.add(userDataPath)
    let releaseWorkerExit: (() => void) | undefined
    const workerExited = new Promise<void>((resolve) => { releaseWorkerExit = resolve })
    let signal: AbortSignal | undefined
    let rejectCompletion: ((reason: unknown) => void) | undefined
    let resolveWorkerStarted: (() => void) | undefined
    const workerStarted = new Promise<void>((resolve) => { resolveWorkerStarted = resolve })
    const startArchiveCleanupWorker = (input: Readonly<Record<string, unknown>>) => {
      signal = input.signal as AbortSignal | undefined
      const completion = new Promise<Readonly<Record<string, unknown>>>((_resolve, reject) => {
        rejectCompletion = reject
      }) as Promise<Readonly<Record<string, unknown>>> & {
        readonly workerExited: Promise<void>
        readonly cancel: () => void
      }
      Object.defineProperties(completion, {
        workerExited: { value: workerExited },
        cancel: { value: () => signal?.dispatchEvent(new Event('abort')) },
      })
      signal?.addEventListener('abort', () => {
        const error = Object.assign(new Error('cleanup worker cancelled'), {
          code: 'ARCHIVE_CLEANUP_CANCELLED',
        })
        rejectCompletion?.(error)
      }, { once: true })
      const onProgress = input.onProgress
      if (typeof onProgress === 'function') onProgress({ phase: 'started' })
      resolveWorkerStarted?.()
      return completion
    }
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveCleanupCredentialCheck: completedCleanupCredentialOperation,
      startArchiveCleanupWorker,
    })
    let cleanup: Promise<Readonly<Record<string, unknown>>> | null = null
    try {
      const mission = await store.createMission({ name: 'Cleanup worker exit fence mission' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'cleanup-worker-exit-device',
        name: 'Cleanup Worker Exit Device',
        color: '#335577',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'cleanup-worker-exit-device',
        lat: 52.1,
        lon: -9.2,
        timestamp: '2026-08-30T13:00:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '94949494-9494-4494-9494-949494949494',
        onProgress: () => undefined,
      })
      cleanup = store.startMissionCleanup({
        missionId: mission.id,
        archiveId: String(finalized.archive.id),
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '95959595-9595-4595-9595-959595959595',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await workerStarted
      await expect(store.cancelMissionArchiveOperation(
        '95959595-9595-4595-9595-959595959595',
      )).resolves.toBe(true)

      let cleanupSettled = false
      void cleanup.catch(() => undefined).finally(() => { cleanupSettled = true })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(cleanupSettled).toBe(false)
      await expect(store.listDevices(mission.id)).rejects.toMatchObject({
        code: 'MISSION_REVIEW_CLEANUP_IN_PROGRESS',
      })

      releaseWorkerExit?.()
      releaseWorkerExit = undefined
      await expect(cleanup).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_CANCELLED' })
      cleanup = null
    } finally {
      releaseWorkerExit?.()
      await cleanup?.catch(() => undefined)
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('treats shutdown cancellation of bounded cleanup as an expected durable restart point', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-cleanup-close-'))
    temporaryDirectories.add(userDataPath)
    let holdNextYield = false
    let releaseYield: (() => void) | undefined
    let observeProgress: (() => void) | undefined
    const progressObserved = new Promise<void>((resolve) => { observeProgress = resolve })
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveCleanupCredentialCheck: completedCleanupCredentialOperation,
      archiveCleanupBatchLimits: { positions: 1, default: 1 },
      yieldArchiveCleanupToMain: () => {
        if (!holdNextYield) return Promise.resolve()
        return new Promise<void>((resolve) => { releaseYield = resolve })
      },
    })
    const mission = await store.createMission({
      name: 'Cleanup shutdown mission',
      start_time: '2026-08-29T09:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'shutdown-device',
      name: 'Shutdown Device',
      color: '#00aa66',
      status: 'online',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'shutdown-device',
      lat: 52.2,
      lon: -9.2,
      timestamp: '2026-08-29T09:01:00.000Z',
      timestamp_source: 'fix',
    })
    await store.finishMission(mission.id)
    const finalized = await store.finalizeMission(mission.id, custody, {
      operationId: '86868686-8686-4686-8686-868686868686',
      onProgress: () => undefined,
    })
    const cleanup = store.startMissionCleanup({
      missionId: mission.id,
      archiveId: String(finalized.archive.id),
      slotType: 'passphrase',
      secret: custody.passphrase,
    }, {
      operationId: '87878787-8787-4787-8787-878787878787',
      reviewActivity: false,
      onProgress: () => {
        holdNextYield = true
        observeProgress?.()
      },
    }).then(
      () => null,
      (error: unknown) => error,
    )

    await progressObserved
    const closing = store.prepareClose()
    releaseYield?.()
    await expect(closing).resolves.toBeUndefined()
    await expect(cleanup).resolves.toMatchObject({ code: 'ARCHIVE_CLEANUP_CANCELLED' })
    store.close()
  }, 60_000)

  it('creates an immutable audited supplemental chain after authorized correction and rejects predecessor-epoch verification', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-supplement-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    } as never)
    try {
      const mission = await store.createMission({
        name: 'Supplement archive mission',
        start_time: '2026-08-29T09:00:00.000Z',
      })
      const marker = await store.upsertMarker({
        mission_id: mission.id,
        type: 'clue',
        name: 'Initial clue description',
        lat: 52.0599,
        lon: -9.5045,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
        label_size: 14,
      })
      await store.finishMission(mission.id)
      const first = await store.finalizeMission(mission.id, custody, {
        operationId: '71717171-7171-4171-8171-717171717171',
        onProgress: () => undefined,
      })
      const firstPath = String(first.archive.archive_path)
      const firstArchiveId = String(first.archive.id)
      const firstCiphertextSha256 = String(first.archive.ciphertext_sha256)
      const firstBytesSha256 = sha256File(firstPath)

      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correct the clue description recorded during review.',
      })
      await store.upsertMarker({
        id: marker.id,
        mission_id: mission.id,
        type: 'clue',
        name: 'Corrected clue description',
        lat: 52.0599,
        lon: -9.5045,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
        label_size: 14,
      })
      const second = await store.finalizeMission(mission.id, custody, {
        operationId: '72727272-7272-4272-8272-727272727272',
        onProgress: () => undefined,
      })

      expect(second.mission).toMatchObject({ status: 'finalized' })
      expect(second.archive).toMatchObject({
        status: 'verified',
        previous_archive_id: firstArchiveId,
      })
      expect(String(second.archive.archive_path)).not.toBe(firstPath)
      expect(sha256File(firstPath)).toBe(firstBytesSha256)
      expect(readArchiveHeader(String(second.archive.archive_path))).toMatchObject({
        previous_archive_sha256: firstCiphertextSha256,
      })

      const archives = await store.listMissionArchives(mission.id)
      expect(archives).toEqual([
        expect.objectContaining({
          id: second.archive.id,
          previous_archive_id: firstArchiveId,
          previous_archive_sha256: firstCiphertextSha256,
          revision_sequence: 2,
          revision_count: 2,
          supplement_authority: 'Duty Admin',
          supplement_reason: 'Correct the clue description recorded during review.',
          supplement_created_at: expect.any(String),
          status: 'verified',
        }),
        expect.objectContaining({
          id: firstArchiveId,
          previous_archive_sha256: null,
          revision_sequence: 1,
          revision_count: 2,
          supplement_authority: null,
          supplement_reason: null,
          supplement_created_at: null,
          status: 'superseded',
          ciphertext_sha256: firstCiphertextSha256,
        }),
      ])

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const supplement = db.prepare(`SELECT * FROM mission_archive_supplements
          WHERE mission_id = ?`).get(mission.id)
        expect(supplement).toMatchObject({
          archive_id: second.archive.id,
          previous_archive_id: firstArchiveId,
          supplement_sequence: 1,
          authority: 'Duty Admin',
          reason: 'Correct the clue description recorded during review.',
          audit_event_id: expect.any(String),
        })
        const supplementEvent = db.prepare(`SELECT event_type, timestamp, details_json
          FROM mission_events WHERE id = ?`).get(supplement.audit_event_id)
        expect(supplementEvent.event_type).toBe('mission_archive_supplement_recorded')
        expect(JSON.parse(String(supplementEvent.details_json))).toEqual({
          archive_id: second.archive.id,
          previous_archive_id: firstArchiveId,
          supplement_sequence: 1,
          authority: 'Duty Admin',
          reason: 'Correct the clue description recorded during review.',
          resulting_status: 'finalized',
        })
        const versions = db.prepare(`SELECT version_sequence, state_json, audit_event_id
          FROM mission_object_versions
          WHERE mission_id = ? AND object_type = 'marker' AND object_id = ?
          ORDER BY version_sequence`).all(mission.id, marker.id)
        expect(versions).toHaveLength(2)
        expect(JSON.parse(String(versions[0].state_json))).toMatchObject({
          name: 'Initial clue description',
        })
        expect(JSON.parse(String(versions[1].state_json))).toMatchObject({
          name: 'Corrected clue description',
        })
        expect(versions.every((version: { readonly audit_event_id: string | null }) =>
          typeof version.audit_event_id === 'string')).toBe(true)
      } finally {
        db.close()
      }

      await expect(store.verifyMissionArchive({
        archiveId: firstArchiveId,
        ...custody,
      })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_EPOCH_CHANGED' })
      expect(sha256File(firstPath)).toBe(firstBytesSha256)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('chains a corrected SARARCH2 revision to the exact retained legacy ZIP bytes', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-supplement-'))
    temporaryDirectories.add(userDataPath)
    const firstStore = createElectronMissionStore({ userDataPath })
    const mission = await firstStore.createMission({ name: 'Legacy correction mission' })
    const marker = await firstStore.upsertMarker({
      mission_id: mission.id,
      type: 'clue',
      name: 'Legacy clue description',
      lat: 52.0599,
      lon: -9.5045,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
      label_size: 14,
    })
    await firstStore.finishMission(mission.id)
    const legacyFinalized = await firstStore.finalizeMission(mission.id, undefined as never)
    const legacyArchivePath = String(legacyFinalized.archive.archive_path)
    const legacyArchiveSha256 = sha256File(legacyArchivePath)
    await firstStore.prepareClose()
    firstStore.close()

    const migrationDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
    try {
      migrationDb.prepare(`DELETE FROM metadata WHERE key IN (
        'legacy_archive_registry_backfill_cursor',
        'legacy_archive_registry_backfill_target'
      )`).run()
    } finally {
      migrationDb.close()
    }

    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    } as never)
    try {
      let legacyArchive: Readonly<Record<string, unknown>> | undefined
      await vi.waitFor(async () => {
        const archives = await store.listMissionArchives(mission.id)
        legacyArchive = archives.find((archive) => archive.container_version === 1)
        expect(legacyArchive).toMatchObject({ availability: 'present', status: 'sealed' })
      }, { timeout: 5_000, interval: 20 })
      const legacyArchiveId = String(legacyArchive?.id)

      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correct a clue description retained in the legacy archive.',
      })
      await store.upsertMarker({
        id: marker.id,
        mission_id: mission.id,
        type: 'clue',
        name: 'Corrected post-migration clue description',
        lat: 52.0599,
        lon: -9.5045,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
        label_size: 14,
      })
      const corrected = await store.finalizeMission(mission.id, custody, {
        operationId: '73737373-7373-4373-8373-737373737373',
        onProgress: () => undefined,
      })

      expect(readArchiveHeader(String(corrected.archive.archive_path))).toMatchObject({
        previous_archive_sha256: legacyArchiveSha256,
      })
      expect(sha256File(legacyArchivePath)).toBe(legacyArchiveSha256)
      await expect(store.listMissionArchives(mission.id)).resolves.toEqual([
        expect.objectContaining({
          id: corrected.archive.id,
          previous_archive_id: legacyArchiveId,
          previous_archive_sha256: legacyArchiveSha256,
          status: 'verified',
          revision_sequence: 2,
          revision_count: 2,
        }),
        expect.objectContaining({
          id: legacyArchiveId,
          container_version: 1,
          status: 'superseded',
          revision_sequence: 1,
          revision_count: 2,
        }),
      ])
      expect(store.issueMissionArchiveReviewTicket(legacyArchiveId)).toMatchObject({
        archiveId: legacyArchiveId,
        containerVersion: 1,
        status: 'superseded',
      })
      expect(store.issueMissionArchiveReviewTicket(String(corrected.archive.id))).toMatchObject({
        archiveId: corrected.archive.id,
        containerVersion: 2,
        status: 'verified',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 90_000)

  it('recovers a published legacy-supplement archive against the same retained ZIP bytes', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-recovery-'))
    temporaryDirectories.add(userDataPath)
    const legacyStore = createElectronMissionStore({ userDataPath })
    const mission = await legacyStore.createMission({ name: 'Legacy recovery mission' })
    const marker = await legacyStore.upsertMarker({
      mission_id: mission.id,
      type: 'clue',
      name: 'Legacy recovery clue',
      lat: 52.0599,
      lon: -9.5045,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
      label_size: 14,
    })
    await legacyStore.finishMission(mission.id)
    const legacyFinalized = await legacyStore.finalizeMission(mission.id, undefined as never)
    const legacyArchivePath = String(legacyFinalized.archive.archive_path)
    const legacyArchiveSha256 = sha256File(legacyArchivePath)
    await legacyStore.prepareClose()
    legacyStore.close()

    const migrationDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
    try {
      migrationDb.prepare(`DELETE FROM metadata WHERE key IN (
        'legacy_archive_registry_backfill_cursor',
        'legacy_archive_registry_backfill_target'
      )`).run()
    } finally {
      migrationDb.close()
    }

    const interrupted = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      archiveLifecycleFaultInjection: { afterPublishBeforeSeal: true },
    } as never)
    let legacyArchiveId = ''
    await vi.waitFor(async () => {
      const archives = await interrupted.listMissionArchives(mission.id)
      const legacy = archives.find((archive) => archive.container_version === 1)
      expect(legacy).toMatchObject({ availability: 'present', status: 'sealed' })
      legacyArchiveId = String(legacy?.id)
    }, { timeout: 5_000, interval: 20 })
    await interrupted.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'Correct the legacy clue before restart recovery.',
    })
    await interrupted.upsertMarker({
      id: marker.id,
      mission_id: mission.id,
      type: 'clue',
      name: 'Corrected legacy recovery clue',
      lat: 52.0599,
      lon: -9.5045,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
      label_size: 14,
    })
    await expect(interrupted.finalizeMission(mission.id, custody, {
      operationId: '74747474-7474-4474-8474-747474747474',
      onProgress: () => undefined,
    })).rejects.toMatchObject({ code: 'ARCHIVE_SIMULATED_INTERRUPTION' })
    interrupted.close()

    const interruptedDb = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
      readonly: true,
    })
    try {
      const active = JSON.parse(String(interruptedDb.prepare(`SELECT value FROM metadata
        WHERE key = 'archive_custody_active_operation'`).get()?.value))
      expect(active).toMatchObject({
        state: 'publish_prepared',
        previousArchiveId: legacyArchiveId,
        previousArchiveSha256: legacyArchiveSha256,
      })
    } finally {
      interruptedDb.close()
    }

    const recovered = createElectronMissionStore({ userDataPath })
    try {
      await vi.waitFor(async () => {
        expect(await recovered.getMission(mission.id)).toMatchObject({ status: 'finalized' })
        expect(await recovered.listMissionArchives(mission.id)).toEqual([
          expect.objectContaining({
            container_version: 2,
            status: 'sealed',
            previous_archive_id: legacyArchiveId,
            previous_archive_sha256: legacyArchiveSha256,
          }),
          expect.objectContaining({
            id: legacyArchiveId,
            container_version: 1,
            status: 'superseded',
          }),
        ])
      }, { timeout: 10_000, interval: 20 })
      expect(sha256File(legacyArchivePath)).toBe(legacyArchiveSha256)

      const [sealed] = await recovered.listMissionArchives(mission.id)
      await expect(recovered.verifyMissionArchive({
        archiveId: String(sealed?.id),
        ...custody,
      })).resolves.toMatchObject({ status: 'verified' })
      expect(recovered.issueMissionArchiveReviewTicket(legacyArchiveId)).toMatchObject({
        containerVersion: 1,
        status: 'superseded',
      })
      expect(recovered.issueMissionArchiveReviewTicket(String(sealed?.id))).toMatchObject({
        containerVersion: 2,
        status: 'verified',
      })

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(db.prepare(`SELECT event_type, COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type IN (
            'mission_archive_sealed_v2', 'mission_archive_supplement_recorded'
          ) GROUP BY event_type ORDER BY event_type`).all(mission.id)).toEqual([
          { event_type: 'mission_archive_sealed_v2', count: 1 },
          { event_type: 'mission_archive_supplement_recorded', count: 1 },
        ])
      } finally {
        db.close()
      }
    } finally {
      await recovered.prepareClose()
      recovered.close()
    }
  }, 120_000)

  it('rejects an attachment that completes after a supplemental archive fence is acquired', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-attachment-finalize-race-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    let releaseWrite = () => undefined
    let signalWriteStarted = () => undefined
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve })
    const holdWrite = new Promise<void>((resolve) => { releaseWrite = resolve })
    try {
      const mission = await store.createMission({ name: 'Attachment finalization race' })
      await store.finishMission(mission.id)
      await store.finalizeMission(mission.id, custody, {
        operationId: '74747474-7474-4474-8474-747474747474',
        onProgress: () => undefined,
      })
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correct attachment while reviewing the retained archive.',
      })

      const attachment = store.runMarkerAttachmentIngest(mission.id, async () => {
        signalWriteStarted()
        await holdWrite
        return path.join(userDataPath, 'missions', mission.id, 'attachments', 'late.txt')
      })
      await writeStarted

      let signalSnapshot = () => undefined
      const snapshotStarted = new Promise<void>((resolve) => { signalSnapshot = resolve })
      const finalization = store.finalizeMission(mission.id, custody, {
        operationId: '75757575-7575-4575-8575-757575757575',
        onProgress: (update) => {
          if (update.kind === 'create' && update.phase === 'snapshot') signalSnapshot()
        },
      })
      await snapshotStarted
      releaseWrite()

      await expect(attachment).rejects.toThrow(/finalization is in progress/iu)
      await expect(finalization).resolves.toMatchObject({
        mission: { id: mission.id, status: 'finalized' },
      })
      const attachmentEvents = (await store.listMissionEvents(mission.id)).filter(
        (event) => event.event_type === 'marker_attachment_ingested',
      )
      expect(attachmentEvents).toHaveLength(0)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('finalizes only after journalled SARARCH2 publish and records exhaustive verification', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-lifecycle-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    try {
      const mission = await store.createMission({
        name: 'Archive lifecycle mission',
        start_time: '2026-08-29T10:00:00.000Z',
      })
      await store.finishMission(mission.id)

      const lifecycleProgress: Readonly<Record<string, unknown>>[] = []
      const finalized = await store.finalizeMission(mission.id, custody, {
        operationId: '11111111-1111-4111-8111-111111111111',
        onProgress: (progress) => lifecycleProgress.push(progress),
      })
      expect(finalized.mission).toMatchObject({ id: mission.id, status: 'finalized' })
      expect(finalized.archive).toMatchObject({
        mission_id: mission.id,
        container_version: 2,
        status: 'verified',
        availability: 'present',
        archive_path: expect.stringMatching(/\.sararch$/u),
        slots: [
          { slotId: 'passphrase-v1', slotType: 'passphrase' },
          { slotId: 'recovery-v1', slotType: 'recovery' },
        ],
      })
      expect(finalized.archive).not.toHaveProperty('verification_proof_json')
      expect(finalized.archive).not.toHaveProperty('slots_json')
      expect(lifecycleProgress.map((entry) => `${entry.kind}:${entry.phase}`)).toEqual(
        expect.arrayContaining([
          'create:staged',
          'create:publish',
          'create:seal',
          'verify:proof',
          'verify:verified',
        ]),
      )
      expect(lifecycleProgress.some((entry) => entry.phase === 'complete')).toBe(false)
      expect(lifecycleProgress.at(-1)).toMatchObject({ kind: 'verify', phase: 'verified' })
      const archivePath = String(finalized.archive.archive_path)
      expect(existsSync(archivePath)).toBe(true)
      expect(path.dirname(archivePath)).toBe(path.join(userDataPath, 'archives'))

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const registry = db.prepare(`SELECT container_version, status, availability,
            request_event_rowid, request_event_id, creation_operation_id,
            protected_finalization_epoch, relative_path, ciphertext_sha256,
            verification_proof_json
          FROM mission_archives WHERE mission_id = ?`).get(mission.id)
        expect(registry).toMatchObject({
          container_version: 2,
          status: 'verified',
          availability: 'present',
          creation_operation_id: '11111111-1111-4111-8111-111111111111',
          protected_finalization_epoch: null,
          relative_path: path.basename(archivePath),
          ciphertext_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          verification_proof_json: expect.any(String),
        })
        const events = db.prepare(`SELECT event_type FROM mission_events
          WHERE mission_id = ? ORDER BY rowid`).all(mission.id)
          .map((row: { readonly event_type: string }) => row.event_type)
        expect(events).toEqual(expect.arrayContaining([
          'mission_finalize_requested',
          'mission_archive_sealed_v2',
          'mission_finalized',
          'mission_archive_verified_v2',
        ]))
        const requestDetails = JSON.parse(String(db.prepare(`SELECT details_json
          FROM mission_events WHERE mission_id = ? AND event_type = 'mission_finalize_requested'
          ORDER BY rowid DESC LIMIT 1`).get(mission.id).details_json))
        expect(requestDetails.operation_id).toBe('11111111-1111-4111-8111-111111111111')
        expect(db.prepare(`SELECT 1 FROM metadata
          WHERE key = 'archive_custody_active_operation'`).get()).toBeUndefined()
        const terminal = db.prepare(`SELECT value FROM metadata
          WHERE key = ?`).get(
          `archive_custody_operation:${registry.creation_operation_id}`,
        )
        expect(JSON.parse(String(terminal.value))).toMatchObject({
          state: 'registered',
          operationId: registry.creation_operation_id,
        })
        expect(db.prepare(`SELECT 1 FROM mission_finalization_fences
          WHERE mission_id = ?`).get(mission.id)).toBeUndefined()
      } finally {
        db.close()
      }

      const stagingRoot = path.join(userDataPath, 'archives', '.staging')
      expect(existsSync(stagingRoot) ? readdirSync(stagingRoot) : []).toEqual([])
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('keeps a verified finalization authoritative when its progress observer throws', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-progress-final-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    try {
      const mission = await store.createMission({ name: 'Archive progress observer mission' })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody, {
        operationId: '12121212-1212-4212-8212-121212121212',
        onProgress: (progress) => {
          if (progress.kind === 'verify' && progress.phase === 'verified') {
            throw new Error('simulated closed renderer during terminal progress')
          }
        },
      })).resolves.toMatchObject({
        mission: { id: mission.id, status: 'finalized' },
        archive: { status: 'verified', availability: 'present' },
      })

      const events = await store.listMissionEvents(mission.id)
      expect(events.filter((event) => event.event_type === 'mission_archive_verified_v2'))
        .toHaveLength(1)
      expect(events.filter((event) => event.event_type === 'mission_archive_verification_failed_v2'))
        .toHaveLength(0)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('resumes a durably published archive after restart and seals it exactly once', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-restart-'))
    temporaryDirectories.add(userDataPath)
    const first = createElectronMissionStore({
      userDataPath,
      archiveLifecycleFaultInjection: { afterPublishBeforeSeal: true },
    })
    const mission = await first.createMission({
      name: 'Interrupted archive mission',
      start_time: '2026-08-29T11:00:00.000Z',
    })
    await first.finishMission(mission.id)
    await expect(first.finalizeMission(mission.id, custody))
      .rejects.toThrow(/simulated archive interruption/iu)
    first.close()

    const interruptedDb = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
      readonly: true,
    })
    try {
      const active = interruptedDb.prepare(`SELECT value FROM metadata
        WHERE key = 'archive_custody_active_operation'`).get()
      expect(JSON.parse(String(active.value))).toMatchObject({
        state: 'publish_prepared',
        archiveKind: 'finalized',
      })
    } finally {
      interruptedDb.close()
    }

    const recovered = createElectronMissionStore({ userDataPath })
    try {
      const deadline = Date.now() + 5_000
      while ((await recovered.getMission(mission.id)).status !== 'finalized'
        && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(await recovered.getMission(mission.id)).toMatchObject({ status: 'finalized' })

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const archive = db.prepare(`SELECT id, status, relative_path, ciphertext_sha256
          FROM mission_archives WHERE mission_id = ?`).get(mission.id)
        expect(archive).toMatchObject({
          status: 'sealed',
          relative_path: expect.stringMatching(/\.sararch$/u),
          ciphertext_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        })
        expect(existsSync(path.join(userDataPath, 'archives', archive.relative_path))).toBe(true)
        expect(db.prepare(`SELECT 1 FROM metadata
          WHERE key = 'archive_custody_active_operation'`).get()).toBeUndefined()
        expect(JSON.parse(String(db.prepare(`SELECT value FROM metadata
          WHERE key = ?`).get(`archive_custody_operation:${archive.id}`)?.value ?? 'null')))
          .toBeNull()
        const terminal = db.prepare(`SELECT value FROM metadata
          WHERE key LIKE 'archive_custody_operation:%'`).get()
        expect(JSON.parse(String(terminal.value))).toMatchObject({ state: 'registered' })
        expect(db.prepare(`SELECT event_type, COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type IN (
            'mission_archive_sealed_v2', 'mission_finalized'
          ) GROUP BY event_type ORDER BY event_type`).all(mission.id)).toEqual([
          { event_type: 'mission_archive_sealed_v2', count: 1 },
          { event_type: 'mission_finalized', count: 1 },
        ])
      } finally {
        db.close()
      }
    } finally {
      await recovered.prepareClose()
      recovered.close()
    }
  }, 30_000)

  it('cleans an interrupted building operation before clearing its exact fence', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-building-'))
    temporaryDirectories.add(userDataPath)
    const first = createElectronMissionStore({
      userDataPath,
      archiveLifecycleFaultInjection: { afterRequestBeforeWorker: true },
    })
    const mission = await first.createMission({
      name: 'Interrupted building mission',
      start_time: '2026-08-29T12:00:00.000Z',
    })
    await first.finishMission(mission.id)
    await expect(first.finalizeMission(mission.id, custody))
      .rejects.toThrow(/simulated archive interruption/iu)
    first.close()

    const recovered = createElectronMissionStore({ userDataPath })
    try {
      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const deadline = Date.now() + 5_000
        while (db.prepare(`SELECT 1 FROM metadata
          WHERE key = 'archive_custody_active_operation'`).get() !== undefined
          && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(await recovered.getMission(mission.id)).toMatchObject({ status: 'finished' })
        expect(db.prepare(`SELECT 1 FROM mission_finalization_fences
          WHERE mission_id = ?`).get(mission.id)).toBeUndefined()
        expect(db.prepare(`SELECT 1 FROM mission_archives WHERE mission_id = ?`)
          .get(mission.id)).toBeUndefined()
        const terminal = db.prepare(`SELECT value FROM metadata
          WHERE key LIKE 'archive_custody_operation:%'`).get()
        expect(JSON.parse(String(terminal.value))).toMatchObject({
          state: 'staging_removed',
        })
        expect(db.prepare(`SELECT COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_archive_failed'`)
          .get(mission.id).count).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      await recovered.prepareClose()
      recovered.close()
    }
  }, 30_000)

  it('leaves live evidence finalized and the archive sealed when independent verification fails', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-verify-fail-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: () => failedWorkerOperation(
        'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
        'simulated closed verifier failure',
      ),
    })
    try {
      const mission = await store.createMission({
        name: 'Verifier failure mission',
        start_time: '2026-08-29T13:00:00.000Z',
      })
      await store.finishMission(mission.id)
      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
      })
      expect(await store.getMission(mission.id)).toMatchObject({ status: 'finalized' })

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const archive = db.prepare(`SELECT id, status, availability, relative_path
          FROM mission_archives WHERE mission_id = ?`).get(mission.id)
        expect(archive).toMatchObject({ status: 'sealed', availability: 'unknown' })
        expect(existsSync(path.join(userDataPath, 'archives', archive.relative_path))).toBe(true)
        expect(db.prepare(`SELECT 1 FROM mission_finalization_fences
          WHERE mission_id = ?`).get(mission.id)).toBeUndefined()
        expect(db.prepare(`SELECT event_type FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_archive_verification_failed_v2'`)
          .get(mission.id)).toBeDefined()
        expect(db.prepare(`SELECT 1 FROM metadata
          WHERE key = 'archive_custody_active_operation'`).get()).toBeUndefined()
      } finally {
        db.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('sweeps and gates verifier plaintext residue before allowing a later retry', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-verify-residue-gate-'))
    temporaryDirectories.add(userDataPath)
    let verifyAttempt = 0
    let strandedResidue = ''
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input) => {
        verifyAttempt += 1
        if (verifyAttempt !== 1) return startArchiveVerifyWorker(input)
        const request = input.request as Readonly<Record<string, unknown>>
        strandedResidue = path.join(
          userDataPath,
          'archives',
          '.verification',
          String(request.operationId),
          'restored.sqlite',
        )
        const directory = path.dirname(strandedResidue)
        require('node:fs').mkdirSync(directory, { recursive: true, mode: 0o700 })
        writeFileSync(strandedResidue, 'APP-ADDRESSABLE-PLAINTEXT', { mode: 0o600 })
        return failedWorkerOperation(
          'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
          'simulated verifier plaintext cleanup failure',
        )
      },
    })
    try {
      const mission = await store.createMission({ name: 'Verifier residue gate mission' })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
      })
      expect(strandedResidue).not.toBe('')
      expect(existsSync(strandedResidue)).toBe(false)
      expect(existsSync(path.join(userDataPath, 'archives', '.verification'))).toBe(false)

      const [sealed] = await store.listMissionArchives(mission.id)
      await expect(store.verifyMissionArchive({
        archiveId: String(sealed?.id),
        ...custody,
      })).resolves.toMatchObject({ status: 'verified' })
      expect(verifyAttempt).toBe(2)

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(db.prepare(`SELECT value FROM metadata
          WHERE key = 'archive_plaintext_sweep_failure'`).get()).toBeUndefined()
      } finally {
        db.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('sweeps verifier plaintext after an unclassified worker termination', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-verify-generic-residue-'))
    temporaryDirectories.add(userDataPath)
    let verifyAttempt = 0
    let strandedResidue = ''
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input) => {
        verifyAttempt += 1
        if (verifyAttempt !== 1) return startArchiveVerifyWorker(input)
        const request = input.request as Readonly<Record<string, unknown>>
        strandedResidue = path.join(
          userDataPath,
          'archives',
          '.verification',
          String(request.operationId),
          'restored.sqlite',
        )
        require('node:fs').mkdirSync(path.dirname(strandedResidue), {
          recursive: true,
          mode: 0o700,
        })
        writeFileSync(strandedResidue, 'APP-ADDRESSABLE-PLAINTEXT', { mode: 0o600 })
        return unclassifiedFailedWorkerOperation('simulated forced verifier termination')
      },
    })
    try {
      const mission = await store.createMission({ name: 'Generic verifier residue mission' })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toThrow(
        /verification failed after archive custody was sealed/iu,
      )
      expect(strandedResidue).not.toBe('')
      expect(existsSync(strandedResidue)).toBe(false)
      expect(existsSync(path.join(userDataPath, 'archives', '.verification'))).toBe(false)

      const [sealed] = await store.listMissionArchives(mission.id)
      await expect(store.verifyMissionArchive({
        archiveId: String(sealed?.id),
        ...custody,
      })).resolves.toMatchObject({ status: 'verified' })
      expect(verifyAttempt).toBe(2)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('still sweeps verifier plaintext when the durable blocker write fails', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-verify-gate-write-failure-'))
    temporaryDirectories.add(userDataPath)
    let sweepCalls = 0
    let verifyAttempt = 0
    let strandedResidue = ''
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input) => {
        verifyAttempt += 1
        const request = input.request as Readonly<Record<string, unknown>>
        strandedResidue = path.join(
          userDataPath,
          'archives',
          '.verification',
          String(request.operationId),
          'restored.sqlite',
        )
        require('node:fs').mkdirSync(path.dirname(strandedResidue), {
          recursive: true,
          mode: 0o700,
        })
        writeFileSync(strandedResidue, 'APP-ADDRESSABLE-PLAINTEXT', { mode: 0o600 })
        const databasePath = String(request.databasePath)
        const triggerDb = new Database(databasePath)
        try {
          triggerDb.exec(`CREATE TRIGGER reject_archive_plaintext_failure
            BEFORE INSERT ON metadata
            WHEN NEW.key = 'archive_plaintext_sweep_failure'
            BEGIN SELECT RAISE(FAIL, 'simulated metadata failure'); END`)
        } finally {
          triggerDb.close()
        }
        return unclassifiedFailedWorkerOperation('simulated verifier failure')
      },
      startArchivePlaintextSweep: () => {
        sweepCalls += 1
        rmSync(path.join(userDataPath, 'archives', '.verification'), {
          recursive: true,
          force: true,
        })
        return Promise.resolve({ status: 'clean', removedEntryCount: 1 })
      },
    })
    try {
      const mission = await store.createMission({ name: 'Verifier gate write failure mission' })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_FAILED',
      })
      expect(sweepCalls).toBe(1)
      expect(verifyAttempt).toBe(1)
      expect(strandedResidue).not.toBe('')
      expect(existsSync(strandedResidue)).toBe(false)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('keeps archive work durably gated when automatic verifier-residue cleanup fails', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-verify-residue-blocked-'))
    temporaryDirectories.add(userDataPath)
    let verifyAttempt = 0
    let strandedResidue = ''
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input) => {
        verifyAttempt += 1
        const request = input.request as Readonly<Record<string, unknown>>
        strandedResidue = path.join(
          userDataPath,
          'archives',
          '.verification',
          String(request.operationId),
          'restored.sqlite',
        )
        require('node:fs').mkdirSync(path.dirname(strandedResidue), {
          recursive: true,
          mode: 0o700,
        })
        writeFileSync(strandedResidue, 'APP-ADDRESSABLE-PLAINTEXT', { mode: 0o600 })
        return failedWorkerOperation(
          'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
          'simulated verifier plaintext cleanup failure',
        )
      },
      startArchivePlaintextSweep: () => failedWorkerOperation(
        'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        'simulated fixed-root sweep failure',
      ),
    })
    try {
      const mission = await store.createMission({ name: 'Blocked verifier residue mission' })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
      })
      expect(existsSync(strandedResidue)).toBe(true)
      const [sealed] = await store.listMissionArchives(mission.id)
      await expect(store.verifyMissionArchive({
        archiveId: String(sealed?.id),
        ...custody,
      })).rejects.toMatchObject({ code: 'ARCHIVE_PLAINTEXT_SWEEP_FAILED' })
      expect(verifyAttempt).toBe(1)

      const db = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(db.prepare(`SELECT value FROM metadata
          WHERE key = 'archive_plaintext_sweep_failure'`).get()).toEqual({
          value: 'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        })
      } finally {
        db.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('classifies cancellation after seal as a verification cancellation', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-cancel-after-seal-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: () => failedWorkerOperation(
        'ARCHIVE_CANCELLED',
        'simulated cancellation after archive seal',
      ),
    })
    try {
      const mission = await store.createMission({
        name: 'Post-seal cancellation mission',
        start_time: '2026-08-29T13:30:00.000Z',
      })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_CANCELLED',
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
      await expect(store.listMissionArchives(mission.id)).resolves.toEqual([
        expect.objectContaining({ status: 'sealed', verified_at: null }),
      ])
      const failureEvent = (await store.listMissionEvents(mission.id)).find(
        (event) => event.event_type === 'mission_archive_verification_failed_v2',
      )
      expect(JSON.parse(String(failureEvent?.details_json))).toMatchObject({
        error_code: 'ARCHIVE_VERIFY_CANCELLED',
        resulting_status: 'finalized',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('normalizes every unclassified failure after seal as a verification failure', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-generic-after-seal-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: () => unclassifiedFailedWorkerOperation(
        'simulated unclassified verifier infrastructure failure',
      ),
    })
    try {
      const mission = await store.createMission({
        name: 'Post-seal generic failure mission',
        start_time: '2026-08-29T13:45:00.000Z',
      })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_FAILED',
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
      await expect(store.listMissionArchives(mission.id)).resolves.toEqual([
        expect.objectContaining({ status: 'sealed', verified_at: null }),
      ])
      const failureEvent = (await store.listMissionEvents(mission.id)).find(
        (event) => event.event_type === 'mission_archive_verification_failed_v2',
      )
      expect(JSON.parse(String(failureEvent?.details_json))).toMatchObject({
        error_code: 'ARCHIVE_VERIFY_FAILED',
        resulting_status: 'finalized',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('keeps a verification terminal when its post-seal failure audit cannot be written', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-audit-full-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      archiveLifecycleFaultInjection: { failVerificationFailureAudit: true },
      startArchiveVerifyWorker: () => unclassifiedFailedWorkerOperation(
        'simulated verifier failure before audit disk-full injection',
      ),
    })
    try {
      const mission = await store.createMission({
        name: 'Post-seal audit failure mission',
        start_time: '2026-08-29T13:50:00.000Z',
      })
      await store.finishMission(mission.id)

      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_AUDIT_FAILED',
        cause: expect.any(AggregateError),
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
      await expect(store.listMissionArchives(mission.id)).resolves.toEqual([
        expect.objectContaining({ status: 'sealed', verified_at: null }),
      ])
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('lists bounded custody data and retries exhaustive verification through a separately cancellable lane', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-retry-'))
    temporaryDirectories.add(userDataPath)
    let verifyAttempt = 0
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input) => {
        verifyAttempt += 1
        return verifyAttempt === 1
          ? failedWorkerOperation('ARCHIVE_VERIFY_AUTHENTICATION_FAILED', 'closed first failure')
          : startArchiveVerifyWorker(input)
      },
    })
    try {
      const mission = await store.createMission({
        name: 'Archive verification retry mission',
        start_time: '2026-08-29T14:00:00.000Z',
      })
      await store.finishMission(mission.id)
      const lifecycleProgress: Readonly<Record<string, unknown>>[] = []
      await expect(store.finalizeMission(mission.id, custody, {
        operationId: '44444444-4444-4444-8444-444444444444',
        onProgress: (progress) => lifecycleProgress.push(progress),
      })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_AUTHENTICATION_FAILED' })
      expect(lifecycleProgress.some((entry) => entry.kind === 'create')).toBe(true)

      const sealed = await store.listMissionArchives(mission.id)
      expect(sealed).toHaveLength(1)
      expect(sealed[0]).toMatchObject({
        mission_id: mission.id,
        status: 'sealed',
        availability: 'present',
        archive_path: expect.stringMatching(/\.sararch$/u),
        slots: [
          { slotId: 'passphrase-v1', slotType: 'passphrase' },
          { slotId: 'recovery-v1', slotType: 'recovery' },
        ],
      })
      expect(sealed[0]).not.toHaveProperty('verification_proof_json')
      expect(sealed[0]).not.toHaveProperty('slots_json')
      expect(archiveVerificationRetryAvailability(sealed[0] as MissionArchiveInfo))
        .toEqual({ available: true, reason: null })

      const retryProgress: Readonly<Record<string, unknown>>[] = []
      const verified = await store.verifyMissionArchive({
        archiveId: String(sealed[0]?.id),
        ...custody,
      }, {
        operationId: '55555555-5555-4555-8555-555555555555',
        onProgress: (progress) => {
          retryProgress.push(progress)
          if (progress.phase === 'verified') {
            throw new Error('simulated closed renderer during retry terminal progress')
          }
        },
      })
      expect(verified).toMatchObject({
        id: sealed[0]?.id,
        status: 'verified',
        availability: 'present',
      })
      expect(retryProgress.length).toBeGreaterThan(0)
      expect(retryProgress.every((entry) => entry.kind === 'verify')).toBe(true)
      expect((await store.listMissionEvents(mission.id)).filter(
        (event) => event.event_type === 'mission_archive_verification_failed_v2',
      )).toHaveLength(1)
      expect(await store.cancelMissionArchiveOperation(
        '55555555-5555-4555-8555-555555555555',
      )).toBe(false)
      expect(verifyAttempt).toBe(2)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)

  it('retries a transient exact availability inspection on Refresh without restarting', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-retry-refresh-'))
    temporaryDirectories.add(userDataPath)
    let reconciliationAttempt = 0
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: () => failedWorkerOperation(
        'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
        'closed verifier failure before retry availability',
      ),
      startArchiveCustodyReconciliation: (input) => {
        reconciliationAttempt += 1
        return reconciliationAttempt === 1
          ? failedWorkerOperation(
              'ARCHIVE_CUSTODY_RECONCILIATION_FAILED',
              'transient exact availability inspection failure',
            )
          : startArchiveCustodyReconciliation(input)
      },
    })
    try {
      const mission = await store.createMission({
        name: 'Archive availability refresh mission',
        start_time: '2026-08-29T14:10:00.000Z',
      })
      await store.finishMission(mission.id)
      await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
      })

      const firstRefresh = await store.listMissionArchives(mission.id)
      expect(firstRefresh).toHaveLength(1)
      expect(firstRefresh[0]).toMatchObject({ status: 'sealed', availability: 'unknown' })
      expect(archiveVerificationRetryAvailability(firstRefresh[0] as MissionArchiveInfo).available)
        .toBe(false)

      const secondRefresh = await store.listMissionArchives(mission.id)
      expect(secondRefresh).toHaveLength(1)
      expect(secondRefresh[0]).toMatchObject({ status: 'sealed', availability: 'present' })
      expect(archiveVerificationRetryAvailability(secondRefresh[0] as MissionArchiveInfo))
        .toEqual({ available: true, reason: null })
      expect(reconciliationAttempt).toBe(2)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 30_000)
})
