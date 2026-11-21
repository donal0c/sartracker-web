import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

// DON-338 piece 3 review: every tracking write reports the mission's distinct
// store-refusal total. This measures what that costs on the real store as the
// number of stored refusals grows, against the <200 ms responsiveness budget.

type PositionRow = {
  readonly source_position_id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly timestamp_source: 'fix'
}

type TrackingAck = {
  readonly insertedPositionCount: number
  readonly missionRejectedPositionTotal: number
}

type Store = {
  readonly close: () => void
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly persistTrackingPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly PositionRow[]
    readonly checkpoints: readonly never[]
  }) => Promise<TrackingAck>
}

type SqliteDatabase = {
  readonly pragma: (source: string) => unknown
  readonly transaction: (callback: () => void) => () => void
  readonly close: () => void
}

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (file: string) => SqliteDatabase
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => Store
}
const { recordStoreRejectedPosition, countStoreWriteAnomalies } = require('../../electron/ingest-anomaly-ledger.cjs') as {
  readonly countStoreWriteAnomalies: (db: SqliteDatabase, missionId: string) => { readonly missionRejectedPositionTotal: number }
  readonly recordStoreRejectedPosition: (db: SqliteDatabase, input: {
    readonly missionId: string
    readonly reasonClass: string
    readonly receivedAt: string
    readonly position: Readonly<Record<string, unknown>>
  }) => void
}

const DEVICE_COUNT = 34
const REFUSAL_POPULATIONS = [0, 1_000, 10_000, 100_000] as const
const SAMPLES = 9

let userDataPath: string | undefined
let store: Store | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (userDataPath !== undefined) await rm(userDataPath, { recursive: true, force: true })
  userDataPath = undefined
})

/** Stores `count` distinct refusals through the real ledger function, as the quarantine path does. */
function seedRefusals(databasePath: string, missionId: string, from: number, count: number): void {
  const database = new Database(databasePath)
  try {
    database.pragma('busy_timeout = 5000')
    database.transaction(() => {
      for (let index = from; index < from + count; index += 1) {
        recordStoreRejectedPosition(database, {
          missionId,
          reasonClass: 'store_missing_fix_time',
          receivedAt: '2026-08-09T10:00:00.000Z',
          position: { source_position_id: `refused-${index}`, device_id: `tracker-${index % DEVICE_COUNT}`, lat: 52, lon: -9.7, timestamp: null },
        })
      }
    })()
  } finally {
    database.close()
  }
}

/** Builds one batch of valid fixes that have never been stored. */
function batch(size: number, tag: string): PositionRow[] {
  return Array.from({ length: size }, (_, index) => ({
    source_position_id: `${tag}-${index}`,
    device_id: `tracker-${index % DEVICE_COUNT}`,
    lat: 52 + index / 1_000_000,
    lon: -9.7 - index / 1_000_000,
    timestamp: new Date(Date.UTC(2026, 7, 9, 11, 0, 0) + index * 1_000).toISOString(),
    timestamp_source: 'fix' as const,
  }))
}

/** Returns the median of `values`. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe('store-refusal total cost on every tracking write [DON-338]', () => {
  it('keeps one tracking write well inside the responsiveness budget with up to 100,000 stored refusals', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-refusal-total-cost-'))
    const opened = createElectronMissionStore({ userDataPath })
    store = opened
    const mission = await opened.createMission({ name: 'Refusal total cost' })
    for (let device = 0; device < DEVICE_COUNT; device += 1) {
      await opened.upsertDevice({ mission_id: mission.id, device_id: `tracker-${device}`, name: `Tracker ${device}`, color: '#00AAFF', status: 'online' })
    }
    const databasePath = (await opened.info()).database_path
    const table: { refusals: number; countMs: number; pollMs: number; chunkMs: number }[] = []
    let seeded = 0
    let writes = 0
    for (const population of REFUSAL_POPULATIONS) {
      seedRefusals(databasePath, mission.id, seeded, population - seeded)
      seeded = population
      const counts: number[] = []
      const reader = new Database(databasePath)
      try {
        for (let sample = 0; sample < SAMPLES; sample += 1) {
          const started = performance.now()
          expect(countStoreWriteAnomalies(reader, mission.id).missionRejectedPositionTotal).toBe(population)
          counts.push(performance.now() - started)
        }
      } finally {
        reader.close()
      }
      const poll: number[] = []
      const chunk: number[] = []
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        for (const [size, timings] of [[DEVICE_COUNT, poll], [256, chunk]] as const) {
          writes += 1
          const started = performance.now()
          const ack = await opened.persistTrackingPositionsBulk({
            mission_id: mission.id,
            positions: batch(size, `write-${writes}`),
            checkpoints: [],
          })
          timings.push(performance.now() - started)
          expect(ack.insertedPositionCount).toBe(size)
          expect(ack.missionRejectedPositionTotal).toBe(population)
        }
      }
      table.push({ refusals: population, countMs: median(counts), pollMs: median(poll), chunkMs: median(chunk) })
    }
    console.log(`REFUSAL-TOTAL-COST ${JSON.stringify(table.map((row) => ({
      refusals: row.refusals,
      countMs: Number(row.countMs.toFixed(2)),
      pollMs: Number(row.pollMs.toFixed(2)),
      chunkMs: Number(row.chunkMs.toFixed(2)),
    })))}`)
    // Measured on a developer Mac (median of 9): the count itself is 0.02 ms at 0,
    // 0.04 ms at 1,000, 0.25 ms at 10,000 and 5.8 ms at 100,000 stored refusals; it
    // grows linearly. A 34-fix poll write took 4 to 11 ms and a 256-row chunk 13 to
    // 35 ms (the chunk also grows with the mission's position count). Generous bounds:
    // the count stays a small slice, and a whole write stays well inside 200 ms.
    expect(table.at(-1)!.countMs).toBeLessThan(25)
    for (const row of table) {
      expect(row.pollMs).toBeLessThan(100)
      expect(row.chunkMs).toBeLessThan(100)
    }
  }, 300_000)
})
