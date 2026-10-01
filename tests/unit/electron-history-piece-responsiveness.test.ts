import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

import { assertReleaseResponsiveness } from '../support/release-responsiveness'
import { persistHistoryChunkInPieces, splitHistoryChunk } from '../../src/features/tracking/split-history-chunk'
import type { TrackingHistoryChunkPersistenceInput } from '../../src/features/tracking/polling-manager'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')

/** One 2 h chunk from a 1 Hz device: the soak's worst case [DON-313]. */
function oneHertzChunk(missionId: string, deviceId: string, historyFromMs: number, startMs: number, rows: number): TrackingHistoryChunkPersistenceInput {
  return {
    phase: 'initial', expectedMissionId: missionId, deviceId,
    historyFrom: new Date(historyFromMs).toISOString(),
    ...(startMs === historyFromMs ? {} : { reconciledFrom: new Date(startMs).toISOString() }),
    reconciledUntil: new Date(startMs + rows * 1_000).toISOString(),
    positions: Array.from({ length: rows }, (_, index) => ({
      id: `${deviceId}-${startMs}-${index}`, device_id: deviceId, lat: 52 + index * 1e-6, lon: -9, altitude: 100,
      speed: 1, battery: 80, accuracy: 5, timestamp: new Date(startMs + index * 1_000).toISOString(), source: 'osmand',
      data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
    })),
  }
}

it('writes a 7,200-fix history chunk without holding the main loop for 200 ms [DON-313]', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sar-history-pieces-'))
  const store = createElectronMissionStore({ userDataPath: directory })
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    const mission = await store.createMission({ name: 'Piece Responsiveness', start_time: '2026-10-01T00:00:00.000Z' })
    await store.upsertDevice({ mission_id: mission.id, device_id: 'walker-1', name: 'Walker', color: '#00AAFF', status: 'online' })
    /** Writes one piece the way the tracking runtime maps it to the store. */
    const write = (piece: TrackingHistoryChunkPersistenceInput) => store.persistTrackingPositionsBulk({
      mission_id: mission.id,
      positions: piece.positions.map((position) => ({
        source_position_id: position.id, device_id: position.device_id, lat: position.lat, lon: position.lon,
        altitude: position.altitude, speed: position.speed, battery: position.battery, accuracy: position.accuracy,
        source: position.source, timestamp: position.timestamp, timestamp_source: 'fix' as const, data_origin: 'live',
      })),
      checkpoints: [{
        device_id: piece.deviceId, history_from: piece.historyFrom,
        ...(piece.reconciledFrom === undefined ? {} : { reconciled_from: piece.reconciledFrom }),
        reconciled_until: piece.reconciledUntil,
      }],
    })
    // A lived-in store first: 24 h of earlier history, written outside the measurement.
    const start = Date.parse('2026-10-01T00:00:00.000Z')
    for (let hour = 0; hour < 12; hour += 1) {
      for (const piece of splitHistoryChunk(oneHertzChunk(mission.id, 'walker-1', start, start + hour * 7_200_000, 7_200))) await write(piece)
    }

    const chunk = oneHertzChunk(mission.id, 'walker-1', start, start + 12 * 7_200_000, 7_200)
    let previous = performance.now()
    let maximumGapMs = 0
    heartbeat = setInterval(() => {
      const now = performance.now()
      maximumGapMs = Math.max(maximumGapMs, now - previous)
      previous = now
    }, 5)
    const started = performance.now()
    // Each piece is its own IPC call in the app, so a task boundary separates them.
    await persistHistoryChunkInPieces(chunk, write, () => new Promise<void>((resolve) => setImmediate(resolve)))
    const totalMs = performance.now() - started
    clearInterval(heartbeat)

    await expect(store.countPositions(mission.id, 'walker-1')).resolves.toBe(13 * 7_200)
    const evidence = { pieces: splitHistoryChunk(chunk).length, maximumGapMs, totalMs }
    process.stdout.write(`History piece responsiveness: ${JSON.stringify(evidence)}\n`)
    assertReleaseResponsiveness(() => expect(maximumGapMs, JSON.stringify(evidence)).toBeLessThan(200))
  } finally {
    clearInterval(heartbeat)
    await store.prepareClose()
    store.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
