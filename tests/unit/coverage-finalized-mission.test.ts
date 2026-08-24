import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => Store
}

type Store = {
  readonly close: () => void
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (missionId: string) => Promise<unknown>
  readonly readCoverageManifest: (missionId: string, requestId: string) => Promise<Manifest>
}

type Manifest = {
  readonly chunks: readonly {
    readonly key: Readonly<Record<string, string>>
    readonly fixCount: number | null
    readonly fixDigest: string | null
  }[]
}

let directory: string | undefined
let store: Store | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('finalized mission coverage classification [DON-276]', () => {
  it('keeps evidence read-only while allowing an equivalent derived-cache rebuild', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-finalized-coverage-'))
    store = createElectronMissionStore({ userDataPath: directory })
    const mission = await store.createMission({ name: 'Finalized coverage' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'device-1', name: 'Device 1',
      color: '#fff', status: 'online',
    })
    const position = {
      mission_id: mission.id, device_id: 'device-1', source_position_id: 'source-1',
      lat: 52, lon: -9.7, timestamp: '2026-08-24T09:00:00.000Z',
    }
    await store.addPosition(position)
    const before = await store.readCoverageManifest(mission.id, 'before')
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    await expect(store.addPosition({ ...position, source_position_id: 'source-2' }))
      .rejects.toThrow(/finalized|finished|read-only/iu)
    const { database_path: databasePath } = await store.info()
    const database = new Database(databasePath)
    database.prepare('DELETE FROM coverage_invalidations WHERE mission_id = ?').run(mission.id)
    database.prepare('DELETE FROM coverage_chunks WHERE mission_id = ?').run(mission.id)
    database.prepare('DELETE FROM coverage_missions WHERE mission_id = ?').run(mission.id)
    database.close()

    const rebuilt = await store.readCoverageManifest(mission.id, 'rebuilt')
    expect(rebuilt.chunks.map(projectChunk)).toEqual(before.chunks.map(projectChunk))
  })
})

function projectChunk(chunk: Manifest['chunks'][number]) {
  return { key: chunk.key, fixCount: chunk.fixCount, fixDigest: chunk.fixDigest }
}
