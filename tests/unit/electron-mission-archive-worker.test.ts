import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs'
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
const { startMissionArchiveCreateWorker } = require(
  '../../electron/mission-archive-runner.cjs',
) as {
  readonly startMissionArchiveCreateWorker: (input: {
    readonly request: Readonly<Record<string, unknown>>
    readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
  }) => Promise<Readonly<Record<string, unknown>>> & { readonly workerExited: Promise<void> }
}
const {
  readArchiveContainer,
  readArchivePreamble,
} = require('../../electron/archive-container.cjs') as {
  readonly readArchivePreamble: (readable: NodeJS.ReadableStream) => Promise<{
    readonly header: Readonly<Record<string, unknown>>
    readonly keySlots: readonly Readonly<Record<string, unknown>>[]
    readonly headerDigest: Buffer
  }>
  readonly readArchiveContainer: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
}
const { unwrapMissionArchiveKey, zeroBuffer } = require('../../electron/archive-crypto.cjs') as {
  readonly unwrapMissionArchiveKey: (input: Readonly<Record<string, unknown>>) => Promise<Buffer>
  readonly zeroBuffer: (buffer: Buffer) => void
}

const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const passphrase = 'Four calm words 2026!'
const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const fenceRequestedAt = '2026-08-29T18:59:59.000Z'
const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates one minimal finished mission with a pre-bound finalize request. */
function createSource() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-worker-'))
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
      cleanup_membership_generation: 0,
      protected_finalization_epoch: null,
    }),
    fenceRequestedAt,
  )
  db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
    VALUES ('mission-a', ?)`).run(fenceRequestedAt)
  db.close()
  return { userDataPath, databasePath, archiveDirectory }
}

describe('mission archive create worker', () => {
  it('streams one encrypted mission archive and removes all plaintext before completion', async () => {
    const fixture = createSource()
    const request = {
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
    }

    const progress: Array<{
      readonly phase: string
      readonly unit: string
      readonly completed: number
      readonly total: number | null
    }> = []
    const result = await startMissionArchiveCreateWorker({
      request,
      onProgress: (value) => progress.push(value as typeof progress[number]),
    }) as {
      readonly temporaryRelativePath: string
      readonly temporaryFileIdentity: Readonly<Record<string, unknown>>
      readonly plaintextSweepConfirmed: boolean
      readonly manifestSummary: { readonly tableCount: number; readonly entryCount: number }
    }
    const archivePath = path.join(fixture.archiveDirectory, result.temporaryRelativePath)
    expect(result.plaintextSweepConfirmed).toBe(true)
    expect(result.temporaryFileIdentity).toMatchObject({
      linkCount: 1,
      sizeBytes: expect.any(Number),
    })
    expect(result.manifestSummary).toMatchObject({ tableCount: 49, entryCount: 4 })
    expect(existsSync(archivePath)).toBe(true)
    expect(existsSync(path.join(
      fixture.archiveDirectory, '.staging', operationId, 'plaintext',
    ))).toBe(false)

    const preamble = await readArchivePreamble(createReadStream(archivePath))
    expect(preamble.header).toMatchObject({
      mission_id: 'mission-a',
      request_event_rowid: 42,
      request_event_id: requestEventId,
      creation_operation_id: operationId,
      protected_finalization_epoch: null,
      schema_version: 13,
      inventory_version: 1,
    })
    const passphraseKey = await unwrapMissionArchiveKey({
      slot: preamble.keySlots.find((slot) => slot.slotType === 'passphrase'),
      secret: passphrase,
      headerDigest: preamble.headerDigest,
    })
    const recoveryKey = await unwrapMissionArchiveKey({
      slot: preamble.keySlots.find((slot) => slot.slotType === 'recovery'),
      secret: recoveryCode,
      headerDigest: preamble.headerDigest,
    })
    expect(recoveryKey).toEqual(passphraseKey)

    const entries = new Map<string, Buffer[]>()
    await readArchiveContainer({
      readable: createReadStream(archivePath),
      missionArchiveKey: passphraseKey,
      onEntryStart: (entry: { readonly name: string }) => entries.set(entry.name, []),
      onEntryChunk: (entry: { readonly name: string }, chunk: Buffer) => {
        entries.get(entry.name)?.push(Buffer.from(chunk))
      },
    })
    zeroBuffer(passphraseKey)
    zeroBuffer(recoveryKey)

    expect([...entries.keys()]).toEqual([
      'manifest.json',
      'mission.json',
      'inventory.json',
      'mission-store.sqlite',
    ])
    const manifest = JSON.parse(Buffer.concat(entries.get('manifest.json') ?? []).toString('utf8'))
    expect(manifest).toMatchObject({
      mission_id: 'mission-a',
      request_event_rowid: 42,
      request_event_id: requestEventId,
      creation_operation_id: operationId,
      protected_finalization_epoch: null,
      schema_version: 13,
      inventory_version: 1,
    })
    expect(manifest.tables).toHaveLength(49)

    expect(progress.some((value) => value.phase === 'sqlite')).toBe(true)
    expect(progress.some((value) => value.phase === 'proof')).toBe(true)
    expect(progress.filter((value) => value.phase === 'extract').every((value) =>
      value.unit === 'rows' && value.total === null)).toBe(true)
    expect(progress.filter((value) => value.phase === 'digest').every((value) =>
      value.unit === 'bytes' && value.total === null)).toBe(true)
    const encryptionProgress = progress.filter((value) => value.phase === 'encrypt')
    expect(encryptionProgress.length).toBeGreaterThan(1)
    expect(encryptionProgress.every((value) =>
      value.unit === 'bytes' && value.total === null)).toBe(true)

    const restoredPath = path.join(fixture.userDataPath, 'restored.sqlite')
    const restoredBytes = Buffer.concat(entries.get('mission-store.sqlite') ?? [])
    // Small fixture only: production restore writes this entry directly to operation scratch.
    require('node:fs').writeFileSync(restoredPath, restoredBytes)
    const restored = new Database(restoredPath, { readonly: true })
    try {
      expect(restored.prepare('SELECT id FROM missions').all()).toEqual([{ id: 'mission-a' }])
      expect(restored.prepare(`SELECT rowid AS event_rowid FROM mission_events
        WHERE id = ?`).get(requestEventId)).toEqual({ event_rowid: 42 })
    } finally {
      restored.close()
    }
  }, 30_000)
})
