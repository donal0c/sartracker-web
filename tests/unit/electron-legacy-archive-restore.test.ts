import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Writable } from 'node:stream'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const nodeFs = require('node:fs') as typeof import('node:fs')
const { createZipArchive } = require('../../electron/zip-archive.cjs') as {
  readonly createZipArchive: (
    entries: readonly { readonly name: string; readonly data: Buffer }[],
  ) => Buffer
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: {
    readonly userDataPath: string
  }) => {
    readonly createMission: (input: {
      readonly name: string
    }) => Promise<{ readonly id: string }>
    readonly finishMission: (missionId: string) => Promise<unknown>
    readonly close: () => void
  }
}
const {
  restoreLegacyMissionArchive,
} = require('../../electron/legacy-archive-restore.cjs') as {
  readonly restoreLegacyMissionArchive: (
    input: {
      readonly archivePath: string
      readonly sessionDirectory: string
      readonly expectedMissionId: string
      readonly onProgress?: (progress: {
        readonly phase: string
        readonly completed: number
      }) => void
    },
    dependencies?: {
      readonly getAvailableDiskBytes?: (sessionDirectory: string) => Promise<number>
    },
  ) => Promise<{
      readonly archiveKind: 'legacy_unencrypted'
      readonly containerVersion: 1
      readonly encrypted: false
      readonly immutable: true
      readonly missionId: string
      readonly databaseFileName: 'mission-store.sqlite'
      readonly databaseFileHandle: Awaited<ReturnType<typeof open>>
      readonly databaseIdentity: {
        readonly dev: number
        readonly ino: number
        readonly sizeBytes: number
      }
      readonly schemaVersion: number
      readonly entryCount: number
      readonly attachmentCount: number
      readonly attachmentMappings: readonly {
        readonly entryName: string
        readonly sourceRelativePath: string
        readonly sha256: string
        readonly sizeBytes: number
        readonly references: readonly {
          readonly referenceKind: string
          readonly referenceId: string
        }[]
      }[]
    }>
}

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

type LegacyFixture = {
  readonly archivePath: string
  readonly bytes: Buffer
  readonly missionId: string
  readonly schemaVersion: number
}

type LegacyAttachmentReference = Readonly<
  | {
    readonly kind: 'marker'
    readonly id: string
    readonly attachmentPath: string
  }
  | {
    readonly kind: 'marker_version'
    readonly id: string
    readonly objectId: string
    readonly attachmentPath: string
  }
  | {
    readonly kind: 'event'
    readonly id: string
    readonly eventType:
      | 'marker_attachment_ingested'
      | 'marker_created'
      | 'marker_updated'
      | 'marker_deleted'
    readonly attachmentPath: string
  }
>

const DEFAULT_ATTACHMENT_NAME = 'abc123-evidence.txt'
const DEFAULT_MARKER_ID = 'legacy-marker-current'

let rootDirectory: string
const restoreHandles = new Set<Awaited<ReturnType<typeof open>>>()

beforeEach(async () => {
  rootDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-legacy-restore-'))
})

afterEach(async () => {
  await Promise.all([...restoreHandles].map(async (handle) => {
    await handle.close().catch(() => undefined)
  }))
  restoreHandles.clear()
  await rm(rootDirectory, { force: true, recursive: true })
})

async function restoreTrackedLegacyMissionArchive(
  input: Parameters<typeof restoreLegacyMissionArchive>[0],
  dependencies?: Parameters<typeof restoreLegacyMissionArchive>[1],
): ReturnType<typeof restoreLegacyMissionArchive> {
  const result = await restoreLegacyMissionArchive(input, dependencies)
  restoreHandles.add(result.databaseFileHandle)
  return result
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeSqliteSnapshot(
  missionId: string,
  schemaVersion: number,
  missionSchemaVersion = schemaVersion,
  missionStatus = 'finalized',
  attachmentReferences: readonly LegacyAttachmentReference[] = [],
): Buffer {
  const databasePath = path.join(rootDirectory, `source-${crypto.randomUUID()}.sqlite`)
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    );
    CREATE TABLE markers (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      attachment_path TEXT
    );
    CREATE TABLE mission_object_versions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      version_sequence INTEGER NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT
    );
  `)
  database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
    .run('schema_version', String(schemaVersion))
  database.prepare(`INSERT INTO missions (id, name, status, schema_version)
    VALUES (?, ?, ?, ?)`).run(missionId, 'Legacy mission', missionStatus, missionSchemaVersion)
  for (const [index, reference] of attachmentReferences.entries()) {
    if (reference.kind === 'marker') {
      database.prepare(`INSERT INTO markers (id, mission_id, attachment_path)
        VALUES (?, ?, ?)`).run(reference.id, missionId, reference.attachmentPath)
      continue
    }
    if (reference.kind === 'marker_version') {
      database.prepare(`INSERT INTO mission_object_versions (
        id, mission_id, object_type, object_id, version_sequence, state_json
      ) VALUES (?, ?, 'marker', ?, ?, ?)`).run(
        reference.id,
        missionId,
        reference.objectId,
        index + 1,
        JSON.stringify({ attachment_path: reference.attachmentPath }),
      )
      continue
    }
    database.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json
    ) VALUES (?, ?, ?, ?, ?)`).run(
      reference.id,
      missionId,
      reference.eventType,
      `2026-08-29T12:00:${String(index).padStart(2, '0')}.000Z`,
      JSON.stringify({ attachment_path: reference.attachmentPath }),
    )
  }
  database.close()
  return require('node:fs').readFileSync(databasePath) as Buffer
}

async function createFixture(input: {
  readonly missionId?: string
  readonly manifestMissionId?: string
  readonly missionJsonId?: string
  readonly missionStatus?: string
  readonly databaseMissionStatus?: string
  readonly archiveVersion?: number
  readonly schemaVersion?: number
  readonly databaseSchemaVersion?: number
  readonly missionSchemaVersion?: number
  readonly missionJsonSchemaVersion?: number
  readonly databaseBytes?: Buffer
  readonly databaseAttachmentReferences?: readonly LegacyAttachmentReference[]
  readonly requiredEntryOrder?: readonly ('manifest.json' | 'mission.json' | 'mission-store.sqlite')[]
  readonly extraEntries?: readonly { readonly name: string; readonly data: Buffer }[]
} = {}): Promise<LegacyFixture> {
  const missionId = input.missionId ?? 'mission-legacy-1'
  const schemaVersion = input.schemaVersion ?? 13
  const databaseSchemaVersion = input.databaseSchemaVersion ?? schemaVersion
  const missionSchemaVersion = input.missionSchemaVersion ?? databaseSchemaVersion
  const archivePath = path.join(rootDirectory, `${crypto.randomUUID()}.zip`)
  const defaultAttachmentPath = `/legacy/missions/${missionId}/attachments/${DEFAULT_ATTACHMENT_NAME}`
  const defaultAttachmentReferences: readonly LegacyAttachmentReference[] = input.extraEntries === undefined
    ? [{
      kind: 'marker',
      id: DEFAULT_MARKER_ID,
      attachmentPath: defaultAttachmentPath,
    }]
    : []
  const requiredEntries = new Map<string, { readonly name: string; readonly data: Buffer }>([
    ['manifest.json', {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({
        archive_version: input.archiveVersion ?? 1,
        created_at: '2026-08-29T12:00:00.000Z',
        mission_id: input.manifestMissionId ?? missionId,
        schema_version: schemaVersion,
        snapshot_format: 'sqlite',
      }), 'utf8'),
    }],
    ['mission.json', {
      name: 'mission.json',
      data: Buffer.from(JSON.stringify({
        id: input.missionJsonId ?? missionId,
        name: 'Legacy mission',
        status: input.missionStatus ?? 'finalized',
        schema_version: input.missionJsonSchemaVersion ?? missionSchemaVersion,
      }), 'utf8'),
    }],
    ['mission-store.sqlite', {
      name: 'mission-store.sqlite',
      data: input.databaseBytes ?? makeSqliteSnapshot(
        missionId,
        databaseSchemaVersion,
        missionSchemaVersion,
        input.databaseMissionStatus ?? input.missionStatus ?? 'finalized',
        input.databaseAttachmentReferences ?? defaultAttachmentReferences,
      ),
    }],
  ])
  const bytes = createZipArchive([
    ...(input.requiredEntryOrder ?? [
      'manifest.json',
      'mission.json',
      'mission-store.sqlite',
    ]).map((name) => requiredEntries.get(name)!),
    ...(input.extraEntries ?? [{
      name: `attachments/${DEFAULT_ATTACHMENT_NAME}`,
      data: Buffer.from('legacy attachment bytes', 'utf8'),
    }]),
  ])
  await writeFile(archivePath, bytes)
  return { archivePath, bytes, missionId, schemaVersion }
}

/** Creates the earliest repository archive-era mission-store schema (v3). */
async function createSchema3Snapshot(missionId: string): Promise<{
  readonly bytes: Buffer
  readonly databasePath: string
}> {
  const databasePath = path.join(rootDirectory, 'legacy-schema-3-live.sqlite')
  const database = new Database(databasePath)
  try {
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time TEXT NOT NULL,
        pause_time TEXT,
        finish_time TEXT,
        paused_seconds INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        schema_version INTEGER NOT NULL
      );
    `)
    database.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', '3')")
      .run()
    database.prepare(`INSERT INTO missions (
      id, name, status, start_time, pause_time, finish_time,
      paused_seconds, notes, schema_version
    ) VALUES (?, 'Earliest legacy archive', 'finalized', ?, NULL, ?, 0, NULL, 3)`).run(
      missionId,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
    )
  } finally {
    database.close()
  }
  return { bytes: await readFile(databasePath), databasePath }
}

/** Creates a v12-shaped store carrying one supported pre-v13 schema marker. */
async function createSchema12ShapedSnapshot(schemaVersion = 12): Promise<{
  readonly bytes: Buffer
  readonly databasePath: string
  readonly missionId: string
}> {
  const userDataPath = path.join(rootDirectory, 'legacy-schema-12-live')
  await mkdir(userDataPath, { recursive: true, mode: 0o700 })
  const store = createElectronMissionStore({ userDataPath })
  const mission = await store.createMission({ name: 'Legacy v12 mission' })
  await store.finishMission(mission.id)
  store.close()

  const databasePath = path.join(userDataPath, 'mission-store.sqlite')
  const database = new Database(databasePath)
  try {
    database.exec(`
      DROP TABLE mission_cleanup_journal;
      DROP TABLE mission_archive_supplements;
      DROP TABLE mission_archives;
    `)
    database.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(schemaVersion))
    database.prepare('UPDATE missions SET schema_version = ? WHERE id = ?')
      .run(schemaVersion, mission.id)
  } finally {
    database.close()
  }
  return { bytes: await readFile(databasePath), databasePath, missionId: mission.id }
}

function findEocd(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('test ZIP is missing EOCD')
}

function centralRecords(bytes: Buffer): readonly { readonly start: number; readonly end: number }[] {
  const eocd = findEocd(bytes)
  const count = bytes.readUInt16LE(eocd + 10)
  let cursor = bytes.readUInt32LE(eocd + 16)
  const records: { start: number; end: number }[] = []
  for (let index = 0; index < count; index += 1) {
    expect(bytes.readUInt32LE(cursor)).toBe(CENTRAL_SIGNATURE)
    const end = cursor + 46
      + bytes.readUInt16LE(cursor + 28)
      + bytes.readUInt16LE(cursor + 30)
      + bytes.readUInt16LE(cursor + 32)
    records.push({ start: cursor, end })
    cursor = end
  }
  return records
}

function localHeaderForCentral(bytes: Buffer, centralOffset: number): number {
  return bytes.readUInt32LE(centralOffset + 42)
}

async function expectFailedWithMainOwnedResidue(
  bytes: Buffer,
  expectedMissionId: string,
  expected: RegExp,
): Promise<void> {
  const archivePath = path.join(rootDirectory, `${crypto.randomUUID()}-attack.zip`)
  const sessionDirectory = path.join(rootDirectory, `${crypto.randomUUID()}-session`)
  await writeFile(archivePath, bytes)
  await expect(restoreTrackedLegacyMissionArchive({
    archivePath,
    sessionDirectory,
    expectedMissionId,
  })).rejects.toThrow(expected)
  await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
}

describe('legacy plaintext archive streaming restore', () => {
  it('restores the fixed legacy payload with permission-restricted files and bounded metadata', async () => {
    const fixture = await createFixture()
    const sourceHashBefore = sha256(await readFile(fixture.archivePath))
    const sessionDirectory = path.join(rootDirectory, 'review-session')
    const progress: Array<{ readonly phase: string; readonly completed: number; readonly total?: number | null; readonly unit?: string }> = []

    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
      onProgress: (update) => progress.push(update),
    })

    const {
      databaseFileHandle: _databaseFileHandle,
      databaseIdentity,
      ...portableResult
    } = result
    expect(_databaseFileHandle.fd).toBeGreaterThanOrEqual(0)
    expect(portableResult).toEqual({
      archiveKind: 'legacy_unencrypted',
      containerVersion: 1,
      encrypted: false,
      immutable: true,
      missionId: fixture.missionId,
      databaseFileName: 'mission-store.sqlite',
      schemaVersion: 13,
      entryCount: 4,
      attachmentCount: 1,
      attachmentMappings: [{
        entryName: `attachments/${DEFAULT_ATTACHMENT_NAME}`,
        sourceRelativePath: DEFAULT_ATTACHMENT_NAME,
        sha256: sha256(Buffer.from('legacy attachment bytes', 'utf8')),
        sizeBytes: Buffer.byteLength('legacy attachment bytes', 'utf8'),
        references: [{
          referenceKind: 'marker',
          referenceId: DEFAULT_MARKER_ID,
        }],
      }],
    })
    const restoredDatabaseIdentity = await stat(
      path.join(sessionDirectory, 'mission-store.sqlite'),
    )
    expect(databaseIdentity).toEqual({
      dev: restoredDatabaseIdentity.dev,
      ino: restoredDatabaseIdentity.ino,
      sizeBytes: restoredDatabaseIdentity.size,
    })
    expect(restoredDatabaseIdentity.size % (1024 * 1024)).not.toBe(0)
    expect(JSON.stringify(result)).not.toContain(rootDirectory)
    expect(sha256(await readFile(fixture.archivePath))).toBe(sourceHashBefore)
    expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(sessionDirectory, 'mission-store.sqlite'))).mode & 0o777).toBe(0o600)
    expect((await stat(path.join(sessionDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(path.join(sessionDirectory, 'attachments'))).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(
      sessionDirectory,
      `attachments/${DEFAULT_ATTACHMENT_NAME}`,
    ))).mode & 0o777).toBe(0o600)
    expect(await readFile(path.join(sessionDirectory, 'attachments', DEFAULT_ATTACHMENT_NAME), 'utf8'))
      .toBe('legacy attachment bytes')
    const validationProgress = progress.filter((update) => update.phase === 'validate')
    expect(validationProgress.at(0)).toMatchObject({
      unit: 'bytes', completed: 0, total: expect.any(Number),
    })
    expect(validationProgress.at(-1)).toMatchObject({
      unit: 'bytes', completed: validationProgress.at(-1)?.total,
    })
    const phaseOrder = ['preflight', 'metadata', 'database', 'validate', 'attachments', 'ready']
    expect(progress.map((update) => phaseOrder.indexOf(update.phase)))
      .toEqual([...progress]
        .map((update) => phaseOrder.indexOf(update.phase))
        .sort((left, right) => left - right))
  })

  it('restores a repository-written highly compressible 1 MiB referenced attachment', async () => {
    const missionId = 'mission-legacy-compressible-attachment'
    const attachmentName = 'compressible-evidence.bin'
    const attachmentPath = `/legacy/missions/${missionId}/attachments/${attachmentName}`
    const attachmentBytes = Buffer.alloc(1024 * 1024, 0x41)
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [{
        kind: 'marker',
        id: 'marker-compressible-evidence',
        attachmentPath,
      }],
      extraEntries: [{
        name: `attachments/${attachmentName}`,
        data: attachmentBytes,
      }],
    })
    const sessionDirectory = path.join(rootDirectory, 'compressible-attachment-session')

    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })

    expect(result).toMatchObject({
      missionId,
      attachmentCount: 1,
      attachmentMappings: [{
        entryName: `attachments/${attachmentName}`,
        sourceRelativePath: attachmentName,
        sha256: sha256(attachmentBytes),
        sizeBytes: attachmentBytes.byteLength,
        references: [{
          referenceKind: 'marker',
          referenceId: 'marker-compressible-evidence',
        }],
      }],
    })
    const restoredBytes = await readFile(path.join(
      sessionDirectory,
      'attachments',
      attachmentName,
    ))
    expect(restoredBytes.byteLength).toBe(attachmentBytes.byteLength)
    expect(sha256(restoredBytes)).toBe(sha256(attachmentBytes))
  })

  it('truncates every displaced plaintext output when the session path is rebound mid-restore', async () => {
    const missionId = 'mission-legacy-rebound-session'
    const attachmentName = 'rebound-evidence.bin'
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [{
        kind: 'marker',
        id: 'marker-rebound-evidence',
        attachmentPath: `/legacy/missions/${missionId}/attachments/${attachmentName}`,
      }],
      extraEntries: [{
        name: `attachments/${attachmentName}`,
        data: Buffer.alloc(2 * 1024 * 1024, 0x52),
      }],
    })
    const sessionDirectory = path.join(rootDirectory, 'rebound-session')
    const displacedSessionDirectory = path.join(rootDirectory, 'displaced-rebound-session')
    let rebound = false

    const failure = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
      onProgress: (progress) => {
        if (!rebound && progress.phase === 'attachments' && progress.completed > 0
          && nodeFs.existsSync(sessionDirectory)) {
          rebound = true
          nodeFs.renameSync(sessionDirectory, displacedSessionDirectory)
        }
      },
    }).then(
      () => null,
      (error: unknown) => error as { readonly code?: string },
    )

    expect(rebound).toBe(true)
    expect(failure).toMatchObject({ code: expect.any(String) })
    expect((await stat(path.join(displacedSessionDirectory, 'mission-store.sqlite'))).size)
      .toBe(0)
    expect((await stat(path.join(
      displacedSessionDirectory,
      'attachments',
      attachmentName,
    ))).size).toBe(0)
  })

  it('rejects a valid highly compressed restore before its first payload write when declared bytes exceed disk headroom', async () => {
    const missionId = 'mission-legacy-disk-headroom'
    const attachmentName = 'highly-compressed-evidence.bin'
    const attachmentPath = `/legacy/missions/${missionId}/attachments/${attachmentName}`
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [{
        kind: 'marker',
        id: 'marker-disk-headroom-evidence',
        attachmentPath,
      }],
      extraEntries: [{
        name: `attachments/${attachmentName}`,
        data: Buffer.alloc(4 * 1024 * 1024, 0x41),
      }],
    })
    const records = centralRecords(fixture.bytes)
    const declaredUncompressedBytes = records.reduce(
      (total, record) => total + fixture.bytes.readUInt32LE(record.start + 24),
      0,
    )
    const declaredCompressedBytes = records.reduce(
      (total, record) => total + fixture.bytes.readUInt32LE(record.start + 20),
      0,
    )
    const requiredFreeBytes = Math.ceil(declaredUncompressedBytes * 1.2)
    const sessionDirectory = path.join(rootDirectory, 'disk-headroom-session')
    const getAvailableDiskBytes = vi.fn(async () => requiredFreeBytes - 1)
    const payloadWriteSpy = vi.spyOn(nodeFs, 'createWriteStream')
    let observation: Readonly<Record<string, unknown>>

    try {
      const archiveHashBefore = sha256(await readFile(fixture.archivePath))
      const failure = await restoreTrackedLegacyMissionArchive({
        archivePath: fixture.archivePath,
        sessionDirectory,
        expectedMissionId: missionId,
      }, {
        getAvailableDiskBytes,
      }).then(
        () => null,
        (error: unknown) => error as { readonly code?: string },
      )
      const sessionResidue = await readdir(sessionDirectory).catch((error: unknown) => {
        if ((error as { readonly code?: string }).code === 'ENOENT') return null
        throw error
      })
      observation = {
        archiveWasHighlyCompressed: declaredCompressedBytes * 20 < declaredUncompressedBytes,
        archiveSourceUnchanged: sha256(await readFile(fixture.archivePath)) === archiveHashBefore,
        capacityProbeCalls: getAvailableDiskBytes.mock.calls,
        failureCode: failure?.code,
        payloadWriteCount: payloadWriteSpy.mock.calls.length,
        sessionResidue,
      }
    } finally {
      payloadWriteSpy.mockRestore()
    }

    expect(observation).toEqual({
      archiveWasHighlyCompressed: true,
      archiveSourceUnchanged: true,
      capacityProbeCalls: [[sessionDirectory]],
      failureCode: 'LEGACY_ARCHIVE_DISK_FULL',
      payloadWriteCount: 0,
      sessionResidue: [],
    })
  })

  it('preserves an output-stream ENOSPC as explicit disk-full and removes plaintext residue', async () => {
    const fixture = await createFixture()
    const sessionDirectory = path.join(rootDirectory, 'runtime-enospc-session')
    const injectedDiskFull = Object.assign(new Error('Injected output disk full.'), {
      code: 'ENOSPC',
    })
    const failingOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback(injectedDiskFull)
      },
    })
    const outputSpy = vi.spyOn(nodeFs, 'createWriteStream').mockImplementationOnce(
      () => failingOutput as unknown as ReturnType<typeof nodeFs.createWriteStream>,
    )
    let observation: Readonly<Record<string, unknown>>

    try {
      const archiveHashBefore = sha256(await readFile(fixture.archivePath))
      const failure = await restoreTrackedLegacyMissionArchive({
        archivePath: fixture.archivePath,
        sessionDirectory,
        expectedMissionId: fixture.missionId,
      }).then(
        () => null,
        (error: unknown) => error as { readonly code?: string },
      )
      const sessionResidue = await readdir(sessionDirectory).catch((error: unknown) => {
        if ((error as { readonly code?: string }).code === 'ENOENT') return null
        throw error
      })
      observation = {
        archiveSourceUnchanged: sha256(await readFile(fixture.archivePath)) === archiveHashBefore,
        failureCode: failure?.code,
        outputOpenCount: outputSpy.mock.calls.length,
        sessionResidue,
      }
    } finally {
      outputSpy.mockRestore()
    }

    expect(observation).toEqual({
      archiveSourceUnchanged: true,
      failureCode: 'LEGACY_ARCHIVE_DISK_FULL',
      outputOpenCount: 1,
      sessionResidue: [],
    })
  })

  it('migrates a genuine v12 archive only inside its restricted scratch session', async () => {
    const source = await createSchema12ShapedSnapshot()
    const fixture = await createFixture({
      missionId: source.missionId,
      schemaVersion: 12,
      missionSchemaVersion: 12,
      missionJsonSchemaVersion: 12,
      missionStatus: 'finished',
      databaseBytes: source.bytes,
      extraEntries: [],
    })
    const archiveHashBefore = sha256(await readFile(fixture.archivePath))
    const liveDatabaseHashBefore = sha256(await readFile(source.databasePath))
    const liveSentinelPath = path.join(rootDirectory, 'unrelated-live.sqlite')
    await writeFile(liveSentinelPath, 'LIVE-STORE-MUST-NOT-CHANGE', { mode: 0o600 })
    const liveSentinelHashBefore = sha256(await readFile(liveSentinelPath))
    const sessionDirectory = path.join(rootDirectory, 'older-schema-session')

    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })

    expect(result).toMatchObject({
      missionId: fixture.missionId,
      schemaVersion: 13,
      attachmentMappings: [],
    })
    const migrated = new Database(path.join(sessionDirectory, 'mission-store.sqlite'), {
      readonly: true,
      fileMustExist: true,
    })
    try {
      expect(migrated.prepare(
        "SELECT value FROM metadata WHERE key = 'schema_version'",
      ).get()).toEqual({ value: '13' })
      expect(migrated.prepare(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'mission_archives', 'mission_archive_supplements', 'mission_cleanup_journal'
        ) ORDER BY name`).all()).toEqual([
        { name: 'mission_archive_supplements' },
        { name: 'mission_archives' },
        { name: 'mission_cleanup_journal' },
      ])
    } finally {
      migrated.close()
    }
    expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(sessionDirectory, 'mission-store.sqlite'))).mode & 0o777)
      .toBe(0o600)
    expect(sha256(await readFile(fixture.archivePath))).toBe(archiveHashBefore)
    expect(sha256(await readFile(source.databasePath))).toBe(liveDatabaseHashBefore)
    expect(sha256(await readFile(liveSentinelPath))).toBe(liveSentinelHashBefore)
  })

  it('does not reject a compatible schema v11 archive merely for its age', async () => {
    const source = await createSchema12ShapedSnapshot(11)
    const fixture = await createFixture({
      missionId: source.missionId,
      schemaVersion: 11,
      missionSchemaVersion: 11,
      missionJsonSchemaVersion: 11,
      missionStatus: 'finished',
      databaseBytes: source.bytes,
      extraEntries: [],
    })

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory: path.join(rootDirectory, 'schema-11-session'),
      expectedMissionId: source.missionId,
    })).resolves.toMatchObject({
      missionId: source.missionId,
      schemaVersion: 13,
      attachmentMappings: [],
    })
  })

  it('migrates the earliest repository archive-era schema to v13 for review', async () => {
    const missionId = 'mission-schema-3-legacy'
    const source = await createSchema3Snapshot(missionId)
    const fixture = await createFixture({
      missionId,
      schemaVersion: 3,
      missionSchemaVersion: 3,
      missionJsonSchemaVersion: 3,
      databaseBytes: source.bytes,
      extraEntries: [],
    })
    const sourceHashBefore = sha256(await readFile(source.databasePath))
    const sessionDirectory = path.join(rootDirectory, 'schema-3-session')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })).resolves.toMatchObject({
      missionId,
      schemaVersion: 13,
      attachmentMappings: [],
    })

    const migrated = new Database(path.join(sessionDirectory, 'mission-store.sqlite'), {
      readonly: true,
      fileMustExist: true,
    })
    try {
      expect(migrated.prepare(
        "SELECT value FROM metadata WHERE key = 'schema_version'",
      ).get()).toEqual({ value: '13' })
      expect(migrated.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(migrated.prepare('SELECT id, status FROM missions WHERE id = ?').get(missionId))
        .toEqual({ id: missionId, status: 'finalized' })
    } finally {
      migrated.close()
    }
    expect(sha256(await readFile(source.databasePath))).toBe(sourceHashBefore)
  })

  it('accepts a mission created under an older row schema inside a newer database schema', async () => {
    const fixture = await createFixture({ schemaVersion: 13, missionSchemaVersion: 5 })
    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory: path.join(rootDirectory, 'older-mission-row-session'),
      expectedMissionId: fixture.missionId,
    })
    expect(result.schemaVersion).toBe(13)
  })

  it('creates a permission-restricted empty attachment root when the archive has no attachments', async () => {
    const fixture = await createFixture({ extraEntries: [] })
    const sessionDirectory = path.join(rootDirectory, 'no-attachment-session')
    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })
    expect(result.attachmentCount).toBe(0)
    expect((await stat(path.join(sessionDirectory, 'attachments'))).mode & 0o777).toBe(0o700)
    expect(await readdir(path.join(sessionDirectory, 'attachments'))).toEqual([])
  })

  it('returns exact closed mappings from current, versioned, and audit marker evidence', async () => {
    const missionId = 'mission-legacy-colliding-attachments'
    const sharedBasename = 'briefing.pdf'
    const firstPath = `/first-host/missions/${missionId}/attachments/${sharedBasename}`
    const secondPath = `/second-host/missions/${missionId}/attachments/${sharedBasename}`
    const firstEntryName = `attachments/${sha256(Buffer.from(firstPath)).slice(0, 12)}-${sharedBasename}`
    const secondEntryName = `attachments/${sha256(Buffer.from(secondPath)).slice(0, 12)}-${sharedBasename}`
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [
        { kind: 'marker', id: 'marker-current', attachmentPath: firstPath },
        {
          kind: 'marker_version',
          id: 'marker-version-2',
          objectId: 'marker-current',
          attachmentPath: firstPath,
        },
        {
          kind: 'event',
          id: 'attachment-ingested-event',
          eventType: 'marker_attachment_ingested',
          attachmentPath: secondPath,
        },
        {
          kind: 'event',
          id: 'marker-updated-event',
          eventType: 'marker_updated',
          attachmentPath: secondPath,
        },
        {
          kind: 'event',
          id: 'marker-created-event',
          eventType: 'marker_created',
          attachmentPath: secondPath,
        },
        {
          kind: 'event',
          id: 'marker-deleted-event',
          eventType: 'marker_deleted',
          attachmentPath: secondPath,
        },
      ],
      extraEntries: [
        { name: firstEntryName, data: Buffer.from('FIRST-COLLIDING-BYTES') },
        { name: secondEntryName, data: Buffer.from('SECOND-COLLIDING-BYTES') },
      ],
    })
    const sessionDirectory = path.join(rootDirectory, 'mapped-attachments-session')

    const result = await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })

    expect(result.attachmentMappings).toEqual([
      {
        entryName: firstEntryName,
        sourceRelativePath: sharedBasename,
        sha256: sha256(Buffer.from('FIRST-COLLIDING-BYTES')),
        sizeBytes: Buffer.byteLength('FIRST-COLLIDING-BYTES'),
        references: [
          { referenceKind: 'marker', referenceId: 'marker-current' },
          { referenceKind: 'marker_version', referenceId: 'marker-version-2' },
        ],
      },
      {
        entryName: secondEntryName,
        sourceRelativePath: sharedBasename,
        sha256: sha256(Buffer.from('SECOND-COLLIDING-BYTES')),
        sizeBytes: Buffer.byteLength('SECOND-COLLIDING-BYTES'),
        references: [
          {
            referenceKind: 'marker_attachment_ingested',
            referenceId: 'attachment-ingested-event',
          },
          { referenceKind: 'marker_created', referenceId: 'marker-created-event' },
          { referenceKind: 'marker_deleted', referenceId: 'marker-deleted-event' },
          { referenceKind: 'marker_updated', referenceId: 'marker-updated-event' },
        ],
      },
    ])
    expect(Object.isFrozen(result.attachmentMappings)).toBe(true)
    expect(result.attachmentMappings.every((mapping) => Object.isFrozen(mapping))).toBe(true)
    expect(result.attachmentMappings.every((mapping) => Object.isFrozen(mapping.references)))
      .toBe(true)
    expect(result.attachmentMappings.flatMap((mapping) => mapping.references)
      .every((reference) => Object.isFrozen(reference))).toBe(true)
    expect(JSON.stringify(result.attachmentMappings)).not.toContain('/first-host')
    expect(JSON.stringify(result.attachmentMappings)).not.toContain('/second-host')
  })

  it('rejects an unprefixed ambiguous basename instead of guessing between DB paths', async () => {
    const missionId = 'mission-legacy-ambiguous-attachment'
    const basename = 'same-name.jpg'
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [
        {
          kind: 'marker',
          id: 'marker-one',
          attachmentPath: `/first/missions/${missionId}/attachments/${basename}`,
        },
        {
          kind: 'marker',
          id: 'marker-two',
          attachmentPath: `/second/missions/${missionId}/attachments/${basename}`,
        },
      ],
      extraEntries: [{ name: `attachments/${basename}`, data: Buffer.from('AMBIGUOUS') }],
    })
    const sessionDirectory = path.join(rootDirectory, 'ambiguous-attachment-session')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING' })
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
  })

  it('rejects an unexplained attachment after v12 migration for the main-owned sweep', async () => {
    const source = await createSchema12ShapedSnapshot()
    const fixture = await createFixture({
      missionId: source.missionId,
      schemaVersion: 12,
      missionSchemaVersion: 12,
      missionJsonSchemaVersion: 12,
      missionStatus: 'finished',
      databaseBytes: source.bytes,
      extraEntries: [{
        name: 'attachments/unreferenced.bin',
        data: Buffer.from('UNREFERENCED'),
      }],
    })
    const archiveHashBefore = sha256(await readFile(fixture.archivePath))
    const sourceHashBefore = sha256(await readFile(source.databasePath))
    const sessionDirectory = path.join(rootDirectory, 'unreferenced-attachment-session')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING' })
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
    expect(sha256(await readFile(fixture.archivePath))).toBe(archiveHashBefore)
    expect(sha256(await readFile(source.databasePath))).toBe(sourceHashBefore)
  })

  it('rejects DB attachment evidence omitted from the ZIP and retains main-owned residue', async () => {
    const missionId = 'mission-legacy-missing-attachment-entry'
    const fixture = await createFixture({
      missionId,
      databaseAttachmentReferences: [{
        kind: 'marker',
        id: 'marker-missing-entry',
        attachmentPath: `/legacy/missions/${missionId}/attachments/missing.jpg`,
      }],
      extraEntries: [],
    })
    const sessionDirectory = path.join(rootDirectory, 'missing-attachment-entry-session')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING' })
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
  })

  it('rejects wrong mission identity across custody, manifest, mission JSON, and SQLite', async () => {
    const custodyMismatch = await createFixture()
    await expectFailedWithMainOwnedResidue(custodyMismatch.bytes, 'other-mission', /mission.*match/iu)

    const missionJsonMismatch = await createFixture({ missionJsonId: 'other-mission' })
    await expectFailedWithMainOwnedResidue(missionJsonMismatch.bytes, missionJsonMismatch.missionId, /mission.*match/iu)

    const manifestMismatch = await createFixture({ manifestMissionId: 'other-mission' })
    await expectFailedWithMainOwnedResidue(manifestMismatch.bytes, manifestMismatch.missionId, /mission.*match/iu)
  })

  it('rejects a manifest/SQLite schema mismatch', async () => {
    const fixture = await createFixture({
      schemaVersion: 12,
      databaseSchemaVersion: 13,
      missionSchemaVersion: 5,
    })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /schema.*match/iu)
  })

  it('rejects a mission JSON/SQLite row-schema mismatch', async () => {
    const fixture = await createFixture({
      schemaVersion: 13,
      missionSchemaVersion: 5,
      missionJsonSchemaVersion: 6,
    })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /mission.*schema.*match/iu)
  })

  it('rejects a legacy payload that claims to archive a still-writable mission', async () => {
    const fixture = await createFixture({ missionStatus: 'active' })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /mission.*status|finished|finalized/iu)
  })

  it('rejects disagreement between mission JSON and SQLite lifecycle status', async () => {
    const fixture = await createFixture({
      missionStatus: 'finished',
      databaseMissionStatus: 'finalized',
    })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /mission.*status.*match/iu)
  })

  it('fails closed for a newer container or schema version', async () => {
    const newerContainer = await createFixture({ archiveVersion: 2 })
    await expectFailedWithMainOwnedResidue(newerContainer.bytes, newerContainer.missionId, /unsupported.*version/iu)

    const newerSchema = await createFixture({ schemaVersion: 14, databaseSchemaVersion: 14 })
    const sessionDirectory = path.join(rootDirectory, 'newer-schema-session')
    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: newerSchema.archivePath,
      sessionDirectory,
      expectedMissionId: newerSchema.missionId,
    })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA' })
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
  })

  it.each([
    { label: 'missing', value: null },
    { label: 'non-numeric', value: 'unknown' },
    { label: 'fractional', value: '12.5' },
  ])('fails closed when restored SQLite schema metadata is $label', async ({ value }) => {
    const missionId = 'mission-legacy-unknown-schema'
    const sourcePath = path.join(rootDirectory, 'unknown-schema.sqlite')
    await writeFile(sourcePath, makeSqliteSnapshot(missionId, 13, 13, 'finalized', []))
    const database = new Database(sourcePath)
    try {
      if (value === null) {
        database.prepare("DELETE FROM metadata WHERE key = 'schema_version'").run()
      } else {
        database.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
          .run(value)
      }
    } finally {
      database.close()
    }
    const fixture = await createFixture({
      missionId,
      schemaVersion: 13,
      missionSchemaVersion: 13,
      missionJsonSchemaVersion: 13,
      databaseBytes: await readFile(sourcePath),
      extraEntries: [],
    })
    const sourceHashBefore = sha256(await readFile(sourcePath))
    const sessionDirectory = path.join(rootDirectory, 'unknown-schema-session')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: missionId,
    })).rejects.toMatchObject({ code: 'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA' })
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
    expect(sha256(await readFile(sourcePath))).toBe(sourceHashBefore)
  })

  it('rejects corruption, truncation, and bytes after the exact ZIP EOF', async () => {
    const fixture = await createFixture()
    const central = centralRecords(fixture.bytes)[0]!
    const local = localHeaderForCentral(fixture.bytes, central.start)
    expect(fixture.bytes.readUInt32LE(local)).toBe(LOCAL_SIGNATURE)
    const nameLength = fixture.bytes.readUInt16LE(local + 26)
    const extraLength = fixture.bytes.readUInt16LE(local + 28)
    const payload = local + 30 + nameLength + extraLength
    const corrupted = Buffer.from(fixture.bytes)
    corrupted[payload] = corrupted[payload]! ^ 0xff
    await expectFailedWithMainOwnedResidue(corrupted, fixture.missionId, /CRC|corrupt|inflate/iu)
    await expectFailedWithMainOwnedResidue(fixture.bytes.subarray(0, -7), fixture.missionId, /end|truncat|EOCD/iu)
    await expectFailedWithMainOwnedResidue(
      Buffer.concat([fixture.bytes, Buffer.from('trailing-splice')]),
      fixture.missionId,
      /trailing|end|EOCD/iu,
    )
  })

  it('rejects central/local disagreement and gaps spliced before the central directory', async () => {
    const fixture = await createFixture()
    const firstCentral = centralRecords(fixture.bytes)[0]!
    const local = localHeaderForCentral(fixture.bytes, firstCentral.start)
    const mismatch = Buffer.from(fixture.bytes)
    mismatch.writeUInt32LE((mismatch.readUInt32LE(local + 14) + 1) >>> 0, local + 14)
    await expectFailedWithMainOwnedResidue(mismatch, fixture.missionId, /central|local|CRC.*agree/iu)

    const eocd = findEocd(fixture.bytes)
    const centralOffset = fixture.bytes.readUInt32LE(eocd + 16)
    const spliced = Buffer.concat([
      fixture.bytes.subarray(0, centralOffset),
      Buffer.from([0]),
      fixture.bytes.subarray(centralOffset),
    ])
    const movedEocd = eocd + 1
    spliced.writeUInt32LE(centralOffset + 1, movedEocd + 16)
    await expectFailedWithMainOwnedResidue(spliced, fixture.missionId, /gap|local|central/iu)
  })

  it('rejects central/local timestamp disagreement', async () => {
    const fixture = await createFixture()
    const central = centralRecords(fixture.bytes)[0]!
    const mismatch = Buffer.from(fixture.bytes)
    mismatch.writeUInt16LE(1, central.start + 12)
    await expectFailedWithMainOwnedResidue(mismatch, fixture.missionId, /central.*local|header.*agree/iu)
  })

  it('rejects central-directory reordering even when every record is otherwise valid', async () => {
    const fixture = await createFixture({ extraEntries: [
      { name: 'attachments/aa.bin', data: Buffer.from('aa') },
      { name: 'attachments/bb.bin', data: Buffer.from('bb') },
    ] })
    const records = centralRecords(fixture.bytes)
    const first = records.at(-2)!
    const second = records.at(-1)!
    expect(first.end - first.start).toBe(second.end - second.start)
    const reordered = Buffer.from(fixture.bytes)
    fixture.bytes.copy(reordered, first.start, second.start, second.end)
    fixture.bytes.copy(reordered, second.start, first.start, first.end)
    await expectFailedWithMainOwnedResidue(reordered, fixture.missionId, /order|local.*offset|central/iu)
  })

  it('rejects a fully rebuilt archive whose fixed repository entries are reordered', async () => {
    const fixture = await createFixture({
      requiredEntryOrder: ['mission.json', 'manifest.json', 'mission-store.sqlite'],
    })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /fixed.*order|entry.*order/iu)
  })

  it('rejects duplicate or filesystem-colliding entry names', async () => {
    const duplicate = await createFixture({ extraEntries: [
      { name: 'attachments/repeated.bin', data: Buffer.from('one') },
      { name: 'attachments/repeated.bin', data: Buffer.from('two') },
    ] })
    await expectFailedWithMainOwnedResidue(duplicate.bytes, duplicate.missionId, /duplicate/iu)

    const caseCollision = await createFixture({ extraEntries: [
      { name: 'attachments/Evidence.bin', data: Buffer.from('one') },
      { name: 'attachments/evidence.bin', data: Buffer.from('two') },
    ] })
    await expectFailedWithMainOwnedResidue(caseCollision.bytes, caseCollision.missionId, /duplicate|collid/iu)
  })

  it.each([
    '../outside.sqlite',
    '/absolute.sqlite',
    'attachments/../../outside',
    'attachments\\outside.bin',
    'attachments//double.bin',
  ])('rejects non-canonical or escaping path %s', async (entryName) => {
    const fixture = await createFixture({ extraEntries: [
      { name: entryName, data: Buffer.from('attack') },
    ] })
    await expectFailedWithMainOwnedResidue(fixture.bytes, fixture.missionId, /path|entry name|canonical/iu)
    await expect(access(path.join(rootDirectory, 'outside.sqlite'), constants.F_OK))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects Unix symlink-like entries', async () => {
    const fixture = await createFixture()
    const attachment = centralRecords(fixture.bytes).at(-1)!
    const symlink = Buffer.from(fixture.bytes)
    symlink.writeUInt16LE((3 << 8) | 20, attachment.start + 4)
    symlink.writeUInt32LE((0o120777 << 16) >>> 0, attachment.start + 38)
    await expectFailedWithMainOwnedResidue(symlink, fixture.missionId, /symlink|file type/iu)
  })

  it.each([
    { label: 'encrypted', flag: 0x0001 },
    { label: 'data-descriptor', flag: 0x0008 },
  ])('rejects unsupported $label entries explicitly', async ({ flag }) => {
    const fixture = await createFixture()
    const central = centralRecords(fixture.bytes)[0]!
    const local = localHeaderForCentral(fixture.bytes, central.start)
    const unsupported = Buffer.from(fixture.bytes)
    unsupported.writeUInt16LE(flag, central.start + 8)
    unsupported.writeUInt16LE(flag, local + 6)
    await expectFailedWithMainOwnedResidue(unsupported, fixture.missionId, /unsupported|encrypted|descriptor/iu)
  })

  it('rejects unsupported compression and ZIP64 sentinels explicitly', async () => {
    const fixture = await createFixture()
    const central = centralRecords(fixture.bytes)[0]!
    const local = localHeaderForCentral(fixture.bytes, central.start)
    const compression = Buffer.from(fixture.bytes)
    compression.writeUInt16LE(99, central.start + 10)
    compression.writeUInt16LE(99, local + 8)
    await expectFailedWithMainOwnedResidue(compression, fixture.missionId, /unsupported.*compression/iu)

    const zip64 = Buffer.from(fixture.bytes)
    zip64.writeUInt32LE(0xffffffff, central.start + 24)
    await expectFailedWithMainOwnedResidue(zip64, fixture.missionId, /ZIP64|unsupported/iu)
  })

  it('rejects a declared compression bomb through the absolute restore budget', async () => {
    const fixture = await createFixture({ extraEntries: [
      { name: 'attachments/bomb-1.txt', data: Buffer.from('one') },
      { name: 'attachments/bomb-2.txt', data: Buffer.from('two') },
      { name: 'attachments/bomb-3.txt', data: Buffer.from('three') },
    ] })
    const bomb = Buffer.from(fixture.bytes)
    for (const central of centralRecords(bomb).slice(-3)) {
      const local = localHeaderForCentral(bomb, central.start)
      bomb.writeUInt32LE(0xfffffffe, central.start + 24)
      bomb.writeUInt32LE(0xfffffffe, local + 22)
    }
    await expectFailedWithMainOwnedResidue(
      bomb,
      fixture.missionId,
      /total restored size exceeds its safe limit/iu,
    )
  })

  it('does not overwrite or delete a pre-existing non-empty caller directory', async () => {
    const fixture = await createFixture()
    const sessionDirectory = path.join(rootDirectory, 'not-a-new-session')
    await mkdir(sessionDirectory, { mode: 0o700 })
    const sentinel = path.join(sessionDirectory, 'sentinel.txt')
    await writeFile(sentinel, 'caller-owned')

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })).rejects.toThrow(/empty|session/iu)
    expect(await readFile(sentinel, 'utf8')).toBe('caller-owned')
  })

  it('repairs an empty session directory to 0700 before extracting', async () => {
    const fixture = await createFixture()
    const sessionDirectory = path.join(rootDirectory, 'precreated-empty-session')
    await mkdir(sessionDirectory, { mode: 0o755 })
    await chmod(sessionDirectory, 0o755)
    await restoreTrackedLegacyMissionArchive({
      archivePath: fixture.archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })
    expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
    expect(await readdir(sessionDirectory)).toEqual(expect.arrayContaining([
      'manifest.json',
      'mission.json',
      'mission-store.sqlite',
      'attachments',
    ]))
  })

  it('retains a precreated session directory for the main owner when extraction fails', async () => {
    const fixture = await createFixture()
    const central = centralRecords(fixture.bytes)[0]!
    const local = localHeaderForCentral(fixture.bytes, central.start)
    const nameLength = fixture.bytes.readUInt16LE(local + 26)
    const corrupt = Buffer.from(fixture.bytes)
    corrupt[local + 30 + nameLength] = corrupt[local + 30 + nameLength]! ^ 0xff
    const archivePath = path.join(rootDirectory, 'precreated-session-failure.zip')
    const sessionDirectory = path.join(rootDirectory, 'precreated-session-failure')
    await writeFile(archivePath, corrupt)
    await mkdir(sessionDirectory, { mode: 0o700 })

    await expect(restoreTrackedLegacyMissionArchive({
      archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
    })).rejects.toThrow(/CRC|corrupt|inflate/iu)
    await expect(access(sessionDirectory, constants.F_OK)).resolves.toBeUndefined()
  })
})
