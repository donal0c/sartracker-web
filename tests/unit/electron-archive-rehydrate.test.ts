import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require(
  '../../electron/mission-store.cjs',
) as {
  readonly createElectronMissionStore: (input: Readonly<Record<string, unknown>>) => {
    readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<{ readonly id: string }>
    readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly finalizeMission: (missionId: string, custody: Readonly<Record<string, string>>) => Promise<Readonly<Record<string, unknown>>>
    readonly syncBackup: (trigger?: string) => Promise<unknown>
    readonly startMissionCleanup: (input: Readonly<Record<string, unknown>>, context: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly listDevices: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}
const { rehydrateMissionFromSnapshot } = require('../../electron/archive-rehydrate.cjs') as {
  readonly rehydrateMissionFromSnapshot: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, string>>
}

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('archived mission correction rehydration', () => {
  it('restores the emptied mission namespace from the authenticated snapshot without replacing retained history', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    const custody = {
      passphrase: 'Correct Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Archived correction restore' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'rehydrate-device',
        name: 'Rehydrate Device',
        color: '#0088ff',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'rehydrate-device',
        lat: 52.1,
        lon: -9.1,
        timestamp: '2026-09-02T10:00:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      const snapshotPath = path.join(userDataPath, 'correction-snapshot.sqlite')
      await store.syncBackup('correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '16161616-1616-4616-8616-161616161616',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      expect(await store.getMission(mission.id)).toMatchObject({ storage_state: 'archived' })
      const liveDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 0 })
        rehydrateMissionFromSnapshot({
          db: liveDb,
          snapshotPath,
          missionId: mission.id,
          archiveId,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        })
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 1 })
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 1 })
        expect(liveDb.prepare(`SELECT COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`).get(mission.id))
          .toEqual({ count: 1 })
      } finally {
        liveDb.close()
      }
      expect(readFileSync(snapshotPath).length).toBeGreaterThan(0)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)
})
