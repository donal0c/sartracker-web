import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
  createArchiveCustodyJournal,
} = require('../../electron/archive-custody-journal.cjs') as {
  readonly ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY: string
  readonly createArchiveCustodyJournal: (input: {
    readonly db: InstanceType<typeof Database>
    readonly archiveDirectory: string
  }) => {
    readonly planBuildingWithinTransaction: (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
  }
}
const { startArchiveVerifyWorker } = require('../../electron/archive-verify-runner.cjs') as {
  readonly startArchiveVerifyWorker: (
    input: Readonly<Record<string, unknown>>,
  ) => ArchiveWorkerOperation
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster?: () => Promise<readonly string[]>
    readonly archiveLifecycleFaultInjection?: {
      readonly afterRequestBeforeWorker?: boolean
    }
    readonly startArchiveVerifyWorker?: (
      input: Readonly<Record<string, unknown>>,
    ) => ArchiveWorkerOperation
  }) => MissionStore
}

type ArchiveWorkerOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

type MissionStore = {
  readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<{
    readonly id: string
  }>
  readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
  readonly finalizeMission: (
    missionId: string,
    custody: typeof custody,
  ) => Promise<{
    readonly mission: Readonly<Record<string, unknown>>
    readonly archive: Readonly<Record<string, unknown>>
  }>
  readonly unlockFinalizedMission: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

const custody = Object.freeze({
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})
const temporaryDirectories = new Set<string>()

/** Opens the durable mission database without changing its contents. */
function openDatabase(userDataPath: string, options: Readonly<Record<string, unknown>> = {}) {
  return new Database(path.join(userDataPath, 'mission-store.sqlite'), options)
}

/** Closes one store only after every owned worker has reached physical exit. */
async function closeStore(store: MissionStore | null) {
  if (store === null) return
  await store.prepareClose()
  store.close()
}

/** Inserts one exact journal-owned v2 request and its PR5 fence into a schema-v13 store. */
function insertJournalOwnedArchiveRequest(
  userDataPath: string,
  missionId: string,
  archiveKind: 'direct' | 'finalized_recovery',
) {
  const db = openDatabase(userDataPath)
  try {
    const requestedAt = archiveKind === 'direct'
      ? '2026-08-30T08:00:00.000Z'
      : '2026-08-30T08:01:00.000Z'
    const operationId = randomUUID()
    const archiveId = randomUUID()
    const requestEventId = randomUUID()
    let protectedFinalizationEpoch: number | null = null
    db.transaction(() => {
      if (archiveKind === 'finalized_recovery') {
        const finalizedEventId = randomUUID()
        db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', missionId)
        db.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json,
          recorded_at, recording_completeness
        ) VALUES (?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
          finalizedEventId,
          missionId,
          '2026-08-30T07:59:00.000Z',
          JSON.stringify({ resulting_status: 'finalized', archive_id: randomUUID() }),
          '2026-08-30T07:59:00.000Z',
        )
        protectedFinalizationEpoch = Number(db.prepare(`SELECT rowid FROM mission_events
          WHERE id = ?`).get(finalizedEventId).rowid)
      }

      db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
        VALUES (?, ?)`).run(missionId, requestedAt)
      db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json,
        recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
        requestEventId,
        missionId,
        requestedAt,
        JSON.stringify({
          resulting_status: archiveKind === 'finalized_recovery' ? 'finalized' : 'finished',
          archive_id: archiveId,
          operation_id: operationId,
          archive_kind: archiveKind,
          archive_relative_path: `${archiveId}.sararch`,
          protected_finalization_epoch: protectedFinalizationEpoch,
        }),
        requestedAt,
      )
      const requestEventRowid = Number(db.prepare(`SELECT rowid FROM mission_events
        WHERE id = ?`).get(requestEventId).rowid)
      createArchiveCustodyJournal({
        db,
        archiveDirectory: path.join(userDataPath, 'archives'),
      }).planBuildingWithinTransaction({
        operationId,
        archiveId,
        missionId,
        requestEventRowid,
        requestEventId,
        archiveKind,
        protectedFinalizationEpoch,
        previousArchiveId: null,
        previousArchiveSha256: null,
        fenceRequestedAt: requestedAt,
        createdAt: requestedAt,
        temporaryRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp`,
        finalRelativePath: `${archiveId}.sararch`,
      })
    }).immediate()
    return Object.freeze({ operationId, requestedAt })
  } finally {
    db.close()
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

describe('archive custody lifecycle attacks', () => {
  it('keeps a custody conflict as a durable global archive-lane blocker across restarts', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-custody-conflict-'))
    temporaryDirectories.add(userDataPath)
    let initial: MissionStore | null = createElectronMissionStore({
      userDataPath,
      archiveLifecycleFaultInjection: { afterRequestBeforeWorker: true },
    })
    const conflictedMission = await initial.createMission({ name: 'Conflicted custody mission' })
    await initial.finishMission(conflictedMission.id)
    const controlMission = await initial.createMission({ name: 'Global lane control mission' })
    await initial.finishMission(controlMission.id)
    await expect(initial.finalizeMission(conflictedMission.id, custody)).rejects.toMatchObject({
      code: 'ARCHIVE_SIMULATED_INTERRUPTION',
    })

    const interruptedDb = openDatabase(userDataPath)
    const active = JSON.parse(String(interruptedDb.prepare(`SELECT value FROM metadata
      WHERE key = ?`).get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY).value)) as {
      readonly operationId: string
      readonly fenceRequestedAt: string
    }
    interruptedDb.close()
    mkdirSync(path.join(userDataPath, 'archives', '.staging'), { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(userDataPath, 'archives', '.staging', active.operationId),
      'hostile non-directory custody state',
      { mode: 0o600 },
    )
    initial.close()
    initial = null

    let firstRestart: MissionStore | null = createElectronMissionStore({ userDataPath })
    try {
      await expect(firstRestart.finalizeMission(controlMission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
      })
      const firstRestartDb = openDatabase(userDataPath, { readonly: true })
      try {
        expect(JSON.parse(String(firstRestartDb.prepare(`SELECT value FROM metadata
          WHERE key = ?`).get(`archive_custody_operation:${active.operationId}`).value)))
          .toMatchObject({ state: 'conflict', lastErrorCode: 'cleanup_not_regular' })
        expect(firstRestartDb.prepare(`SELECT requested_at FROM mission_finalization_fences
          WHERE mission_id = ?`).get(conflictedMission.id)).toEqual({
          requested_at: active.fenceRequestedAt,
        })
      } finally {
        firstRestartDb.close()
      }
    } finally {
      await closeStore(firstRestart)
      firstRestart = null
    }

    let secondRestart: MissionStore | null = createElectronMissionStore({
      userDataPath,
      archiveLifecycleFaultInjection: { afterRequestBeforeWorker: true },
    })
    try {
      await expect(secondRestart.finalizeMission(controlMission.id, custody)).rejects.toMatchObject({
        code: 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
      })
      const secondRestartDb = openDatabase(userDataPath, { readonly: true })
      try {
        expect(secondRestartDb.prepare(`SELECT requested_at FROM mission_finalization_fences
          WHERE mission_id = ?`).get(conflictedMission.id)).toEqual({
          requested_at: active.fenceRequestedAt,
        })
      } finally {
        secondRestartDb.close()
      }
    } finally {
      await closeStore(secondRestart)
      secondRestart = null
    }
  }, 30_000)

  it.each(['direct', 'finalized_recovery'] as const)(
    'never migrates away a journal-owned %s archive request fence',
    async (archiveKind) => {
      const userDataPath = mkdtempSync(path.join(tmpdir(), `sartracker-${archiveKind}-fence-`))
      temporaryDirectories.add(userDataPath)
      const initial = createElectronMissionStore({ userDataPath })
      const mission = await initial.createMission({ name: `${archiveKind} fence mission` })
      await initial.finishMission(mission.id)
      await closeStore(initial)

      const fixture = insertJournalOwnedArchiveRequest(
        userDataPath,
        mission.id,
        archiveKind,
      )
      const reopened = createElectronMissionStore({ userDataPath })
      reopened.close()

      const db = openDatabase(userDataPath, { readonly: true })
      try {
        expect(db.prepare(`SELECT requested_at FROM mission_finalization_fences
          WHERE mission_id = ?`).get(mission.id)).toEqual({
          requested_at: fixture.requestedAt,
        })
        expect(JSON.parse(String(db.prepare(`SELECT value FROM metadata
          WHERE key = ?`).get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY).value))).toMatchObject({
          operationId: fixture.operationId,
          archiveKind,
          fenceRequestedAt: fixture.requestedAt,
        })
        expect(db.prepare(`SELECT COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_archive_failed'`).get(mission.id))
          .toEqual({ count: 0 })
      } finally {
        db.close()
      }
    },
  )

  it('blocks correction unlock until delayed verification commits a reviewable predecessor', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-verify-epoch-'))
    temporaryDirectories.add(userDataPath)
    let signalProofReady = () => undefined
    let releaseProof = () => undefined
    const proofReady = new Promise<void>((resolve) => { signalProofReady = resolve })
    const holdProof = new Promise<void>((resolve) => { releaseProof = resolve })
    const delayedVerifier = (input: Readonly<Record<string, unknown>>) => {
      const physical = startArchiveVerifyWorker(input)
      const delayed = physical.then(async (proof) => {
        signalProofReady()
        await holdProof
        return proof
      }) as ArchiveWorkerOperation
      Object.defineProperties(delayed, {
        workerExited: { value: physical.workerExited },
        cancel: { value: () => physical.cancel() },
      })
      return delayed
    }

    let first: MissionStore | null = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveVerifyWorker: delayedVerifier,
    })
    let second: MissionStore | null = null
    let firstFinalization: ReturnType<MissionStore['finalizeMission']> | null = null
    try {
      const mission = await first.createMission({ name: 'Verification epoch race mission' })
      await first.finishMission(mission.id)
      firstFinalization = first.finalizeMission(mission.id, custody)
      await proofReady

      const sealedDb = openDatabase(userDataPath, { readonly: true })
      const firstArchiveId = String(sealedDb.prepare(`SELECT id FROM mission_archives
        WHERE mission_id = ? ORDER BY request_event_rowid DESC LIMIT 1`).get(mission.id).id)
      sealedDb.close()

      await expect(first.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'A correction requires a newer immutable archive epoch.',
      })).rejects.toThrow(/verification.*complete|verified archive/iu)

      releaseProof()
      await expect(firstFinalization).resolves.toMatchObject({
        archive: { id: firstArchiveId, status: 'verified' },
      })

      await expect(first.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'A correction requires a newer immutable archive epoch.',
      })).resolves.toMatchObject({ status: 'finished' })

      second = createElectronMissionStore({ userDataPath })
      const newerFinalization = await second.finalizeMission(mission.id, custody)
      expect(newerFinalization.archive.id).not.toBe(firstArchiveId)

      const finalDb = openDatabase(userDataPath, { readonly: true })
      try {
        expect(finalDb.prepare(`SELECT status, verified_at, verification_proof_json
          FROM mission_archives WHERE id = ?`).get(firstArchiveId)).toMatchObject({
          status: 'superseded',
          verified_at: expect.any(String),
          verification_proof_json: expect.any(String),
        })
      } finally {
        finalDb.close()
      }
    } finally {
      releaseProof()
      await firstFinalization?.catch(() => undefined)
      await closeStore(second)
      second = null
      await closeStore(first)
      first = null
    }
  }, 60_000)
})
