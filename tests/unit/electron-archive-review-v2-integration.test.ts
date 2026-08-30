import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const nodeFs = require('node:fs') as typeof import('node:fs')
const Database = require('better-sqlite3') as new (
  databasePath: string,
  options?: Readonly<Record<string, unknown>>,
) => TestDatabase
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (
    options: { readonly userDataPath: string },
  ) => MissionStore
}
const { createArchiveReviewSessionManager } = require(
  '../../electron/archive-review-sessions.cjs',
) as {
  readonly createArchiveReviewSessionManager: (
    options: ArchiveReviewSessionManagerOptions,
  ) => ArchiveReviewSessionManager
}
const { createArchiveReviewSource } = require(
  '../../electron/archive-review-source.cjs',
) as {
  readonly createArchiveReviewSource: (options: {
    readonly databasePath: string
    readonly missionId: string
    readonly sessionId: string
  }) => Readonly<Record<string, unknown>> & { readonly close: () => Promise<void> }
}
const { computeTableContentDigest } = require('../../electron/archive-inventory.cjs') as {
  readonly computeTableContentDigest: (
    database: TestDatabase,
    input: {
      readonly missionId: string
      readonly schemaVersion: number
      readonly tableName: string
    },
  ) => { readonly rowCount: number; readonly contentSha256: string }
}
const { restoreMissionArchiveForReview } = require('../../electron/archive-restore.cjs') as {
  readonly restoreMissionArchiveForReview: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly secretBytes: Buffer
    readonly cancellationFlag: Int32Array<SharedArrayBuffer>
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
  }) => Promise<Readonly<Record<string, unknown>>>
}
const { verifyMissionArchiveFile } = require('../../electron/archive-verify.cjs') as {
  readonly verifyMissionArchiveFile: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly passphraseBytes: Buffer
    readonly recoveryCodeBytes: Buffer
    readonly cancellationFlag: Int32Array<SharedArrayBuffer>
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
  }) => Promise<Readonly<Record<string, unknown>>>
}

type TestDatabase = {
  readonly prepare: (sql: string) => {
    readonly all: (...parameters: readonly unknown[]) => readonly Readonly<Record<string, unknown>>[]
    readonly get: (...parameters: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
  }
  readonly backup: (destinationPath: string) => Promise<unknown>
  readonly pragma: (sql: string) => unknown
  readonly close: () => void
}

type MissionStore = {
  readonly info: () => Promise<{
    readonly database_path: string
    readonly schema_version: number
  }>
  readonly createMission: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertMarker: (input: Readonly<Record<string, unknown>>) => Promise<{ readonly id: string }>
  readonly upsertDrawing: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertGpxImport: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly createOuting: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertSearchArea: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (
    missionId: string,
    custody: { readonly passphrase: string; readonly recoveryCode: string },
    context: {
      readonly operationId: string
      readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
    },
  ) => Promise<{
    readonly mission: Readonly<Record<string, unknown>>
    readonly archive: {
      readonly id: string
      readonly mission_id: string
      readonly request_event_rowid: number
      readonly container_version: number
      readonly ciphertext_sha256: string
      readonly archive_path: string
      readonly status: string
      readonly availability: string
    }
  }>
  readonly issueMissionArchiveReviewTicket: (
    archiveId: string,
  ) => ArchiveReviewTicket
  readonly recordMissionArchiveReviewOpened: (
    input: Readonly<Record<string, unknown>>,
  ) => string
  readonly recordMissionArchiveReviewClosed: (
    input: Readonly<Record<string, unknown>>,
  ) => string
  readonly recordMissionArchiveReviewMutationDenied: (
    input: Readonly<Record<string, unknown>>,
  ) => string
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

type ArchiveReviewTicket = {
  readonly archiveId: string
  readonly archiveKind: string
  readonly archiveRelativePath: string
  readonly missionId: string
  readonly requestEventRowid: number
  readonly requestEventId: string
  readonly creationOperationId: string
  readonly protectedFinalizationEpoch: number | null
  readonly createdAt: string
  readonly containerVersion: number
  readonly schemaVersion: number
  readonly inventoryVersion: number
  readonly ciphertextSha256: string
  readonly headerSha256: string
  readonly sizeBytes: number
  readonly frameCount: number
  readonly manifestSha256: string
  readonly entryCount: number
  readonly tableCount: number
  readonly previousArchiveSha256: string | null
}

type ArchiveReviewSessionManagerOptions = {
  readonly reviewRoot: string
  readonly archiveDirectory: string
  readonly registry: {
    readonly issueReviewTicket: (archiveId: string) => Readonly<Record<string, unknown>>
    readonly recordReviewOpened: (input: Readonly<Record<string, unknown>>) => string
    readonly recordReviewClosed: (input: Readonly<Record<string, unknown>>) => string
    readonly recordReviewMutationDenied: (input: Readonly<Record<string, unknown>>) => string
  }
  readonly openRestoredAttachment?: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>
}

type ArchiveReviewSessionManager = {
  readonly sweepStartup: () => Promise<void>
  readonly open: (input: {
    readonly senderId: number
    readonly request: {
      readonly archiveId: string
      readonly containerVersion: 2
      readonly operationId: string
      readonly slotType: 'passphrase' | 'recovery'
    }
    readonly secret: string
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
  }) => Promise<{
    readonly sessionId: string
    readonly archiveId: string
    readonly missionId: string
    readonly containerVersion: number
    readonly verified: boolean
    readonly encrypted: boolean
    readonly immutable: boolean
    readonly ciphertextSha256: string
    readonly plaintextResidual: string
  }>
  readonly read: (input: {
    readonly senderId: number
    readonly sessionId: string
    readonly method: string
    readonly args: readonly unknown[]
  }) => Promise<unknown>
  readonly close: (input: { readonly senderId: number; readonly sessionId: string }) => Promise<void>
  readonly prepareClose: () => Promise<void>
}

type ReviewFacade = {
  readonly call: (method: string, args: readonly unknown[]) => Promise<unknown>
}

type ReplayState = Readonly<Record<string, unknown>> & {
  readonly replayGeneration: number
  readonly tracks: readonly Readonly<Record<string, unknown>>[]
  readonly objects: readonly Readonly<Record<string, unknown>>[]
  readonly nextCursor: string | null
  readonly nextObjectCursor: string | null
  readonly availableOutingIds: readonly string[]
  readonly availableOutingNextCursor: string | null
  readonly availableOutingTotalCount: number
  readonly totalTrackCount: number
  readonly totalObjectCount: number
  readonly staticGpxPointCount: number
  readonly limitations: readonly { readonly code: string }[]
}

type ReplayPage = {
  readonly tracks?: readonly Readonly<Record<string, unknown>>[]
  readonly objects?: readonly Readonly<Record<string, unknown>>[]
  readonly entries?: readonly string[]
  readonly nextCursor?: string | null
  readonly nextObjectCursor?: string | null
  readonly totalTrackCount?: number
  readonly totalObjectCount?: number
  readonly totalCount?: number
}

const temporaryDirectories = new Set<string>()
const SENDER_ID = 37
const CREATE_OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const WRONG_KEY_OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const WRONG_KEY_SESSION_ID = '23232323-2323-4232-8232-232323232323'
const REBOUND_RESTORE_OPERATION_ID = '27272727-2727-4272-8272-272727272727'
const REBOUND_RESTORE_SESSION_ID = '28282828-2828-4282-8282-282828282828'
const LOW_CAPACITY_RESTORE_OPERATION_ID = '24242424-2424-4242-8242-242424242424'
const LOW_CAPACITY_RESTORE_SESSION_ID = '25252525-2525-4252-8252-252525252525'
const LOW_CAPACITY_VERIFY_OPERATION_ID = '26262626-2626-4262-8262-262626262626'
const SUBSTITUTION_OPERATION_ID = '33333333-3333-4333-8333-333333333333'
const OPEN_OPERATION_ID = '44444444-4444-4444-8444-444444444444'
const PASSPHRASE = 'Four calm words 2026!'
const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const EVIDENCE_TABLES = Object.freeze([
  'devices',
  'drawings',
  'gpx_evidence_points',
  'gpx_import_revisions',
  'gpx_track_imports',
  'markers',
  'mission_object_versions',
  'missions',
  'outings',
  'positions',
  'search_areas',
])

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
  temporaryDirectories.clear()
})

/** Locates frame zero from the exact length-prefixed preamble of a real SARARCH2 file. */
function locateFirstFrameOffset(archiveBytes: Buffer): number {
  expect(archiveBytes.subarray(0, 8).toString('ascii')).toBe('SARARCH2')
  const headerLength = archiveBytes.readUInt32BE(8)
  const slotLengthOffset = 12 + headerLength
  expect(slotLengthOffset + 4).toBeLessThan(archiveBytes.byteLength)
  const slotLength = archiveBytes.readUInt32BE(slotLengthOffset)
  const firstFrameOffset = slotLengthOffset + 4 + slotLength
  expect(firstFrameOffset + 13).toBeLessThan(archiveBytes.byteLength)
  expect(archiveBytes.readBigUInt64BE(firstFrameOffset)).toBe(0n)
  return firstFrameOffset
}

/** Projects positional source-byte ranges actually returned by a readSync spy. */
function readRanges(readSpy: {
  readonly mock: {
    readonly calls: readonly (readonly unknown[])[]
    readonly results: readonly { readonly type: string; readonly value?: unknown }[]
  }
}): readonly { readonly start: number; readonly end: number }[] {
  return readSpy.mock.calls.flatMap((call, index) => {
    const result = readSpy.mock.results[index]
    const position = call[4]
    if (result?.type !== 'return' || typeof result.value !== 'number'
      || result.value < 1 || typeof position !== 'number') {
      return []
    }
    return [{ start: position, end: position + result.value }]
  })
}

/** Builds one complete trusted restore identity from the registry review ticket. */
function restoreRequestFromTicket(input: {
  readonly ticket: ArchiveReviewTicket
  readonly archiveDirectory: string
  readonly reviewRoot: string
  readonly operationId: string
  readonly sessionId: string
}): Readonly<Record<string, unknown>> {
  return {
    operationId: input.operationId,
    sessionId: input.sessionId,
    archiveId: input.ticket.archiveId,
    archiveKind: input.ticket.archiveKind,
    archiveDirectory: input.archiveDirectory,
    archiveRelativePath: input.ticket.archiveRelativePath,
    reviewRoot: input.reviewRoot,
    missionId: input.ticket.missionId,
    requestEventRowid: input.ticket.requestEventRowid,
    requestEventId: input.ticket.requestEventId,
    creationOperationId: input.ticket.creationOperationId,
    protectedFinalizationEpoch: input.ticket.protectedFinalizationEpoch,
    createdAt: input.ticket.createdAt,
    containerVersion: input.ticket.containerVersion,
    schemaVersion: input.ticket.schemaVersion,
    inventoryVersion: input.ticket.inventoryVersion,
    ciphertextSha256: input.ticket.ciphertextSha256,
    headerSha256: input.ticket.headerSha256,
    sizeBytes: input.ticket.sizeBytes,
    frameCount: input.ticket.frameCount,
    manifestSha256: input.ticket.manifestSha256,
    entryCount: input.ticket.entryCount,
    tableCount: input.ticket.tableCount,
    slotType: 'passphrase',
    previousArchiveSha256: input.ticket.previousArchiveSha256,
  }
}

/** Builds one complete independent verification identity from the same registry ticket. */
function verifyRequestFromTicket(input: {
  readonly ticket: ArchiveReviewTicket
  readonly archiveDirectory: string
  readonly databasePath: string
  readonly operationId: string
}): Readonly<Record<string, unknown>> {
  return {
    operationId: input.operationId,
    archiveId: input.ticket.archiveId,
    archiveKind: input.ticket.archiveKind,
    archiveDirectory: input.archiveDirectory,
    archiveRelativePath: input.ticket.archiveRelativePath,
    databasePath: input.databasePath,
    missionId: input.ticket.missionId,
    requestEventRowid: input.ticket.requestEventRowid,
    requestEventId: input.ticket.requestEventId,
    creationOperationId: input.ticket.creationOperationId,
    protectedFinalizationEpoch: input.ticket.protectedFinalizationEpoch,
    createdAt: input.ticket.createdAt,
    containerVersion: input.ticket.containerVersion,
    schemaVersion: input.ticket.schemaVersion,
    inventoryVersion: input.ticket.inventoryVersion,
    ciphertextSha256: input.ticket.ciphertextSha256,
    headerSha256: input.ticket.headerSha256,
    sizeBytes: input.ticket.sizeBytes,
    frameCount: input.ticket.frameCount,
    manifestSha256: input.ticket.manifestSha256,
    entryCount: input.ticket.entryCount,
    tableCount: input.ticket.tableCount,
    previousArchiveSha256: input.ticket.previousArchiveSha256,
  }
}

describe('verified SARARCH2 archive-backed review integration [DON-252 / BCP-15]', () => {
  it('fails low-capacity restore and verification before digest, KDF, or payload reads', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-archive-preflight-'))
    temporaryDirectories.add(userDataPath)
    const reviewRoot = path.join(userDataPath, 'archive-review')
    const archiveDirectory = path.join(userDataPath, 'archives')
    const store = createElectronMissionStore({ userDataPath })

    try {
      const mission = await seedReviewMission(store)
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(
        mission.id,
        { passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE },
        { operationId: CREATE_OPERATION_ID, onProgress: () => undefined },
      )
      const ticket = store.issueMissionArchiveReviewTicket(finalized.archive.id)
      const info = await store.info()
      const archiveBytes = await readFile(finalized.archive.archive_path)
      const firstFrameOffset = locateFirstFrameOffset(archiveBytes)
      const actualCapacity = nodeFs.statfsSync(userDataPath)
      const statfsSpy = vi.spyOn(nodeFs, 'statfsSync').mockReturnValue({
        ...actualCapacity,
        bavail: 0,
      })
      const readSpy = vi.spyOn(nodeFs, 'readSync')
      const restoreProgress: Readonly<Record<string, unknown>>[] = []
      let restoreFailure: unknown
      let verifyFailure: unknown
      let restoreReadRanges: readonly { readonly start: number; readonly end: number }[] = []
      let verifyReadRanges: readonly { readonly start: number; readonly end: number }[] = []
      const verifyProgress: Readonly<Record<string, unknown>>[] = []

      try {
        try {
          await restoreMissionArchiveForReview({
            request: restoreRequestFromTicket({
              ticket,
              archiveDirectory,
              reviewRoot,
              operationId: LOW_CAPACITY_RESTORE_OPERATION_ID,
              sessionId: LOW_CAPACITY_RESTORE_SESSION_ID,
            }),
            secretBytes: Buffer.from(PASSPHRASE, 'utf8'),
            cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
            onProgress: (progress) => restoreProgress.push(progress),
          })
        } catch (error) {
          restoreFailure = error
        }
        restoreReadRanges = readRanges(readSpy)
        readSpy.mockClear()

        try {
          await verifyMissionArchiveFile({
            request: verifyRequestFromTicket({
              ticket,
              archiveDirectory,
              databasePath: info.database_path,
              operationId: LOW_CAPACITY_VERIFY_OPERATION_ID,
            }),
            passphraseBytes: Buffer.from(PASSPHRASE, 'utf8'),
            recoveryCodeBytes: Buffer.from(RECOVERY_CODE, 'utf8'),
            cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
            onProgress: (progress) => verifyProgress.push(progress),
          })
        } catch (error) {
          verifyFailure = error
        }
        verifyReadRanges = readRanges(readSpy)
      } finally {
        readSpy.mockRestore()
        statfsSpy.mockRestore()
      }

      expect(restoreFailure).toMatchObject({ code: 'ARCHIVE_RESTORE_DISK_FULL' })
      expect(verifyFailure).toMatchObject({ code: 'ARCHIVE_VERIFY_DISK_FULL' })
      expect.soft(restoreProgress.map((progress) => progress.phase)).not.toContain('keys')
      expect.soft(verifyProgress.map((progress) => progress.phase)).not.toContain('keys')
      expect.soft(
        restoreReadRanges.filter((range) => range.end > firstFrameOffset),
        `restore read frame bytes at or beyond offset ${firstFrameOffset}`,
      ).toEqual([])
      expect.soft(
        verifyReadRanges.filter((range) => range.end > firstFrameOffset),
        `verify read frame bytes at or beyond offset ${firstFrameOffset}`,
      ).toEqual([])
      expect(await listReviewResiduals(reviewRoot)).toEqual([])
    } finally {
      await store.prepareClose().catch(() => undefined)
      store.close()
    }
  }, 120_000)

  it('restores one registry-bound archive, exhausts semantic pages, protects live evidence, and sweeps plaintext', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-archive-review-v2-'))
    temporaryDirectories.add(userDataPath)
    const reviewRoot = path.join(userDataPath, 'archive-review')
    const archiveDirectory = path.join(userDataPath, 'archives')
    const store = createElectronMissionStore({ userDataPath })
    let manager: ArchiveReviewSessionManager | null = null
    let liveSource: (Readonly<Record<string, unknown>> & { readonly close: () => Promise<void> })
      | null = null

    try {
      const mission = await seedReviewMission(store)
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(
        mission.id,
        { passphrase: PASSPHRASE, recoveryCode: RECOVERY_CODE },
        { operationId: CREATE_OPERATION_ID, onProgress: () => undefined },
      )
      expect(finalized).toMatchObject({
        mission: { id: mission.id, status: 'finalized' },
        archive: {
          mission_id: mission.id,
          container_version: 2,
          status: 'verified',
          availability: 'present',
          ciphertext_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      })

      const archiveBytes = await readFile(finalized.archive.archive_path)
      expect(archiveBytes.byteLength).toBeGreaterThan(64 * 1024)
      const firstFrameOffset = locateFirstFrameOffset(archiveBytes)
      const payloadSubstitution = Buffer.from(archiveBytes)
      payloadSubstitution[payloadSubstitution.byteLength - 1]! ^= 0x01
      await writeFile(finalized.archive.archive_path, payloadSubstitution, { mode: 0o600 })
      const reviewTicket = store.issueMissionArchiveReviewTicket(finalized.archive.id)
      const readSpy = vi.spyOn(nodeFs, 'readSync')
      let wrongCredentialFailure: unknown
      try {
        await restoreMissionArchiveForReview({
          request: {
            operationId: WRONG_KEY_OPERATION_ID,
            sessionId: WRONG_KEY_SESSION_ID,
            archiveId: reviewTicket.archiveId,
            archiveKind: reviewTicket.archiveKind,
            archiveDirectory,
            archiveRelativePath: reviewTicket.archiveRelativePath,
            reviewRoot,
            missionId: reviewTicket.missionId,
            requestEventRowid: reviewTicket.requestEventRowid,
            requestEventId: reviewTicket.requestEventId,
            creationOperationId: reviewTicket.creationOperationId,
            protectedFinalizationEpoch: reviewTicket.protectedFinalizationEpoch,
            createdAt: reviewTicket.createdAt,
            containerVersion: reviewTicket.containerVersion,
            schemaVersion: reviewTicket.schemaVersion,
            inventoryVersion: reviewTicket.inventoryVersion,
            ciphertextSha256: reviewTicket.ciphertextSha256,
            headerSha256: reviewTicket.headerSha256,
            sizeBytes: reviewTicket.sizeBytes,
            frameCount: reviewTicket.frameCount,
            manifestSha256: reviewTicket.manifestSha256,
            entryCount: reviewTicket.entryCount,
            tableCount: reviewTicket.tableCount,
            slotType: 'passphrase',
            previousArchiveSha256: reviewTicket.previousArchiveSha256,
          },
          secretBytes: Buffer.from('Wrong calm words 2026!', 'utf8'),
          cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
        })
      } catch (error) {
        wrongCredentialFailure = error
      }
      const rangesReadBeforeCredentialFailure = readRanges(readSpy)
      readSpy.mockRestore()
      await writeFile(finalized.archive.archive_path, archiveBytes, { mode: 0o600 })

      expect(wrongCredentialFailure).toMatchObject({ code: 'ARCHIVE_RESTORE_WRONG_KEY' })
      expect(rangesReadBeforeCredentialFailure).not.toHaveLength(0)
      expect(
        rangesReadBeforeCredentialFailure.filter((range) => range.end > firstFrameOffset),
        `wrong passphrase read frame bytes at or beyond offset ${firstFrameOffset}`,
      ).toEqual([])

      const reboundSessionDirectory = path.join(reviewRoot, REBOUND_RESTORE_SESSION_ID)
      const displacedSessionDirectory = path.join(userDataPath, 'displaced-review-restore')
      let reboundRestore = false
      let reboundRestoreFailure: unknown
      try {
        await restoreMissionArchiveForReview({
          request: restoreRequestFromTicket({
            ticket: reviewTicket,
            archiveDirectory,
            reviewRoot,
            operationId: REBOUND_RESTORE_OPERATION_ID,
            sessionId: REBOUND_RESTORE_SESSION_ID,
          }),
          secretBytes: Buffer.from(PASSPHRASE, 'utf8'),
          cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
          onProgress: (progress) => {
            if (!reboundRestore && progress.phase === 'decrypt'
              && Number(progress.completed) > 256 * 1024
              && nodeFs.existsSync(reboundSessionDirectory)) {
              reboundRestore = true
              nodeFs.renameSync(reboundSessionDirectory, displacedSessionDirectory)
            }
          },
        })
      } catch (error) {
        reboundRestoreFailure = error
      }
      expect(reboundRestore).toBe(true)
      expect(reboundRestoreFailure).toMatchObject({ code: expect.any(String) })
      expect((await stat(path.join(displacedSessionDirectory, 'mission-store.sqlite'))).size)
        .toBe(0)
      await rm(displacedSessionDirectory, { recursive: true, force: true })

      const info = await store.info()
      expect(info.schema_version).toBe(13)
      const requestEvent = readArchiveRequestEvent(
        info.database_path,
        finalized.archive.request_event_rowid,
      )
      const evidenceBeforeReview = digestMissionEvidence(info.database_path, mission.id)

      const liveComparisonPath = path.join(userDataPath, 'pinned-live-comparison.sqlite')
      const liveDatabase = new Database(info.database_path, {
        readonly: true,
        fileMustExist: true,
      })
      await liveDatabase.backup(liveComparisonPath)
      liveDatabase.close()
      const liveComparisonDatabase = new Database(liveComparisonPath)
      liveComparisonDatabase.pragma('journal_mode = DELETE')
      liveComparisonDatabase.close()
      await chmod(liveComparisonPath, 0o444)
      liveSource = createArchiveReviewSource({
        databasePath: liveComparisonPath,
        missionId: mission.id,
        sessionId: 'live-fence-comparison',
      })
      const liveFacade = createSourceFacade(liveSource)
      const liveReview = await readReviewSemantic(
        liveFacade,
        mission.id,
        finalized.archive.request_event_rowid,
        'live',
      )
      const liveReplay = await exhaustReplay(
        liveFacade,
        mission.id,
        requestEvent.timestamp,
        'live',
      )
      const liveSearchAreas = await exhaustSearchAreas(liveFacade, mission.id)
      await liveSource.close()
      liveSource = null

      const openRestoredAttachment = vi.fn(async () => true)
      manager = createArchiveReviewSessionManager({
        reviewRoot,
        archiveDirectory,
        registry: {
          issueReviewTicket: (archiveId) => store.issueMissionArchiveReviewTicket(archiveId),
          recordReviewOpened: (input) => store.recordMissionArchiveReviewOpened(input),
          recordReviewClosed: (input) => store.recordMissionArchiveReviewClosed(input),
          recordReviewMutationDenied: (input) =>
            store.recordMissionArchiveReviewMutationDenied(input),
        },
        openRestoredAttachment,
      })
      await manager.sweepStartup()

      await expect(manager.open({
        senderId: SENDER_ID,
        request: {
          archiveId: finalized.archive.id,
          containerVersion: 2,
          operationId: WRONG_KEY_OPERATION_ID,
          slotType: 'passphrase',
        },
        secret: 'Wrong calm words 2026!',
      })).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_WRONG_KEY' })
      expect(await listReviewResiduals(reviewRoot)).toEqual([])
      expect(readReviewAuditTypes(info.database_path, mission.id)).toEqual([])

      const substitutedBytes = Buffer.from(archiveBytes)
      substitutedBytes[Math.floor(substitutedBytes.byteLength / 2)]! ^= 0x01
      await writeFile(finalized.archive.archive_path, substitutedBytes)
      await expect(manager.open({
        senderId: SENDER_ID,
        request: {
          archiveId: finalized.archive.id,
          containerVersion: 2,
          operationId: SUBSTITUTION_OPERATION_ID,
          slotType: 'passphrase',
        },
        secret: PASSPHRASE,
      })).rejects.toMatchObject({ code: 'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH' })
      expect(await listReviewResiduals(reviewRoot)).toEqual([])
      expect(readReviewAuditTypes(info.database_path, mission.id)).toEqual([])
      await writeFile(finalized.archive.archive_path, archiveBytes, { mode: 0o600 })
      expect(sha256(await readFile(finalized.archive.archive_path)))
        .toBe(finalized.archive.ciphertext_sha256)

      const successfulRestoreProgress: Readonly<Record<string, unknown>>[] = []
      const publicSession = await manager.open({
        senderId: SENDER_ID,
        request: {
          archiveId: finalized.archive.id,
          containerVersion: 2,
          operationId: OPEN_OPERATION_ID,
          slotType: 'passphrase',
        },
        secret: PASSPHRASE,
        onProgress: (progress) => successfulRestoreProgress.push(progress),
      })
      expect(publicSession).toMatchObject({
        archiveId: finalized.archive.id,
        missionId: mission.id,
        containerVersion: 2,
        verified: true,
        encrypted: true,
        immutable: true,
        ciphertextSha256: finalized.archive.ciphertext_sha256,
        plaintextResidual: 'permission_restricted_session_open',
      })
      expect(JSON.stringify(publicSession)).not.toContain(userDataPath)
      expect(successfulRestoreProgress.map((progress) => progress.phase))
        .toEqual(expect.arrayContaining(['ciphertext', 'validate']))
      const validationProgress = successfulRestoreProgress.filter(
        (progress) => progress.phase === 'validate',
      )
      expect(validationProgress.at(0)).toMatchObject({
        unit: 'bytes', completed: 0, total: expect.any(Number),
      })
      expect(validationProgress.at(-1)).toMatchObject({
        unit: 'bytes', completed: validationProgress.at(-1)?.total,
      })
      const sessionDirectory = path.join(reviewRoot, publicSession.sessionId)
      expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(path.join(sessionDirectory, 'mission-store.sqlite'))).mode & 0o777)
        .toBe(0o600)

      const restoredFacade = createManagerFacade(manager, publicSession.sessionId)
      await expect(manager.read({
        senderId: SENDER_ID,
        sessionId: publicSession.sessionId,
        method: 'openAttachment',
        args: [{
          missionId: mission.id,
          attachmentPath: mission.attachment.fileName,
          referenceKind: 'marker',
          referenceId: mission.attachment.markerId,
        }],
      })).resolves.toBe(true)
      expect(openRestoredAttachment).toHaveBeenCalledWith(expect.objectContaining({
        displayName: mission.attachment.fileName,
        expectedSha256: sha256(mission.attachment.bytes),
        expectedSizeBytes: mission.attachment.bytes.byteLength,
        signal: expect.any(AbortSignal),
      }))
      const restoredReview = await readReviewSemantic(
        restoredFacade,
        mission.id,
        finalized.archive.request_event_rowid,
        'restored',
      )
      const restoredReplay = await exhaustReplay(
        restoredFacade,
        mission.id,
        requestEvent.timestamp,
        'restored',
      )
      const restoredSearchAreas = await exhaustSearchAreas(restoredFacade, mission.id)

      expect(restoredReview).toEqual(liveReview)
      expect(restoredReview.breadcrumbCount).toBe(4)
      expect(restoredReplay).toEqual(liveReplay)
      expect(restoredReplay.trackRows).toHaveLength(restoredReplay.totalTrackCount)
      expect(restoredReplay.objectRows).toHaveLength(restoredReplay.totalObjectCount)
      expect(restoredReplay.staticGpxPointCount).toBe(3)
      expect(restoredReplay.limitations).toContain('undated_gpx_static')
      expect(restoredSearchAreas).toEqual(liveSearchAreas)
      expect(restoredSearchAreas.entries.map((entry) => entry.name)).toEqual(
        expect.arrayContaining(['Archive Area Alpha', 'Archive Area Bravo']),
      )
      expect(JSON.stringify({
        restoredReview,
        restoredReplay,
        restoredSearchAreas,
      })).not.toContain(userDataPath)

      await expect(manager.read({
        senderId: SENDER_ID,
        sessionId: publicSession.sessionId,
        method: 'upsertMarker',
        args: [{ mission_id: mission.id, name: 'Mutation attack' }],
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_READ_ONLY' })
      expect(digestMissionEvidence(info.database_path, mission.id)).toEqual(evidenceBeforeReview)

      await manager.close({ senderId: SENDER_ID, sessionId: publicSession.sessionId })
      expect(await listReviewResiduals(reviewRoot)).toEqual([])
      await expect(manager.read({
        senderId: SENDER_ID,
        sessionId: publicSession.sessionId,
        method: 'listMissions',
        args: [],
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH' })
      expect(digestMissionEvidence(info.database_path, mission.id)).toEqual(evidenceBeforeReview)
      expect(readReviewAuditTypes(info.database_path, mission.id)).toEqual([
        'mission_archive_review_opened',
        'mission_archive_review_mutation_denied',
        'mission_archive_review_closed',
      ])
      expect(sha256(await readFile(finalized.archive.archive_path)))
        .toBe(finalized.archive.ciphertext_sha256)
    } finally {
      await liveSource?.close().catch(() => undefined)
      await manager?.prepareClose().catch(() => undefined)
      await store.prepareClose().catch(() => undefined)
      store.close()
    }
  }, 120_000)
})

/** Seeds mission evidence that exercises Review, Replay, search paging and undated GPX semantics. */
async function seedReviewMission(store: MissionStore): Promise<{
  readonly id: string
  readonly attachment: {
    readonly fileName: string
    readonly markerId: string
    readonly bytes: Buffer
  }
}> {
  const mission = await store.createMission({
    name: 'Archive review production-path mission',
    start_time: '2026-08-29T08:00:00.000Z',
  })
  await store.upsertDevice({
    mission_id: mission.id,
    device_id: 'tracker-archive-review',
    name: 'Archive Review Tracker',
    color: '#0077AA',
    status: 'online',
    last_seen: '2026-08-29T09:04:00.000Z',
  })
  for (let index = 0; index < 4; index += 1) {
    await store.addPosition({
      source_position_id: `archive-review-fix-${index}`,
      mission_id: mission.id,
      device_id: 'tracker-archive-review',
      lat: 52.0599 + index * 0.0001,
      lon: -9.5045 - index * 0.0001,
      timestamp: `2026-08-29T09:0${index}:00.000Z`,
      timestamp_source: 'fix',
    })
  }
  const storeInfo = await store.info()
  const attachmentFileName = 'archive-review-briefing.txt'
  const attachmentBytes = Buffer.from('ARCHIVED REVIEW BRIEFING', 'utf8')
  const attachmentDirectory = path.join(
    path.dirname(storeInfo.database_path),
    'missions',
    mission.id,
    'attachments',
  )
  await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 })
  await writeFile(path.join(attachmentDirectory, attachmentFileName), attachmentBytes, {
    mode: 0o600,
  })
  const marker = await store.upsertMarker({
    mission_id: mission.id,
    type: 'ipp_lkp',
    name: 'Archive Review IPP',
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 480000,
    irish_grid_n: 580000,
    display_order: 0,
    label_size: 14,
    attachment_path: path.join(attachmentDirectory, attachmentFileName),
  })
  await store.upsertDrawing({
    mission_id: mission.id,
    type: 'search_area',
    name: 'Archive Review Sector',
    display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  })
  const gpxBytes = Buffer.from(
    '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/><trkpt lat="52.02" lon="-9.72"/></trkseg></trk></gpx>',
    'utf8',
  )
  await store.upsertGpxImport({
    mission_id: mission.id,
    source_path: '/field/archive-review-undated.gpx',
    file_name: 'archive-review-undated.gpx',
    display_name: 'Archive Review Undated GPX',
    geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01],[-9.72,52.02]]]}',
    metadata_json: '{}',
    content_sha256: sha256(gpxBytes),
    source_bytes_base64: gpxBytes.toString('base64'),
    timing_class: 'undated',
    points: [
      { segment_index: 0, point_index: 0, track_name: 'Undated', lat: 52, lon: -9.7, elevation: null, timestamp: null },
      { segment_index: 0, point_index: 1, track_name: 'Undated', lat: 52.01, lon: -9.71, elevation: null, timestamp: null },
      { segment_index: 0, point_index: 2, track_name: 'Undated', lat: 52.02, lon: -9.72, elevation: null, timestamp: null },
    ],
    rejections: [],
  })
  await store.createOuting({ mission_id: mission.id, label: 'Archive Review Outing' })
  for (const name of ['Archive Area Alpha', 'Archive Area Bravo']) {
    await store.upsertSearchArea({
      mission_id: mission.id,
      name,
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Archive Review Coordinator',
    })
  }
  return Object.freeze({
    id: mission.id,
    attachment: Object.freeze({
      fileName: attachmentFileName,
      markerId: marker.id,
      bytes: attachmentBytes,
    }),
  })
}

/** Creates a read facade over one in-process source without exposing its private database path. */
function createSourceFacade(source: Readonly<Record<string, unknown>>): ReviewFacade {
  return {
    async call(method, args) {
      const operation = source[method]
      if (typeof operation !== 'function') throw new Error(`Review source method ${method} is absent.`)
      return Reflect.apply(operation, source, args)
    },
  }
}

/** Creates the same read facade through the sender- and session-owned main manager boundary. */
function createManagerFacade(
  manager: ArchiveReviewSessionManager,
  sessionId: string,
): ReviewFacade {
  return {
    call: (method, args) => manager.read({
      senderId: SENDER_ID,
      sessionId,
      method,
      args,
    }),
  }
}

/** Reads the complete bounded review audit snapshot up to the archive request fence. */
async function readReviewSemantic(
  facade: ReviewFacade,
  missionId: string,
  requestEventRowid: number,
  label: string,
): Promise<{
  readonly auditEvents: readonly Readonly<Record<string, unknown>>[]
  readonly breadcrumbCount: number
}> {
  const result = requireRecord(await facade.call('readMissionReview', [{
    missionId,
    includeTelemetry: false,
    auditLimit: 5_001,
  }, `${label}-mission-review`]), 'Mission Review result')
  const auditEvents = requireRecordArray(result.auditEvents, 'Mission Review audit events')
    .filter((event) => Number(event.rowid) <= requestEventRowid)
  return {
    auditEvents,
    breadcrumbCount: requireNonNegativeInteger(
      result.breadcrumbCount,
      'Mission Review breadcrumb count',
    ),
  }
}

/** Exhausts every track, object and outing-filter Replay cursor into one semantic projection. */
async function exhaustReplay(
  facade: ReviewFacade,
  missionId: string,
  selectedTime: string,
  label: string,
): Promise<{
  readonly state: Readonly<Record<string, unknown>>
  readonly trackRows: readonly Readonly<Record<string, unknown>>[]
  readonly objectRows: readonly Readonly<Record<string, unknown>>[]
  readonly outingIds: readonly string[]
  readonly totalTrackCount: number
  readonly totalObjectCount: number
  readonly staticGpxPointCount: number
  readonly limitations: readonly string[]
}> {
  const input = { missionId, selectedTime, timezone: 'Europe/Dublin', trackLimit: 1, objectLimit: 1 }
  let requestSequence = 0
  const nextRequestId = () => `${label}-replay-${requestSequence += 1}`
  const state = requireRecord(
    await facade.call('readMissionReplay', [input, nextRequestId()]),
    'Replay state',
  ) as ReplayState
  const trackRows = [...requireRecordArray(state.tracks, 'Replay tracks')]
  const objectRows = [...requireRecordArray(state.objects, 'Replay objects')]
  const outingIds = [...requireStringArray(state.availableOutingIds, 'Replay outing choices')]

  let trackCursor = requireNullableString(state.nextCursor, 'Replay track cursor')
  const seenTrackCursors = new Set<string>()
  while (trackCursor !== null) {
    if (seenTrackCursors.has(trackCursor)) throw new Error('Replay track cursor repeated.')
    seenTrackCursors.add(trackCursor)
    const page = requireRecord(
      await facade.call('readMissionReplayTrackChunk', [
        { ...input, cursor: trackCursor },
        nextRequestId(),
      ]),
      'Replay track page',
    ) as ReplayPage
    trackRows.push(...requireRecordArray(page.tracks, 'Replay track page rows'))
    trackCursor = requireNullableString(page.nextCursor, 'Replay next track cursor')
  }

  let objectCursor = requireNullableString(state.nextObjectCursor, 'Replay object cursor')
  const seenObjectCursors = new Set<string>()
  while (objectCursor !== null) {
    if (seenObjectCursors.has(objectCursor)) throw new Error('Replay object cursor repeated.')
    seenObjectCursors.add(objectCursor)
    const page = requireRecord(
      await facade.call('readMissionReplayObjectChunk', [
        { ...input, objectCursor, replayGeneration: state.replayGeneration },
        nextRequestId(),
      ]),
      'Replay object page',
    ) as ReplayPage
    objectRows.push(...requireRecordArray(page.objects, 'Replay object page rows'))
    objectCursor = requireNullableString(page.nextObjectCursor, 'Replay next object cursor')
  }

  let outingCursor = requireNullableString(
    state.availableOutingNextCursor,
    'Replay outing-filter cursor',
  )
  const seenOutingCursors = new Set<string>()
  while (outingCursor !== null) {
    if (seenOutingCursors.has(outingCursor)) throw new Error('Replay outing cursor repeated.')
    seenOutingCursors.add(outingCursor)
    const page = requireRecord(
      await facade.call('readMissionReplayFilterPage', [
        {
          ...input,
          filterKind: 'outing',
          filterCursor: outingCursor,
          filterLimit: 1,
        },
        nextRequestId(),
      ]),
      'Replay outing-filter page',
    ) as ReplayPage
    outingIds.push(...requireStringArray(page.entries, 'Replay outing-filter entries'))
    outingCursor = requireNullableString(page.nextCursor, 'Replay next outing-filter cursor')
  }

  const transportKeys = new Set([
    'availableOutingIds',
    'availableOutingNextCursor',
    'availableOutingTotalCount',
    'nextCursor',
    'nextObjectCursor',
    'objectCursor',
    'objects',
    'previousCursor',
    'progress',
    'replayGeneration',
    'trackCursor',
    'tracks',
  ])
  const semanticState = Object.fromEntries(
    Object.entries(state).filter(([key]) => !transportKeys.has(key)),
  )
  const totalTrackCount = requireNonNegativeInteger(state.totalTrackCount, 'Replay track total')
  const totalObjectCount = requireNonNegativeInteger(state.totalObjectCount, 'Replay object total')
  const totalOutingCount = requireNonNegativeInteger(
    state.availableOutingTotalCount,
    'Replay outing-filter total',
  )
  if (trackRows.length !== totalTrackCount
    || objectRows.length !== totalObjectCount
    || outingIds.length !== totalOutingCount) {
    throw new Error('Replay cursors did not exhaust their declared totals.')
  }
  return {
    state: semanticState,
    trackRows,
    objectRows,
    outingIds,
    totalTrackCount,
    totalObjectCount,
    staticGpxPointCount: requireNonNegativeInteger(
      state.staticGpxPointCount,
      'Replay static GPX count',
    ),
    limitations: requireRecordArray(state.limitations, 'Replay limitations')
      .map((entry) => String(entry.code)),
  }
}

/** Exhausts every Search Operations area cursor and validates its declared total. */
async function exhaustSearchAreas(
  facade: ReviewFacade,
  missionId: string,
): Promise<{
  readonly entries: readonly Readonly<Record<string, unknown>>[]
  readonly totalCount: number
}> {
  const entries: Readonly<Record<string, unknown>>[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  let totalCount: number | null = null
  do {
    const page = requireRecord(await facade.call('listSearchOperationPage', [{
      missionId,
      kind: 'areas',
      limit: 1,
      ...(cursor === null ? {} : { cursor }),
    }]), 'Search Operations page')
    const pageTotal = requireNonNegativeInteger(page.totalCount, 'Search Operations total')
    if (totalCount !== null && pageTotal !== totalCount) {
      throw new Error('Search Operations total changed while paging.')
    }
    totalCount = pageTotal
    entries.push(...requireRecordArray(page.entries, 'Search Operations entries'))
    cursor = requireNullableString(page.nextCursor, 'Search Operations cursor')
    if (cursor !== null && seenCursors.has(cursor)) {
      throw new Error('Search Operations cursor repeated.')
    }
    if (cursor !== null) seenCursors.add(cursor)
  } while (cursor !== null)
  if (entries.length !== totalCount) throw new Error('Search Operations pages were incomplete.')
  return { entries, totalCount }
}

/** Digests every selected source row in the mission tables archive review must never mutate. */
function digestMissionEvidence(
  databasePath: string,
  missionId: string,
): Readonly<Record<string, { readonly rowCount: number; readonly contentSha256: string }>> {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return Object.fromEntries(EVIDENCE_TABLES.map((tableName) => [
      tableName,
      computeTableContentDigest(database, { tableName, missionId, schemaVersion: 13 }),
    ]))
  } finally {
    database.close()
  }
}

/** Reads the exact finalization request fence used as the historical Replay comparison time. */
function readArchiveRequestEvent(
  databasePath: string,
  requestEventRowid: number,
): { readonly timestamp: string } {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const event = database.prepare(`SELECT timestamp FROM mission_events
      WHERE rowid = ? AND event_type = 'mission_finalize_requested'`).get(requestEventRowid)
    if (typeof event?.timestamp !== 'string') throw new Error('Archive request event is absent.')
    return { timestamp: event.timestamp }
  } finally {
    database.close()
  }
}

/** Lists only the audit rows that a successfully opened review session may append. */
function readReviewAuditTypes(databasePath: string, missionId: string): readonly string[] {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return database.prepare(`SELECT event_type FROM mission_events
      WHERE mission_id = ? AND event_type IN (
        'mission_archive_review_opened', 'mission_archive_review_mutation_denied',
        'mission_archive_review_closed'
      ) ORDER BY rowid`).all(missionId).map((row) => String(row.event_type))
  } finally {
    database.close()
  }
}

/** Lists app-addressable review residuals without assuming the root already exists. */
async function listReviewResiduals(reviewRoot: string): Promise<readonly string[]> {
  try {
    return await readdir(reviewRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Requires one result object at a production read boundary. */
function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`)
  }
  return value as Readonly<Record<string, unknown>>
}

/** Requires one array of result objects at a production read boundary. */
function requireRecordArray(
  value: unknown,
  label: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array.`)
  return value.map((entry) => requireRecord(entry, label))
}

/** Requires one array of strings at a production read boundary. */
function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} is not a string array.`)
  }
  return value as readonly string[]
}

/** Requires one null-or-string cursor at a production read boundary. */
function requireNullableString(value: unknown, label: string): string | null {
  if (value !== null && typeof value !== 'string') throw new Error(`${label} is invalid.`)
  return value
}

/** Requires one non-negative safe integer at a production read boundary. */
function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid.`)
  return Number(value)
}

/** Computes one exact SHA-256 identity. */
function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
