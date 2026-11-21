import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { deserialize, serialize } from 'node:v8'

import { afterEach, describe, expect, it } from 'vitest'

import { readRefusedSourcePositions } from '../../src/features/tracking/store-refused-positions'

// DON-338 round 9: the mission store names the rows it refused as source-id
// conflicts in its write acknowledgement, so the tracking runtime can keep
// exactly those observations off the live trail. Counts are unchanged; no
// content of a refused row crosses back, and no "kept" row is invented.

type PositionRow = {
  readonly source_position_id?: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp?: string | null
  readonly timestamp_source?: 'fix' | null
}

type RefusedRow = {
  readonly index: number
  readonly device_id: string
  readonly source_position_id: string
}

type TrackingAck = {
  readonly changedPositionCount: number
  readonly insertedPositionCount: number
  readonly rejectedPositionCount: number
  readonly sourceIdentityConflictCount: number
  readonly missionSourceIdentityConflictTotal: number
  readonly refusedSourceIdentityConflicts: readonly RefusedRow[]
}

type Store = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
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

/** Opens a real store with one mission and two devices. */
async function openMission(
  coverageLedgerFaultInjection?: { readonly afterWrite?: boolean },
): Promise<{ readonly store: Store; readonly missionId: string }> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-refused-rows-'))
  const opened = createElectronMissionStore({
    userDataPath,
    ...(coverageLedgerFaultInjection === undefined ? {} : { coverageLedgerFaultInjection }),
  })
  store = opened
  const mission = await opened.createMission({ name: 'Refused rows' })
  for (const deviceId of ['1', '2']) {
    await opened.upsertDevice({
      mission_id: mission.id,
      device_id: deviceId,
      name: `Unit ${deviceId}`,
      color: '#336699',
      status: 'online',
    })
  }
  return { store: opened, missionId: mission.id }
}

/** One synthetic fix row as the runtime sends it. */
function row(id: string, deviceId: string, lat: number, second = 0): PositionRow {
  return {
    source_position_id: id,
    device_id: deviceId,
    lat,
    lon: -9.7,
    timestamp: new Date(Date.UTC(2026, 10, 7, 9, 59, second)).toISOString(),
    timestamp_source: 'fix',
  }
}

/** The renderer-side observation a row was built from (`id` is the provider id). */
function observation(sent: PositionRow): { readonly id: string; readonly device_id: string } {
  return { id: sent.source_position_id ?? '', device_id: sent.device_id }
}

/** Writes one batch with no checkpoint, the quarantine acknowledgement path. */
function write(opened: { readonly store: Store; readonly missionId: string }, positions: readonly PositionRow[]) {
  return opened.store.persistTrackingPositionsBulk({ mission_id: opened.missionId, positions, checkpoints: [] })
}

describe('[DON-338] the store acknowledgement names the rows it refused as source-id conflicts', () => {
  it('names a refused conflict by its index, device and provider id as sent, and nothing else', async () => {
    const opened = await openMission()
    await write(opened, [row('17', '1', 52.1, 0), row('18', '1', 52.101, 30)])

    const ack = await write(opened, [row('18', '1', 52.101, 30), row('17', '1', 52.2, 0), row('19', '1', 52.102, 45)])

    expect(ack.sourceIdentityConflictCount).toBe(1)
    expect(ack.refusedSourceIdentityConflicts).toEqual([{ index: 1, device_id: '1', source_position_id: '17' }])
    expect(Object.keys(ack.refusedSourceIdentityConflicts[0]!).sort()).toEqual(['device_id', 'index', 'source_position_id'])
    expect(ack.insertedPositionCount).toBe(1)
  })

  it('reports an empty list when nothing was refused, including an empty batch', async () => {
    const opened = await openMission()

    await expect(write(opened, [row('17', '1', 52.1)])).resolves.toMatchObject({ refusedSourceIdentityConflicts: [] })
    await expect(write(opened, [row('17', '1', 52.1)])).resolves.toMatchObject({ refusedSourceIdentityConflicts: [] })
    await expect(write(opened, [])).resolves.toMatchObject({ refusedSourceIdentityConflicts: [] })
  })

  it('names only the refused copy when one batch carries the original and the conflict for the same id', async () => {
    const opened = await openMission()

    const ack = await write(opened, [row('17', '1', 52.1, 0), row('17', '1', 52.2, 0)])

    expect(ack.refusedSourceIdentityConflicts).toEqual([{ index: 1, device_id: '1', source_position_id: '17' }])
    const refused = readRefusedSourcePositions(ack, [observation(row('17', '1', 52.1)), observation(row('17', '1', 52.2))])
    expect(refused).toHaveLength(1)
  })

  it('names an id reused on another device with the device it was sent for (case d)', async () => {
    const opened = await openMission()
    await write(opened, [row('17', '1', 52.1)])

    const ack = await write(opened, [row('17', '2', 52.2)])

    expect(ack.refusedSourceIdentityConflicts).toEqual([{ index: 0, device_id: '2', source_position_id: '17' }])
  })

  it('names refusals inside a checkpointed history piece too', async () => {
    const opened = await openMission()
    await write(opened, [row('17', '1', 52.1, 0)])

    const ack = await opened.store.persistTrackingPositionsBulk({
      mission_id: opened.missionId,
      positions: [row('17', '1', 52.2, 0), row('18', '1', 52.101, 30)],
      checkpoints: [{
        device_id: '1',
        history_from: new Date(Date.UTC(2026, 10, 7, 9, 0, 0)).toISOString(),
        reconciled_until: new Date(Date.UTC(2026, 10, 7, 10, 0, 0)).toISOString(),
      }],
    })

    expect(ack.refusedSourceIdentityConflicts).toEqual([{ index: 0, device_id: '1', source_position_id: '17' }])
  })

  it('returns no list at all from a batch that rolled back', async () => {
    const opened = await openMission({ afterWrite: true })

    await expect(write(opened, [row('17', '1', 52.1)])).rejects.toThrow(/injected coverage ledger failure/i)
    await expect(opened.store.countPositions(opened.missionId)).resolves.toBe(0)
  })
})

describe('[DON-338] the refused-row list survives the IPC contract and is validated on receipt', () => {
  const sent = [observation(row('18', '1', 52.101)), observation(row('17', '1', 52.2))]
  const valid = {
    changedPositionCount: 0,
    insertedPositionCount: 0,
    sourceIdentityConflictCount: 1,
    refusedSourceIdentityConflicts: [{ index: 1, device_id: '1', source_position_id: '17' }],
  }

  it('crosses the structured-clone boundary unchanged and maps back to the observation that was sent', async () => {
    const opened = await openMission()
    await write(opened, [row('17', '1', 52.1, 0)])
    const ack = await write(opened, [row('18', '1', 52.101, 30), row('17', '1', 52.2, 0)])

    // Electron IPC uses the structured-clone algorithm, as v8 serialisation does.
    const received = deserialize(serialize(ack)) as unknown
    expect(received).toEqual(ack)
    expect(readRefusedSourcePositions(received, sent)).toEqual([sent[1]])
  })

  it('maps an empty list to no refused observations', () => {
    expect(readRefusedSourcePositions({ ...valid, sourceIdentityConflictCount: 0, refusedSourceIdentityConflicts: [] }, sent))
      .toEqual([])
  })

  const malformed: readonly (readonly [string, unknown])[] = [
    ['no acknowledgement', undefined],
    ['a missing list', { ...valid, refusedSourceIdentityConflicts: undefined }],
    ['a list that is not an array', { ...valid, refusedSourceIdentityConflicts: 'none' }],
    ['an entry that is not an object', { ...valid, refusedSourceIdentityConflicts: [1] }],
    ['an index outside the batch', { ...valid, refusedSourceIdentityConflicts: [{ index: 2, device_id: '1', source_position_id: '17' }] }],
    ['a fractional index', { ...valid, refusedSourceIdentityConflicts: [{ index: 0.5, device_id: '1', source_position_id: '17' }] }],
    ['an entry naming another device', { ...valid, refusedSourceIdentityConflicts: [{ index: 1, device_id: '2', source_position_id: '17' }] }],
    ['an entry naming another provider id', { ...valid, refusedSourceIdentityConflicts: [{ index: 1, device_id: '1', source_position_id: '18' }] }],
    ['the same row named twice', {
      ...valid,
      sourceIdentityConflictCount: 2,
      refusedSourceIdentityConflicts: [valid.refusedSourceIdentityConflicts[0], valid.refusedSourceIdentityConflicts[0]],
    }],
    ['a list that disagrees with the conflict count', { ...valid, sourceIdentityConflictCount: 2 }],
  ]

  for (const [label, acknowledgement] of malformed) {
    it(`treats ${label} as a persistence failure, in words`, () => {
      expect(() => readRefusedSourcePositions(acknowledgement, sent))
        .toThrow(/Mission storage did not confirm which trail fixes it refused/)
    })
  }
})
