import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

import { materializeLegacySchema } from '../../scripts/qualification/legacy-schema-fixtures.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => PromotionStore
}

type CoverageKey = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

type RedeliveredFix = {
  readonly source_position_id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly timestamp_source?: 'fix'
}

type ManifestChunk = {
  readonly key: CoverageKey
  readonly contentRev: number
  readonly builtRev: number | null
  readonly exactCount: number
}

type PromotionStore = {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly addPosition: (input: RedeliveredFix & { readonly mission_id: string }) => Promise<unknown>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly RedeliveredFix[]
  }) => Promise<unknown>
  readonly readCoverageManifest: (missionId: string, requestId?: string) => Promise<{
    readonly chunks: readonly ManifestChunk[]
  }>
  readonly syncCoverageTileCatalog: (
    input: { readonly missionId: string; readonly chunks: readonly { readonly key: CoverageKey; readonly contentRev: number }[] },
    requestId?: string,
  ) => Promise<{ readonly activationId: string }>
  readonly readCoverageClaim: (
    input: { readonly missionId: string; readonly selectedKeys: readonly CoverageKey[] },
    requestId?: string,
  ) => Promise<{ readonly databaseReady: boolean; readonly blockers: readonly string[] }>
  readonly activateCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
  readonly finalizeCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
}

const FENCE_KEY_PREFIX = 'coverage_promotion_fence:'

let directory: string | undefined
let store: PromotionStore | undefined

afterEach(async () => {
  if (store !== undefined) {
    await store.prepareClose().catch(() => undefined)
    store.close()
  }
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** Opens the mission store at the test profile, replacing any prior handle. */
async function reopen(): Promise<PromotionStore> {
  if (store !== undefined) {
    await store.prepareClose()
    store.close()
  }
  store = createElectronMissionStore({ userDataPath: directory! })
  return store
}

/** Reads the manifest and drives the real tile worker through one attested build. */
async function buildCoverage(missionId: string, label: string): Promise<readonly ManifestChunk[]> {
  const manifest = await store!.readCoverageManifest(missionId, `${label}-manifest`)
  const catalog = await store!.syncCoverageTileCatalog({
    missionId,
    chunks: manifest.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })),
  }, `${label}-sync`)
  await store!.activateCoverageTileCatalog({ activationId: catalog.activationId })
  await store!.finalizeCoverageTileCatalog({ activationId: catalog.activationId })
  return manifest.chunks
}

/** Returns exact coverage counts per device for the Unassigned period. */
function countsByDevice(chunks: readonly ManifestChunk[]): Record<string, number> {
  return Object.fromEntries(chunks.map((chunk) => [chunk.key.device_id, chunk.exactCount]))
}

/** Opens the profile database directly for evidence inspection or seeding. */
function openRaw(readonly = false) {
  return new Database(path.join(directory!, 'mission-store.sqlite'), { readonly })
}

/**
 * Reproduces exactly what beta.13.0–13.4 commit for a retained fixTime promotion:
 * the row update and a replay-generation bump in one transaction, with no coverage change.
 */
function simulateBeta134Promotion(missionId: string, sourcePositionId: string, recordedAt: string): void {
  const db = openRaw()
  try {
    db.transaction(() => {
      const promoted = db.prepare(`UPDATE positions SET timestamp_source = 'fix',
        timestamp_provenance_recorded_at = ? WHERE mission_id = ? AND source_position_id = ?
        AND timestamp_source IS NULL`).run(recordedAt, missionId, sourcePositionId)
      expect(promoted.changes).toBe(1)
      db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation) VALUES (?, 1)
        ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`).run(missionId)
    })()
  } finally {
    db.close()
  }
}

/** Reads per-device content revisions for one mission. */
function readRevisions(missionId: string): Record<string, number> {
  const db = openRaw(true)
  try {
    return Object.fromEntries((db.prepare(`SELECT device_id, content_rev FROM coverage_chunks
      WHERE mission_id = ? ORDER BY device_id`).all(missionId) as { device_id: string; content_rev: number }[])
      .map((row) => [row.device_id, row.content_rev]))
  } finally {
    db.close()
  }
}

/** Creates a schema-7 (beta.12.11-era) store with retained legacy fixes for two devices. */
async function seedLegacySchema7Profile(): Promise<{ readonly missionId: string; readonly legacyFixes: readonly RedeliveredFix[] }> {
  const fixture = await materializeLegacySchema(7, path.join(directory!, 'mission-store.sqlite')) as { readonly missionId: string }
  const db = openRaw()
  try {
    db.prepare(`INSERT INTO devices (id, mission_id, device_id, name, color, status)
      VALUES ('legacy-device-2-row', ?, 'legacy-device-2', 'Legacy two', '#00ff00', 'online')`)
      .run(fixture.missionId)
    const insert = db.prepare(`INSERT INTO positions (id, mission_id, device_id, source_position_id, lat, lon, timestamp, data_origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'live')`)
    insert.run('legacy-row-a', fixture.missionId, 'historical-device', 'legacy-source-a', 52.101, -9.501, '2026-08-20T10:00:05.000Z')
    insert.run('legacy-row-b', fixture.missionId, 'legacy-device-2', 'legacy-source-b', 52.2, -9.6, '2026-08-20T10:00:10.000Z')
    insert.run('legacy-row-c', fixture.missionId, 'legacy-device-2', 'legacy-source-c', 52.201, -9.601, '2026-08-20T10:00:15.000Z')
    const legacyFixes = db.prepare(`SELECT source_position_id, device_id, lat, lon, timestamp
      FROM positions WHERE mission_id = ? ORDER BY timestamp, id`).all(fixture.missionId) as RedeliveredFix[]
    return { missionId: fixture.missionId, legacyFixes }
  } finally {
    db.close()
  }
}

describe('legacy fix-time provenance promotion keeps coverage attested [DON-282]', () => {
  it('rebuilds coverage when Traccar re-delivers upgraded 12.11 fixes, and stays stable across restarts', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-don282-legacy-'))
    const { missionId, legacyFixes } = await seedLegacySchema7Profile()
    expect(legacyFixes).toHaveLength(4)

    await reopen()
    // Legacy rows have no authoritative fixTime provenance, so coverage honestly excludes them.
    expect(countsByDevice(await buildCoverage(missionId, 'upgrade'))).toEqual({
      'historical-device': 0,
      'legacy-device-2': 0,
    })

    // Active mission resumes: Traccar re-delivers three of the four retained fixes with fixTime,
    // plus one genuinely new fix.
    const [unconfirmed, ...redelivered] = legacyFixes
    await store!.addPositionsBulk({
      mission_id: missionId,
      positions: [
        ...redelivered.map((fix) => ({ ...fix, timestamp_source: 'fix' as const })),
        {
          source_position_id: 'current-source-d', device_id: 'legacy-device-2',
          lat: 52.202, lon: -9.602, timestamp: '2026-08-20T10:00:20.000Z', timestamp_source: 'fix',
        },
      ],
    })
    const promoted = await buildCoverage(missionId, 'promoted')
    expect(countsByDevice(promoted)).toEqual({ 'historical-device': 1, 'legacy-device-2': 3 })

    const revisionsBeforeRestart = readRevisions(missionId)
    for (const cycle of [1, 2]) {
      await reopen()
      // This build's own promotions are fenced, so an ordinary reopen invalidates nothing.
      expect(readRevisions(missionId)).toEqual(revisionsBeforeRestart)
      const chunks = await buildCoverage(missionId, `restart-${cycle}`)
      expect(countsByDevice(chunks)).toEqual({ 'historical-device': 1, 'legacy-device-2': 3 })
      expect(chunks.every((chunk) => chunk.builtRev === chunk.contentRev)).toBe(true)
    }

    // 12.11 never recorded the requested history window, so the attested build must not
    // be mistaken for reconciled history until live reconciliation records one.
    const claim = await store!.readCoverageClaim({
      missionId,
      selectedKeys: promoted.map((chunk) => chunk.key),
    }, 'legacy-claim')
    expect(claim.databaseReady).toBe(false)
    expect(claim.blockers).toContain('history_reconciliation_incomplete')

    const db = openRaw(true)
    try {
      // Every retained record survives; nothing unknowable is manufactured.
      expect(db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(missionId)).toEqual({ count: 5 })
      expect(db.prepare(`SELECT timestamp_source, received_at, content_hash, source_kind
        FROM positions WHERE source_position_id = ?`).get(unconfirmed.source_position_id)).toEqual({
        timestamp_source: null, received_at: null, content_hash: null, source_kind: null,
      })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM positions
        WHERE id LIKE 'legacy-row-%' AND timestamp_source = 'fix' AND received_at IS NULL`).get())
        .toEqual({ count: 3 })
    } finally {
      db.close()
    }
  })

  it('invalidates coverage for a single-position re-delivery of a legacy fix', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-don282-single-'))
    const { missionId, legacyFixes } = await seedLegacySchema7Profile()
    await reopen()
    await buildCoverage(missionId, 'before')

    const target = legacyFixes.find((fix) => fix.device_id === 'legacy-device-2')!
    await store!.addPosition({ ...target, mission_id: missionId, timestamp_source: 'fix' })

    expect(countsByDevice(await buildCoverage(missionId, 'after'))).toEqual({
      'historical-device': 0,
      'legacy-device-2': 1,
    })
  })

  it('repairs ledgers left stale by beta.13.4 promotions, again after a later rollback, and only then', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-don282-repair-'))
    await reopen()
    const mission = await store!.createMission({ name: 'Stale ledger', start_time: '2026-08-20T09:00:00.000Z' })
    for (const deviceId of ['device-a', 'device-b']) {
      await store!.upsertDevice({ mission_id: mission.id, device_id: deviceId, name: deviceId, color: '#ff0000', status: 'online' })
    }
    await store!.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        { source_position_id: 'a-1', device_id: 'device-a', lat: 52.1, lon: -9.5, timestamp: '2026-08-20T10:00:00.000Z' },
        { source_position_id: 'a-2', device_id: 'device-a', lat: 52.101, lon: -9.501, timestamp: '2026-08-20T10:00:05.000Z' },
        { source_position_id: 'b-1', device_id: 'device-b', lat: 52.2, lon: -9.6, timestamp: '2026-08-20T10:00:00.000Z', timestamp_source: 'fix' },
      ],
    })
    expect(countsByDevice(await buildCoverage(mission.id, 'initial'))).toEqual({ 'device-a': 0, 'device-b': 1 })
    await store!.prepareClose()
    store!.close()
    store = undefined

    // First damage: beta.13.4 promotes a-1 before this build ever opens the store.
    simulateBeta134Promotion(mission.id, 'a-1', '2026-08-20T11:00:00.000Z')
    const damaged = readRevisions(mission.id)
    await reopen()
    const firstRepair = readRevisions(mission.id)
    expect(firstRepair['device-a']).toBe(damaged['device-a'] + 1)
    expect(firstRepair['device-b']).toBe(damaged['device-b'])
    expect(countsByDevice(await buildCoverage(mission.id, 'first-repair'))).toEqual({ 'device-a': 1, 'device-b': 1 })

    await reopen()
    expect(readRevisions(mission.id)).toEqual(firstRepair)
    await buildCoverage(mission.id, 'first-stable')
    await store!.prepareClose()
    store!.close()
    store = undefined

    // Rollback: beta.13.4 runs again after a successful repair and promotes a-2.
    simulateBeta134Promotion(mission.id, 'a-2', '2026-08-20T12:00:00.000Z')
    await reopen()
    const secondRepair = readRevisions(mission.id)
    expect(secondRepair['device-a']).toBe(firstRepair['device-a'] + 1)
    expect(secondRepair['device-b']).toBe(firstRepair['device-b'])
    expect(countsByDevice(await buildCoverage(mission.id, 'second-repair'))).toEqual({ 'device-a': 2, 'device-b': 1 })

    for (const cycle of [1, 2]) {
      await reopen()
      expect(readRevisions(mission.id)).toEqual(secondRepair)
      expect(countsByDevice(await buildCoverage(mission.id, `second-stable-${cycle}`))).toEqual({ 'device-a': 2, 'device-b': 1 })
    }
    const db = openRaw(true)
    try {
      expect(db.prepare('SELECT value FROM metadata WHERE key = ?').get(`${FENCE_KEY_PREFIX}${mission.id}`))
        .toEqual({ value: String((db.prepare('SELECT generation FROM mission_replay_generations WHERE mission_id = ?')
          .get(mission.id) as { generation: number }).generation) })
    } finally {
      db.close()
    }
  })

  it('leaves fresh current-format missions untouched by the repair', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-don282-fresh-'))
    await reopen()
    const mission = await store!.createMission({ name: 'Fresh', start_time: '2026-08-20T09:00:00.000Z' })
    await store!.upsertDevice({ mission_id: mission.id, device_id: 'device-a', name: 'A', color: '#ff0000', status: 'online' })
    await store!.addPositionsBulk({
      mission_id: mission.id,
      positions: [{ source_position_id: 'a-1', device_id: 'device-a', lat: 52.1, lon: -9.5, timestamp: '2026-08-20T10:00:00.000Z', timestamp_source: 'fix' }],
    })
    const first = await buildCoverage(mission.id, 'first')
    await reopen()
    const second = await buildCoverage(mission.id, 'second')
    expect(second).toEqual(first)
    expect(countsByDevice(second)).toEqual({ 'device-a': 1 })
  })
})
