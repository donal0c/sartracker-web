import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => TestStore
}
const {
  createArchiveCleanupCoordinator,
} = require('../../electron/archive-cleanup.cjs') as {
  readonly createArchiveCleanupCoordinator: (
    input: Readonly<Record<string, unknown>>,
  ) => ArchiveCleanupCoordinator
}

type TestStore = {
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly close: () => void
}

type BetterSqliteDatabase = {
  readonly exec: (sql: string) => unknown
  readonly pragma: (sql: string) => unknown
  readonly close: () => void
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined
    readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[]
    readonly run: (...parameters: readonly unknown[]) => { readonly changes: number }
  }
  readonly transaction: <T>(callback: () => T) => (() => T) & {
    readonly deferred: () => T
    readonly immediate: () => T
  }
}

type CleanupEvidence = {
  readonly archiveId: string
  readonly missionId: string
  readonly ciphertextSha256: string
  readonly sizeBytes: number
  readonly verificationProofValidated: boolean
  readonly custodyReconciled: boolean
  readonly archiveCustodyIdle: boolean
  readonly evidenceHealth: {
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly pendingCount: number
    readonly corruptCount: number
  }
  readonly reviewActivity: boolean
  readonly nonMachineUnwrap: null | {
    readonly archiveId: string
    readonly missionId: string
    readonly slotType: 'passphrase' | 'recovery'
    readonly authenticatedAt: string
    readonly ciphertextSha256: string
    readonly sizeBytes: number
  }
}

type ArchiveCleanupCoordinator = {
  readonly getEligibility: (input: CleanupEvidence) => {
    readonly eligible: boolean
    readonly blockers: readonly string[]
    readonly storageState: 'live' | 'cleanup_in_progress' | 'archived'
  }
  readonly start: (
    input: CleanupEvidence,
    options?: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: Readonly<Record<string, unknown>>) => void
      readonly faultInjection?: Readonly<Record<string, unknown>>
      readonly withCustodyCommit?: <T>(
        commit: (assertCustodyUnchanged: () => void) => T,
      ) => T
    },
  ) => Promise<Readonly<Record<string, unknown>>>
  readonly resume: (
    input: Omit<CleanupEvidence, 'nonMachineUnwrap'>,
    options?: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
}

type CleanupFixture = {
  readonly directory: string
  readonly db: BetterSqliteDatabase
  readonly coordinator: ArchiveCleanupCoordinator
  readonly missionId: string
  readonly archiveId: string
  readonly otherMissionId: string
  readonly evidence: CleanupEvidence
}

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Inserts one immutable cleanup audit event and preserves replay-generation semantics. */
function appendCleanupEvent(
  db: BetterSqliteDatabase,
  missionId: string,
  eventType: string,
  timestamp: string,
  details: Readonly<Record<string, unknown>>,
) {
  const eventId = randomUUID()
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at,
    recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`).run(
    eventId,
    missionId,
    eventType,
    timestamp,
    JSON.stringify(details),
    timestamp,
  )
  db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES (?, 1) ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`)
    .run(missionId)
  return eventId
}

/** Creates a genuine v13 store with two missions and one current verified archive identity. */
async function createFixture(input: {
  readonly yieldToMain?: (db: BetterSqliteDatabase, missionId: string, archiveId: string) => Promise<void>
  readonly yieldAfterBusyRetry?: () => Promise<void>
} = {}): Promise<CleanupFixture> {
  const directory = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-cleanup-'))
  temporaryDirectories.add(directory)
  const store = createElectronMissionStore({ userDataPath: directory })
  const mission = await store.createMission({ name: 'Cleanup Mission' })
  await store.upsertDevice({
    mission_id: mission.id,
    device_id: 'tracker-cleanup',
    name: 'Cleanup Tracker',
    color: '#00AAFF',
    status: 'offline',
  })
  for (let index = 0; index < 7; index += 1) {
    await store.addPosition({
      mission_id: mission.id,
      source_position_id: `cleanup-${index}`,
      device_id: 'tracker-cleanup',
      lat: 52 + index / 10_000,
      lon: -9,
      timestamp: `2026-08-30T10:00:0${index}.000Z`,
      timestamp_source: 'fix',
    })
  }
  await store.finishMission(mission.id)
  const otherMission = await store.createMission({ name: 'Other Mission' })
  await store.upsertDevice({
    mission_id: otherMission.id,
    device_id: 'tracker-other',
    name: 'Other Tracker',
    color: '#FFAA00',
    status: 'online',
  })
  await store.addPosition({
    mission_id: otherMission.id,
    source_position_id: 'other-1',
    device_id: 'tracker-other',
    lat: 53,
    lon: -8,
    timestamp: '2026-08-30T11:00:00.000Z',
    timestamp_source: 'fix',
  })
  const databasePath = (await store.info()).database_path
  store.close()

  const db = new Database(databasePath) as BetterSqliteDatabase
  db.pragma('foreign_keys = ON')
  const archiveId = randomUUID()
  const requestEventId = randomUUID()
  const sealedEventId = randomUUID()
  const finalizedEventId = randomUUID()
  const ciphertextSha256 = 'a'.repeat(64)
  const createdAt = '2026-08-30T12:00:00.000Z'
  db.transaction(() => {
    db.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, 'mission_finalize_requested', ?, ?, ?, 'complete')`).run(
      requestEventId,
      mission.id,
      createdAt,
      JSON.stringify({ archive_id: archiveId, resulting_status: 'finished' }),
      createdAt,
    )
    const requestEventRowid = Number(db.prepare(
      'SELECT rowid FROM mission_events WHERE id = ?',
    ).get(requestEventId)?.rowid)
    db.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, 'mission_archive_sealed_v2', ?, ?, ?, 'complete')`).run(
      sealedEventId,
      mission.id,
      createdAt,
      JSON.stringify({ archive_id: archiveId, resulting_status: 'finalized' }),
      createdAt,
    )
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, request_event_id,
      creation_operation_id, protected_finalization_epoch, archive_kind,
      container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
      sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
      table_count, verified_at, verification_proof_json, previous_archive_id,
      status, availability, availability_reason, last_reconciled_at,
      last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
      legacy_event_rowid
    ) VALUES (?, ?, ?, ?, ?, NULL, 'finalized', 2, ?, ?, 4096, ?, ?, 8, ?, ?, 4,
      49, ?, ?, NULL, 'verified', 'present', NULL, ?, ?, ?, NULL, NULL)`).run(
      archiveId,
      mission.id,
      requestEventRowid,
      requestEventId,
      randomUUID(),
      `${archiveId}.sararch`,
      ciphertextSha256,
      createdAt,
      sealedEventId,
      'b'.repeat(64),
      'c'.repeat(64),
      createdAt,
      JSON.stringify({ exhaustive: true }),
      createdAt,
      JSON.stringify({ device: '1', inode: '2', sizeBytes: 4096 }),
      JSON.stringify([
        { slotId: 'passphrase-v1', slotType: 'passphrase' },
        { slotId: 'recovery-v1', slotType: 'recovery' },
      ]),
    )
    db.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
      finalizedEventId,
      mission.id,
      createdAt,
      JSON.stringify({
        archive_id: archiveId,
        archive_relative_path: `${archiveId}.sararch`,
        container_version: 2,
        resulting_status: 'finalized',
      }),
      createdAt,
    )
    db.prepare("UPDATE missions SET status = 'finalized' WHERE id = ?").run(mission.id)
  }).immediate()

  let clock = Date.parse('2026-08-30T12:05:00.000Z')
  const cleanupCoordinator = createArchiveCleanupCoordinator({
    db,
    schemaVersion: 13,
    now: () => new Date(clock++).toISOString(),
    yieldToMain: () => input.yieldToMain?.(db, mission.id, archiveId) ?? Promise.resolve(),
    ...(input.yieldAfterBusyRetry === undefined
      ? {}
      : { yieldAfterBusyRetry: input.yieldAfterBusyRetry }),
    appendEvent: (
      missionId: string,
      eventType: string,
      timestamp: string,
      details: Readonly<Record<string, unknown>>,
    ) => appendCleanupEvent(db, missionId, eventType, timestamp, details),
    batchLimits: { positions: 3, default: 2 },
  })
  const defaultCustodyCommit = <T>(
    commit: (assertCustodyUnchanged: () => void) => T,
  ): T => commit(() => undefined)
  const coordinator: ArchiveCleanupCoordinator = Object.freeze({
    getEligibility: (input) => cleanupCoordinator.getEligibility(input),
    start: (input, options = {}) => cleanupCoordinator.start(input, {
      withCustodyCommit: defaultCustodyCommit,
      ...options,
    }),
    resume: (input, options = {}) => cleanupCoordinator.resume(input, {
      withCustodyCommit: defaultCustodyCommit,
      ...options,
    }),
  })
  const evidence: CleanupEvidence = Object.freeze({
    archiveId,
    missionId: mission.id,
    ciphertextSha256,
    sizeBytes: 4096,
    verificationProofValidated: true,
    custodyReconciled: true,
    archiveCustodyIdle: true,
    evidenceHealth: Object.freeze({ state: 'healthy', pendingCount: 0, corruptCount: 0 }),
    reviewActivity: false,
    nonMachineUnwrap: Object.freeze({
      archiveId,
      missionId: mission.id,
      slotType: 'passphrase',
      authenticatedAt: '2026-08-30T12:04:59.000Z',
      ciphertextSha256,
      sizeBytes: 4096,
    }),
  })
  return {
    directory,
    db,
    coordinator,
    missionId: mission.id,
    archiveId,
    otherMissionId: otherMission.id,
    evidence,
  }
}

describe('kill-safe archive-backed live-store cleanup [DON-253]', () => {
  it('spaces production busy retries so a short WAL lock does not fail cleanup immediately', async () => {
    const fixture = await createFixture()
    let lockWorker: Worker | null = null
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })

      lockWorker = new Worker(`
        const Database = require('better-sqlite3')
        const { parentPort, workerData } = require('node:worker_threads')
        const db = new Database(workerData.databasePath)
        db.pragma('journal_mode = WAL')
        const hold = db.transaction(() => {
          db.prepare('UPDATE missions SET status = status WHERE id = ?').run(workerData.missionId)
          parentPort.postMessage('locked')
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_200)
        })
        try { hold.immediate() } finally { db.close() }
      `, {
        eval: true,
        workerData: {
          databasePath: path.join(fixture.directory, 'mission-store.sqlite'),
          missionId: fixture.missionId,
        },
      })
      await new Promise<void>((resolve, reject) => {
        lockWorker?.once('message', (message) => {
          if (message === 'locked') resolve()
        })
        lockWorker?.once('error', reject)
      })

      let heartbeatCount = 0
      const heartbeat = setInterval(() => { heartbeatCount += 1 }, 25)
      await expect(fixture.coordinator.resume(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
      clearInterval(heartbeat)
      expect(heartbeatCount).toBeGreaterThanOrEqual(20)
    } finally {
      await lockWorker?.terminate()
      fixture.db.close()
    }
  }, 15_000)

  it('retries a cleanup boundary after a concurrent WAL writer without failing the live lane', async () => {
    const fixture = await createFixture({
      yieldToMain: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      },
    })
    let lockWorker: Worker | null = null
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })

      lockWorker = new Worker(`
        const Database = require('better-sqlite3')
        const { parentPort, workerData } = require('node:worker_threads')
        const db = new Database(workerData.databasePath)
        db.pragma('journal_mode = WAL')
        const hold = db.transaction(() => {
          db.prepare('UPDATE missions SET status = status WHERE id = ?')
            .run(workerData.missionId)
          parentPort.postMessage('locked')
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6_000)
        })
        try {
          hold.immediate()
          parentPort.postMessage('done')
        } finally {
          db.close()
        }
      `, {
        eval: true,
        workerData: {
          databasePath: path.join(fixture.directory, 'mission-store.sqlite'),
          missionId: fixture.missionId,
        },
      })
      await new Promise<void>((resolve, reject) => {
        lockWorker?.once('message', (message) => {
          if (message === 'locked') resolve()
        })
        lockWorker?.once('error', reject)
      })

      await expect(fixture.coordinator.resume(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
    } finally {
      await lockWorker?.terminate()
      fixture.db.close()
    }
  }, 15_000)

  it('stops before the next delete when a mutable database precondition changes during a yield', async () => {
    const attacks = [
      (db: BetterSqliteDatabase, missionId: string) => {
        db.prepare("UPDATE missions SET status = 'finished' WHERE id = ?").run(missionId)
      },
      (db: BetterSqliteDatabase, missionId: string) => {
        db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
          VALUES (?, ?)`).run(missionId, '2026-08-30T12:06:00.000Z')
      },
      (db: BetterSqliteDatabase, _missionId: string, archiveId: string) => {
        db.prepare("UPDATE mission_archives SET availability = 'mismatched' WHERE id = ?")
          .run(archiveId)
      },
    ] as const

    for (const attack of attacks) {
      let yielded = false
      const fixture = await createFixture({
        yieldToMain: async (db, missionId, archiveId) => {
          if (yielded) return
          yielded = true
          attack(db, missionId, archiveId)
        },
      })
      try {
        await expect(fixture.coordinator.start(fixture.evidence))
          .rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_FAILED' })
        expect(fixture.db.prepare(`SELECT state, last_error FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
          state: 'in_progress',
          last_error: 'ARCHIVE_CLEANUP_FAILED',
        })
        expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
          .get(fixture.missionId)?.total).toBe(0)
      } finally {
        fixture.db.close()
      }
    }
  })

  it('withholds every locked precondition independently and never caches eligibility', async () => {
    const fixture = await createFixture()
    try {
      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: true,
        blockers: [],
        storageState: 'live',
      })
      const cases: readonly [string, CleanupEvidence][] = [
        ['verification_proof_invalid', { ...fixture.evidence, verificationProofValidated: false }],
        ['archive_custody_mismatch', { ...fixture.evidence, custodyReconciled: false }],
        ['archive_custody_busy', { ...fixture.evidence, archiveCustodyIdle: false }],
        ['evidence_health_not_clean', {
          ...fixture.evidence,
          evidenceHealth: { state: 'degraded', pendingCount: 1, corruptCount: 0 },
        }],
        ['archive_review_active', { ...fixture.evidence, reviewActivity: true }],
        ['fresh_non_machine_unlock_required', { ...fixture.evidence, nonMachineUnwrap: null }],
        ['fresh_non_machine_unlock_required', {
          ...fixture.evidence,
          nonMachineUnwrap: {
            ...fixture.evidence.nonMachineUnwrap!,
            archiveId: randomUUID(),
          },
        }],
      ]
      for (const [blocker, input] of cases) {
        expect(fixture.coordinator.getEligibility(input)).toMatchObject({
          eligible: false,
          blockers: expect.arrayContaining([blocker]),
          storageState: 'live',
        })
      }

      fixture.db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
        VALUES (?, ?)`).run(fixture.missionId, '2026-08-30T12:04:00.000Z')
      expect(fixture.coordinator.getEligibility(fixture.evidence).blockers)
        .toContain('finalization_fence_active')
      fixture.db.prepare('DELETE FROM mission_finalization_fences WHERE mission_id = ?')
        .run(fixture.missionId)
      expect(fixture.coordinator.getEligibility(fixture.evidence).eligible).toBe(true)

      fixture.db.prepare("UPDATE mission_archives SET status = 'sealed', verified_at = NULL, verification_proof_json = NULL WHERE id = ?")
        .run(fixture.archiveId)
      expect(fixture.coordinator.getEligibility(fixture.evidence).blockers)
        .toContain('current_archive_not_verified')
    } finally {
      fixture.db.close()
    }
  })

  it('deletes only inventoried bulk mission rows in bounded transactions and retains the reviewable custody stub', async () => {
    const fixture = await createFixture()
    const progress: Readonly<Record<string, unknown>>[] = []
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        onProgress: (update) => progress.push(update),
      })).resolves.toMatchObject({
        missionId: fixture.missionId,
        archiveId: fixture.archiveId,
        state: 'completed',
        storageState: 'archived',
      })
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM devices WHERE mission_id = ?')
        .get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.otherMissionId)?.total).toBe(1)
      expect(fixture.db.prepare('SELECT status FROM missions WHERE id = ?')
        .get(fixture.missionId)?.status).toBe('finalized')
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM mission_events WHERE mission_id = ?')
        .get(fixture.missionId)?.total).toBeGreaterThan(0)
      expect(fixture.db.prepare('SELECT status FROM mission_archives WHERE id = ?')
        .get(fixture.archiveId)?.status).toBe('verified')
      expect(fixture.db.prepare('SELECT state FROM mission_cleanup_journal WHERE mission_id = ?')
        .get(fixture.missionId)?.state).toBe('completed')
      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_already_completed'],
        storageState: 'archived',
      })
      expect(progress.filter((update) => update.tableName === 'positions'))
        .toHaveLength(3)
      expect(progress.every((update) => Number(update.deletedRows) <= 3)).toBe(true)
      expect(JSON.stringify(progress)).not.toMatch(/delete evidence/iu)
    } finally {
      fixture.db.close()
    }
  })

  it('resumes from the exact atomic cursor after a simulated kill without double events or cross-mission loss', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: {
          simulateKillAfterTableBatch: { tableName: 'positions', tableBatch: 2 },
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      const interrupted = fixture.db.prepare(`SELECT state, progress_json
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)
      expect(interrupted?.state).toBe('in_progress')
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBeLessThan(7)
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBeGreaterThan(0)

      const resumeEvidence = {
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>
      await expect(fixture.coordinator.resume(resumeEvidence)).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.otherMissionId)?.total).toBe(1)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(1)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_started'`)
        .get(fixture.missionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('projects an interrupted cursor as explicit cleanup-in-progress evidence, never ordinary live Review', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: {
          simulateKillAfterTableBatch: { tableName: 'positions', tableBatch: 1 },
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_in_progress'],
        storageState: 'cleanup_in_progress',
      })
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBeGreaterThan(0)
    } finally {
      fixture.db.close()
    }
  })

  it('pins every bounded delete transaction to one custody witness and stops before the next delete after replacement', async () => {
    const fixture = await createFixture()
    let custodyReplaced = false
    let custodyCommitCount = 0
    let inTransactionAssertions = 0
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        onProgress: () => { custodyReplaced = true },
        withCustodyCommit: (commit) => {
          custodyCommitCount += 1
          if (custodyReplaced) {
            throw Object.assign(new Error('simulated custody replacement'), {
              code: 'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
            })
          }
          return commit(() => { inTransactionAssertions += 1 })
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_FAILED' })

      const remaining = Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)
      expect(remaining).toBeGreaterThan(0)
      expect(custodyCommitCount).toBeGreaterThan(1)
      expect(inTransactionAssertions).toBe(custodyCommitCount - 1)
      const journal = fixture.db.prepare(`SELECT state, last_error, progress_json
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)
      expect(journal).toMatchObject({
        state: 'in_progress',
        last_error: 'ARCHIVE_CLEANUP_FAILED',
      })
      expect(JSON.parse(String(journal?.progress_json)).deletedRows).toBeGreaterThan(0)
      const failure = fixture.db.prepare(`SELECT details_json FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_failed'
        ORDER BY rowid DESC LIMIT 1`).get(fixture.missionId)
      expect(JSON.parse(String(failure?.details_json))).toMatchObject({
        storage_state: 'cleanup_in_progress',
      })
    } finally {
      fixture.db.close()
    }
  })

  it('rolls a failed batch and its journal cursor back together', async () => {
    const fixture = await createFixture()
    try {
      const before = fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { failBeforeJournalUpdateForTable: 'positions' },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_FAILED' })
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.missionId)?.total).toBe(before)
      expect(fixture.db.prepare(`SELECT state, last_error FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
        state: 'in_progress',
        last_error: 'ARCHIVE_CLEANUP_FAILED',
      })
      expect(fixture.db.prepare('SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?')
        .get(fixture.otherMissionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('resets only the current journal cursor for a newly finalized supplemental epoch', async () => {
    const fixture = await createFixture()
    try {
      await fixture.coordinator.start(fixture.evidence)
      const archiveId = randomUUID()
      const requestEventId = randomUUID()
      const sealedEventId = randomUUID()
      const finalizedEventId = randomUUID()
      const createdAt = '2026-08-30T13:00:00.000Z'
      const ciphertextSha256 = 'd'.repeat(64)
      fixture.db.transaction(() => {
        fixture.db.prepare("UPDATE missions SET status = 'finished' WHERE id = ?")
          .run(fixture.missionId)
        fixture.db.prepare(`INSERT INTO devices (
          id, mission_id, device_id, name, color, last_seen, status
        ) VALUES (?, ?, 'tracker-supplement', 'Supplement Tracker', '#ffffff', NULL, 'offline')`)
          .run(randomUUID(), fixture.missionId)
        fixture.db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'mission_finalize_requested', ?, '{}', ?, 'complete')`).run(
          requestEventId, fixture.missionId, createdAt, createdAt,
        )
        const requestEventRowid = Number(fixture.db.prepare(
          'SELECT rowid FROM mission_events WHERE id = ?',
        ).get(requestEventId)?.rowid)
        fixture.db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'mission_archive_sealed_v2', ?, '{}', ?, 'complete')`).run(
          sealedEventId, fixture.missionId, createdAt, createdAt,
        )
        fixture.db.prepare(`INSERT INTO mission_archives (
          id, mission_id, request_event_rowid, request_event_id,
          creation_operation_id, protected_finalization_epoch, archive_kind,
          container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
          sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
          table_count, verified_at, verification_proof_json, previous_archive_id,
          status, availability, availability_reason, last_reconciled_at,
          last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
          legacy_event_rowid
        ) VALUES (?, ?, ?, ?, ?, NULL, 'finalized', 2, ?, ?, 8192, ?, ?, 9, ?, ?, 5,
          49, ?, ?, ?, 'verified', 'present', NULL, ?, ?, ?, NULL, NULL)`).run(
          archiveId,
          fixture.missionId,
          requestEventRowid,
          requestEventId,
          randomUUID(),
          `${archiveId}.sararch`,
          ciphertextSha256,
          createdAt,
          sealedEventId,
          'e'.repeat(64),
          'f'.repeat(64),
          createdAt,
          JSON.stringify({ exhaustive: true, epoch: 2 }),
          fixture.archiveId,
          createdAt,
          JSON.stringify({ device: '1', inode: '3', sizeBytes: 8192 }),
          JSON.stringify([
            { slotId: 'passphrase-v1', slotType: 'passphrase' },
            { slotId: 'recovery-v1', slotType: 'recovery' },
          ]),
        )
        fixture.db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
          finalizedEventId,
          fixture.missionId,
          createdAt,
          JSON.stringify({ archive_id: archiveId, resulting_status: 'finalized' }),
          createdAt,
        )
        fixture.db.prepare("UPDATE missions SET status = 'finalized' WHERE id = ?")
          .run(fixture.missionId)
      }).immediate()
      const nextEvidence: CleanupEvidence = {
        ...fixture.evidence,
        archiveId,
        ciphertextSha256,
        sizeBytes: 8192,
        nonMachineUnwrap: {
          archiveId,
          missionId: fixture.missionId,
          slotType: 'recovery',
          authenticatedAt: '2026-08-30T13:01:00.000Z',
          ciphertextSha256,
          sizeBytes: 8192,
        },
      }

      expect(fixture.coordinator.getEligibility(nextEvidence)).toMatchObject({
        eligible: true,
        storageState: 'live',
      })
      await expect(fixture.coordinator.start(nextEvidence)).resolves.toMatchObject({
        archiveId,
        state: 'completed',
      })
      expect(fixture.db.prepare(`SELECT archive_id, state FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toEqual({
        archive_id: archiveId,
        state: 'completed',
      })
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(2)
    } finally {
      fixture.db.close()
    }
  })
})
