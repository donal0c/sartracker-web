import { createHash, randomUUID } from 'node:crypto'
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
  readArchiveCleanupGuard,
  readCompletedArchiveCleanupJournalProof,
} = require('../../electron/archive-cleanup.cjs') as {
  readonly createArchiveCleanupCoordinator: (
    input: Readonly<Record<string, unknown>>,
  ) => ArchiveCleanupCoordinator
  readonly readCompletedArchiveCleanupJournalProof: (
    database: BetterSqliteDatabase,
    input: { readonly missionId: string; readonly archiveId: string },
  ) => Readonly<Record<string, unknown>>
  readonly readArchiveCleanupGuard: (
    database: BetterSqliteDatabase,
    missionId: string,
  ) => null | {
    readonly guard: Readonly<Record<string, unknown>>
    readonly guardJson: string
  }
}
const {
  readArchiveCleanupMembershipGeneration,
} = require('../../electron/archive-cleanup-membership.cjs') as {
  readonly readArchiveCleanupMembershipGeneration: (
    db: BetterSqliteDatabase,
    missionId: string,
  ) => number
}
const { readMissionLiveReviewStorageState } = require(
  '../../electron/mission-live-review-access.cjs',
) as {
  readonly readMissionLiveReviewStorageState: (
    database: BetterSqliteDatabase,
    missionId: string,
  ) => 'live' | 'cleanup_in_progress' | 'archived' | 'recovery_required'
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

/** Mirrors the production archive-lifecycle event identity contract. */
function deriveArchiveLifecycleEventId(archiveId: string, kind: string): string {
  const digest = createHash('sha256')
    .update(`sartracker-archive-lifecycle:${kind}:${archiveId}`, 'utf8')
    .digest('hex')
  const bytes = digest.slice(0, 32).split('')
  bytes[12] = '4'
  bytes[16] = ['8', '9', 'a', 'b'][Number.parseInt(bytes[16], 16) % 4]
  return `${bytes.slice(0, 8).join('')}-${bytes.slice(8, 12).join('')}-${bytes.slice(12, 16).join('')}-${bytes.slice(16, 20).join('')}-${bytes.slice(20).join('')}`
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
  readonly preparedSql?: string[]
  readonly beforeFinalization?: (
    db: BetterSqliteDatabase,
    missionId: string,
    archiveId: string,
  ) => void
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
  const finalizedEventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
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
    input.beforeFinalization?.(db, mission.id, archiveId)
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
        cleanup_membership_generation: readArchiveCleanupMembershipGeneration(db, mission.id),
        container_version: 2,
        resulting_status: 'finalized',
      }),
      createdAt,
    )
    db.prepare("UPDATE missions SET status = 'finalized' WHERE id = ?").run(mission.id)
  }).immediate()

  let clock = Date.parse('2026-08-30T12:05:00.000Z')
  const coordinatorDb = input.preparedSql === undefined
    ? db
    : {
        prepare: (sql: string) => {
          input.preparedSql?.push(sql)
          return db.prepare(sql)
        },
        pragma: (sql: string) => db.pragma(sql),
        transaction: <T>(callback: () => T) => db.transaction(callback),
      }
  const cleanupCoordinator = createArchiveCleanupCoordinator({
    db: coordinatorDb,
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
    batchLimits: { positions: 3, missionEvents: 2, default: 2 },
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
  it('keeps the initial cleanup journal transaction non-blocking under a concurrent WAL writer', async () => {
    const fixture = await createFixture()
    let lockWorker: Worker | null = null
    try {
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
      await expect(fixture.coordinator.start(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
      clearInterval(heartbeat)
      expect(heartbeatCount).toBeGreaterThanOrEqual(20)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_cleanup_journal
        WHERE mission_id = ? AND state = 'completed'`).get(fixture.missionId)?.total).toBe(1)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_started'`).get(fixture.missionId)?.total)
        .toBe(1)
    } finally {
      await lockWorker?.terminate()
      fixture.db.close()
    }
  }, 15_000)

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
      expect(readCompletedArchiveCleanupJournalProof(fixture.db, {
        missionId: fixture.missionId,
        archiveId: fixture.archiveId,
      })).toMatchObject({
        archiveId: fixture.archiveId,
        state: 'completed',
        finalizationEpoch: expect.any(Number),
        membershipGeneration: expect.any(Number),
        startedEventId: expect.any(String),
        completionEventId: expect.any(String),
      })
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId)).toBe('archived')
      const replayGeneration = fixture.db.prepare(`SELECT mission_id, generation
        FROM mission_replay_generations WHERE mission_id = ?`).get(fixture.missionId)
      expect(replayGeneration?.mission_id).toBe(fixture.missionId)
      expect(Number.isSafeInteger(replayGeneration?.generation)).toBe(true)
      expect(Number(replayGeneration?.generation)).toBeGreaterThan(0)
      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_already_completed'],
        storageState: 'archived',
      })
      expect(progress.filter((update) => update.tableName === 'positions'))
        .toHaveLength(3)
      expect(progress.every((update) => Number(update.deletedRows) <= 3)).toBe(true)
      expect(JSON.stringify(progress)).not.toMatch(/delete evidence/iu)
      const guardRow = fixture.db.prepare(`SELECT key, value FROM metadata
        WHERE key LIKE 'archive_cleanup_guard_v1:%'`).get()
      const tamperedGuard = JSON.parse(String(guardRow?.value)) as Record<string, unknown>
      tamperedGuard.progressSha256 = '0'.repeat(64)
      fixture.db.prepare('UPDATE metadata SET value = ? WHERE key = ?')
        .run(JSON.stringify(tamperedGuard), guardRow?.key)
      expect(() => readCompletedArchiveCleanupJournalProof(fixture.db, {
        missionId: fixture.missionId,
        archiveId: fixture.archiveId,
      })).toThrow(/guard|journal|proof/iu)
    } finally {
      fixture.db.close()
    }
  })

  it('removes only target-mission telemetry events in bounded rowid windows and retains operational audit evidence', async () => {
    const fixture = await createFixture({
      beforeFinalization: (db, missionId) => {
        const insert = db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, ?, ?, NULL, ?, 'complete')`)
        for (let index = 0; index < 11; index += 1) {
          insert.run(
            randomUUID(),
            missionId,
            ['device_updated', 'position_recorded', 'mission_backup_synced'][index % 3],
            `2026-08-30T11:50:${String(index).padStart(2, '0')}.000Z`,
            `2026-08-30T11:50:${String(index).padStart(2, '0')}.000Z`,
          )
        }
      },
    })
    const progress: Readonly<Record<string, unknown>>[] = []
    try {
      const insert = fixture.db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (?, ?, ?, ?, NULL, ?, 'complete')`)
      insert.run(
        randomUUID(),
        fixture.missionId,
        'operator_note_recorded',
        '2026-08-30T12:11:00.000Z',
        '2026-08-30T12:11:00.000Z',
      )
      for (const eventType of [
        'mission_archive_available',
        'mission_cleanup_failed',
        'future_operator_custody_event',
      ]) {
        insert.run(
          randomUUID(),
          fixture.missionId,
          eventType,
          '2026-08-30T12:11:30.000Z',
          '2026-08-30T12:11:30.000Z',
        )
      }
      insert.run(
        randomUUID(),
        fixture.otherMissionId,
        'device_updated',
        '2026-08-30T12:12:00.000Z',
        '2026-08-30T12:12:00.000Z',
      )

      await expect(fixture.coordinator.start(fixture.evidence, {
        onProgress: (update) => progress.push(update),
      })).resolves.toMatchObject({ state: 'completed', storageState: 'archived' })

      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type IN (
          'device_updated', 'position_recorded', 'mission_backup_synced'
        )`).get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'operator_note_recorded'`)
        .get(fixture.missionId)?.total).toBe(1)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type IN (
          'mission_archive_available', 'mission_cleanup_failed',
          'future_operator_custody_event'
        )`).get(fixture.missionId)?.total).toBe(3)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'device_updated'`)
        .get(fixture.otherMissionId)?.total).toBe(1)
      expect(progress.some((update) => update.tableName === 'mission_events')).toBe(true)
      const journal = fixture.db.prepare(`SELECT progress_json FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)
      expect(JSON.parse(String(journal?.progress_json))).toMatchObject({
        version: 2,
        tableCursor: null,
        missionEventsTargetRowid: expect.any(Number),
      })
    } finally {
      fixture.db.close()
    }
  })

  it('fails closed without completion when target telemetry arrives after the fixed high-water', async () => {
    let insertedLateTelemetry = false
    let lateTelemetryRowid = 0
    const fixture = await createFixture({
      yieldToMain: async (db, missionId) => {
        if (insertedLateTelemetry) return
        insertedLateTelemetry = true
        const lateEventId = randomUUID()
        db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'position_recorded', ?, NULL, ?, 'complete')`).run(
          lateEventId,
          missionId,
          '2026-08-30T12:30:00.000Z',
          '2026-08-30T12:30:00.000Z',
        )
        lateTelemetryRowid = Number(db.prepare(
          'SELECT rowid FROM mission_events WHERE id = ?',
        ).get(lateEventId)?.rowid)
      },
    })
    try {
      await expect(fixture.coordinator.start(fixture.evidence))
        .rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_FAILED' })

      const journal = fixture.db.prepare(`SELECT state, progress_json, completed_at
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)
      const progress = JSON.parse(String(journal?.progress_json)) as {
        readonly finalizationEpoch: number
        readonly missionEventsTargetRowid: number
      }
      const finalizationRowid = Number(fixture.db.prepare(`SELECT rowid FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_finalized'`).get(fixture.missionId)?.rowid)
      expect(progress.finalizationEpoch).toBe(finalizationRowid)
      expect(progress.missionEventsTargetRowid).toBe(finalizationRowid)
      expect(lateTelemetryRowid).toBeGreaterThan(progress.missionEventsTargetRowid)
      expect(journal).toMatchObject({ state: 'in_progress', completed_at: null })
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE rowid = ? AND mission_id = ? AND event_type = 'position_recorded'`)
        .get(lateTelemetryRowid, fixture.missionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('stops on telemetry inserted into a deleted rowid hole during cleanup', async () => {
    let insertedEventId: string | null = null
    let insertedRowid = 0
    const fixture = await createFixture({
      beforeFinalization: (db, missionId) => {
        const insert = db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'position_recorded', ?, NULL, ?, 'complete')`)
        for (let index = 0; index < 6; index += 1) {
          const timestamp = `2026-08-30T11:30:${String(index).padStart(2, '0')}.000Z`
          insert.run(randomUUID(), missionId, timestamp, timestamp)
        }
      },
      yieldToMain: async (db, missionId) => {
        if (insertedEventId !== null) return
        const journal = db.prepare(`SELECT progress_json FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(missionId)
        const progress = JSON.parse(String(journal?.progress_json)) as {
          readonly tables: string[]
          readonly tableIndex: number
          readonly tableCursor: number | null
        }
        if (progress.tables[progress.tableIndex] !== 'mission_events'
          || progress.tableCursor === null) return
        for (let candidate = 1; candidate <= progress.tableCursor; candidate += 1) {
          if (db.prepare('SELECT 1 FROM mission_events WHERE rowid = ?').get(candidate)
            !== undefined) continue
          insertedEventId = randomUUID()
          insertedRowid = candidate
          db.prepare(`INSERT INTO mission_events (
            rowid, id, mission_id, event_type, timestamp, details_json, recorded_at,
            recording_completeness
          ) VALUES (?, ?, ?, 'position_recorded', ?, NULL, ?, 'complete')`).run(
            candidate,
            insertedEventId,
            missionId,
            '2026-08-30T12:30:01.000Z',
            '2026-08-30T12:30:01.000Z',
          )
          return
        }
      },
    })
    try {
      await expect(fixture.coordinator.start(fixture.evidence)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_FAILED',
        cause: {
          code: 'ARCHIVE_CLEANUP_PRECONDITION_CHANGED',
          blockers: ['cleanup_membership_changed'],
        },
      })
      expect(insertedEventId).not.toBeNull()
      expect(fixture.db.prepare(`SELECT id FROM mission_events WHERE rowid = ?`)
        .get(insertedRowid)).toEqual({ id: insertedEventId })
      expect(fixture.db.prepare(`SELECT state, completed_at FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
        state: 'in_progress',
        completed_at: null,
      })
    } finally {
      fixture.db.close()
    }
  })

  it('binds cleanup to the finalization event and preserves telemetry written before cleanup starts', async () => {
    const fixture = await createFixture()
    try {
      const finalizationRowid = Number(fixture.db.prepare(`SELECT rowid FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_finalized'`).get(fixture.missionId)?.rowid)
      const positionsBefore = Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)
      const lateEventId = randomUUID()
      fixture.db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (?, ?, 'position_recorded', ?, NULL, ?, 'complete')`).run(
        lateEventId,
        fixture.missionId,
        '2026-08-30T12:31:00.000Z',
        '2026-08-30T12:31:00.000Z',
      )

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_membership_changed'],
        storageState: 'live',
      })
      await expect(fixture.coordinator.start(fixture.evidence)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_NOT_ELIGIBLE',
        blockers: ['cleanup_membership_changed'],
      })
      const lateEventRowid = Number(fixture.db.prepare(
        'SELECT rowid FROM mission_events WHERE id = ?',
      ).get(lateEventId)?.rowid)
      expect(lateEventRowid).toBeGreaterThan(finalizationRowid)
      expect(fixture.db.prepare('SELECT 1 AS present FROM mission_events WHERE id = ?')
        .get(lateEventId)).toEqual({ present: 1 })
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBe(positionsBefore)
      expect(fixture.db.prepare(`SELECT 1 AS present FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toBeUndefined()
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_started'`)
        .get(fixture.missionId)?.total).toBe(0)
    } finally {
      fixture.db.close()
    }
  })

  it('rejects a downgraded v2 journal before another row can be deleted', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      const positionsBefore = Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)
      const journal = fixture.db.prepare(`SELECT progress_json FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)
      const downgraded = JSON.parse(String(journal?.progress_json)) as Record<string, unknown>
      downgraded.version = 1
      delete downgraded.tableCursor
      delete downgraded.missionEventsTargetRowid
      fixture.db.prepare(`UPDATE mission_cleanup_journal SET progress_json = ?
        WHERE mission_id = ?`).run(JSON.stringify(downgraded), fixture.missionId)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      })
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBe(positionsBefore)
    } finally {
      fixture.db.close()
    }
  })

  it('rejects a forged metadata revision before another row can be deleted', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      const positionsBefore = Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)
      const guardRow = fixture.db.prepare(`SELECT key, value FROM metadata
        WHERE key LIKE 'archive_cleanup_guard_v1:%'`).get()
      const guard = JSON.parse(String(guardRow?.value)) as Record<string, unknown>
      guard.revision = Number(guard.revision) + 1
      fixture.db.prepare('UPDATE metadata SET value = ? WHERE key = ?')
        .run(JSON.stringify(guard), guardRow?.key)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      })
      expect(Number(fixture.db.prepare(
        'SELECT COUNT(*) AS total FROM positions WHERE mission_id = ?',
      ).get(fixture.missionId)?.total)).toBe(positionsBefore)
    } finally {
      fixture.db.close()
    }
  })

  it('does not accept an early SQL completed-state flip as archived custody', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      fixture.db.prepare(`UPDATE mission_cleanup_journal SET
        state = 'completed', completed_at = ? WHERE mission_id = ?`).run(
        '2026-08-30T12:32:00.000Z',
        fixture.missionId,
      )

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_journal_invalid'],
        storageState: 'cleanup_in_progress',
      })
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(0)
    } finally {
      fixture.db.close()
    }
  })

  it('fails live Review closed when a retained guard has no matching active journal state', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      expect(readArchiveCleanupGuard(fixture.db, fixture.missionId)).toMatchObject({
        guard: { missionId: fixture.missionId, state: 'in_progress' },
      })
      expect(() => readArchiveCleanupGuard(fixture.db, 'x'.repeat(201))).toThrow(/input/iu)

      fixture.db.prepare(`UPDATE mission_cleanup_journal SET state = 'eligible'
        WHERE mission_id = ?`).run(fixture.missionId)
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')

      fixture.db.prepare('DELETE FROM mission_cleanup_journal WHERE mission_id = ?')
        .run(fixture.missionId)
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')

      fixture.db.prepare(`UPDATE metadata SET value = '{'
        WHERE key LIKE 'archive_cleanup_guard_v1:%'`).run()
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
    } finally {
      fixture.db.close()
    }
  })

  it('fails terminal completion and preserves a late row in an already-passed table', async () => {
    let insertedLateRow = false
    const fixture = await createFixture({
      yieldToMain: async (db, missionId) => {
        if (insertedLateRow) return
        const journal = db.prepare(`SELECT progress_json FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(missionId)
        const progress = JSON.parse(String(journal?.progress_json)) as {
          readonly tables: string[]
          readonly tableIndex: number
        }
        const passedIndex = progress.tables.indexOf('coverage_missions')
        if (passedIndex < 0 || progress.tableIndex <= passedIndex) return
        db.exec('DROP TRIGGER IF EXISTS archive_cleanup_membership_coverage_missions_insert')
        db.prepare(`INSERT INTO coverage_missions (
          mission_id, change_seq, enumerated, updated_at
        ) VALUES (?, 99, 1, ?)`).run(missionId, '2026-08-30T12:33:00.000Z')
        insertedLateRow = true
      },
    })
    try {
      await expect(fixture.coordinator.start(fixture.evidence)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_FAILED',
        cause: { code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT' },
        cleanupDiagnostic: { substage: 'completion' },
      })
      expect(insertedLateRow).toBe(true)
      expect(fixture.db.prepare(`SELECT 1 AS present FROM coverage_missions
        WHERE mission_id = ?`).get(fixture.missionId)).toEqual({ present: 1 })
      expect(fixture.db.prepare(`SELECT state, completed_at FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
        state: 'in_progress',
        completed_at: null,
      })
    } finally {
      fixture.db.close()
    }
  })

  it('invalidates completed classification when its verification custody proof changes', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
      })
      fixture.db.prepare(`UPDATE mission_archives SET verification_proof_json = ?
        WHERE id = ?`).run(JSON.stringify({ exhaustive: true, replaced: true }), fixture.archiveId)

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_journal_invalid'],
        storageState: 'cleanup_in_progress',
      })
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
    } finally {
      fixture.db.close()
    }
  })

  it('invalidates completed classification when the bound completion event changes', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
      })
      fixture.db.prepare(`UPDATE mission_events SET details_json = '{}'
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .run(fixture.missionId)

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_journal_invalid'],
        storageState: 'cleanup_in_progress',
      })
    } finally {
      fixture.db.close()
    }
  })

  it('rejects a completed legacy v1 journal instead of silently re-cleaning it', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence)).resolves.toMatchObject({
        state: 'completed',
      })
      const journal = fixture.db.prepare(`SELECT progress_json FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)
      const legacyProgress = JSON.parse(String(journal?.progress_json)) as Record<string, unknown>
      const legacyTables = (legacyProgress.tables as string[])
        .filter((tableName) => tableName !== 'mission_events')
      legacyProgress.version = 1
      legacyProgress.tables = legacyTables
      legacyProgress.tableIndex = legacyTables.length
      delete legacyProgress.tableCursor
      delete legacyProgress.missionEventsTargetRowid
      fixture.db.prepare(`UPDATE mission_cleanup_journal SET progress_json = ?
        WHERE mission_id = ?`).run(JSON.stringify(legacyProgress), fixture.missionId)
      fixture.db.prepare(`DELETE FROM metadata
        WHERE key LIKE 'archive_cleanup_guard_v1:%'`).run()
      fixture.db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (?, ?, 'device_updated', ?, NULL, ?, 'complete')`).run(
        randomUUID(),
        fixture.missionId,
        '2026-08-30T12:35:00.000Z',
        '2026-08-30T12:35:00.000Z',
      )
      expect(fixture.coordinator.getEligibility(fixture.evidence)).toEqual({
        eligible: false,
        blockers: ['cleanup_journal_invalid'],
        storageState: 'cleanup_in_progress',
      })
      await expect(fixture.coordinator.start(fixture.evidence)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_NOT_ELIGIBLE',
        blockers: ['cleanup_journal_invalid'],
      })

      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'device_updated'`)
        .get(fixture.missionId)?.total).toBe(1)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_started'`)
        .get(fixture.missionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('rejects an impossible forward cursor rather than skipping eligible telemetry on resume', async () => {
    const fixture = await createFixture({
      beforeFinalization: (db, missionId) => {
        const insert = db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'position_recorded', ?, NULL, ?, 'complete')`)
        for (let index = 0; index < 8; index += 1) {
          const timestamp = `2026-08-30T11:40:${String(index).padStart(2, '0')}.000Z`
          insert.run(randomUUID(), missionId, timestamp, timestamp)
        }
      },
    })
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: {
          simulateKillAfterTableBatch: { tableName: 'mission_events', tableBatch: 1 },
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })

      const journal = fixture.db.prepare(`SELECT progress_json FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)
      const corruptProgress = JSON.parse(String(journal?.progress_json)) as Record<string, unknown>
      corruptProgress.tableCursor = Number(corruptProgress.missionEventsTargetRowid) + 1
      fixture.db.prepare(`UPDATE mission_cleanup_journal SET progress_json = ?
        WHERE mission_id = ?`).run(JSON.stringify(corruptProgress), fixture.missionId)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      })
      expect(Number(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'position_recorded'`)
        .get(fixture.missionId)?.total)).toBeGreaterThan(0)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(0)
    } finally {
      fixture.db.close()
    }
  })

  it('rejects a forged terminal event cursor while cleanable telemetry remains below high-water', async () => {
    const fixture = await createFixture({
      beforeFinalization: (db, missionId) => {
        const insert = db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'position_recorded', ?, NULL, ?, 'complete')`)
        for (let index = 0; index < 8; index += 1) {
          const timestamp = `2026-08-30T11:42:${String(index).padStart(2, '0')}.000Z`
          insert.run(randomUUID(), missionId, timestamp, timestamp)
        }
      },
    })
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: {
          simulateKillAfterTableBatch: { tableName: 'mission_events', tableBatch: 1 },
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })

      const journal = fixture.db.prepare(`SELECT progress_json FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)
      const corruptProgress = JSON.parse(String(journal?.progress_json)) as Record<string, unknown>
      corruptProgress.tableCursor = corruptProgress.missionEventsTargetRowid
      fixture.db.prepare(`UPDATE mission_cleanup_journal SET progress_json = ?
        WHERE mission_id = ?`).run(JSON.stringify(corruptProgress), fixture.missionId)
      const remainingBeforeResume = Number(fixture.db.prepare(`SELECT COUNT(*) AS total
        FROM mission_events WHERE mission_id = ? AND rowid <= ?
          AND event_type IN ('device_updated', 'mission_backup_synced', 'position_recorded')`)
        .get(fixture.missionId, corruptProgress.missionEventsTargetRowid)?.total)
      expect(remainingBeforeResume).toBeGreaterThan(0)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).rejects.toMatchObject({
        code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      })
      expect(fixture.db.prepare(`SELECT state, completed_at FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
        state: 'in_progress',
        completed_at: null,
      })
      expect(Number(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND rowid <= ?
          AND event_type IN ('device_updated', 'mission_backup_synced', 'position_recorded')`)
        .get(fixture.missionId, corruptProgress.missionEventsTargetRowid)?.total))
        .toBe(remainingBeforeResume)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(0)
    } finally {
      fixture.db.close()
    }
  })

  it('rejects a replayed older cursor while the guard retains its newer revision', async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      const olderProgressJson = String(fixture.db.prepare(`SELECT progress_json
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)?.progress_json)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>, {
        faultInjection: { simulateKillAfterCommittedBatch: 1 },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      const currentProgressJson = String(fixture.db.prepare(`SELECT progress_json
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)?.progress_json)
      expect(currentProgressJson).not.toBe(olderProgressJson)

      fixture.db.prepare(`UPDATE mission_cleanup_journal SET progress_json = ?
        WHERE mission_id = ?`).run(olderProgressJson, fixture.missionId)
      const rowsBeforeResume = Number(fixture.db.prepare(`SELECT COUNT(*) AS total
        FROM positions WHERE mission_id = ?`).get(fixture.missionId)?.total)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>))
        .rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_JOURNAL_CORRUPT' })

      expect(Number(fixture.db.prepare(`SELECT COUNT(*) AS total
        FROM positions WHERE mission_id = ?`).get(fixture.missionId)?.total))
        .toBe(rowsBeforeResume)
      expect(fixture.db.prepare(`SELECT state, completed_at FROM mission_cleanup_journal
        WHERE mission_id = ?`).get(fixture.missionId)).toMatchObject({
        state: 'in_progress',
        completed_at: null,
      })
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(0)
    } finally {
      fixture.db.close()
    }
  })

  it('resumes telemetry cleanup from its durable rowid window without re-deleting operational events', async () => {
    const fixture = await createFixture({
      beforeFinalization: (db, missionId) => {
        const insert = db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'device_updated', ?, NULL, ?, 'complete')`)
        for (let index = 0; index < 9; index += 1) {
          const timestamp = `2026-08-30T11:20:${String(index).padStart(2, '0')}.000Z`
          insert.run(randomUUID(), missionId, timestamp, timestamp)
        }
      },
    })
    try {
      const insert = fixture.db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (?, ?, ?, ?, NULL, ?, 'complete')`)
      insert.run(
        randomUUID(),
        fixture.missionId,
        'operator_note_recorded',
        '2026-08-30T12:21:00.000Z',
        '2026-08-30T12:21:00.000Z',
      )

      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: {
          simulateKillAfterTableBatch: { tableName: 'mission_events', tableBatch: 1 },
        },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_SIMULATED_KILL' })
      expect(Number(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'device_updated'`)
        .get(fixture.missionId)?.total)).toBeGreaterThan(0)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).resolves.toMatchObject({
        state: 'completed',
      })
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'device_updated'`)
        .get(fixture.missionId)?.total).toBe(0)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'operator_note_recorded'`)
        .get(fixture.missionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('resolves the current finalization by indexed archive-event identity without a mission history scan', async () => {
    const preparedSql: string[] = []
    const fixture = await createFixture({ preparedSql })
    try {
      fixture.db.exec('DROP INDEX IF EXISTS idx_mission_events_replay')

      expect(fixture.coordinator.getEligibility(fixture.evidence)).toMatchObject({ eligible: true })

      const finalizationReads = preparedSql.filter((sql) =>
        sql.includes('event_rowid') && sql.includes('FROM mission_events'))
      expect(finalizationReads.length).toBeGreaterThan(0)
      expect(finalizationReads.every((sql) => /WHERE\s+(?:id|rowid)\s*=\s*\?/iu.test(sql)))
        .toBe(true)
      expect(finalizationReads.some((sql) => /WHERE\s+mission_id\s*=\s*\?/iu.test(sql)))
        .toBe(false)
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
      const failure = await fixture.coordinator.start(fixture.evidence, {
        faultInjection: { failBeforeJournalUpdateForTable: 'positions' },
      }).catch((error: unknown) => error as {
        readonly code?: string
        readonly cleanupDiagnostic?: Readonly<Record<string, unknown>>
      })
      expect(failure).toMatchObject({
        code: 'ARCHIVE_CLEANUP_FAILED',
        cleanupDiagnostic: {
          substage: 'delete_page',
          causeClass: 'internal_failure',
          tableName: 'positions',
          cursor: {
            tableBatch: 0,
            deletedRows: expect.any(Number),
            totalDeletedRows: expect.any(Number),
          },
          workerExit: { observed: false, event: 'none', code: null },
        },
      })
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

  it('resumes after a recorded failure beyond the Replay-generation plan point', async () => {
    const fixture = await createFixture()
    try {
      const replayGenerationBefore = Number(fixture.db.prepare(`SELECT generation
        FROM mission_replay_generations WHERE mission_id = ?`).get(fixture.missionId)?.generation)
      await expect(fixture.coordinator.start(fixture.evidence, {
        faultInjection: { failBeforeSelectForTable: 'positions' },
      })).rejects.toMatchObject({ code: 'ARCHIVE_CLEANUP_FAILED' })

      const journal = fixture.db.prepare(`SELECT progress_json
        FROM mission_cleanup_journal WHERE mission_id = ?`).get(fixture.missionId)
      const progress = JSON.parse(String(journal?.progress_json)) as {
        readonly tables: string[]
        readonly tableIndex: number
      }
      expect(progress.tables).not.toContain('mission_replay_generations')
      expect(progress.tables[progress.tableIndex]).toBe('positions')
      const replayGenerationAfterFailure = Number(fixture.db.prepare(`SELECT generation
        FROM mission_replay_generations WHERE mission_id = ?`).get(fixture.missionId)?.generation)
      expect(replayGenerationAfterFailure).toBeGreaterThan(replayGenerationBefore)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_failed'`)
        .get(fixture.missionId)?.total).toBe(1)

      await expect(fixture.coordinator.resume({
        ...fixture.evidence,
        nonMachineUnwrap: undefined,
      } as unknown as Omit<CleanupEvidence, 'nonMachineUnwrap'>)).resolves.toMatchObject({
        state: 'completed',
        storageState: 'archived',
      })
      expect(fixture.db.prepare(`SELECT COUNT(*) AS total FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`)
        .get(fixture.missionId)?.total).toBe(1)
    } finally {
      fixture.db.close()
    }
  })

  it('attributes failures to the SQL boundary that actually failed', async () => {
    const selectFixture = await createFixture()
    try {
      const selectFailure = await selectFixture.coordinator.start(selectFixture.evidence, {
        faultInjection: { failBeforeSelectForTable: 'positions' },
      }).catch((error: unknown) => error as {
        readonly cleanupDiagnostic?: Readonly<Record<string, unknown>>
      })
      expect(selectFailure).toMatchObject({
        cleanupDiagnostic: {
          substage: 'select_page',
          tableName: 'positions',
        },
      })
    } finally {
      selectFixture.db.close()
    }

    const deleteFixture = await createFixture()
    try {
      const deleteFailure = await deleteFixture.coordinator.start(deleteFixture.evidence, {
        faultInjection: { failBeforeDeleteForTable: 'positions' },
      }).catch((error: unknown) => error as {
        readonly cleanupDiagnostic?: Readonly<Record<string, unknown>>
      })
      expect(deleteFailure).toMatchObject({
        cleanupDiagnostic: {
          substage: 'delete_page',
          tableName: 'positions',
        },
      })
    } finally {
      deleteFixture.db.close()
    }
  })

  it('resets only the current journal cursor for a newly finalized supplemental epoch', async () => {
    const fixture = await createFixture()
    try {
      await fixture.coordinator.start(fixture.evidence)
      const archiveId = randomUUID()
      const requestEventId = randomUUID()
      const sealedEventId = randomUUID()
      const finalizedEventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
      const restoreEventId = randomUUID()
      const correctionOperationId = randomUUID()
      const restoredAt = '2026-08-30T12:30:00.000Z'
      const createdAt = '2026-08-30T13:00:00.000Z'
      const ciphertextSha256 = 'd'.repeat(64)
      const restoreDetails = {
        admin_name: 'Incident Controller',
        reason: 'Correct supplemental mission evidence',
        restored_from_archive_id: fixture.archiveId,
        archive_correction_operation_id: correctionOperationId,
        resulting_status: 'finished',
        storage_state: 'live',
      }
      fixture.db.transaction(() => {
        fixture.db.prepare("UPDATE missions SET status = 'finished' WHERE id = ?")
          .run(fixture.missionId)
        fixture.db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at,
          recording_completeness
        ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
          restoreEventId,
          fixture.missionId,
          restoredAt,
          JSON.stringify(restoreDetails),
          restoredAt,
        )
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
          JSON.stringify({
            archive_id: archiveId,
            archive_path: `/test-archives/${archiveId}.sararch`,
            archive_relative_path: `${archiveId}.sararch`,
            cleanup_membership_generation: readArchiveCleanupMembershipGeneration(
              fixture.db,
              fixture.missionId,
            ),
            container_version: 2,
            resulting_status: 'finalized',
          }),
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

      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId)).toBe('live')
      fixture.db.exec('SAVEPOINT invalid_restore_operation')
      fixture.db.prepare(`UPDATE mission_events SET details_json = ? WHERE id = ?`).run(
        JSON.stringify({ ...restoreDetails, archive_correction_operation_id: '' }),
        restoreEventId,
      )
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
      fixture.db.exec('ROLLBACK TO invalid_restore_operation; RELEASE invalid_restore_operation')

      const cleanupTerminal = readCompletedArchiveCleanupJournalProof(fixture.db, {
        missionId: fixture.missionId,
        archiveId: fixture.archiveId,
      })
      fixture.db.exec('SAVEPOINT restore_before_completion')
      fixture.db.prepare(`UPDATE mission_events SET rowid = (
        SELECT MAX(rowid) + 1 FROM mission_events
      ) WHERE id = ?`).run(cleanupTerminal.completionEventId)
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
      fixture.db.exec('ROLLBACK TO restore_before_completion; RELEASE restore_before_completion')

      fixture.db.exec('SAVEPOINT restore_after_refinalization')
      fixture.db.prepare(`UPDATE mission_events SET rowid = (
        SELECT MAX(rowid) + 1 FROM mission_events
      ) WHERE id = ?`).run(restoreEventId)
      expect(readMissionLiveReviewStorageState(fixture.db, fixture.missionId))
        .toBe('cleanup_in_progress')
      fixture.db.exec('ROLLBACK TO restore_after_refinalization; RELEASE restore_after_refinalization')

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
