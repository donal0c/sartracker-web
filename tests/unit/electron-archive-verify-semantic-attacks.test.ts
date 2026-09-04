import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

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
const { startMissionArchiveCreateWorker } = require(
  '../../electron/mission-archive-runner.cjs',
) as {
  readonly startMissionArchiveCreateWorker: (input: {
    readonly request: Readonly<Record<string, unknown>>
  }) => Promise<ArchiveCreateResult> & { readonly workerExited: Promise<void> }
}
const {
  canonicalJson,
  parseCanonicalJson,
  readArchiveContainer,
  readArchivePreamble,
  writeArchiveContainer,
} = require('../../electron/archive-container.cjs') as ArchiveContainerModule
const {
  generateMissionArchiveKey,
  unwrapMissionArchiveKey,
  wrapMissionArchiveKey,
  zeroBuffer,
} = require('../../electron/archive-crypto.cjs') as ArchiveCryptoModule
const { verifyMissionArchiveFile } = require('../../electron/archive-verify.cjs') as {
  readonly verifyMissionArchiveFile: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
}

interface ArchiveCreateResult {
  readonly temporaryRelativePath: string
  readonly ciphertextSha256: string
  readonly sizeBytes: number
}

interface ArchiveHeader {
  readonly cipher: string
  readonly container_version: number
  readonly created_at: string
  readonly request_event_rowid: number
  readonly frame_size: number
  readonly framing: string
  readonly inventory_version: number
  readonly key_slot_count: number
  readonly mission_id: string
  readonly nonce_prefix: string
  readonly previous_archive_sha256: string | null
  readonly schema_version: number
}

interface ArchiveEntry {
  readonly name: string
  readonly bytes: Buffer
}

interface ArchivePreamble {
  readonly header: ArchiveHeader
  readonly keySlots: readonly Readonly<Record<string, unknown>>[]
  readonly headerDigest: Buffer
}

interface ArchiveContainerModule {
  readonly canonicalJson: (value: unknown) => string
  readonly parseCanonicalJson: (bytes: Buffer, label: string) => unknown
  readonly readArchivePreamble: (
    readable: NodeJS.ReadableStream | AsyncIterable<Buffer>,
  ) => Promise<ArchivePreamble>
  readonly readArchiveContainer: (input: {
    readonly readable: NodeJS.ReadableStream | AsyncIterable<Buffer>
    readonly missionArchiveKey: Buffer
    readonly onEntryStart: (entry: { readonly name: string; readonly size: bigint }) => void
    readonly onEntryChunk: (
      entry: { readonly name: string; readonly size: bigint },
      chunk: Buffer,
    ) => void
    readonly onEntryEnd: (entry: { readonly name: string; readonly size: bigint }) => void
  }) => Promise<unknown>
  readonly writeArchiveContainer: (input: {
    readonly writable: NodeJS.WritableStream
    readonly header: ArchiveHeader
    readonly keySlots: readonly Readonly<Record<string, unknown>>[]
    readonly missionArchiveKey: Buffer
    readonly entries: readonly {
      readonly name: string
      readonly size: number
      readonly source: Buffer
    }[]
  }) => Promise<{
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly frameCount: bigint
    readonly headerDigest: string
  }>
}

interface ArchiveCryptoModule {
  readonly generateMissionArchiveKey: () => Buffer
  readonly unwrapMissionArchiveKey: (input: {
    readonly slot: Readonly<Record<string, unknown>>
    readonly secret: string | Buffer
    readonly headerDigest: Buffer
  }) => Promise<Buffer>
  readonly wrapMissionArchiveKey: (input: {
    readonly missionArchiveKey: Buffer
    readonly slotType: 'passphrase' | 'recovery'
    readonly slotId: string
    readonly secret: string | Buffer
    readonly headerDigest: Buffer
  }) => Promise<Readonly<Record<string, unknown>>>
  readonly zeroBuffer: (value: Buffer) => void
}

interface ManifestEntryProof {
  readonly name: string
  readonly sha256: string
  readonly size_bytes: number
}

interface ArchiveManifest extends Readonly<Record<string, unknown>> {
  readonly entries: readonly ManifestEntryProof[]
}

const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const passphrase = 'Four calm words 2026!'
const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const fenceRequestedAt = '2026-08-29T18:59:59.000Z'
const createdAt = '2026-08-29T19:00:00.000Z'
const maximumTestArchiveBytes = 16 * 1024 * 1024
const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates a small v13 source store and one real production-created archive. */
async function createArchiveFixture() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-semantic-attack-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const databasePath = path.join(userDataPath, 'mission-store.sqlite')
  const archiveDirectory = path.join(userDataPath, 'archives')
  const db = new Database(databasePath)
  db.prepare(`INSERT INTO missions (
    id, name, status, start_time, finish_time, paused_seconds, schema_version
  ) VALUES ('mission-a', 'Mission A', 'finished', ?, ?, 0, 13)`).run(
    '2026-08-29T10:00:00.000Z',
    '2026-08-29T12:00:00.000Z',
  )
  const cleanupMembershipGeneration = readArchiveCleanupMembershipGeneration(db, 'mission-a')
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

  const result = await startMissionArchiveCreateWorker({
    request: {
      operationId,
      archiveId,
      databasePath,
      archiveDirectory,
      missionId: 'mission-a',
      requestEventRowid: 42,
      fenceRequestedAt,
      requestEventId,
      archiveKind: 'finalized',
      createdAt,
      schemaVersion: 13,
      inventoryVersion: 1,
      previousArchiveSha256: null,
      protectedFinalizationEpoch: null,
      passphrase,
      recoveryCode,
    },
  })
  return { userDataPath, databasePath, archiveDirectory, result }
}

/** Decrypts the small fixture archive with the production reader for controlled repackaging. */
async function readFixtureEntries(
  fixture: Awaited<ReturnType<typeof createArchiveFixture>>,
) {
  const archivePath = path.join(fixture.archiveDirectory, fixture.result.temporaryRelativePath)
  const archiveBytes = readFileSync(archivePath)
  if (archiveBytes.byteLength > maximumTestArchiveBytes) {
    throw new Error('Semantic attack fixture unexpectedly exceeded its test-only memory bound.')
  }
  const preamble = await readArchivePreamble(Readable.from([archiveBytes]))
  const passphraseSlot = preamble.keySlots.find((slot) => slot.slotType === 'passphrase')
  if (passphraseSlot === undefined) throw new Error('Fixture archive has no passphrase slot.')
  const missionArchiveKey = await unwrapMissionArchiveKey({
    slot: passphraseSlot,
    secret: Buffer.from(passphrase, 'utf8'),
    headerDigest: preamble.headerDigest,
  })
  const entries: ArchiveEntry[] = []
  let chunks: Buffer[] | null = null
  let currentName: string | null = null
  try {
    await readArchiveContainer({
      readable: Readable.from([archiveBytes]),
      missionArchiveKey,
      onEntryStart: (entry) => {
        if (entry.size > BigInt(maximumTestArchiveBytes)) {
          throw new Error(`Semantic attack entry ${entry.name} exceeded its test-only bound.`)
        }
        currentName = entry.name
        chunks = []
      },
      onEntryChunk: (_entry, chunk) => {
        if (chunks === null) throw new Error('Fixture entry chunks arrived out of order.')
        chunks.push(Buffer.from(chunk))
      },
      onEntryEnd: (entry) => {
        if (chunks === null || currentName !== entry.name) {
          throw new Error('Fixture entry completion arrived out of order.')
        }
        entries.push({ name: entry.name, bytes: Buffer.concat(chunks) })
        chunks.forEach((chunk) => chunk.fill(0))
        chunks = null
        currentName = null
      },
    })
    return { entries, header: preamble.header }
  } finally {
    zeroBuffer(missionArchiveKey)
    preamble.headerDigest.fill(0)
    chunks?.forEach((chunk) => chunk.fill(0))
  }
}

/** Writes a validly encrypted semantic substitution with fresh MAK, nonce prefix, and slots. */
async function writeReencryptedAttack(
  fixture: Awaited<ReturnType<typeof createArchiveFixture>>,
  originalHeader: ArchiveHeader,
  name: string,
  entries: readonly ArchiveEntry[],
) {
  const noncePrefix = randomBytes(4)
  const header: ArchiveHeader = {
    ...originalHeader,
    nonce_prefix: noncePrefix.toString('base64'),
  }
  const headerDigest = createHash('sha256').update(canonicalJson(header), 'utf8').digest()
  const missionArchiveKey = generateMissionArchiveKey()
  const relativePath = `${archiveId}.sararch`
  const outputPath = path.join(fixture.archiveDirectory, relativePath)
  try {
    const keySlots = await Promise.all([
      wrapMissionArchiveKey({
        missionArchiveKey,
        slotType: 'passphrase',
        slotId: 'passphrase-v1',
        secret: passphrase,
        headerDigest,
      }),
      wrapMissionArchiveKey({
        missionArchiveKey,
        slotType: 'recovery',
        slotId: 'recovery-v1',
        secret: recoveryCode,
        headerDigest,
      }),
    ])
    const written = await writeArchiveContainer({
      writable: createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
      header,
      keySlots,
      missionArchiveKey,
      entries: entries.map((entry) => ({
        name: entry.name,
        size: entry.bytes.byteLength,
        source: entry.bytes,
      })),
    })
    return {
      archiveRelativePath: relativePath,
      ciphertextSha256: written.ciphertextSha256,
      sizeBytes: written.sizeBytes,
      frameCount: Number(written.frameCount),
      headerSha256: written.headerDigest,
      manifestSha256: createHash('sha256')
        .update(entries.find((entry) => entry.name === 'manifest.json')?.bytes
          ?? Buffer.alloc(0)).digest('hex'),
      entryCount: entries.length,
      tableCount: 49,
    }
  } finally {
    zeroBuffer(missionArchiveKey)
    headerDigest.fill(0)
    noncePrefix.fill(0)
  }
}

/** Builds the verifier's exact registered identity for one attacked archive. */
function verifyRequest(
  fixture: Awaited<ReturnType<typeof createArchiveFixture>>,
  operationIdForVerification: string,
  attack: {
    readonly archiveRelativePath: string
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly frameCount: number
    readonly headerSha256: string
    readonly manifestSha256: string
    readonly entryCount: number
    readonly tableCount: number
  },
) {
  return {
    operationId: operationIdForVerification,
    archiveId,
    archiveKind: 'finalized',
    archiveDirectory: fixture.archiveDirectory,
    archiveRelativePath: attack.archiveRelativePath,
    databasePath: fixture.databasePath,
    missionId: 'mission-a',
    requestEventRowid: 42,
    requestEventId,
    creationOperationId: operationId,
    protectedFinalizationEpoch: null,
    createdAt,
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: attack.ciphertextSha256,
    previousArchiveSha256: null,
    sizeBytes: attack.sizeBytes,
    frameCount: attack.frameCount,
    headerSha256: attack.headerSha256,
    manifestSha256: attack.manifestSha256,
    entryCount: attack.entryCount,
    tableCount: attack.tableCount,
  }
}

/** Runs the independent verifier and asserts its owned plaintext directory was swept. */
async function expectRejectedWithoutPlaintext(
  fixture: Awaited<ReturnType<typeof createArchiveFixture>>,
  operationIdForVerification: string,
  attack: Awaited<ReturnType<typeof writeReencryptedAttack>>,
  expectedCode: string,
) {
  await expect(verifyMissionArchiveFile({
    request: verifyRequest(fixture, operationIdForVerification, attack),
    passphraseBytes: Buffer.from(passphrase, 'utf8'),
    recoveryCodeBytes: Buffer.from(recoveryCode, 'utf8'),
    cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
  })).rejects.toMatchObject({ code: expectedCode })
  expect(existsSync(path.join(
    fixture.archiveDirectory,
    '.verification',
    operationIdForVerification,
  ))).toBe(false)
}

describe('mission archive semantic substitution attacks', () => {
  it('rejects when the pinned live database replay diverges from the authenticated restored baseline', async () => {
    const fixture = await createArchiveFixture()
    const { entries, header } = await readFixtureEntries(fixture)
    const sealed = await writeReencryptedAttack(
      fixture,
      header,
      'pinned-live-replay-divergence',
      entries,
    )

    const liveDatabase = new Database(fixture.databasePath)
    try {
      liveDatabase.prepare(`INSERT INTO mission_object_versions (
        id, mission_id, object_type, object_id, version_sequence, operation,
        effective_at, recorded_at, completeness, state_json
      ) VALUES (?, 'mission-a', 'marker', ?, 1, 'created', ?, ?, 'complete', ?)`).run(
        'live-only-version',
        'live-only-marker',
        '2026-08-29T10:30:00.000Z',
        '2026-08-29T10:30:00.000Z',
        JSON.stringify({ id: 'live-only-marker', type: 'Clue' }),
      )
    } finally {
      liveDatabase.close()
    }

    await expectRejectedWithoutPlaintext(
      fixture,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sealed,
      'ARCHIVE_VERIFY_REPLAY_MISMATCH',
    )
  }, 90_000)

  it('rejects a restored request event with the wrong mission-lifecycle meaning', async () => {
    const fixture = await createArchiveFixture()
    const { entries, header } = await readFixtureEntries(fixture)
    const sqliteEntry = entries.find((entry) => entry.name === 'mission-store.sqlite')
    const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
    if (sqliteEntry === undefined || manifestEntry === undefined) {
      throw new Error('Fixture archive is missing its manifest or SQLite entry.')
    }

    const mutatedDatabasePath = path.join(fixture.userDataPath, 'wrong-request-type.sqlite')
    writeFileSync(mutatedDatabasePath, sqliteEntry.bytes)
    const mutatedDatabase = new Database(mutatedDatabasePath)
    mutatedDatabase.prepare(`UPDATE mission_events SET event_type = 'mission_archive_requested'
      WHERE id = ?`).run(requestEventId)
    mutatedDatabase.close()
    const mutatedSqliteBytes = readFileSync(mutatedDatabasePath)
    const manifest = parseCanonicalJson(manifestEntry.bytes, 'test manifest') as ArchiveManifest
    const changedManifestBytes = Buffer.from(canonicalJson({
      ...manifest,
      entries: manifest.entries.map((proof) => proof.name === 'mission-store.sqlite'
        ? {
            ...proof,
            sha256: createHash('sha256').update(mutatedSqliteBytes).digest('hex'),
            size_bytes: mutatedSqliteBytes.byteLength,
          }
        : proof),
    }), 'utf8')
    const attacked = await writeReencryptedAttack(
      fixture,
      header,
      'wrong-request-type',
      entries.map((entry) => {
        if (entry.name === 'manifest.json') return { ...entry, bytes: changedManifestBytes }
        if (entry.name === 'mission-store.sqlite') return { ...entry, bytes: mutatedSqliteBytes }
        return entry
      }),
    )

    await expectRejectedWithoutPlaintext(
      fixture,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      attacked,
      'ARCHIVE_VERIFY_SCOPE_MISMATCH',
    )
  }, 90_000)

  it('rejects a re-encrypted SQLite row mutation even when its entry digest is updated', async () => {
    const fixture = await createArchiveFixture()
    const { entries, header } = await readFixtureEntries(fixture)
    const sqliteEntry = entries.find((entry) => entry.name === 'mission-store.sqlite')
    const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
    if (sqliteEntry === undefined || manifestEntry === undefined) {
      throw new Error('Fixture archive is missing its manifest or SQLite entry.')
    }

    const mutatedDatabasePath = path.join(fixture.userDataPath, 'mutated-archive.sqlite')
    writeFileSync(mutatedDatabasePath, sqliteEntry.bytes)
    const mutatedDatabase = new Database(mutatedDatabasePath)
    mutatedDatabase.prepare(`UPDATE mission_events SET details_json = ? WHERE id = ?`).run(
      JSON.stringify({ semantic_attack: 'valid-ciphertext-row-substitution' }),
      requestEventId,
    )
    mutatedDatabase.close()
    const mutatedSqliteBytes = readFileSync(mutatedDatabasePath)
    const manifest = parseCanonicalJson(manifestEntry.bytes, 'test manifest') as ArchiveManifest
    const changedManifest = {
      ...manifest,
      entries: manifest.entries.map((proof) => proof.name === 'mission-store.sqlite'
        ? {
            ...proof,
            sha256: createHash('sha256').update(mutatedSqliteBytes).digest('hex'),
            size_bytes: mutatedSqliteBytes.byteLength,
          }
        : proof),
    }
    const changedManifestBytes = Buffer.from(canonicalJson(changedManifest), 'utf8')
    const attackedEntries = entries.map((entry) => {
      if (entry.name === 'manifest.json') return { ...entry, bytes: changedManifestBytes }
      if (entry.name === 'mission-store.sqlite') return { ...entry, bytes: mutatedSqliteBytes }
      return entry
    })
    const attacked = await writeReencryptedAttack(
      fixture,
      header,
      'row-substitution',
      attackedEntries,
    )

    await expectRejectedWithoutPlaintext(
      fixture,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attacked,
      'ARCHIVE_VERIFY_SCOPE_MISMATCH',
    )
  }, 90_000)

  it('rejects a validly encrypted extra logical entry outside the closed manifest inventory', async () => {
    const fixture = await createArchiveFixture()
    const { entries, header } = await readFixtureEntries(fixture)
    const extraBytes = Buffer.from('undeclared semantic archive content', 'utf8')
    const attacked = await writeReencryptedAttack(
      fixture,
      header,
      'extra-entry-substitution',
      [...entries, { name: 'unexpected.bin', bytes: extraBytes }],
    )

    await expectRejectedWithoutPlaintext(
      fixture,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attacked,
      'ARCHIVE_VERIFY_ENTRY_MISMATCH',
    )
  }, 90_000)
})
