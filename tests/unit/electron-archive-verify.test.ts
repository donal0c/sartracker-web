import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly close: () => void
  }
}
const { readArchiveCleanupMembershipGeneration } = require(
  '../../electron/archive-cleanup-membership.cjs',
) as {
  readonly readArchiveCleanupMembershipGeneration: (
    database: InstanceType<typeof Database>,
    missionId: string,
  ) => number
}
const { deriveArchiveLifecycleEventId } = require(
  '../../electron/mission-finalization-boundary.cjs',
) as {
  readonly deriveArchiveLifecycleEventId: (archiveId: string, kind: string) => string
}
const { startMissionArchiveCreateWorker } = require(
  '../../electron/mission-archive-runner.cjs',
) as {
  readonly startMissionArchiveCreateWorker: (input: {
    readonly request: Readonly<Record<string, unknown>>
  }) => Promise<Readonly<Record<string, unknown>>> & { readonly workerExited: Promise<void> }
}
const { verifyMissionArchiveFile } = require('../../electron/archive-verify.cjs') as {
  readonly verifyMissionArchiveFile: (input: Readonly<Record<string, unknown>>) => Promise<{
    readonly proofVersion: number
    readonly exhaustive: boolean
    readonly layers: Readonly<Record<string, unknown>>
    readonly tables: readonly {
      readonly tableName: string
      readonly rowCount: number
      readonly contentSha256: string
    }[]
    readonly tableLedgerSha256: string
    readonly replaySemantic: {
      readonly sampled: boolean
      readonly sampleCount: number
      readonly samples: readonly {
        readonly sampledTrackCount: number
        readonly totalTrackCount: number
        readonly sampledObjectCount: number
        readonly totalObjectCount: number
        readonly sampledOutingFilterCount: number
        readonly totalOutingFilterCount: number
      }[]
    }
    readonly plaintextSweepConfirmed: boolean
  }>
}
const { startArchiveVerifyWorker } = require('../../electron/archive-verify-runner.cjs') as {
  readonly startArchiveVerifyWorker: (input: {
    readonly request: Readonly<Record<string, unknown>>
  }) => Promise<Readonly<Record<string, unknown>>> & { readonly workerExited: Promise<void> }
}
const {
  authenticateArchiveCleanupCredential,
} = require('../../electron/archive-cleanup-credential.cjs') as {
  readonly authenticateArchiveCleanupCredential: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly secretBytes: Buffer
    readonly cancellationFlag: Int32Array
  }) => Promise<Readonly<Record<string, unknown>>>
}

const operationId = '11111111-1111-4111-8111-111111111111'
const verifyOperationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const recoveryRequestEventId = '55555555-5555-4555-8555-555555555555'
const passphrase = 'Four calm words 2026!'
const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const fenceRequestedAt = '2026-08-29T18:59:59.000Z'
const temporaryDirectories = new Set<string>()

type BetterSqliteDatabase = {
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates a v13 source store with one mission and its pre-bound archive request. */
function createSource(prepareSource?: (db: BetterSqliteDatabase) => void) {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-verify-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const databasePath = path.join(userDataPath, 'mission-store.sqlite')
  const archiveDirectory = path.join(userDataPath, 'archives')
  const db = new Database(databasePath)
  db.prepare(`INSERT INTO missions (
    id, name, status, start_time, finish_time, paused_seconds, schema_version
  ) VALUES ('mission-a', 'Mission A', 'finished', ?, ?, 0, 13)`).run(
    '2026-08-29T10:00:00.000Z', '2026-08-29T12:00:00.000Z',
  )
  prepareSource?.(db)
  const cleanupMembershipGeneration = readArchiveCleanupMembershipGeneration(
    db,
    'mission-a',
  )
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (42, ?, 'mission-a', 'mission_finalize_requested', ?, ?, ?, 'complete')`).run(
    requestEventId,
    fenceRequestedAt,
    JSON.stringify({
      resulting_status: 'finished',
      archive_id: archiveId,
      operation_id: operationId,
      archive_kind: 'finalized',
      archive_relative_path: `${archiveId}.sararch`,
      cleanup_membership_generation: cleanupMembershipGeneration,
      protected_finalization_epoch: null,
    }),
    fenceRequestedAt,
  )
  db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
    VALUES ('mission-a', ?)`).run(fenceRequestedAt)
  db.close()
  return { userDataPath, databasePath, archiveDirectory, cleanupMembershipGeneration }
}

/** Creates one real staged SARARCH2 archive through the production worker. */
async function createArchive(prepareSource?: (db: BetterSqliteDatabase) => void) {
  const fixture = createSource(prepareSource)
  const result = await startMissionArchiveCreateWorker({
    request: {
      operationId,
      archiveId,
      databasePath: fixture.databasePath,
      archiveDirectory: fixture.archiveDirectory,
      missionId: 'mission-a',
      requestEventRowid: 42,
      fenceRequestedAt,
      requestEventId,
      archiveKind: 'finalized',
      createdAt: '2026-08-29T19:00:00.000Z',
      schemaVersion: 13,
      inventoryVersion: 1,
      previousArchiveSha256: null,
      protectedFinalizationEpoch: null,
      passphrase,
      recoveryCode,
      finalizationProjection: {
        eventId: deriveArchiveLifecycleEventId(archiveId, 'mission-finalized'),
        timestamp: fenceRequestedAt,
        recordedAt: fenceRequestedAt,
        archivePath: path.join(fixture.archiveDirectory, `${archiveId}.sararch`),
        archiveRelativePath: `${archiveId}.sararch`,
        cleanupMembershipGeneration: fixture.cleanupMembershipGeneration,
        supplement: null,
      },
    },
  }) as {
    readonly temporaryRelativePath: string
    readonly finalRelativePath: string
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly frameCount: number
    readonly headerSha256: string
    readonly manifestSummary: {
      readonly entryCount: number
      readonly tableCount: number
      readonly manifestSha256: string
    }
  }
  renameSync(
    path.join(fixture.archiveDirectory, result.temporaryRelativePath),
    path.join(fixture.archiveDirectory, result.finalRelativePath),
  )
  const live = new Database(fixture.databasePath)
  live.transaction(() => {
    live.prepare("UPDATE missions SET status = 'finalized' WHERE id = 'mission-a'").run()
    live.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json,
      recorded_at, recording_completeness
    ) VALUES (?, 'mission-a', 'mission_finalized', ?, ?, ?, 'complete')`).run(
      deriveArchiveLifecycleEventId(archiveId, 'mission-finalized'),
      fenceRequestedAt,
      JSON.stringify({
        resulting_status: 'finalized',
        archive_id: archiveId,
        archive_path: path.join(fixture.archiveDirectory, `${archiveId}.sararch`),
        archive_relative_path: `${archiveId}.sararch`,
        cleanup_membership_generation: fixture.cleanupMembershipGeneration,
        container_version: 2,
      }),
      fenceRequestedAt,
    )
  })()
  live.close()
  return { fixture, result }
}

/** Creates a recovery archive whose request row is later than its protected finalization. */
async function createRecoveryArchive() {
  const fixture = createSource()
  const recoveryRequestedAt = '2026-08-29T19:10:00.000Z'
  const db = new Database(fixture.databasePath)
  db.prepare('DELETE FROM mission_events WHERE id = ?').run(requestEventId)
  db.prepare("UPDATE missions SET status = 'finalized' WHERE id = 'mission-a'").run()
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (5, '45454545-4545-4545-8545-454545454545', 'mission-a',
    'mission_finalized', '2026-08-29T19:05:00.000Z', ?,
    '2026-08-29T19:05:00.000Z', 'complete')`).run(JSON.stringify({
    resulting_status: 'finalized',
  }))
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (6, ?, 'mission-a', 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
    recoveryRequestEventId,
    recoveryRequestedAt,
    JSON.stringify({
      resulting_status: 'finalized',
      archive_id: archiveId,
      operation_id: operationId,
      archive_kind: 'finalized_recovery',
      archive_relative_path: `${archiveId}.sararch`,
      cleanup_membership_generation: fixture.cleanupMembershipGeneration,
      protected_finalization_epoch: 5,
    }),
    recoveryRequestedAt,
  )
  db.prepare(`UPDATE mission_finalization_fences SET requested_at = ?
    WHERE mission_id = 'mission-a'`).run(recoveryRequestedAt)
  db.close()
  const result = await startMissionArchiveCreateWorker({
    request: {
      operationId,
      archiveId,
      databasePath: fixture.databasePath,
      archiveDirectory: fixture.archiveDirectory,
      missionId: 'mission-a',
      requestEventRowid: 6,
      fenceRequestedAt: recoveryRequestedAt,
      requestEventId: recoveryRequestEventId,
      archiveKind: 'finalized_recovery',
      createdAt: '2026-08-29T19:00:00.000Z',
      schemaVersion: 13,
      inventoryVersion: 1,
      previousArchiveSha256: null,
      protectedFinalizationEpoch: 5,
      passphrase,
      recoveryCode,
    },
  }) as Awaited<ReturnType<typeof createArchive>>['result']
  renameSync(
    path.join(fixture.archiveDirectory, result.temporaryRelativePath),
    path.join(fixture.archiveDirectory, result.finalRelativePath),
  )
  return { fixture, result }
}

/** Builds the closed verifier request from the creator's non-secret result. */
function verifyRequest(
  fixture: Awaited<ReturnType<typeof createArchive>>['fixture'],
  result: Awaited<ReturnType<typeof createArchive>>['result'],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    operationId: verifyOperationId,
    archiveId,
    archiveKind: 'finalized',
    archiveDirectory: fixture.archiveDirectory,
    archiveRelativePath: result.finalRelativePath,
    databasePath: fixture.databasePath,
    missionId: 'mission-a',
    requestEventRowid: 42,
    requestEventId,
    creationOperationId: operationId,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-29T19:00:00.000Z',
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: result.ciphertextSha256,
    previousArchiveSha256: null,
    sizeBytes: result.sizeBytes,
    frameCount: result.frameCount,
    headerSha256: result.headerSha256,
    manifestSha256: result.manifestSummary.manifestSha256,
    entryCount: result.manifestSummary.entryCount,
    tableCount: result.manifestSummary.tableCount,
    ...overrides,
  }
}

/** Removes verifier-only live-database input and binds one non-machine cleanup slot. */
function cleanupCredentialRequest(
  fixture: Awaited<ReturnType<typeof createArchive>>['fixture'],
  result: Awaited<ReturnType<typeof createArchive>>['result'],
  slotType: 'passphrase' | 'recovery',
) {
  const { databasePath, ...identity } = verifyRequest(fixture, result)
  void databasePath
  return { ...identity, slotType }
}

/** Replaces the fixture archive and returns its exact new registered identity. */
function replaceArchiveBytes(
  fixture: Awaited<ReturnType<typeof createArchive>>['fixture'],
  result: Awaited<ReturnType<typeof createArchive>>['result'],
  bytes: Buffer,
) {
  writeFileSync(path.join(fixture.archiveDirectory, result.finalRelativePath), bytes)
  return {
    ciphertextSha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
}

describe('independent mission archive verification', () => {
  it('authenticates one fresh non-machine cleanup slot while hashing the exact pinned archive', async () => {
    const { fixture, result } = await createArchive()
    const cancellationFlag = new Int32Array(new SharedArrayBuffer(4))

    await expect(authenticateArchiveCleanupCredential({
      request: cleanupCredentialRequest(fixture, result, 'passphrase'),
      secretBytes: Buffer.from(passphrase, 'utf8'),
      cancellationFlag,
    })).resolves.toMatchObject({
      operationId: verifyOperationId,
      archiveId,
      missionId: 'mission-a',
      slotType: 'passphrase',
      ciphertextSha256: result.ciphertextSha256,
      sizeBytes: result.sizeBytes,
      custodyReconciled: true,
    })
    await expect(authenticateArchiveCleanupCredential({
      request: cleanupCredentialRequest(fixture, result, 'recovery'),
      secretBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag,
    })).resolves.toMatchObject({ slotType: 'recovery', custodyReconciled: true })
  })

  it('rejects a wrong cleanup secret and a same-path ciphertext substitution without an unwrap claim', async () => {
    const { fixture, result } = await createArchive()
    const cancellationFlag = new Int32Array(new SharedArrayBuffer(4))
    const request = cleanupCredentialRequest(fixture, result, 'passphrase')
    await expect(authenticateArchiveCleanupCredential({
      request,
      secretBytes: Buffer.from('Wrong cleanup passphrase 2026!', 'utf8'),
      cancellationFlag,
    })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_WRONG_KEY' })

    const archivePath = path.join(fixture.archiveDirectory, result.finalRelativePath)
    const bytes = readFileSync(archivePath)
    bytes[bytes.length - 1] ^= 1
    writeFileSync(archivePath, bytes)
    await expect(authenticateArchiveCleanupCredential({
      request,
      secretBytes: Buffer.from(passphrase, 'utf8'),
      cancellationFlag,
    })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_CUSTODY_MISMATCH' })
  })

  it('classifies a registered key-slot tag mutation as custody corruption, never a wrong secret', async () => {
    const { fixture, result } = await createArchive()
    const archivePath = path.join(fixture.archiveDirectory, result.finalRelativePath)
    const bytes = readFileSync(archivePath)
    const headerLength = bytes.readUInt32BE(8)
    const slotsLengthOffset = 12 + headerLength
    const slotsLength = bytes.readUInt32BE(slotsLengthOffset)
    const slotsOffset = slotsLengthOffset + 4
    const slots = JSON.parse(
      bytes.subarray(slotsOffset, slotsOffset + slotsLength).toString('utf8'),
    ) as readonly { readonly slotType: string; readonly authTag: string }[]
    const tag = slots.find((slot) => slot.slotType === 'passphrase')?.authTag
    expect(tag).toBeDefined()
    const tagOffset = bytes.indexOf(Buffer.from(String(tag), 'ascii'), slotsOffset)
    expect(tagOffset).toBeGreaterThanOrEqual(slotsOffset)
    bytes[tagOffset] = bytes[tagOffset] === 65 ? 66 : 65
    writeFileSync(archivePath, bytes)

    await expect(authenticateArchiveCleanupCredential({
      request: cleanupCredentialRequest(fixture, result, 'passphrase'),
      secretBytes: Buffer.from(passphrase, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_CUSTODY_MISMATCH' })
  })

  it('proves recovery request row 6 without substituting protected finalization epoch 5', async () => {
    const { fixture, result } = await createRecoveryArchive()
    const request = verifyRequest(fixture, result, {
      archiveKind: 'finalized_recovery',
      requestEventRowid: 6,
      requestEventId: recoveryRequestEventId,
      protectedFinalizationEpoch: 5,
    })
    await expect(verifyMissionArchiveFile({
      request,
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).resolves.toMatchObject({
      requestEventRowid: 6,
      requestEventId: recoveryRequestEventId,
      creationOperationId: operationId,
      protectedFinalizationEpoch: 5,
    })

    await expect(verifyMissionArchiveFile({
      request: { ...request, protectedFinalizationEpoch: 6 },
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_IDENTITY_MISMATCH' })
    expect(existsSync(path.join(
      fixture.archiveDirectory,
      '.verification',
      verifyOperationId,
    ))).toBe(false)
  }, 60_000)

  it('restores the sealed bytes and proves every completeness layer before sweeping plaintext', async () => {
    const { fixture, result } = await createArchive((db) => {
      db.prepare(`INSERT INTO devices (
        id, mission_id, device_id, name, color, status
      ) VALUES ('device-row', 'mission-a', 'device-a', 'Device A', '#123456', 'online')`).run()
      const insertPosition = db.prepare(`INSERT INTO positions (
        id, mission_id, device_id, lat, lon, timestamp, data_origin, received_at,
        source_kind, timestamp_source, timestamp_provenance_recorded_at
      ) VALUES (?, 'mission-a', 'device-a', 52, -9.7, ?, 'live', ?, 'traccar', 'fix', ?)`)
      for (let index = 0; index < 129; index += 1) {
        const timestamp = new Date(Date.parse('2026-08-29T10:10:00.000Z') + index * 1_000)
          .toISOString()
        insertPosition.run(`position-${index}`, timestamp, timestamp, timestamp)
      }
      const insertObject = db.prepare(`INSERT INTO mission_object_versions (
        id, mission_id, object_type, object_id, version_sequence, operation,
        effective_at, recorded_at, completeness, state_json
      ) VALUES (?, 'mission-a', 'marker', ?, 1, 'created', ?, ?, 'complete', ?)`)
      for (let index = 0; index < 65; index += 1) {
        insertObject.run(
          `version-${index}`,
          `marker-${index}`,
          '2026-08-29T10:10:00.000Z',
          '2026-08-29T10:10:00.000Z',
          JSON.stringify({ id: `marker-${index}`, type: 'Clue' }),
        )
      }
      db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
        VALUES ('mission-a', 1) ON CONFLICT(mission_id) DO UPDATE SET generation = 1`).run()
    })
    const progress: Array<{
      readonly phase: string
      readonly unit: string
      readonly completed: number
      readonly total: number | null
    }> = []
    const proof = await verifyMissionArchiveFile({
      request: verifyRequest(fixture, result),
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
      onProgress: (value: typeof progress[number]) => progress.push(value),
    })

    expect(proof).toMatchObject({
      proofVersion: 1,
      exhaustive: true,
      plaintextSweepConfirmed: true,
      layers: {
        ciphertext: { exhaustive: true, matched: true },
        authenticatedFrames: { exhaustive: true, matched: true },
        entries: { exhaustive: true, matched: true },
        inventory: { exhaustive: true, matched: true, tableCount: 49 },
        gpxSourceBytes: { exhaustive: true, matched: true },
        attachments: { exhaustive: true, matched: true },
      },
      replaySemantic: { sampled: true },
    })
    expect(proof.replaySemantic.sampleCount).toBeGreaterThanOrEqual(2)
    expect(proof.tables).toHaveLength(49)
    expect(new Set(proof.tables.map((table) => table.tableName)).size).toBe(49)
    expect(proof.tables.every((table) => Number.isSafeInteger(table.rowCount)
      && table.rowCount >= 0 && /^[0-9a-f]{64}$/u.test(table.contentSha256))).toBe(true)
    expect(proof.tableLedgerSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(proof.replaySemantic.samples).toHaveLength(proof.replaySemantic.sampleCount)
    expect(proof.replaySemantic.samples.every((sample) =>
      sample.sampledTrackCount === sample.totalTrackCount
      && sample.sampledObjectCount === sample.totalObjectCount
      && sample.sampledOutingFilterCount === sample.totalOutingFilterCount)).toBe(true)
    expect(progress.filter((value) => value.phase === 'preflight').every((value) =>
      value.unit === 'bytes' && value.total === result.sizeBytes)).toBe(true)
    expect(progress.filter((value) => value.phase === 'sqlite')).toEqual([
      expect.objectContaining({ unit: 'bytes', completed: 0, total: expect.any(Number) }),
      expect.objectContaining({ unit: 'bytes', total: expect.any(Number) }),
    ])
    expect(progress.filter((value) => value.phase === 'inventory').every((value) =>
      value.unit === 'rows' && value.total === null)).toBe(true)
    const replayProgress = progress.filter((value) => value.phase === 'replay')
    expect(replayProgress.length).toBeGreaterThan(proof.replaySemantic.sampleCount * 2)
    expect(replayProgress.every((value) => value.unit === 'rows' && value.total === null)).toBe(true)
    expect(existsSync(path.join(
      fixture.archiveDirectory, '.verification', verifyOperationId,
    ))).toBe(false)
  }, 60_000)

  it('requires passphrase and recovery slots to unwrap the same key before creating plaintext', async () => {
    const { fixture, result } = await createArchive()
    const wrongRecovery = 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ'

    await expect(verifyMissionArchiveFile({
      request: verifyRequest(fixture, result),
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(wrongRecovery, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_WRONG_KEY' })
    expect(existsSync(path.join(fixture.archiveDirectory, '.verification'))).toBe(false)
  }, 60_000)

  it('rejects a wrong passphrase before creating verification plaintext', async () => {
    const { fixture, result } = await createArchive()

    await expect(verifyMissionArchiveFile({
      request: verifyRequest(fixture, result),
      passphraseBytes: Buffer.from('Wrong calm words 2026!', 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_WRONG_KEY' })
    expect(existsSync(path.join(fixture.archiveDirectory, '.verification'))).toBe(false)
  }, 60_000)

  it.each(['bit-flip', 'truncation'] as const)(
    'rejects authenticated-stream %s after exact disk identity is rebound and sweeps scratch',
    async (attack) => {
      const { fixture, result } = await createArchive()
      const archivePath = path.join(fixture.archiveDirectory, result.finalRelativePath)
      const original = readFileSync(archivePath)
      let attacked: Buffer
      if (attack === 'bit-flip') {
        attacked = Buffer.from(original)
        const headerLength = attacked.readUInt32BE(8)
        const slotsLengthOffset = 12 + headerLength
        const slotsLength = attacked.readUInt32BE(slotsLengthOffset)
        const firstCiphertextByte = slotsLengthOffset + 4 + slotsLength + 13
        attacked[firstCiphertextByte] = attacked[firstCiphertextByte]! ^ 0x01
      } else {
        attacked = original.subarray(0, original.length - 20)
      }
      const identity = replaceArchiveBytes(fixture, result, attacked)

      await expect(verifyMissionArchiveFile({
        request: verifyRequest(fixture, result, identity),
        passphraseBytes: Buffer.from(passphrase, 'utf8'),
        recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
        cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
      })).rejects.toBeTruthy()
      expect(existsSync(path.join(
        fixture.archiveDirectory, '.verification', verifyOperationId,
      ))).toBe(false)
    },
    60_000,
  )

  it('rejects a wrong mission or request event row before creating verification plaintext', async () => {
    const { fixture, result } = await createArchive()

    for (const [identity, expectedCode] of [
      [{ missionId: 'mission-substituted' }, 'ARCHIVE_VERIFY_IDENTITY_MISMATCH'],
      [{ requestEventRowid: 43 }, 'ARCHIVE_VERIFY_IDENTITY_MISMATCH'],
    ] as const) {
      await expect(verifyMissionArchiveFile({
        request: verifyRequest(fixture, result, identity),
        passphraseBytes: Buffer.from(passphrase, 'utf8'),
        recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
        cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
      })).rejects.toMatchObject({ code: expectedCode })
      expect(existsSync(path.join(fixture.archiveDirectory, '.verification'))).toBe(false)
    }
  }, 60_000)

  it('cancels after key proof without retaining verification plaintext', async () => {
    const { fixture, result } = await createArchive()
    const cancellationFlag = new Int32Array(new SharedArrayBuffer(4))

    await expect(verifyMissionArchiveFile({
      request: verifyRequest(fixture, result),
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag,
      onProgress: (progress: { readonly phase?: string }) => {
        if (progress.phase === 'keys') Atomics.store(cancellationFlag, 0, 1)
      },
    })).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    expect(existsSync(path.join(
      fixture.archiveDirectory, '.verification', verifyOperationId,
    ))).toBe(false)
  }, 60_000)

  it('runs the complete independent proof off the main isolate with transferred secrets', async () => {
    const { fixture, result } = await createArchive()
    const operation = startArchiveVerifyWorker({
      request: {
        ...verifyRequest(fixture, result),
        passphrase,
        recoveryCode,
      },
    })

    await expect(operation).resolves.toMatchObject({
      proofVersion: 1,
      exhaustive: true,
      archiveId,
      missionId: 'mission-a',
      plaintextSweepConfirmed: true,
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
  }, 60_000)

  it('rejects a registry-to-disk hash mismatch before creating plaintext', async () => {
    const { fixture, result } = await createArchive()
    const request = {
      ...verifyRequest(fixture, result),
      ciphertextSha256: '0'.repeat(64),
    }

    await expect(verifyMissionArchiveFile({
      request,
      passphraseBytes: Buffer.from(passphrase, 'utf8'),
      recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })).rejects.toMatchObject({ code: 'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH' })
    expect(existsSync(path.join(fixture.archiveDirectory, '.verification'))).toBe(false)
  }, 60_000)
})
