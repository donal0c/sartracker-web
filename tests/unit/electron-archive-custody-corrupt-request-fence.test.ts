import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
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
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
  }) => MissionStore
}

type ArchiveKind = 'direct' | 'finalized_recovery'
type InvalidDetailsKind = 'corrupt_json' | 'missing_identity'
type MissionStore = {
  readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<{
    readonly id: string
  }>
  readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
  readonly finalizeMission: (
    missionId: string,
    custody: typeof custody,
  ) => Promise<Readonly<Record<string, unknown>>>
  readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

const custody = Object.freeze({
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})
const temporaryDirectories = new Set<string>()

/** Opens the durable mission database at one test-owned user-data root. */
function openDatabase(userDataPath: string, options: Readonly<Record<string, unknown>> = {}) {
  return new Database(path.join(userDataPath, 'mission-store.sqlite'), options)
}

/** Closes a store after all background work has reached physical exit. */
async function closeStore(store: MissionStore | null) {
  if (store === null) return
  await store.prepareClose()
  store.close()
}

/**
 * Inserts one valid journal-owned v2 request, then damages only its audit details.
 * The active journal, request row identity, and PR5 fence remain exact.
 */
function insertJournalRequestWithInvalidDetails(
  userDataPath: string,
  missionId: string,
  archiveKind: ArchiveKind,
  invalidDetailsKind: InvalidDetailsKind,
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

      const invalidDetails = invalidDetailsKind === 'corrupt_json'
        ? '{"archive_id":'
        : JSON.stringify({
            resulting_status: archiveKind === 'finalized_recovery' ? 'finalized' : 'finished',
            archive_kind: archiveKind,
          })
      db.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?')
        .run(invalidDetails, requestEventId)
    }).immediate()

    return Object.freeze({
      archiveId,
      archiveKind,
      missionId,
      operationId,
      protectedFinalizationEpoch,
      requestEventId,
      requestedAt,
    })
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

describe('corrupt journal-owned archive request migration', () => {
  it.each([
    ['direct', 'corrupt_json'],
    ['direct', 'missing_identity'],
    ['finalized_recovery', 'corrupt_json'],
    ['finalized_recovery', 'missing_identity'],
  ] as const)(
    'preserves the %s PR5 fence when request details are %s',
    async (archiveKind, invalidDetailsKind) => {
      const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-corrupt-fence-'))
      temporaryDirectories.add(userDataPath)
      let initial: MissionStore | null = createElectronMissionStore({ userDataPath })
      const affected = await initial.createMission({
        name: `${archiveKind} corrupt request mission`,
      })
      await initial.finishMission(affected.id)
      const control = await initial.createMission({ name: 'Live-read control mission' })
      await initial.finishMission(control.id)
      await closeStore(initial)
      initial = null

      const expected = insertJournalRequestWithInvalidDetails(
        userDataPath,
        affected.id,
        archiveKind,
        invalidDetailsKind,
      )
      let reopened: MissionStore | null = createElectronMissionStore({ userDataPath })
      try {
        await expect(reopened.getMission(control.id)).resolves.toMatchObject({
          id: control.id,
          status: 'finished',
        })
        await expect(reopened.finalizeMission(control.id, custody)).rejects.toMatchObject({
          code: 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
        })
        await expect(reopened.getMission(affected.id)).resolves.toMatchObject({
          id: affected.id,
          status: archiveKind === 'finalized_recovery' ? 'finalized' : 'finished',
        })

        const db = openDatabase(userDataPath, { readonly: true })
        try {
          const activeRow = db.prepare(`SELECT value FROM metadata
            WHERE key = ?`).get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY)
          const observed = {
            active: activeRow === undefined ? null : JSON.parse(String(activeRow.value)),
            fence: db.prepare(`SELECT requested_at FROM mission_finalization_fences
              WHERE mission_id = ?`).get(affected.id) ?? null,
            legacyFailureCount: Number(db.prepare(`SELECT COUNT(*) AS count
              FROM mission_events
              WHERE mission_id = ? AND event_type = 'mission_archive_failed'`)
              .get(affected.id).count),
          }
          expect(observed).toEqual({
            active: expect.objectContaining({
              archiveId: expected.archiveId,
              archiveKind: expected.archiveKind,
              missionId: expected.missionId,
              operationId: expected.operationId,
              protectedFinalizationEpoch: expected.protectedFinalizationEpoch,
              requestEventId: expected.requestEventId,
              fenceRequestedAt: expected.requestedAt,
              state: 'building',
            }),
            fence: { requested_at: expected.requestedAt },
            legacyFailureCount: 0,
          })
        } finally {
          db.close()
        }
      } finally {
        await closeStore(reopened)
        reopened = null
      }
    },
    30_000,
  )
})
