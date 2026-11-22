import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

// DON-338 piece 3: position write integrity in the real Electron mission store.
// STO-2: a fix with no observed time must never be stored with an invented time.
// STO-3: one bad row must not block the good rows of its batch, and must be recorded.
// STO-1: a reused Traccar position id keeps today's winner, but is counted out loud.

type PositionRow = {
  readonly source_position_id?: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp?: string | null
  readonly timestamp_source?: 'fix' | null
}

type TrackingAck = {
  readonly changedPositionCount: number
  readonly insertedPositionCount: number
  readonly skippedAmbiguousLegacyAdoptionCount: number
  readonly rejectedPositionCount: number
  readonly sourceIdentityConflictCount: number
  readonly missionRejectedPositionTotal: number
  readonly missionSourceIdentityConflictTotal: number
  readonly refusedSourceIdentityConflicts: readonly {
    readonly index: number
    readonly device_id: string
    readonly source_position_id: string
  }[]
}

type Anomaly = {
  readonly kind: 'rejected' | 'conflict'
  readonly reason_class: string
  readonly device_id: string | null
  readonly source_position_id: string | null
  readonly occurrence_count: number
  readonly canonical_payload_json: string
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
  readonly addPosition: (input: PositionRow & { readonly mission_id: string }) => Promise<unknown>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly PositionRow[]
  }) => Promise<readonly unknown[]>
  readonly persistTrackingPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly PositionRow[]
    readonly checkpoints: readonly {
      readonly device_id: string
      readonly history_from: string
      readonly reconciled_until: string
    }[]
  }) => Promise<TrackingAck>
  readonly countPositions: (missionId: string) => Promise<number>
  readonly listPositions: (missionId: string) => Promise<readonly {
    readonly source_position_id: string | null
    readonly lat: number
    readonly timestamp: string
  }[]>
  readonly listIngestAnomalies: (missionId: string) => Promise<readonly Anomaly[]>
  readonly getIngestEvidenceHealth: (missionId: string) => Promise<{
    readonly rejectedCount: number
    readonly conflictCount: number
  }>
  readonly listTrackingHistoryCheckpoints: (missionId: string) => Promise<readonly {
    readonly device_id: string
    readonly reconciled_until: string
  }[]>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly coverageLedgerFaultInjection?: { readonly afterWrite?: boolean }
  }) => Store
}

let userDataPath: string | undefined
let store: Store | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

/** Opens a real store on a temporary user-data folder with one mission and one device. */
async function openMission(
  coverageLedgerFaultInjection?: { readonly afterWrite?: boolean },
): Promise<{ readonly store: Store; readonly missionId: string }> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-write-integrity-'))
  const opened = createElectronMissionStore({
    userDataPath,
    ...(coverageLedgerFaultInjection === undefined ? {} : { coverageLedgerFaultInjection }),
  })
  store = opened
  const mission = await opened.createMission({ name: 'Write Integrity' })
  await opened.upsertDevice({
    mission_id: mission.id,
    device_id: 'tracker-1',
    name: 'Tracker One',
    color: '#00AAFF',
    status: 'online',
  })
  return { store: opened, missionId: mission.id }
}

/** Builds valid synthetic fixes one second apart. */
function fixes(count: number, prefix = 'source'): PositionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    source_position_id: `${prefix}-${index}`,
    device_id: 'tracker-1',
    lat: 52 + index / 1_000_000,
    lon: -9.7 - index / 1_000_000,
    timestamp: new Date(Date.UTC(2026, 7, 9, 10, 0, index)).toISOString(),
    timestamp_source: 'fix' as const,
  }))
}

describe('mission store position write integrity [DON-338]', () => {
  it('never stores a tracking fix with no observed time; it is refused, recorded and counted (STO-2)', async () => {
    const opened = await openMission()
    const batch = fixes(3)
    batch[1] = { ...batch[1]!, timestamp: null }

    const ack = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId,
      positions: batch,
      checkpoints: [],
    })

    expect(ack).toEqual({
      changedPositionCount: 2,
      insertedPositionCount: 2,
      skippedAmbiguousLegacyAdoptionCount: 0,
      rejectedPositionCount: 1,
      sourceIdentityConflictCount: 0,
      missionRejectedPositionTotal: 1,
      missionSourceIdentityConflictTotal: 0,
      // A malformed row is not a source-id conflict, so it is not named here.
      refusedSourceIdentityConflicts: [],
    })
    const stored = await opened.store.listPositions(opened.missionId)
    expect(stored.map((row) => row.source_position_id).sort()).toEqual(['source-0', 'source-2'])
    const anomalies = await opened.store.listIngestAnomalies(opened.missionId)
    expect(anomalies).toEqual([
      expect.objectContaining({
        kind: 'rejected',
        reason_class: 'store_missing_fix_time',
        device_id: 'tracker-1',
        source_position_id: 'source-1',
        occurrence_count: 1,
      }),
    ])
    expect(JSON.parse(anomalies[0]!.canonical_payload_json)).toMatchObject({ timestamp: null })
    await expect(opened.store.getIngestEvidenceHealth(opened.missionId))
      .resolves.toMatchObject({ rejectedCount: 1, conflictCount: 0 })
  })

  it('refuses a single or array-API position with no time instead of inventing one (STO-2)', async () => {
    const opened = await openMission()
    const [base] = fixes(1)

    await expect(opened.store.addPosition({ ...base!, mission_id: opened.missionId, timestamp: null }))
      .rejects.toThrow(/timestamp is required/i)
    await expect(opened.store.addPosition({
      mission_id: opened.missionId, device_id: 'tracker-1', lat: 52, lon: -9.7,
    })).rejects.toThrow(/timestamp is required/i)
    // The array API returns stored rows only, so it cannot report a partial
    // acceptance: it stays all-or-nothing and names the refused row.
    await expect(opened.store.addPositionsBulk({
      mission_id: opened.missionId,
      positions: [...fixes(2), { ...base!, source_position_id: 'undated', timestamp: undefined }],
    })).rejects.toThrow(/position 3 of 3.*timestamp is required/i)
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(0)
  })

  it('stores the good rows of a 256-row batch around one bad row, and repeat delivery makes progress (STO-3)', async () => {
    const opened = await openMission()
    const batch = fixes(256)
    batch[100] = { ...batch[100]!, lat: 999 }

    const first = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })
    const second = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })

    expect(first).toMatchObject({ insertedPositionCount: 255, rejectedPositionCount: 1 })
    // Per-call counts repeat with each delivery; the mission total stays distinct.
    expect(second).toMatchObject({
      insertedPositionCount: 0, changedPositionCount: 0, rejectedPositionCount: 1, missionRejectedPositionTotal: 1,
    })
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(255)
    const anomalies = await opened.store.listIngestAnomalies(opened.missionId)
    // One durable record per distinct refused row; repeats raise its count.
    expect(anomalies).toEqual([
      expect.objectContaining({
        kind: 'rejected',
        reason_class: 'store_invalid_coordinates',
        source_position_id: 'source-100',
        occurrence_count: 2,
      }),
    ])
    await expect(opened.store.getIngestEvidenceHealth(opened.missionId))
      .resolves.toMatchObject({ rejectedCount: 1 })
  })

  it('names each refusal reason for malformed time, provenance and source identity (STO-3)', async () => {
    const opened = await openMission()
    const batch = fixes(5)
    batch[0] = { ...batch[0]!, timestamp: 'yesterday' }
    batch[1] = { ...batch[1]!, timestamp_source: null }
    batch[2] = { ...batch[2]!, source_position_id: '   ' }
    batch[3] = { ...batch[3]!, lon: Number.NaN }

    const ack = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })

    expect(ack).toMatchObject({ insertedPositionCount: 1, rejectedPositionCount: 4 })
    const reasons = (await opened.store.listIngestAnomalies(opened.missionId))
      .map((anomaly) => anomaly.reason_class).sort()
    expect(reasons).toEqual([
      'store_invalid_coordinates',
      'store_invalid_fix_time',
      'store_invalid_source_identity',
      'store_missing_fix_time_provenance',
    ])
  })

  it('leaves no half-written state when the batch fails after its rows were written', async () => {
    const opened = await openMission({ afterWrite: true })
    const batch = fixes(10)
    batch[4] = { ...batch[4]!, timestamp: null }

    await expect(opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })).rejects.toThrow(/injected coverage ledger failure/i)

    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(0)
    await expect(opened.store.listIngestAnomalies(opened.missionId)).resolves.toEqual([])
    await expect(opened.store.getIngestEvidenceHealth(opened.missionId))
      .resolves.toMatchObject({ rejectedCount: 0 })
  })

  it('stores the other devices\' rows around a fix whose device has no row, and records the refusal (M-34)', async () => {
    const opened = await openMission()
    const batch = fixes(256)
    batch[2] = { ...batch[2]!, device_id: 'tracker-unknown' }

    const first = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })
    const second = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: batch, checkpoints: [],
    })

    expect(first).toMatchObject({ insertedPositionCount: 255, rejectedPositionCount: 1 })
    expect(second).toMatchObject({
      insertedPositionCount: 0, rejectedPositionCount: 1, missionRejectedPositionTotal: 1,
    })
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(255)
    await expect(opened.store.listIngestAnomalies(opened.missionId)).resolves.toEqual([
      expect.objectContaining({
        kind: 'rejected',
        reason_class: 'store_unknown_device',
        device_id: 'tracker-unknown',
        source_position_id: 'source-2',
        occurrence_count: 2,
      }),
    ])
  })

  it('keeps the strict bulk API atomic for a missing device: nothing is written and the error names it', async () => {
    const opened = await openMission()
    const batch = fixes(3)
    batch[2] = { ...batch[2]!, device_id: 'tracker-unknown' }

    await expect(opened.store.addPositionsBulk({
      mission_id: opened.missionId, positions: batch,
    })).rejects.toThrow(/device not found: tracker-unknown/i)
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(0)
  })

  it('fails a checkpointed history piece by name for a device with no row, so no unsaved fix is reported kept (M-34)', async () => {
    const opened = await openMission()
    const batch = fixes(3)
    batch[1] = { ...batch[1]!, device_id: 'tracker-unknown' }

    await expect(opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId,
      positions: batch,
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-09T10:00:00.000Z',
        reconciled_until: '2026-08-09T10:00:02.000Z',
      }],
    })).rejects.toThrow(/device not found: tracker-unknown/i)
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(0)
    await expect(opened.store.listTrackingHistoryCheckpoints(opened.missionId)).resolves.toEqual([])
  })

  it('quarantines a bad row in a checkpointed history piece and still records the checkpoint (STO-3)', async () => {
    const opened = await openMission()
    const batch = fixes(4)
    batch[2] = { ...batch[2]!, timestamp: null }

    const ack = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId,
      positions: batch,
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-09T10:00:00.000Z',
        reconciled_until: '2026-08-09T10:00:03.000Z',
      }],
    })

    expect(ack).toMatchObject({ insertedPositionCount: 3, rejectedPositionCount: 1 })
    await expect(opened.store.listTrackingHistoryCheckpoints(opened.missionId)).resolves.toEqual([
      expect.objectContaining({ device_id: 'tracker-1', reconciled_until: '2026-08-09T10:00:03.000Z' }),
    ])
    await expect(opened.store.listIngestAnomalies(opened.missionId)).resolves.toEqual([
      expect.objectContaining({ kind: 'rejected', reason_class: 'store_missing_fix_time' }),
    ])
  })

  it('counts a reused Traccar position id in the acknowledgement without changing which row wins (STO-1)', async () => {
    const opened = await openMission()
    const [original] = fixes(1, 'reused')
    await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: [original!], checkpoints: [],
    })
    // A reset Traccar numbers positions again: same id, different fix.
    const reused = { ...original!, lat: 53.5, timestamp: '2026-08-09T15:00:00.000Z' }

    const ack = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId, positions: [reused, ...fixes(2, 'fresh')], checkpoints: [],
    })

    expect(ack).toEqual({
      changedPositionCount: 2,
      insertedPositionCount: 2,
      skippedAmbiguousLegacyAdoptionCount: 0,
      rejectedPositionCount: 0,
      sourceIdentityConflictCount: 1,
      missionRejectedPositionTotal: 0,
      missionSourceIdentityConflictTotal: 1,
      // The refused row is named by its batch index and identity as sent [DON-338 round 9].
      refusedSourceIdentityConflicts: [{ index: 0, device_id: 'tracker-1', source_position_id: 'reused-0' }],
    })
    const stored = await opened.store.listPositions(opened.missionId)
    expect(stored.find((row) => row.source_position_id === 'reused-0')).toMatchObject({
      lat: original!.lat,
      timestamp: original!.timestamp,
    })
    await expect(opened.store.listIngestAnomalies(opened.missionId)).resolves.toEqual([
      expect.objectContaining({ kind: 'conflict', source_position_id: 'reused-0' }),
    ])
  })
})
