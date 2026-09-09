import { createHash } from 'node:crypto'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

it('streams and bounds untrusted attachment references before retaining the full ledger', () => {
  let rowsRead = 0
  const db = {
    exec: () => undefined,
    close: () => undefined,
    prepare: (sql: string) => ({
      run: () => undefined,
      all: () => { throw new Error('Unbounded reference allocation attempted') },
      *iterate() {
        if (!sql.includes('FROM markers')) return
        for (let index = 0; index < 100_000; index += 1) {
          rowsRead += 1
          yield { id: `marker-${index}`, attachment_path: `/missions/mission-a/attachments/${'x'.repeat(3900)}-${index}.jpg` }
        }
      },
    }),
  }
  expect(() => readArchiveAttachmentReferenceLedger({ db, databasePath: '/scratch/mission.sqlite', missionId: 'mission-a', restored: true }))
    .toThrow(expect.objectContaining({ code: 'ARCHIVE_ATTACHMENT_REFERENCE_LIMIT' }))
  expect(rowsRead).toBeLessThan(2000)
})
const {
  correctionAttachmentPeerName,
} = require('../../electron/archive-correction-custody.cjs') as {
  readonly correctionAttachmentPeerName: (targetName: string) => string
}
const {
  enumerateArchiveAttachments,
  readArchiveAttachmentReferenceLedger,
  streamArchiveAttachment,
  verifyArchiveAttachmentEntryProofs,
} = require('../../electron/archive-attachments.cjs') as {
  readonly enumerateArchiveAttachments: (input: {
    readonly db: BetterSqliteDatabase
    readonly databasePath: string
    readonly missionId: string
  }) => readonly AttachmentDescriptor[]
  readonly streamArchiveAttachment: (
    descriptor: AttachmentDescriptor,
  ) => AsyncIterable<Buffer>
  readonly readArchiveAttachmentReferenceLedger: (input: {
    readonly db: BetterSqliteDatabase
    readonly databasePath: string
    readonly missionId: string
    readonly restored?: boolean
  }) => readonly Readonly<Record<string, unknown>>[]
  readonly verifyArchiveAttachmentEntryProofs: (input: {
    readonly attachments: readonly Readonly<Record<string, unknown>>[]
    readonly entries: readonly Readonly<Record<string, unknown>>[]
  }) => void
}

type BetterSqliteDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

type AttachmentDescriptor = {
  readonly attachmentId: string
  readonly sourcePath: string
  readonly sourceRelativePath: string
  readonly entryName: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly custodyClass: 'v2_digest' | 'legacy_path_only'
  readonly references: readonly Readonly<Record<string, unknown>>[]
}

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates the minimal pinned attachment-reference schema and trusted root. */
function createFixture() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-attachments-'))
  temporaryDirectories.add(userDataPath)
  const missionId = 'mission-a'
  const databasePath = path.join(userDataPath, 'mission-store.sqlite')
  const attachmentRoot = path.join(userDataPath, 'missions', missionId, 'attachments')
  mkdirSync(attachmentRoot, { recursive: true, mode: 0o700 })
  const db = new Database(':memory:') as BetterSqliteDatabase
  db.exec(`
    CREATE TABLE markers (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, attachment_path TEXT,
      display_order INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE mission_object_versions (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, object_type TEXT NOT NULL,
      object_id TEXT NOT NULL, version_sequence INTEGER NOT NULL, state_json TEXT NOT NULL
    );
    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL, details_json TEXT
    );
  `)
  return { userDataPath, missionId, databasePath, attachmentRoot, db }
}

/** Adds one current marker reference to a fixture attachment. */
function referenceAttachment(
  fixture: ReturnType<typeof createFixture>,
  attachmentPath: string,
) {
  fixture.db.prepare(`INSERT INTO markers VALUES (?, ?, ?, 0, ?)`)
    .run('marker-a', fixture.missionId, attachmentPath, '2026-08-29T10:00:00.000Z')
}

/** Returns a representative operation-owned correction attachment basename. */
function correctionTargetName() {
  return 'correction-0123456789abcdef-0000-field-photo-fedcba9876543210.jpg'
}

/** Creates the exact retained two-link topology for a correction attachment. */
function createCorrectionPair(fixture: ReturnType<typeof createFixture>, bytes = 'corrected evidence') {
  const targetName = correctionTargetName()
  const targetPath = path.join(fixture.attachmentRoot, targetName)
  const peerPath = path.join(
    fixture.attachmentRoot,
    correctionAttachmentPeerName(targetName),
  )
  writeFileSync(targetPath, bytes, { mode: 0o600 })
  chmodSync(targetPath, 0o600)
  linkSync(targetPath, peerPath)
  return { targetPath, peerPath }
}

/** Consumes one bounded attachment stream and returns exact bytes. */
async function consume(stream: AsyncIterable<Buffer>) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe('archive attachment custody', () => {
  it('accepts and streams an exact mode-0600 correction hardlink pair', async () => {
    const fixture = createFixture()
    const { targetPath } = createCorrectionPair(fixture)
    referenceAttachment(fixture, targetPath)

    const descriptor = enumerateArchiveAttachments(fixture)[0]

    expect(descriptor.sourcePath).toBe(targetPath)
    await expect(consume(streamArchiveAttachment(descriptor)))
      .resolves.toEqual(Buffer.from('corrected evidence'))
    fixture.db.close()
  })

  it('rejects a two-link attachment whose public name is not correction-owned', () => {
    const fixture = createFixture()
    const targetPath = path.join(fixture.attachmentRoot, 'ordinary-evidence.jpg')
    writeFileSync(targetPath, 'ordinary evidence', { mode: 0o600 })
    chmodSync(targetPath, 0o600)
    linkSync(targetPath, path.join(fixture.attachmentRoot, '.ordinary-evidence.custody'))
    referenceAttachment(fixture, targetPath)

    expect(() => enumerateArchiveAttachments(fixture)).toThrow(/regular owner-contained file/iu)
    fixture.db.close()
  })

  it('rejects correction attachments with a third hardlink', () => {
    const fixture = createFixture()
    const { targetPath } = createCorrectionPair(fixture)
    linkSync(targetPath, path.join(fixture.attachmentRoot, '.unexpected-third-link'))
    referenceAttachment(fixture, targetPath)

    expect(() => enumerateArchiveAttachments(fixture)).toThrow(/regular owner-contained file/iu)
    fixture.db.close()
  })

  it.each(['missing', 'wrong'] as const)(
    'rejects a correction attachment whose exact custody peer is %s',
    (peerState) => {
      const fixture = createFixture()
      const targetName = correctionTargetName()
      const targetPath = path.join(fixture.attachmentRoot, targetName)
      const exactPeerPath = path.join(
        fixture.attachmentRoot,
        correctionAttachmentPeerName(targetName),
      )
      writeFileSync(targetPath, 'corrected evidence', { mode: 0o600 })
      chmodSync(targetPath, 0o600)
      linkSync(targetPath, path.join(fixture.attachmentRoot, '.wrong-custody-peer'))
      if (peerState === 'wrong') {
        writeFileSync(exactPeerPath, 'corrected evidence', { mode: 0o600 })
        chmodSync(exactPeerPath, 0o600)
        linkSync(exactPeerPath, path.join(fixture.attachmentRoot, '.wrong-peer-owner'))
      }
      referenceAttachment(fixture, targetPath)

      expect(() => enumerateArchiveAttachments(fixture)).toThrow(/regular owner-contained file/iu)
      fixture.db.close()
    },
  )

  it('rejects a correction hardlink pair that is not mode 0600', () => {
    const fixture = createFixture()
    const { targetPath } = createCorrectionPair(fixture)
    chmodSync(targetPath, 0o640)
    referenceAttachment(fixture, targetPath)

    expect(() => enumerateArchiveAttachments(fixture)).toThrow(/regular owner-contained file/iu)
    fixture.db.close()
  })

  it('unions current, version and custody references with deterministic manifest identities', () => {
    const fixture = createFixture()
    const firstPath = path.join(fixture.attachmentRoot, '11111111-photo.jpg')
    const secondPath = path.join(fixture.attachmentRoot, '22222222-photo.jpg')
    writeFileSync(firstPath, Buffer.from('first evidence'))
    writeFileSync(secondPath, Buffer.from('second evidence'))
    fixture.db.prepare(`INSERT INTO markers VALUES (?, ?, ?, 0, ?)`)
      .run('marker-a', fixture.missionId, firstPath, '2026-08-29T10:00:00.000Z')
    fixture.db.prepare(`INSERT INTO mission_object_versions
      VALUES (?, ?, 'marker', ?, 1, ?)`).run(
      'version-a', fixture.missionId, 'marker-a', JSON.stringify({ attachment_path: firstPath }),
    )
    fixture.db.prepare(`INSERT INTO mission_events VALUES (?, ?, ?, ?, ?)`).run(
      'event-a', fixture.missionId, 'marker_attachment_ingested',
      '2026-08-29T09:59:00.000Z', JSON.stringify({ attachment_path: firstPath }),
    )
    fixture.db.prepare(`INSERT INTO mission_events VALUES (?, ?, ?, ?, ?)`).run(
      'event-b', fixture.missionId, 'marker_attachment_ingested',
      '2026-08-29T10:01:00.000Z', JSON.stringify({ attachment_path: secondPath }),
    )

    const descriptors = enumerateArchiveAttachments(fixture)

    expect(descriptors).toHaveLength(2)
    expect(descriptors.map((descriptor) => descriptor.entryName)).toEqual([
      'attachments/00000001-11111111-photo.jpg',
      'attachments/00000002-22222222-photo.jpg',
    ])
    expect(descriptors[0]).toMatchObject({
      sourceRelativePath: '11111111-photo.jpg',
      sizeBytes: Buffer.byteLength('first evidence'),
      sha256: createHash('sha256').update('first evidence').digest('hex'),
      custodyClass: 'legacy_path_only',
    })
    expect(descriptors[0].references).toHaveLength(3)
    expect(descriptors[0].attachmentId).toMatch(/^legacy-[a-f0-9]{32}$/u)
    fixture.db.close()
  })

  it('accepts v2 custody only when the recorded size and digest match exact bytes', () => {
    const fixture = createFixture()
    const attachmentPath = path.join(fixture.attachmentRoot, '33333333-map.png')
    const bytes = Buffer.from('map evidence')
    writeFileSync(attachmentPath, bytes)
    fixture.db.prepare(`INSERT INTO mission_events VALUES (?, ?, ?, ?, ?)`).run(
      'event-v2', fixture.missionId, 'marker_attachment_ingested',
      '2026-08-29T10:01:00.000Z', JSON.stringify({
        attachment_id: '55555555-5555-4555-8555-555555555555',
        attachment_path: attachmentPath,
        relative_path: `missions/${fixture.missionId}/attachments/33333333-map.png`,
        display_name: 'map.png',
        size_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        custody_version: 2,
      }),
    )

    expect(enumerateArchiveAttachments(fixture)[0]).toMatchObject({
      attachmentId: '55555555-5555-4555-8555-555555555555',
      custodyClass: 'v2_digest',
    })
    fixture.db.prepare(`UPDATE mission_events SET details_json = ? WHERE id = 'event-v2'`).run(
      JSON.stringify({
        attachment_id: '55555555-5555-4555-8555-555555555555',
        attachment_path: attachmentPath,
        relative_path: `missions/${fixture.missionId}/attachments/33333333-map.png`,
        display_name: 'map.png',
        size_bytes: bytes.length,
        sha256: '0'.repeat(64),
        custody_version: 2,
      }),
    )
    expect(() => enumerateArchiveAttachments(fixture)).toThrow(/custody digest/iu)
    fixture.db.close()
  })

  it('rejects outside-root, symlink, missing, empty and non-regular attachment sources', () => {
    const attacks: Array<(fixture: ReturnType<typeof createFixture>) => string> = [
      (fixture) => {
        const outside = path.join(fixture.userDataPath, 'outside.txt')
        writeFileSync(outside, 'outside')
        return outside
      },
      (fixture) => {
        const target = path.join(fixture.attachmentRoot, 'target.txt')
        const link = path.join(fixture.attachmentRoot, 'link.txt')
        writeFileSync(target, 'target')
        symlinkSync(target, link)
        return link
      },
      (fixture) => path.join(fixture.attachmentRoot, 'missing.txt'),
      (fixture) => {
        const empty = path.join(fixture.attachmentRoot, 'empty.txt')
        writeFileSync(empty, '')
        return empty
      },
      (fixture) => fixture.attachmentRoot,
    ]
    for (const attack of attacks) {
      const fixture = createFixture()
      const attachmentPath = attack(fixture)
      fixture.db.prepare(`INSERT INTO markers VALUES (?, ?, ?, 0, ?)`)
        .run('marker-a', fixture.missionId, attachmentPath, '2026-08-29T10:00:00.000Z')
      expect(() => enumerateArchiveAttachments(fixture)).toThrow()
      fixture.db.close()
    }
  })

  it('detects same-size mutation between prehash and container streaming', async () => {
    const fixture = createFixture()
    const attachmentPath = path.join(fixture.attachmentRoot, '44444444-clue.txt')
    writeFileSync(attachmentPath, 'before')
    fixture.db.prepare(`INSERT INTO markers VALUES (?, ?, ?, 0, ?)`)
      .run('marker-a', fixture.missionId, attachmentPath, '2026-08-29T10:00:00.000Z')
    const descriptor = enumerateArchiveAttachments(fixture)[0]

    writeFileSync(attachmentPath, 'after!')

    await expect(consume(streamArchiveAttachment(descriptor))).rejects.toThrow(/changed/iu)
    fixture.db.close()
  })

  it('reconciles archived references without reopening their original-machine paths', () => {
    const fixture = createFixture()
    const originalPath = path.join(
      '/original-host/app-data', 'missions', fixture.missionId, 'attachments', 'evidence.jpg',
    )
    fixture.db.prepare(`INSERT INTO markers VALUES (?, ?, ?, 0, ?)`).run(
      'marker-a', fixture.missionId, originalPath, '2026-08-29T10:00:00.000Z',
    )

    expect(readArchiveAttachmentReferenceLedger({
      db: fixture.db,
      databasePath: fixture.databasePath,
      missionId: fixture.missionId,
      restored: true,
    })).toMatchObject([{ sourceRelativePath: 'evidence.jpg' }])

    fixture.db.prepare(`UPDATE markers SET attachment_path = ? WHERE id = 'marker-a'`).run(
      '/original-host/app-data/evidence.jpg',
    )
    expect(() => readArchiveAttachmentReferenceLedger({
      db: fixture.db,
      databasePath: fixture.databasePath,
      missionId: fixture.missionId,
      restored: true,
    })).toThrow(/archived mission attachment path/iu)
    fixture.db.close()
  })

  it('requires every attachment content digest and size to match its encrypted entry proof', () => {
    const digest = createHash('sha256').update('evidence').digest('hex')
    const attachment = {
      entry_name: 'attachments/00000001-evidence.txt',
      size_bytes: 8,
      sha256: digest,
    }
    const entry = {
      name: 'attachments/00000001-evidence.txt',
      size_bytes: 8,
      sha256: digest,
    }

    expect(() => verifyArchiveAttachmentEntryProofs({
      attachments: [attachment],
      entries: [entry],
    })).not.toThrow()
    for (const substituted of [
      { ...entry, sha256: '0'.repeat(64) },
      { ...entry, size_bytes: 9 },
      { ...entry, name: 'attachments/00000002-other.txt' },
    ]) {
      expect(() => verifyArchiveAttachmentEntryProofs({
        attachments: [attachment],
        entries: [substituted],
      })).toThrow(/attachment.*entry.*proof/iu)
    }
    expect(() => verifyArchiveAttachmentEntryProofs({
      attachments: [attachment],
      entries: [],
    })).toThrow(/attachment.*entry.*proof/iu)
  })
})
